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
