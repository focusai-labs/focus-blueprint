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
