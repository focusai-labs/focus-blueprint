import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(fileURLToPath(new URL('../plugins/focus-blueprint/scripts/prototype-check.browser.js', import.meta.url)), 'utf8');
const fn = new Function('return ' + text)();
const pure = await fn({ __pure: true });

test('the file is one async arrow function', () => {
  assert.equal(typeof fn, 'function');
  assert.match(text.trimStart(), /^async\s*\(/);
});

test('classify: a go event decides by where it leads', () => {
  assert.equal(pure.classify({ event: { t: 'go', kind: 'built' } }), 'navigates');
  assert.equal(pure.classify({ event: { t: 'go', kind: 'missing' }, changed: true }), 'dead-missing');
  assert.equal(pure.classify({ event: { t: 'go', kind: 'unknown' } }), 'dead-unknown');
});
test('classify: external, demo, changes, nothing', () => {
  assert.equal(pure.classify({ event: { t: 'external' } }), 'external');
  assert.equal(pure.classify({ event: { t: 'demo' } }), 'demo');
  assert.equal(pure.classify({ demoAttr: true, changed: true }), 'demo');
  assert.equal(pure.classify({ changed: true }), 'changes');
  assert.equal(pure.classify({ dialogOpened: true }), 'changes');
  assert.equal(pure.classify({ focusMoved: true }), 'changes');
  assert.equal(pure.classify({}), 'nothing');
  assert.equal(pure.classify(), 'nothing');
});
test('summarize: counts per class, dead is both dead kinds, pass needs no dead and no nothing', () => {
  const mk = (kind) => ({ screen: 's', selector: 'a', name: 'n', kind });
  const ok = pure.summarize([mk('navigates'), mk('changes'), mk('demo'), mk('external')], [{}, {}]);
  assert.deepEqual([ok.screens, ok.controls, ok.navigates, ok.changes, ok.demo, ok.external, ok.dead, ok.nothing, ok.pass], [2, 4, 1, 1, 1, 1, 0, 0, true]);
  const bad = pure.summarize([mk('dead-missing'), mk('dead-unknown'), mk('nothing'), mk('navigates')]);
  assert.equal(bad.dead, 2); assert.equal(bad.nothing, 1); assert.equal(bad.pass, false);
  assert.equal(pure.summarize([mk('nothing')]).pass, false);
  assert.equal(pure.summarize([mk('dead-missing')]).pass, false);
  assert.equal(pure.summarize([]).pass, true);
});
test('stateOf reads the state value of a link', () => {
  assert.equal(pure.stateOf('walk.html?state=empty'), '?state=empty');
  assert.equal(pure.stateOf('walk.html?x=1&state=error#a'), '?state=error');
  assert.equal(pure.stateOf('walk.html'), '');
  assert.equal(pure.stateOf(null), '');
});
