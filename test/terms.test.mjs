import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const terms = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'terms', 'terms.json'), 'utf8'));
const md = fs.readFileSync(path.join(PLUGIN, 'TERMS.md'), 'utf8');

test('TERMS.md carries the version, the short notice and every clause verbatim', () => {
  assert.ok(md.startsWith('# תנאי השימוש\n'));
  assert.ok(md.includes(`גרסה: ${terms.version}`));
  assert.ok(md.includes(terms.short));
  assert.equal(terms.clauses.length, 10);
  terms.clauses.forEach((c, i) => {
    assert.ok(md.includes(`${i + 1}. **${c.title}**`), c.title);
    assert.ok(md.includes(c.text), c.title);
  });
});
