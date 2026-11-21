import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const DIR = path.join(PLUGIN, 'data', 'questions');
const RANGES = { context: [4, 4], 'round-a': [22, 30], 'round-b': [6, 10], 'round-c': [15, 20], 'round-d': [8, 12] };
const TYPES = ['single', 'multi', 'open', 'scale', 'pairs'];
const TRACK = { 'a-16': 'login', 'a-17': 'data', 'a-18': 'payment', 'a-19': 'background' };

const bank = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
const all = () => Object.keys(RANGES).flatMap((n) => bank(n).questions.map((q) => ({ ...q, bank: n })));

test('every bank exists and its size is within the design range', () => {
  for (const [name, [min, max]] of Object.entries(RANGES)) {
    const b = bank(name);
    assert.equal(b.schema, 1, name);
    assert.ok(b.questions.length >= min && b.questions.length <= max, `${name}: ${b.questions.length}`);
  }
});

test('every entry follows contract C7', () => {
  const ids = new Set();
  for (const q of all()) {
    assert.ok(!ids.has(q.id), `duplicate id ${q.id}`); ids.add(q.id);
    for (const f of ['block', 'text', 'why', 'writes']) assert.ok(typeof q[f] === 'string' && q[f].trim(), `${q.id}.${f}`);
    assert.ok(TYPES.includes(q.type), `${q.id}.type`);
    assert.ok(Array.isArray(q.options), `${q.id}.options`);
    if (q.type === 'single' || q.type === 'multi') assert.ok(q.options.length >= 2 || q.allowOther, `${q.id} needs options`);
    for (const o of q.options) assert.ok(o.v && o.t, `${q.id} option`);
    assert.equal(typeof q.allowOther, 'boolean', `${q.id}.allowOther`);
    assert.equal(typeof q.decideButton, 'boolean', `${q.id}.decideButton`);
    assert.equal(typeof q.prefillable, 'boolean', `${q.id}.prefillable`);
    if (q.type === 'scale' || q.type === 'pairs') assert.equal(q.prefillable, false, `${q.id} cannot be prefilled`);
    if (q.probe) assert.equal(q.prefillable, false, `${q.id} has a probe, so it asks for the student's own view`);
    if (q.default !== null) assert.ok(q.options.some((o) => o.v === q.default), `${q.id}.default is an option`);
    if (q.source) for (const s of q.source) assert.match(s, /^[RSDT]\d+$/, `${q.id}.source`);
  }
});

test('when refers to earlier questions and to their real option values', () => {
  const byId = Object.fromEntries(all().map((q) => [q.id, q]));
  for (const q of all()) {
    for (const [ref, values] of Object.entries(q.when || {})) {
      assert.ok(byId[ref], `${q.id}.when refers to ${ref}`);
      for (const v of values) assert.ok(byId[ref].options.some((o) => o.v === v), `${q.id}.when ${ref}=${v}`);
    }
  }
});

test('context questions and the payment question have no "decide for me" button', () => {
  for (const q of bank('context').questions) assert.equal(q.decideButton, false, q.id);
  for (const q of all().filter((x) => x.block === 'תשלום' || x.id === 'a-18')) assert.equal(q.decideButton, false, q.id);
});

test('the four track questions are in round A as yes or no (the track junction reads them)', () => {
  const a = Object.fromEntries(bank('round-a').questions.map((q) => [q.id, q]));
  for (const [id, key] of Object.entries(TRACK)) {
    assert.ok(a[id], id);
    assert.equal(a[id].type, 'single');
    assert.deepEqual(a[id].options.map((o) => o.v), ['yes', 'no']);
    assert.equal(a[id].writes, `spec.track.${key}`);
    assert.equal(a[id].prefillable, true);
  }
});

test('round C is templated per screen', () => {
  for (const q of bank('round-c').questions) {
    assert.match(q.id, /^c-[a-z]+-\{screen\}$/, q.id);
    assert.ok(q.text.includes('{screen}'), `${q.id} text`);
    assert.ok(q.writes.includes('{screen}'), `${q.id} writes`);
  }
});

test('the "many businesses" answer carries the one-copy-per-client note', () => {
  const c03 = bank('context').questions.find((q) => q.id === 'c-03');
  assert.ok(c03.notes && c03.notes.many && c03.notes.many.includes('עותק נפרד'));
});
