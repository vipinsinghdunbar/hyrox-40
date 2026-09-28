const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const PORT = Number(process.env.PORT || 10000);
const APP_ORIGIN = (process.env.APP_ORIGIN || '').replace(/\/$/, '');
const RP_ID = (process.env.RP_ID || '').toLowerCase();
const DATABASE_URL = process.env.DATABASE_URL || '';
const PG_CONNECTION_STRING = (() => {
  if (!DATABASE_URL) return '';
  try {
    const parsed = new URL(DATABASE_URL);
    // Supabase URIs often add sslmode=require, which the pg URI parser maps to
    // rejectUnauthorized=false. Keep the server's explicit verified TLS config.
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch { return DATABASE_URL; }
})();
const SESSION_COOKIE = 'hyrox40_session';
const SESSION_DAYS = 14;
const CHALLENGE_MINUTES = 5;
const RECOVERY_MINUTES = 30;
const APP_DIR = path.join(__dirname, 'dist');
const isProduction = process.env.NODE_ENV === 'production';

let databaseReady = false;
let databaseError = '';
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: isProduction ? { rejectUnauthorized: true } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', err => console.error('Postgres pool error:', err.message));
}

const mailer = process.env.SMTP_URL
  ? nodemailer.createTransport(process.env.SMTP_URL, { disableFileAccess: true, disableUrlAccess: true })
  : null;
const MAIL_FROM = process.env.MAIL_FROM || '';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '600kb', type: 'application/json' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Please wait a moment before trying again.' },
});
const ceremonyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait and try again.' },
});
app.use('/api', apiLimiter);
app.use('/api/passkey', ceremonyLimiter);
app.use('/api/recovery', ceremonyLimiter);

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function safeSecretEqual(a, b) {
  if (!a || !b) return false;
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}
function validUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(value);
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()) && String(value).length <= 254;
}
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return '';
}
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
}
function clientUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    roles: row.roles,
    recoveryEmailVerified: row.recovery_email_verified,
  };
}
function webauthnReady() {
  return Boolean(APP_ORIGIN && RP_ID && APP_ORIGIN.startsWith('https://'));
}
let schemaLoading = false;
let schemaText = null;
async function ensureDatabase() {
  if (databaseReady) return true;
  if (!pool || schemaLoading) return false;
  schemaLoading = true;
  try {
    schemaText ||= fs.readFileSync(path.join(__dirname, 'sql', 'schema.sql'), 'utf8');
    await pool.query(schemaText);
    databaseReady = true;
    databaseError = '';
    console.log('Account database connected and schema ready.');
    return true;
  } catch (error) {
    databaseError = error.message;
    console.error('Account database is not ready:', error.message);
    return false;
  } finally { schemaLoading = false; }
}
async function requireDatabase(req, res, next) {
  if (!databaseReady) await ensureDatabase();
  if (!databaseReady || !pool) return res.status(503).json({ error: 'Account storage is not connected yet.' });
  next();
}
function requireOrigin(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.get('origin');
    if (origin !== APP_ORIGIN) return res.status(403).json({ error: 'Request origin was not accepted.' });
  }
  next();
}
app.use('/api', requireOrigin);

async function userFromSession(req) {
  if (!databaseReady) return null;
  const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
  if (!token || token.length > 256) return null;
  const result = await pool.query(
    `SELECT u.id,u.username,u.display_name,u.roles,u.recovery_email_verified,s.token_hash
       FROM app_sessions s JOIN app_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW()`,
    [hash(token)]
  );
  if (!result.rowCount) return null;
  pool.query('UPDATE app_sessions SET last_seen_at=NOW() WHERE token_hash=$1', [hash(token)]).catch(() => {});
  return result.rows[0];
}
async function authenticated(req, res, next) {
  try {
    const user = await userFromSession(req);
    if (!user) return res.status(401).json({ error: 'Sign in with your passkey to continue.' });
    req.user = user;
    next();
  } catch (error) {
    console.error('Session lookup failed:', error.message);
    res.status(503).json({ error: 'Account service is temporarily unavailable.' });
  }
}
async function newSession(userId, res) {
  await pool.query('DELETE FROM app_sessions WHERE expires_at<NOW()');
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [hash(token), userId, expires]);
  setSessionCookie(res, token);
}
async function putChallenge(kind, userId, challenge, payload = {}) {
  await pool.query('DELETE FROM webauthn_challenges WHERE expires_at<NOW()');
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO webauthn_challenges(id,kind,user_id,challenge,payload,expires_at)
     VALUES($1,$2,$3,$4,$5,NOW()+($6 * INTERVAL '1 minute'))`,
    [id, kind, userId, challenge, payload, CHALLENGE_MINUTES]
  );
  return id;
}
async function takeChallenge(id, kind) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const result = await pool.query(
    `DELETE FROM webauthn_challenges WHERE id=$1 AND kind=$2 AND expires_at>NOW() RETURNING *`,
    [id, kind]
  );
  return result.rows[0] || null;
}
async function issueEmailToken(userId, purpose, email, subject, routeParam) {
  if (!mailer || !MAIL_FROM || !validEmail(email)) return false;
  const token = randomToken(32);
  const tokenHash = hash(token);
  const expiry = new Date(Date.now() + RECOVERY_MINUTES * 60000);
  await pool.query("DELETE FROM email_tokens WHERE expires_at<NOW() OR used_at<NOW()-INTERVAL '7 days'");
  await pool.query('INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,$4)', [tokenHash, userId, purpose, expiry]);
  const link = `${APP_ORIGIN}/?${routeParam}=${encodeURIComponent(token)}`;
  await mailer.sendMail({
    from: MAIL_FROM,
    to: email,
    subject,
    text: `Use this one-time HYROX 40 link within 30 minutes:\n\n${link}\n\nIf you did not request this, ignore this message.`,
    html: `<p>Use this one-time HYROX 40 link within 30 minutes:</p><p><a href="${link}">Continue securely</a></p><p>If you did not request this, ignore this message.</p>`,
  });
  return true;
}
async function createUserSession(userId, res) {
  await newSession(userId, res);
  const result = await pool.query('SELECT id,username,display_name,roles,recovery_email_verified FROM app_users WHERE id=$1', [userId]);
  return clientUser(result.rows[0]);
}

app.get('/api/health', (req, res) => res.json({ ok: true, database: databaseReady }));
app.get('/api/status', async (req, res) => {
  if (!databaseReady) await ensureDatabase();
  if (!databaseReady) return res.json({ ready: false, registrationOpen: false, adminExists: false, adminSetupConfigured: Boolean(process.env.ADMIN_BOOTSTRAP_CODE), recoveryEmailReady: Boolean(mailer && MAIL_FROM) });
  try {
    const result = await pool.query("SELECT EXISTS(SELECT 1 FROM app_users WHERE 'admin'=ANY(roles)) AS has_admin");
    res.json({
      ready: webauthnReady(),
      registrationOpen: !result.rows[0].has_admin && Boolean(process.env.ADMIN_BOOTSTRAP_CODE),
      adminExists: Boolean(result.rows[0].has_admin),
      adminSetupConfigured: Boolean(process.env.ADMIN_BOOTSTRAP_CODE),
      recoveryEmailReady: Boolean(mailer && MAIL_FROM),
    });
  } catch (error) {
    console.error('Status query failed:', error.message);
    res.status(503).json({ ready: false, registrationOpen: false, recoveryEmailReady: false });
  }
});

app.get('/api/me', requireDatabase, async (req, res) => {
  try {
    const row = await userFromSession(req);
    if (!row) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: clientUser(row) });
  } catch (error) {
    console.error('Account lookup failed:', error.message);
    res.status(503).json({ error: 'Account service is temporarily unavailable.' });
  }
});

app.post('/api/passkey/register/options', requireDatabase, async (req, res) => {
  try {
    if (!webauthnReady()) return res.status(503).json({ error: 'Passkey origin is not configured yet.' });
    const username = normalizeUsername(req.body.username);
    const displayName = String(req.body.displayName || '').trim().slice(0, 64);
    const recoveryEmail = String(req.body.recoveryEmail || '').trim().toLowerCase();
    const bootstrapCode = String(req.body.bootstrapCode || '');
    if (!validUsername(username)) return res.status(400).json({ error: 'Use a 3–30 character username with letters, numbers, dot, dash, or underscore.' });
    if (!displayName) return res.status(400).json({ error: 'Enter your display name.' });
    if (!validEmail(recoveryEmail)) return res.status(400).json({ error: 'Enter a valid recovery email address.' });
    if (!safeSecretEqual(bootstrapCode, process.env.ADMIN_BOOTSTRAP_CODE)) return res.status(403).json({ error: 'The owner setup code is not correct.' });
    const admin = await pool.query("SELECT 1 FROM app_users WHERE 'admin'=ANY(roles) LIMIT 1");
    if (admin.rowCount) return res.status(409).json({ error: 'Owner account is already set up. Use Sign in with passkey.' });
    const duplicate = await pool.query('SELECT 1 FROM app_users WHERE username=$1', [username]);
    if (duplicate.rowCount) return res.status(409).json({ error: 'That username is already used.' });

    const userId = crypto.randomUUID();
    const options = await generateRegistrationOptions({
      rpName: 'HYROX 40',
      rpID: RP_ID,
      userID: Buffer.from(userId.replaceAll('-', ''), 'hex'),
      userName: username,
      userDisplayName: displayName,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60000,
    });
    const attemptId = await putChallenge('register', userId, options.challenge, { username, displayName, recoveryEmail });
    res.json({ attemptId, options });
  } catch (error) {
    console.error('Passkey registration options failed:', error.message);
    res.status(500).json({ error: 'Could not start account setup. Please try again.' });
  }
});

app.post('/api/passkey/register/verify', requireDatabase, async (req, res) => {
  const attempt = await takeChallenge(req.body.attemptId, 'register').catch(() => null);
  if (!attempt) return res.status(400).json({ error: 'Setup expired. Start again.' });
  try {
    const verification = await verifyRegistrationResponse({
      response: req.body.credential,
      expectedChallenge: attempt.challenge,
      expectedOrigin: APP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'The passkey could not be verified.' });
    const info = verification.registrationInfo;
    const credential = info.credential;
    const clientUserRow = await pool.connect();
    let user;
    try {
      await clientUserRow.query('BEGIN');
      await clientUserRow.query("SELECT pg_advisory_xact_lock(74291101)");
      const existingAdmin = await clientUserRow.query("SELECT 1 FROM app_users WHERE 'admin'=ANY(roles) LIMIT 1");
      if (existingAdmin.rowCount) {
        await clientUserRow.query('ROLLBACK');
        return res.status(409).json({ error: 'Owner setup has already been completed.' });
      }
      const inserted = await clientUserRow.query(
        `INSERT INTO app_users(id,username,display_name,recovery_email,roles)
         VALUES($1,$2,$3,$4,ARRAY['admin','athlete']::TEXT[])
         RETURNING id,username,display_name,roles,recovery_email_verified`,
        [attempt.user_id, attempt.payload.username, attempt.payload.displayName, attempt.payload.recoveryEmail]
      );
      user = inserted.rows[0];
      await clientUserRow.query(
        `INSERT INTO passkeys(credential_id,user_id,public_key,counter,transports,device_type,backed_up)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [credential.id, user.id, Buffer.from(credential.publicKey), credential.counter, credential.transports || [], info.credentialDeviceType, info.credentialBackedUp]
      );
      await clientUserRow.query('INSERT INTO account_state(user_id,payload) VALUES($1,$2)', [user.id, {}]);
      await clientUserRow.query('COMMIT');
    } catch (dbError) {
      await clientUserRow.query('ROLLBACK').catch(() => {});
      if (dbError.code === '23505') return res.status(409).json({ error: 'That account or passkey already exists.' });
      throw dbError;
    } finally {
      clientUserRow.release();
    }
    const safeUser = await createUserSession(user.id, res);
    let recoveryEmailSent = false;
    try {
      recoveryEmailSent = await issueEmailToken(user.id, 'verify-recovery-email', user.recovery_email, 'Verify your HYROX 40 recovery email', 'verify-email');
    } catch (mailError) {
      console.error('Recovery verification email could not be sent:', mailError.message);
    }
    res.status(201).json({ user: safeUser, recoveryEmailSent });
  } catch (error) {
    console.error('Passkey registration verification failed:', error.message);
    res.status(400).json({ error: 'Passkey setup did not complete. Please start again.' });
  }
});

app.post('/api/passkey/auth/options', requireDatabase, async (req, res) => {
  try {
    if (!webauthnReady()) return res.status(503).json({ error: 'Passkey origin is not configured yet.' });
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required', timeout: 60000 });
    const attemptId = await putChallenge('authenticate', null, options.challenge, {});
    res.json({ attemptId, options });
  } catch (error) {
    console.error('Passkey sign-in options failed:', error.message);
    res.status(500).json({ error: 'Could not start passkey sign-in. Please try again.' });
  }
});

app.post('/api/passkey/auth/verify', requireDatabase, async (req, res) => {
  const attempt = await takeChallenge(req.body.attemptId, 'authenticate').catch(() => null);
  if (!attempt) return res.status(400).json({ error: 'Sign-in expired. Try again.' });
  try {
    const credentialId = String(req.body.credential?.id || '');
    if (!credentialId) return res.status(400).json({ error: 'No passkey was returned.' });
    const found = await pool.query(
      `SELECT p.credential_id,p.user_id,p.public_key,p.counter,p.transports,
              u.username,u.display_name,u.roles,u.recovery_email_verified
         FROM passkeys p JOIN app_users u ON u.id=p.user_id WHERE p.credential_id=$1`,
      [credentialId]
    );
    if (!found.rowCount) return res.status(401).json({ error: 'No HYROX 40 account matches that passkey.' });
    const passkey = found.rows[0];
    const verification = await verifyAuthenticationResponse({
      response: req.body.credential,
      expectedChallenge: attempt.challenge,
      expectedOrigin: APP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter),
        transports: passkey.transports || [],
      },
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified) return res.status(401).json({ error: 'Passkey verification failed.' });
    await pool.query('UPDATE passkeys SET counter=$1,last_used_at=NOW() WHERE credential_id=$2', [verification.authenticationInfo.newCounter, passkey.credential_id]);
    const user = await createUserSession(passkey.user_id, res);
    res.json({ user });
  } catch (error) {
    console.error('Passkey sign-in verification failed:', error.message);
    res.status(401).json({ error: 'Passkey sign-in did not complete. Please try again.' });
  }
});

app.post('/api/logout', requireDatabase, async (req, res) => {
  const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
  if (token) await pool.query('DELETE FROM app_sessions WHERE token_hash=$1', [hash(token)]).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/state', requireDatabase, authenticated, async (req, res) => {
  const result = await pool.query('SELECT payload,updated_at FROM account_state WHERE user_id=$1', [req.user.id]);
  res.json({ state: result.rows[0]?.payload || null, updatedAt: result.rows[0]?.updated_at || null });
});
app.put('/api/state', requireDatabase, authenticated, async (req, res) => {
  try {
    const input = req.body?.state;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: 'Invalid training data.' });
    const payload = {
      profile: input.profile && typeof input.profile === 'object' ? input.profile : {},
      logs: Array.isArray(input.logs) ? input.logs.slice(-600) : [],
      bodyChecks: Array.isArray(input.bodyChecks) ? input.bodyChecks.slice(-600) : [],
      adjustments: input.adjustments && typeof input.adjustments === 'object' ? input.adjustments : {},
    };
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > 500000) return res.status(413).json({ error: 'Training history is too large to sync.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query('SELECT payload FROM account_state WHERE user_id=$1 FOR UPDATE', [req.user.id]);
      const old = prior.rows[0]?.payload || {};
      const mergeByKey = (previous, incoming, keyOf) => {
        const merged = new Map();
        for (const item of [...(Array.isArray(previous) ? previous : []), ...incoming]) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const key = keyOf(item);
          if (key) merged.set(key, item);
        }
        return [...merged.values()].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).slice(-600);
      };
      payload.logs = mergeByKey(old.logs, payload.logs, item => item.date && item.day !== undefined ? `${item.date}:${item.day}` : '');
      payload.bodyChecks = mergeByKey(old.bodyChecks, payload.bodyChecks, item => item.date ? String(item.date) : '');
      payload.adjustments = { ...(old.adjustments || {}), ...payload.adjustments };
      const mergedJson = JSON.stringify(payload);
      if (Buffer.byteLength(mergedJson, 'utf8') > 500000) {
        await client.query('ROLLBACK');
        return res.status(413).json({ error: 'Training history is too large to sync.' });
      }
      await client.query(
        `INSERT INTO account_state(user_id,payload,updated_at) VALUES($1,$2,NOW())
         ON CONFLICT(user_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,
        [req.user.id, payload]
      );
      await client.query('COMMIT');
    } catch (syncError) {
      await client.query('ROLLBACK').catch(() => {});
      throw syncError;
    } finally { client.release(); }
    res.json({ ok: true });
  } catch (error) {
    console.error('Training data sync failed:', error.message);
    res.status(500).json({ error: 'Training data could not be synced yet.' });
  }
});

app.post('/api/recovery/verify-email', requireDatabase, async (req, res) => {
  const token = String(req.body?.token || '');
  const tokenHash = hash(token);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT user_id FROM email_tokens WHERE token_hash=$1 AND purpose='verify-recovery-email'
       AND expires_at>NOW() AND used_at IS NULL FOR UPDATE`, [tokenHash]
    );
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'That verification link is invalid or expired.' }); }
    const userId = found.rows[0].user_id;
    await client.query('UPDATE app_users SET recovery_email_verified=TRUE,updated_at=NOW() WHERE id=$1', [userId]);
    await client.query('UPDATE email_tokens SET used_at=NOW() WHERE token_hash=$1', [tokenHash]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Email verification could not be completed.' });
  } finally { client.release(); }
});

app.post('/api/recovery/request', requireDatabase, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Return the same response for found and unknown addresses to reduce account enumeration.
  const generic = { ok: true, message: 'If a verified recovery email matches, a link will arrive shortly.' };
  if (!validEmail(email) || !mailer || !MAIL_FROM) return res.json(generic);
  try {
    const user = await pool.query('SELECT id,recovery_email FROM app_users WHERE lower(recovery_email)=lower($1) AND recovery_email_verified=TRUE LIMIT 1', [email]);
    if (user.rowCount) {
      await issueEmailToken(user.rows[0].id, 'recover-passkey', user.rows[0].recovery_email, 'Recover your HYROX 40 passkey', 'recover-passkey');
    }
    res.json(generic);
  } catch (error) {
    console.error('Recovery request failed:', error.message);
    res.json(generic);
  }
});

app.post('/api/recovery/passkey/options', requireDatabase, async (req, res) => {
  try {
    const tokenHash = hash(String(req.body?.token || ''));
    const tokenResult = await pool.query(
      `SELECT t.user_id,u.username,u.display_name FROM email_tokens t
       JOIN app_users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.purpose='recover-passkey'
       AND t.expires_at>NOW() AND t.used_at IS NULL`, [tokenHash]
    );
    if (!tokenResult.rowCount) return res.status(400).json({ error: 'That recovery link is invalid or expired.' });
    const user = tokenResult.rows[0];
    const keys = await pool.query('SELECT credential_id,transports FROM passkeys WHERE user_id=$1', [user.user_id]);
    const options = await generateRegistrationOptions({
      rpName: 'HYROX 40', rpID: RP_ID,
      userID: Buffer.from(user.user_id.replaceAll('-', ''), 'hex'),
      userName: user.username, userDisplayName: user.display_name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: keys.rows.map(k => ({ id: k.credential_id, transports: k.transports || [] })),
      timeout: 60000,
    });
    const attemptId = await putChallenge('recover-register', user.user_id, options.challenge, { tokenHash });
    res.json({ attemptId, options });
  } catch (error) {
    console.error('Recovery passkey setup failed:', error.message);
    res.status(500).json({ error: 'Could not begin passkey recovery.' });
  }
});
app.post('/api/recovery/passkey/verify', requireDatabase, async (req, res) => {
  const attempt = await takeChallenge(req.body.attemptId, 'recover-register').catch(() => null);
  if (!attempt) return res.status(400).json({ error: 'Recovery setup expired. Start again from the email link.' });
  const client = await pool.connect();
  try {
    const verification = await verifyRegistrationResponse({
      response: req.body.credential,
      expectedChallenge: attempt.challenge,
      expectedOrigin: APP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'The replacement passkey could not be verified.' });
    const credential = verification.registrationInfo.credential;
    await client.query('BEGIN');
    const tokenResult = await client.query(
      `SELECT user_id FROM email_tokens WHERE token_hash=$1 AND purpose='recover-passkey'
       AND expires_at>NOW() AND used_at IS NULL FOR UPDATE`, [attempt.payload.tokenHash]
    );
    if (!tokenResult.rowCount || tokenResult.rows[0].user_id !== attempt.user_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That recovery link is invalid or already used.' });
    }
    await client.query(
      `INSERT INTO passkeys(credential_id,user_id,public_key,counter,transports,device_type,backed_up)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [credential.id, attempt.user_id, Buffer.from(credential.publicKey), credential.counter, credential.transports || [], verification.registrationInfo.credentialDeviceType, verification.registrationInfo.credentialBackedUp]
    );
    await client.query('UPDATE email_tokens SET used_at=NOW() WHERE token_hash=$1', [attempt.payload.tokenHash]);
    await client.query('DELETE FROM app_sessions WHERE user_id=$1', [attempt.user_id]);
    await client.query('COMMIT');
    const user = await createUserSession(attempt.user_id, res);
    res.json({ user });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Recovery verification failed:', error.message);
    res.status(400).json({ error: 'Passkey recovery did not complete. Request a fresh link.' });
  } finally { client.release(); }
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.path.endsWith('/sw.js')) res.setHeader('Cache-Control', 'no-cache');
  if (req.path.endsWith('/version.json')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(APP_DIR, { maxAge: isProduction ? '5m' : 0, etag: true, index: false }));
app.get('*path', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(APP_DIR, 'index.html'), error => { if (error) next(error); });
});
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Unhandled request error:', error.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function start() {
  if (DATABASE_URL) await ensureDatabase();
  else {
    databaseError = 'DATABASE_URL not set';
    console.warn('DATABASE_URL is not configured; account endpoints will be unavailable.');
  }
  if (!fs.existsSync(path.join(APP_DIR, 'index.html'))) console.warn('dist/index.html is missing; run npm run build.');
  app.listen(PORT, '0.0.0.0', () => console.log(`HYROX 40 secure app listening on ${PORT}. DB ready: ${databaseReady}`));
}
start().catch(error => {
  console.error('Server startup failed:', error.message);
  process.exit(1);
});
