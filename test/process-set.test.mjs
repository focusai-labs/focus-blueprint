// T6: `bp process step|timer|case set`, the optional timer stage, and the service `existing` flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject, bp } from './helpers.mjs';

const J = (o) => JSON.stringify(o);
const readMap = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'map.json'), 'utf8'));
const proc = (dir) => readMap(dir).processes[0];

function setup() {
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  bp(dir, ['role', 'add', 'client', '--name', 'לקוח', '--kind', 'user']);
  bp(dir, ['process', 'add', 'collect', '--name', 'איסוף']);
  bp(dir, ['process', 'stage', 'add', 'collect', '--json', J({ id: 'remind', name: 'תזכורת' })]);
  bp(dir, ['process', 'stage', 'add', 'collect', '--json', J({ id: 'upload', name: 'העלאה' })]);
  bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's1', stage: 'remind', actor: 'automation', kind: 'system', text: 'שולחים תזכורת', onFailure: 'התראה', src: 'client' })]);
  bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's2', stage: 'upload', actor: 'role:client', kind: 'human', text: 'הלקוח מעלה קבלה', src: 'client' })]);
  return dir;
}

test('step set merges a partial and keeps every other field', () => {
  const dir = setup();
  const r = bp(dir, ['process', 'step', 'set', 'collect', 's2', '--json', J({ screen: 'mockup/upload.html' })]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.screen, 'mockup/upload.html');
  assert.equal(r.json.text, 'הלקוח מעלה קבלה'); assert.equal(r.json.src, 'client'); assert.deepEqual(r.json.tables, []);
  const s2 = proc(dir).steps.find((s) => s.id === 's2');
  assert.equal(s2.screen, 'mockup/upload.html'); assert.equal(s2.kind, 'human');
  // the build fills table, permission and test later
  const b = bp(dir, ['process', 'step', 'set', 'collect', 's2', '--json', J({ capability: 'upload', tables: ['documents'], permission: 'client:insert:documents:own', test: 'evals/upload.md' })]);
  assert.equal(b.code, 0, b.err);
  assert.deepEqual(proc(dir).steps.find((s) => s.id === 's2').tables, ['documents']);
  assert.equal(proc(dir).steps.find((s) => s.id === 's2').screen, 'mockup/upload.html');
  // null clears a field
  assert.equal(bp(dir, ['process', 'step', 'set', 'collect', 's2', '--json', J({ screen: null })]).json.screen, null);
});

test('step set validates the merged step exactly as add does', () => {
  const dir = setup();
  const before = fs.readFileSync(path.join(dir, '.blueprint', 'map.json'), 'utf8');
  for (const bad of [{ kind: 'magic' }, { stage: 'nope' }, { actor: 'wizard' }, { src: 'who' }, { text: '' }, { tables: 'documents' }, { next: [1] }, { screen: 5 }, { onFailure: ['x'] }]) {
    const r = bp(dir, ['process', 'step', 'set', 'collect', 's1', '--json', J(bad)]);
    assert.equal(r.code, 1, `should refuse ${J(bad)}`);
  }
  assert.equal(fs.readFileSync(path.join(dir, '.blueprint', 'map.json'), 'utf8'), before, 'a refused set writes nothing');
  assert.equal(bp(dir, ['process', 'step', 'set', 'collect', 's9', '--json', J({ text: 'x' })]).code, 1);   // unknown step
  assert.equal(bp(dir, ['process', 'step', 'set', 'nope', 's1', '--json', J({ text: 'x' })]).code, 1);     // unknown process
  assert.equal(bp(dir, ['process', 'step', 'set', 'collect', 's1', '--json', J({ id: 's7' })]).code, 1);  // id cannot change
  assert.equal(bp(dir, ['process', 'step', 'set', 'collect', 's1', '--json', J({ id: 's1', text: 'אותו מזהה' })]).code, 0);
  assert.equal(bp(dir, ['process', 'step', 'set', 'collect', 's1']).code, 1);                               // no --json
  assert.equal(bp(dir, ['process', 'step', 'set', 'collect']).code, 1);                                     // no id
  assert.equal(bp(dir, ['process', 'stage', 'set', 'collect', 'remind', '--json', J({ name: 'x' })]).code, 1);
});

test('step add now refuses the wrong shapes too', () => {
  const dir = setup();
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's3', stage: 'remind', actor: 'ai', kind: 'ai', text: 'x', tables: 'documents' })]).code, 1);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's3', stage: 'remind', actor: 'ai', kind: 'ai', text: '   ' })]).code, 1);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's3', stage: 'remind', actor: 'ai', kind: 'ai', text: 'x', onFailure: 'בדיקה ידנית' })]).code, 0);
});

test('step set keeps the actor list in step with the steps', () => {
  const dir = setup();
  assert.deepEqual(proc(dir).actors, ['automation', 'role:client']);
  bp(dir, ['process', 'step', 'set', 'collect', 's1', '--json', J({ actor: 'ai', kind: 'ai' })]);
  assert.deepEqual(proc(dir).actors, ['role:client', 'ai'], 'the old actor goes when no step uses it');
  bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's3', stage: 'upload', actor: 'role:client', kind: 'human', text: 'עוד צעד' })]);
  bp(dir, ['process', 'step', 'set', 'collect', 's3', '--json', J({ actor: 'server', kind: 'system', onFailure: 'התראה' })]);
  assert.deepEqual(proc(dir).actors, ['role:client', 'ai', 'server'], 'an actor another step still uses stays');
});

test('timer add and set take an optional stage of the same process', () => {
  const dir = setup();
  assert.equal(bp(dir, ['process', 'timer', 'add', 'collect', '--json', J({ id: 't1', text: 'מסמך תקף 90 יום', duration: 'P90D', onExpire: 'התראה', stage: 'upload' })]).code, 0);
  assert.equal(bp(dir, ['process', 'timer', 'add', 'collect', '--json', J({ id: 't2', text: 'בלי שלב' })]).code, 0);
  assert.equal(bp(dir, ['process', 'timer', 'add', 'collect', '--json', J({ id: 't3', text: 'שלב לא קיים', stage: 'nope' })]).code, 1);
  assert.equal(proc(dir).timers.find((t) => t.id === 't1').stage, 'upload');
  const r = bp(dir, ['process', 'timer', 'set', 'collect', 't2', '--json', J({ stage: 'remind', test: 'evals/cases/t2.md' })]);
  assert.equal(r.code, 0, r.err); assert.equal(r.json.stage, 'remind'); assert.equal(r.json.text, 'בלי שלב');
  assert.equal(bp(dir, ['process', 'timer', 'set', 'collect', 't2', '--json', J({ stage: 'nope' })]).code, 1);
  assert.equal(bp(dir, ['process', 'timer', 'set', 'collect', 't2', '--json', J({ stage: null })]).json.stage, null);
  assert.equal(bp(dir, ['process', 'timer', 'set', 'collect', 't2', '--json', J({ text: '' })]).code, 1);
  assert.equal(bp(dir, ['process', 'timer', 'set', 'collect', 't9', '--json', J({ text: 'x' })]).code, 1);
});

test('case set links the acceptance test and validates the kind', () => {
  const dir = setup();
  bp(dir, ['process', 'case', 'add', 'collect', '--json', J({ id: 'c1', kind: 'happy', text: 'הלקוח מעלה שלוש קבלות והכל תקין' })]);
  const r = bp(dir, ['process', 'case', 'set', 'collect', 'c1', '--json', J({ eval: 'evals/cases/collect-c1.md' })]);
  assert.equal(r.code, 0, r.err); assert.equal(r.json.eval, 'evals/cases/collect-c1.md'); assert.equal(r.json.kind, 'happy');
  assert.equal(bp(dir, ['process', 'case', 'set', 'collect', 'c1', '--json', J({ kind: 'odd' })]).code, 1);
  assert.equal(bp(dir, ['process', 'case', 'set', 'collect', 'c1', '--json', J({ eval: 3 })]).code, 1);
  assert.equal(proc(dir).cases[0].eval, 'evals/cases/collect-c1.md');
});

test('service existing must be a boolean', () => {
  const dir = setup();
  assert.equal(bp(dir, ['service', 'add', 'crm', '--json', J({ name: 'Fireberry', existing: 'yes' })]).code, 1);
  const r = bp(dir, ['service', 'add', 'crm', '--json', J({ name: 'Fireberry', purpose: 'ה-CRM שהעסק כבר עובד איתו', existing: true })]);
  assert.equal(r.code, 0, r.err); assert.equal(r.json.existing, true);
  assert.equal(bp(dir, ['service', 'set', 'crm', '--json', J({ existing: 1 })]).code, 1);
  assert.equal(bp(dir, ['service', 'set', 'crm', '--json', J({ existing: false })]).json.existing, false);
});
