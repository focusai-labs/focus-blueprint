import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const principlesFile = path.join(PLUGIN, 'data', 'ux', 'principles.json');
const uxCheckFile = path.join(PLUGIN, 'scripts', 'ux-check.browser.js');
const MUST = 'R8 S1 S2 S13 S14 D6 D7 D12 D15 D16 D17 D33 D34 D39 D40 D41 D43 D45 D46 D47 D48 T1 T2 T3'.split(' ');
const TEXT_FIELDS = ['chapter', 'topic', 'name', 'says', 'why', 'test', 'prevents'];

const load = () => JSON.parse(fs.readFileSync(principlesFile, 'utf8'));

test('principles.json follows contract C8', () => {
  const data = load();
  assert.equal(data.schema, 1);
  const list = data.principles;
  assert.equal(list.length, 78);
  const ids = list.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const p of list) {
    assert.match(p.id, /^(R([1-9]|1[01])|S([1-9]|1[0-4])|D([1-9]|[1-3]\d|4[0-9])|T[1-4])$/, p.id);
    for (const f of TEXT_FIELDS) assert.ok(typeof p[f] === 'string' && p[f].trim().length > 0, `${p.id}.${f}`);
    assert.ok(['must', 'should'].includes(p.level), `${p.id}.level`);
    assert.ok(Array.isArray(p.stages) && p.stages.length > 0, `${p.id}.stages`);
    for (const s of p.stages) assert.ok(Number.isInteger(s) && s >= 1 && s <= 15, `${p.id} stage ${s}`);
    assert.match(p.check, /^(review|auto:[a-z-]+(,[a-z-]+)*)$/, `${p.id}.check`);
  }
});

test('the must level is exactly the agreed list', () => {
  const must = load().principles.filter((p) => p.level === 'must').map((p) => p.id).sort();
  assert.deepEqual(must, [...MUST].sort());
});

test('no figures in the wording: thresholds live only in the check script', () => {
  for (const p of load().principles) {
    for (const f of TEXT_FIELDS) assert.doesNotMatch(p[f], /\d/, `${p.id}.${f} contains a digit`);
  }
});

test('every principle is Hebrew-led (lines open with a Hebrew letter or a quote)', () => {
  for (const p of load().principles) {
    for (const f of TEXT_FIELDS) assert.match(p[f], /^["'(]?[֐-׿]/, `${p.id}.${f}`);
  }
});

test('auto check ids match the ids exported by ux-check.browser.js', (t) => {
  if (!fs.existsSync(uxCheckFile)) { t.skip('ux-check.browser.js is built in Task 10'); return; }
  const src = fs.readFileSync(uxCheckFile, 'utf8');
  const m = src.match(/\/\*\s*ids:\s*(\[[^\]]*\])\s*\*\//);
  assert.ok(m, 'the trailing /* ids: [...] */ comment exists');
  const scriptIds = new Set(JSON.parse(m[1]));
  const principleIds = new Set(load().principles.filter((p) => p.check.startsWith('auto:')).flatMap((p) => p.check.slice(5).split(',')));
  assert.deepEqual([...principleIds].sort(), [...scriptIds].sort());
});
