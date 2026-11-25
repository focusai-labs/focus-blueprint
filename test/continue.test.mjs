import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject, bp, hook, PLUGIN } from './helpers.mjs';

const stages = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'stages.json'), 'utf8'));
const at = (n) => stages.find((s) => s.n === n);
const stateFile = (dir) => path.join(dir, '.blueprint', 'state.json');
const readState = (dir) => JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
/** A project whose current stage is n, started. */
function atStage(n) {
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  const s = readState(dir);
  s.stage = n; s.stages = { [n]: { status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z', branch: `stage-${n}` } };
  fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  return dir;
}
const close = (dir, n) => bp(dir, ['stage', 'done', String(n), '--status', 'done', '--proof', 'ok']).json;

test('session-start on compact records session.compactedAt, other sources do not', () => {
  const dir = atStage(3);
  hook('session-start', { cwd: dir, source: 'startup' });
  assert.equal(readState(dir).session, undefined);
  hook('session-start', { cwd: dir, source: 'compact' });
  const c = readState(dir).session.compactedAt;
  assert.ok(!Number.isNaN(Date.parse(c)));
  assert.equal(readState(dir).stage, 3);
});

test('stage done: same chapter continues here', () => {
  const r = close(atStage(2), 2);
  assert.equal(r.continueHere, true);
  assert.equal(r.next, 'השלב הבא הוא שלב 3, שאלון, באותו פרק, ולכן אפשר להמשיך אליו כאן, באותה שיחה.');
});

test('stage done: a new chapter asks for a new conversation', () => {
  const r = close(atStage(5), 5);
  assert.equal(r.continueHere, false);
  assert.equal(r.next, `השלב הבא הוא שלב 6, ${at(6).name}, והוא פותח את הפרק "${at(6).chapter}". כדי שיתחיל עם הקשר נקי, פותחים שיחה חדשה ומקלידים /focus-blueprint:${at(6).skill}`);
});

test('stage done: stage 12 always gets its own conversation', () => {
  const r = close(atStage(11), 11);
  assert.equal(r.continueHere, false);
  assert.equal(r.next, `השלב הבא הוא שלב 12, ${at(12).name}. כל יכולת נבנית בשיחה חדשה משלה, ולכן פותחים שיחה חדשה ומקלידים /focus-blueprint:${at(12).skill}`);
});

test('stage done: after a compaction the next stage is a new conversation', () => {
  const dir = atStage(2);
  const s = readState(dir); s.session = { compactedAt: '2026-06-01T00:00:00.000Z' };
  fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  const r = close(dir, 2);
  assert.equal(r.continueHere, false);
  assert.equal(r.next, `השלב הבא הוא שלב 3, ${at(3).name}. השיחה הזאת כבר נדחסה, ולכן פותחים שיחה חדשה ומקלידים /focus-blueprint:${at(3).skill}`);
});

test('stage done: a compaction before the stage started does not count', () => {
  const dir = atStage(2);
  const s = readState(dir); s.session = { compactedAt: '2025-12-01T00:00:00.000Z' };
  fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  assert.equal(close(dir, 2).continueHere, true);
});

test('stage done: stage 15 keeps the last line and has no continueHere', () => {
  const r = close(atStage(15), 15);
  assert.equal(r.next, 'זה היה השלב האחרון, וכל 15 השלבים הושלמו.');
  assert.equal(r.continueHere, undefined);
});

test('stage next prints the header and the next skill body with the plugin root filled in', () => {
  const dir = atStage(2);
  close(dir, 2);
  const r = bp(dir, ['stage', 'next']);
  assert.equal(r.code, 0);
  const lines = r.out.split('\n');
  assert.equal(lines[0], `ממשיכים לשלב 3, ${at(3).name}, באותה שיחה. מכאן עובדים לפי ההוראות של השלב, כמו אחרי /focus-blueprint:${at(3).skill}.`);
  assert.ok(!r.out.includes('${CLAUDE_PLUGIN_ROOT}'));
  assert.ok(!r.out.includes('disable-model-invocation'));
  assert.ok(r.out.includes(PLUGIN));
  assert.equal(readState(dir).stage, 3);
  assert.equal(readState(dir).stages['3'], undefined, 'it never starts a stage');
});

test('stage next on a never-started current stage prints that stage', () => {
  const dir = atStage(4);
  const s = readState(dir); s.stages = {}; fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  assert.ok(bp(dir, ['stage', 'next']).out.startsWith(`ממשיכים לשלב 4, ${at(4).name}`));
});

test('stage next refuses while the current stage is open', () => {
  const dir = atStage(3);
  const r = bp(dir, ['stage', 'next']);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes('השלב הנוכחי עוד לא נסגר, ולכן אי אפשר להתחיל את השלב הבא. קודם סוגרים אותו.'));
});

test('the shared next-stage instructions exist and every stage skill stays small', () => {
  assert.ok(fs.existsSync(path.join(PLUGIN, 'skills', 'blueprint', 'references', 'next-stage.md')));
});
