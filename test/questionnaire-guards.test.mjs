import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const pages = path.join(PLUGIN, 'ui', 'pages');
const strings = JSON.parse(fs.readFileSync(path.join(pages, 'strings.he.json'), 'utf8'));
const js = fs.readFileSync(path.join(pages, 'ui.js'), 'utf8');

test('F10: next is disabled and aria-disabled while a prefilled answer is unconfirmed, with the muted line', () => {
  assert.equal(strings.questionnaire.confirmFirst, 'קודם מאשרים את התשובה שמולאה, או משנים אותה.');
  assert.match(js, /disabled: pre, 'aria-disabled': pre \? 'true' : null/);
  assert.match(js, /t\('questionnaire\.confirmFirst'\)/);
});

test('F12: the counter has a status note that shows only when the total changed', () => {
  assert.equal(strings.questionnaire.countChanged, 'מספר השאלות השתנה לפי התשובות שלכם.');
  const html = fs.readFileSync(path.join(pages, 'questionnaire.html'), 'utf8');
  assert.match(html, /id="count-note"[^>]*role="status"/);
  assert.match(js, /if \(was && list\.length !== was\) noteCountChange\(\)/);
  assert.match(js, /setTimeout\(\(\) => \{ el\.textContent = ''; \}, 4000\)/);
});

test('E7: every board term has its text, and the board attaches each to its heading', () => {
  const keys = ['summary', 'rulings', 'later', 'evals', 'drift', 'changes', 'mock', 'git', 'prd'];
  for (const k of keys) assert.ok(typeof strings.terms[k] === 'string' && strings.terms[k].length > 0, k);
  assert.equal(strings.terms.summary, 'מה זה?');
  for (const k of ['rulings', 'later', 'evals', 'drift', 'changes', 'mock', 'git']) assert.match(js, new RegExp(`withTerm\\([^\\n]*'${k}'\\)`), k);
  assert.doesNotMatch(js, /withTerm\([^\n]*'prd'\)/, 'the board shows no PRD, so no PRD term is attached');
});
