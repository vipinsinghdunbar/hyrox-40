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
  assert.match(js, /role="progressbar"[^>]*aria-labelledby="weekly-sessions-label"[^>]*aria-valuemin="0"[^>]*aria-valuemax="\$\{plannedTotal\}"[^>]*aria-valuenow="\$\{clampedDone\}"/);
  assert.match(js, /Resume active workout/);
  assert.match(js, /Open today’s session/);
  assert.match(css, /\.hero-progress/);
  assert.match(css, /\.next-action-card/);

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
  assert.match(idleHtml, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="5"[^>]*aria-valuenow="0"/);
  assert.match(idleHtml, /class="progress-fill" style="width:0%"/);
  assert.match(idleHtml, /data-action="detail:sled-baseline:2026-09-30">Open today’s session<\/button>/);

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
  assert.match(activeHtml, /data-action="resume:active-1">Resume active workout<\/button>/);
  assert.match(activeHtml, /data-action="detail:sled-baseline:2026-09-30">Open today’s session<\/button>/);
});
