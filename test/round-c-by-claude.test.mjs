import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject, bp, PLUGIN } from './helpers.mjs';
import { questionsFor, progress } from '../plugins/focus-blueprint/ui/lib.mjs';
import { startUi } from '../plugins/focus-blueprint/ui/server.mjs';

const STUDENT = ['c-who', 'c-send', 'c-undo'];
const bank = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'questions', 'round-c.json'), 'utf8')).questions;

function project() {
  const map = { schema: 2, capabilities: [], tables: [], automations: [], later: [], screens: [
    { file: 'mockup/home.html', name: 'הבית' }, { file: 'mockup/list.html', name: 'הרשימה' }] };
  const dir = tmpProject({ state: { schema: 2, project: 'בדיקה', stage: 7, status: 'in_progress', stages: {}, pending: [], connections: {}, where: {} }, map });
  fs.mkdirSync(path.join(dir, 'mockup'));
  for (const f of ['home', 'list']) fs.writeFileSync(path.join(dir, 'mockup', `${f}.html`), '<p>x</p>');
  return dir;
}

test('the bank marks 13 questions "by": "claude" and keeps who, send and undo for the student', () => {
  const by = bank.filter((q) => q.by === 'claude');
  assert.equal(by.length, 13);
  assert.deepEqual(bank.filter((q) => q.by !== 'claude').map((q) => q.id.replace('-{screen}', '')).sort(), [...STUDENT].sort());
});

test('questionsFor leaves the Claude questions out unless asked, and progress counts only the student ones', () => {
  const dir = project();
  const qs = questionsFor(dir, 'c');
  assert.equal(qs.length, 6);
  assert.ok(qs.every((q) => q.by !== 'claude'));
  assert.equal(questionsFor(dir, 'c', { includeClaude: true }).length, 32);
  assert.equal(progress(dir, 'round-c').total, 6);
});

test('bp answer set writes a Claude answer, validates round C ids per built screen, and the board does not list it as pending', async () => {
  const dir = project();
  const r = bp(dir, ['answer', 'set', 'c', 'c-click-mockup-home', '--value', 'לחיצה כפולה נבדקה, נשלחת פעם אחת']);
  assert.equal(r.code, 0, r.err);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'ui', 'answers', 'round-c.json'), 'utf8'));
  assert.equal(saved.answers['c-click-mockup-home'].value, 'לחיצה כפולה נבדקה, נשלחת פעם אחת');
  assert.equal(saved.answers['c-click-mockup-home'].decidedBy, 'claude');
  assert.equal(bp(dir, ['answer', 'set', 'c', 'c-click-{screen}', '--value', 'x']).code, 1, 'the template id is not a real id');
  assert.equal(bp(dir, ['answer', 'set', 'c', 'c-click-nowhere', '--value', 'x']).code, 1, 'an unbuilt screen');
  assert.equal(bp(dir, ['answer', 'set', 'c', 'c-click-mockup-list']).code, 1, 'a value is required');
  assert.equal(bp(dir, ['answer', 'set', 'z', 'c-click-mockup-list', '--value', 'x']).code, 1, 'a bad round');
  const ui = await startUi({ projectDir: dir });
  try {
    const st = await (await fetch(`${ui.url}api/state`)).json();
    assert.deepEqual(st.pendingQuestions, []);
    const q = await (await fetch(`${ui.url}api/questions?round=c`)).json();
    assert.equal(q.questions.length, 6);
  } finally { ui.close(); await ui.closed; }
});
