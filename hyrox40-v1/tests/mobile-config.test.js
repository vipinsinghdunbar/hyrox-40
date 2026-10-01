'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src/app.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'hyrox40-plan-config.json'), 'utf8'));

test('mobile shell declares a viewport and notch-safe insets', () => {
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  assert.match(css, /env\(safe-area-inset-(top|bottom|left|right)\)/);
});

test('mobile layout constrains overflow and flex/grid children at narrow widths', () => {
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /@media\s*\(max-width:\s*360px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,minmax\(0,1fr\)\)/);
});

test('the prototype has a single local-first navigation shell and no goal picker', () => {
  assert.match(html, /class="bottom-nav"/);
  assert.doesNotMatch(html, /Choose 2.?3 goals/i);
  assert.doesNotMatch(JSON.stringify(config), /goalQuestionnaire|goalPicker/i);
});

test('plan draft stays visibly unapproved and does not prescribe sled weight', () => {
  assert.equal(config.review.status, 'pending-qualified-coach-review');
  const sled = config.baselineWeek.flatMap(day => day.segments).filter(s => String(s.type).includes('sled'));
  assert.ok(sled.length >= 2);
  assert.ok(sled.every(s => s.weightKg == null));
  assert.equal(config.targetRules.status, 'incomplete-pending-plan-config');
});

test('animated HYROX landing reuses the app logo and holds the app until entry', () => {
  const js = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.match(html, /id="launch-screen"/);
  assert.match(html, /class="launch-logo" src="icon\.svg"/);
  assert.match(html, /id="launch-enter"[^>]*disabled/);
  assert.match(html, /id="launch-resume"[^>]*hidden disabled/);
  assert.match(html, /class="app-shell" aria-hidden="true"/);
  assert.match(css, /\.app-shell\{visibility:hidden\}/);
  assert.match(js, /await repo\.requestPersistentStorage\(\);await refreshData\(\);[\s\S]*?enterButton\.disabled=false/);
  assert.match(js, /resumeButton\.hidden=false;resumeButton\.disabled=false/);
  assert.match(js, /function enterApp\(resumeActive=false\)/);
});

test('landing motion respects reduced-motion and exposes visible keyboard focus', () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.launch-grid[\s\S]*?animation:none!important/);
  assert.match(css, /\.launch-button:focus-visible\{outline:/);
  assert.match(html, /role="status" aria-live="polite"/);
});

test('Today screen defines weekly focus hierarchy, accessible sessions-logged progress bar, and clear next actions', async () => {
  const vm = require('node:vm');
  const T = require('../src/timer-engine.js');
  const js = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');

  assert.match(js, /aria-labelledby="weekly-focus-title"/);
  assert.match(js, /<p class="week-label">WEEKLY FOCUS<\/p>/);
  assert.match(js, /id="weekly-sessions-count"[^>]*aria-live="polite"/);
  assert.match(js, /role="progressbar"[^>]*aria-labelledby="weekly-sessions-label"[^>]*aria-describedby="weekly-sessions-summary"[^>]*aria-valuemin="0"[^>]*aria-valuemax="\$\{plannedTotal\}"[^>]*aria-valuenow="\$\{clampedDone\}"/);
  assert.match(js, /Resume active workout/);
  assert.match(js, /Open today’s session/);
  assert.match(css, /\.hero-progress/);
  assert.match(css, /\.next-action-card/);
  assert.match(css, /\.next-action-button/);

  async function renderTodayInSandbox({ sessions = [], calendar = {}, fixedDate = new Date(2026, 8, 30, 12, 0, 0) } = {}) {
    const elements = new Map();
    const makeEl = id => ({
      id,
      innerHTML: '',
      textContent: '',
      title: '',
      hidden: false,
      disabled: false,
      value: '',
      returnValue: '',
      dataset: {},
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      addEventListener(type, fn) { this[`on_${type}`] = fn; },
      focus() {},
      click() {},
      closest() { return null; },
    });
    for (const id of ['screen', 'toast', 'connection-state', 'backup-shortcut', 'import-file', 'confirm-dialog', 'launch-enter', 'launch-resume', 'launch-actions', 'launch-status']) {
      elements.set(id, makeEl(id));
    }
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) return new RealDate(fixedDate.getTime());
        return new RealDate(...args);
      }
      static now() { return fixedDate.getTime(); }
      static UTC(...args) { return RealDate.UTC(...args); }
    }
    const meta = { profile: config.athleteDefaults, measurements: [], calendar, program: { startWeek: '2026-09-28' } };
    const windowObj = {
      Date: FixedDate,
      HyroxTimer: T,
      HyroxStorage: {
        createRepository: () => ({
          requestPersistentStorage: async () => true,
          list: async () => sessions,
          getMetadata: async (k, fb) => (k in meta ? meta[k] : fb),
          setMetadata: async (k, v) => { meta[k] = v; return v; },
        }),
      },
      navigator: { onLine: true },
      location: { protocol: 'http:', hostname: 'localhost' },
      document: {
        body: makeEl('body'),
        getElementById: id => elements.get(id) || makeEl(id),
        querySelector: () => makeEl('qs'),
        querySelectorAll: () => [],
        addEventListener() {},
      },
      fetch: async () => ({ ok: true, json: async () => config }),
      addEventListener() {},
      requestAnimationFrame: fn => fn(),
      scrollTo() {},
      setInterval: () => 1,
      clearTimeout() {},
      setTimeout: () => 1,
    };
    windowObj.window = windowObj;
    vm.runInNewContext(js, windowObj);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    elements.get('launch-enter').on_click();
    return elements.get('screen').innerHTML;
  }

  const idleHtml = await renderTodayInSandbox();
  assert.match(idleHtml, /<p class="week-label">WEEKLY FOCUS<\/p>/);
  assert.match(idleHtml, /<h2 id="weekly-focus-title" class="hero-focus">Baseline &amp; movement quality<\/h2>/);
  assert.match(idleHtml, /0 of 5 sessions logged/);
  assert.match(idleHtml, /role="progressbar"[^>]*aria-describedby="weekly-sessions-summary"[^>]*aria-valuemin="0"[^>]*aria-valuemax="5"[^>]*aria-valuenow="0"/);
  assert.match(idleHtml, /class="progress-fill" style="width:0%"/);
  assert.match(idleHtml, /id="weekly-sessions-summary"[^>]*><span>0% complete<\/span><span>5 sessions remaining this week<\/span>/);
  assert.match(idleHtml, /class="calendar-day today [^"]*" aria-current="date"/);
  assert.match(idleHtml, /class="button button-primary next-action-button" data-action="detail:sled-baseline:2026-09-30">Open today’s session<\/button>/);

  const activeSession = T.startSession(
    T.createSession({ id: 'active-1', date: '2026-09-30', planDay: 'sled-baseline', segments: config.baselineWeek[2].segments }, 1000),
    2000
  );
  const activeHtml = await renderTodayInSandbox({
    sessions: [activeSession],
    calendar: {
      '2026-09-28': { status: 'completed' },
      '2026-09-29': { status: 'completed' },
    },
  });
  assert.match(activeHtml, /2 of 5 sessions logged/);
  assert.match(activeHtml, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="5"[^>]*aria-valuenow="2"/);
  assert.match(activeHtml, /class="progress-fill" style="width:40%"/);
  assert.match(activeHtml, /id="weekly-sessions-summary"[^>]*><span>40% complete<\/span><span>3 sessions remaining this week<\/span>/);
  assert.match(activeHtml, /class="button button-primary next-action-button" data-action="resume:active-1">Resume active workout<\/button>/);
  assert.match(activeHtml, /data-action="detail:sled-baseline:2026-09-30">Open today’s session<\/button>/);

  const recoveryHtml = await renderTodayInSandbox({
    fixedDate: new Date(2026, 9, 3, 12, 0, 0),
    calendar: { '2026-10-03': { status: 'completed' } },
  });
  assert.match(recoveryHtml, /0 of 5 sessions logged/, 'a recovery-day status must not inflate planned-session progress');
  assert.match(recoveryHtml, /NEXT ACTION · RECOVERY DAY/);
  assert.match(recoveryHtml, /data-action="detail:run-intervals:2026-10-05">Open next session<\/button>/);
  assert.doesNotMatch(recoveryHtml, />Open today’s session<\/button>/);
});

test('the public product name is HYROX wherever users see it', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const js = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(manifest.name, 'HYROX — Local Training');
  assert.equal(manifest.short_name, 'HYROX');
  assert.match(html, /<title>HYROX — Training<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="HYROX">/);
  assert.match(html, /<strong>HYROX<\/strong>/);
  assert.match(html, /<h1 id="launch-title">BUILT FOR<br><span>THE NEXT<\/span><br>RACE\.<\/h1>/, 'the launch tagline must not keep the old "40" brand motif');
  assert.match(html, /alt="HYROX logo"/);
  assert.match(html, /aria-label="HYROX home"/);
  assert.doesNotMatch(pkg.description, /HYROX 40/);

  for (const file of ['index.html', 'manifest.webmanifest', 'package.json', 'service-worker.js', 'src/app.js', 'src/storage.js', 'src/timer-engine.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /HYROX 40/, `${file} still shows the old product name`);
  }

  // the exported backup filename is user-visible and renamed; the on-disk format identifier is not
  assert.match(js, /a\.download=`hyrox-backup-\$\{localDateKey\(\)\}\.json`/);
  assert.doesNotMatch(js, /hyrox40-backup/);
  assert.match(storage, /format: 'hyrox40-local-backup'/);
  assert.match(storage, /backup\.format !== 'hyrox40-local-backup'/);
  assert.match(storage, /not a supported HYROX backup\./);
});

test('internal identifiers, deploy target and training content paths are unchanged', () => {
  const js = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');

  assert.equal(pkg.name, 'hyrox40-local-v1');
  assert.match(storage, /const DB_NAME = 'hyrox40-local-v1';/);
  assert.match(js, /fetch\('\.\/hyrox40-plan-config\.json'\)/);
  assert.match(sw, /'\.\/hyrox40-plan-config\.json'/);
  assert.match(render, /name: hyrox40-v1/);
});

test('installed PWAs receive the update: worker bytes change and the app reloads once on takeover', () => {
  const js = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

  const version = sw.match(/const CACHE = 'hyrox40-v(\d+\.\d+\.\d+)';/);
  assert.ok(version, 'the service worker must declare a versioned hyrox40- cache');
  const rank = value => value.split('.').reduce((total, part) => total * 1000 + Number(part), 0);
  assert.ok(rank(version[1]) > rank('1.2.0'), 'the cache version must be bumped whenever shipped bytes change');

  assert.match(sw, /k\.startsWith\('hyrox40-'\) && k !== CACHE/, 'stale hyrox40- caches must still be purged');
  assert.match(sw, /self\.skipWaiting\(\)/, 'a new worker must activate without waiting for other tabs');
  assert.match(js, /registration\.update\(\)/, 'the app must ask for a worker update on start');
  assert.match(js, /addEventListener\('controllerchange'/, 'a takeover must be noticed so the page refreshes');
  assert.match(js, /swUpdateHandled/, 'the refresh must be one-shot to avoid reload loops');
});

function createServiceWorkerHarness({ existingCaches = [], fetchImpl } = {}) {
  const vm = require('node:vm');
  const script = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  const listeners = {};
  const cachesMap = new Map(existingCaches.map(name => [name, new Set(['./index.html', './manifest.webmanifest'])]));
  const self = {
    location: { origin: 'https://hyrox-40-secure.onrender.com' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => { self.skippedWaiting = true; },
    clients: { claim: async () => { self.claimedClients = true; } },
  };
  const urlOf = request => request.url || String(request);
  const caches = {
    open: async name => {
      const set = cachesMap.get(name) || new Set();
      cachesMap.set(name, set);
      return {
        addAll: async urls => urls.forEach(url => set.add(url)),
        put: async request => set.add(urlOf(request)),
        match: async request => (set.has(urlOf(request)) ? { cached: urlOf(request) } : undefined),
      };
    },
    keys: async () => [...cachesMap.keys()],
    delete: async name => cachesMap.delete(name),
    match: async request => {
      for (const set of cachesMap.values()) if (set.has(urlOf(request))) return { cached: urlOf(request) };
      return undefined;
    },
  };
  vm.runInNewContext(script, { self, caches, URL, fetch: fetchImpl });
  return { listeners, cachesMap, self };
}

test('service-worker lifecycle refreshes an installed app and purges the superseded brand cache', async () => {
  const { listeners, cachesMap, self } = createServiceWorkerHarness({ existingCaches: ['hyrox40-v1.2.0'] });

  const install = [];
  listeners.install({ waitUntil: promise => install.push(promise) });
  await Promise.all(install);
  assert.equal(self.skippedWaiting, true, 'a new worker must activate immediately');

  const current = [...cachesMap.keys()].filter(name => name.startsWith('hyrox40-') && name !== 'hyrox40-v1.2.0');
  assert.equal(current.length, 1, 'exactly one new versioned cache must be precached');
  const cached = cachesMap.get(current[0]);
  for (const file of ['./index.html', './manifest.webmanifest', './src/app.js', './src/storage.js']) {
    assert.ok(cached.has(file), `${file} must be precached so the rename reaches installed apps`);
  }

  const activate = [];
  listeners.activate({ waitUntil: promise => activate.push(promise) });
  await Promise.all(activate);
  assert.equal(self.claimedClients, true, 'the new worker must take over open clients');
  assert.ok(!cachesMap.has('hyrox40-v1.2.0'), 'the pre-rename cache must be deleted so old names cannot be served');
});

test('a navigation never stays pinned to the old shell but still loads offline', async () => {
  const navigation = { method: 'GET', mode: 'navigate', url: 'https://hyrox-40-secure.onrender.com/' };
  const onlineCalls = [];
  const online = createServiceWorkerHarness({ fetchImpl: async request => { onlineCalls.push(request); return { ok: true, clone: () => ({ ok: true, copy: true }) }; } });
  let onlineResponse;
  online.listeners.fetch({ request: navigation, respondWith: promise => { onlineResponse = promise; } });
  assert.equal(onlineCalls.length, 1, 'a navigation must try the network first, so a cached old shell cannot win');
  assert.equal((await onlineResponse).ok, true, 'the fresh network shell must be used');

  const offline = createServiceWorkerHarness({ existingCaches: ['hyrox40-v1.3.0'], fetchImpl: async () => { throw new Error('offline'); } });
  offline.cachesMap.get('hyrox40-v1.3.0').add(navigation.url);
  let offlineResponse;
  offline.listeners.fetch({ request: navigation, respondWith: promise => { offlineResponse = promise; } });
  assert.equal((await offlineResponse).cached, navigation.url, 'offline launches must still resolve to the cached shell');
});
