import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject, bp, PLUGIN } from './helpers.mjs';

const stages = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'stages.json'), 'utf8'));
const req = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'requirements', 'default.json'), 'utf8'));
const setup = () => { const dir = tmpProject(); bp(dir, ['init', '--name', 'x']); return dir; };

test('every stage has a goal and a session model', () => {
  const expected = { 1: 'sonnet', 2: 'fable', 3: 'fable', 4: 'fable', 5: 'fable', 6: 'opus', 7: 'opus', 8: 'fable', 9: 'sonnet', 10: 'opus', 11: 'sonnet', 12: 'opus', 13: 'opus', 14: 'opus', 15: 'opus' };
  for (const s of stages) {
    assert.equal(s.session_model, expected[s.n], `stage ${s.n}`);
    assert.ok(s.goal.startsWith('בשלב הזה'), `goal ${s.n}`);
  }
});

test('stage intro prints the opening and needs no project', () => {
  const dir = tmpProject({ git: false });
  const r = bp(dir, ['stage', 'intro', '3']);
  assert.equal(r.code, 0);
  const lines = r.out.split('\n');
  assert.equal(lines[0], 'זה שלב 3 מתוך 15, שאלון, בפרק "להבין".');
  assert.equal(lines[1], stages[2].goal);
  assert.equal(lines[2], 'מה יהיה נכון בסוף השלב:');
  assert.deepEqual(lines.slice(3, 3 + req.stages['3'].length), req.stages['3'].map((i) => `- ${i}`));
  assert.match(lines[lines.length - 1], /^מומלץ לעבוד בשלב הזה עם Fable/);
});

test('the model line follows session_model', () => {
  assert.match(bp(tmpProject({ git: false }), ['stage', 'intro', '1']).out, /ולכן מספיק לעבוד בו עם Sonnet/);
  assert.match(bp(tmpProject({ git: false }), ['stage', 'intro', '6']).out, /עם Opus, שהוא ברירת המחדל/);
  for (const s of stages) {
    const out = bp(tmpProject({ git: false }), ['stage', 'intro', String(s.n)]).out;
    assert.ok(out.includes(`זה שלב ${s.n} מתוך 15, ${s.name}`), `stage ${s.n}`);
    for (const i of req.stages[String(s.n)] || []) assert.ok(out.includes(`- ${i}`));
  }
});

test('stage start returns the same opening as stage intro', () => {
  const dir = setup();
  const start = bp(dir, ['stage', 'start', '2']).json;
  assert.equal(start.opening, bp(dir, ['stage', 'intro', '2']).out);
  assert.equal(start.stage, 2);
});

test('every stage skill tells Claude to pass the opening on word for word', () => {
  for (const s of stages) {
    const t = fs.readFileSync(path.join(PLUGIN, 'skills', s.skill, 'SKILL.md'), 'utf8');
    assert.ok(t.includes('מעבירים לסטודנט, מילה במילה, את הפתיחה שהפקודה הדפיסה.'), s.skill);
  }
});
