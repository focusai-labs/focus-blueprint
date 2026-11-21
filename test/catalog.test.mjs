import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const dir = path.join(PLUGIN, 'data', 'catalog');
const examples = path.join(dir, 'examples');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const KINDS = ['visual', 'nav', 'structure', 'login', 'density'];
const cards = (kind) => read(path.join(dir, `${kind}.json`));
const all = KINDS.flatMap(cards);
const rounds = read(path.join(PLUGIN, 'data', 'questions', 'round-b.json')).questions;
const QUESTION = { visual: 'b-03', nav: 'b-04', density: 'b-05', structure: 'b-06', login: 'b-07' };

test('there are eighteen cards', () => {
  assert.equal(all.length, 18);
});

test('every card has an example file with dir="rtl"', () => {
  for (const c of all) {
    const f = path.join(examples, c.example);
    assert.ok(fs.existsSync(f), `${c.example} exists`);
    assert.match(fs.readFileSync(f, 'utf8'), /<html[^>]*\bdir="rtl"/, `${c.example} dir=rtl`);
  }
});

test('no example references http', () => {
  for (const c of all) assert.doesNotMatch(fs.readFileSync(path.join(examples, c.example), 'utf8'), /http/i, c.example);
});

test('every example is under 6 KB', () => {
  for (const c of all) assert.ok(fs.statSync(path.join(examples, c.example)).size < 6 * 1024, c.example);
});

test('card ids match the option values of questions b-03 to b-07', () => {
  for (const kind of KINDS) {
    const q = rounds.find((x) => x.id === QUESTION[kind]);
    assert.ok(q, QUESTION[kind]);
    assert.deepEqual(cards(kind).map((c) => c.id).sort(), q.options.map((o) => o.v).sort(), kind);
  }
});
