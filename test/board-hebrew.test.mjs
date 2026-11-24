import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pages = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'focus-blueprint', 'ui', 'pages');
const strings = JSON.parse(fs.readFileSync(path.join(pages, 'strings.he.json'), 'utf8'));
const js = fs.readFileSync(path.join(pages, 'ui.js'), 'utf8');

test('board: every status and change-log word has a Hebrew string', () => {
  assert.deepEqual(strings.board.statuses, {
    not_started: 'עוד לא התחיל', in_progress: 'בעבודה', done: 'הושלם', done_with_concerns: 'הושלם עם הערות',
    blocked: 'תקוע', needs_context: 'מחכה למידע',
  });
  assert.equal(strings.board.decisions_words.now, 'עכשיו');
  assert.equal(strings.board.decisions_words.later, 'אחר כך');
});
test('board: the change log translates the decision, and the map card has one sentence', () => {
  assert.ok(!js.includes('(${c.decision})'), 'raw decision in the change log');
  assert.ok(js.includes('decisionWord(c.decision)'));
  assert.equal(strings.board.capabilities, 'יכולות: {real} אמיתיות מתוך {total}, ו-{mock} עם נתוני דמה');
  assert.match(js, /t\('board\.capabilities', \{ real, total: map\.capabilities\.length, mock:/);
  assert.ok(!/kv\(t\('board\.capabilities'/.test(js), 'no key: value wrapper around the capabilities sentence');
});
