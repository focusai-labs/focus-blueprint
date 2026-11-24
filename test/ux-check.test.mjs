import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(fileURLToPath(new URL('../plugins/focus-blueprint/scripts/ux-check.browser.js', import.meta.url)), 'utf8');
const results = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/ux/results/${name}.json`, import.meta.url)), 'utf8'));
const EXPECTED = ['contrast-text', 'primary-count', 'target-size', 'tab-order', 'field-labels', 'typing-replaceable', 'required-gate', 'inline-error-slot', 'destructive-adjacency', 'destructive-confirm', 'opt-in-prechecked', 'line-length', 'rtl-direction', 'anchor-home', 'feedback-states', 'loading-state', 'color-alone', 'persist-input', 'motion', 'desktop-width'];
const PHONE_ONLY = ['target-size'];
const DESKTOP_ONLY = ['tab-order', 'line-length', 'feedback-states', 'desktop-width'];

test('the file is one arrow function', () => {
  const fn = new Function('return ' + text)();
  assert.equal(typeof fn, 'function');
  assert.match(text.trimStart(), /^\(\)\s*=>/);
});

const ids = JSON.parse(text.match(/\/\*\s*ids:\s*(\[[^\]]*\])\s*\*\/\s*$/)?.[1] ?? 'null');

test('trailing ids comment lists the 20 checks', () => {
  assert.deepEqual(ids, EXPECTED);
});

test('every id has a block in the source', () => {
  for (const id of ids) assert.ok(new RegExp(`add\\('${id}'|skip\\('${id}'`).test(text), `no block for ${id}`);
});

const applies = (id, vp) => !(PHONE_ONLY.includes(id) && vp !== 'phone') && !(DESKTOP_ONLY.includes(id) && vp !== 'desktop');

for (const vp of ['desktop', 'phone']) {
  test(`pass.html passes every check at ${vp}`, () => {
    const r = results(`pass.${vp}`).results;
    assert.deepEqual(r.map((x) => x.id), EXPECTED);
    for (const x of r) {
      assert.ok(x.pass, `${x.id}: ${x.details.join('; ')}`);
      assert.equal(x.level, applies(x.id, vp) ? 'pass' : 'skip', x.id);
    }
  });
  test(`fail-all.html fails every applicable check at ${vp}`, () => {
    const r = results(`fail-all.${vp}`).results;
    assert.deepEqual(r.map((x) => x.id), EXPECTED);
    for (const x of r) {
      if (x.id === 'desktop-width') continue; // covered by its own fixtures below
      if (applies(x.id, vp)) { assert.equal(x.pass, false, `${x.id} should fail`); assert.ok(['fail', 'warn'].includes(x.level)); assert.ok(x.details.length > 0, x.id); }
      else assert.equal(x.level, 'skip', x.id);
    }
  });
}

test('desktop-width: a 480px centered column fails at 1280, with the percentage in the message', () => {
  const x = results('width-fail.desktop').results.find((r) => r.id === 'desktop-width');
  assert.equal(x.pass, false);
  assert.equal(x.level, 'warn');
  assert.match(x.details[0], /^ברוחב של מחשב המסך תופס רק \d+% מהרוחב\. כדאי לפרוס אותו לשתי עמודות או להוסיף חלונית צד\.$/);
  assert.ok(Number(x.details[0].match(/(\d+)%/)[1]) < 55);
});
test('desktop-width: a two-column layout passes at 1280', () => {
  const x = results('width-pass.desktop').results.find((r) => r.id === 'desktop-width');
  assert.equal(x.pass, true);
  assert.equal(x.level, 'pass');
  assert.deepEqual(x.details, []);
});
test('desktop-width is bound to D50 as an auto check, and S5 stays a review', () => {
  const p = JSON.parse(readFileSync(fileURLToPath(new URL('../plugins/focus-blueprint/data/ux/principles.json', import.meta.url)), 'utf8')).principles.find((q) => q.id === 'D50');
  assert.equal(p.check, 'auto:desktop-width');
  const s5 = JSON.parse(readFileSync(fileURLToPath(new URL('../plugins/focus-blueprint/data/ux/principles.json', import.meta.url)), 'utf8')).principles.find((q) => q.id === 'S5');
  assert.equal(s5.check, 'review');
});
