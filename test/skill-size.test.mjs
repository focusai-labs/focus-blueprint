import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const FAIL = 12000;
const WARN = 9000;

function skillFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...skillFiles(p));
    else if (e.name === 'SKILL.md') out.push(p);
  }
  return out;
}

test(`every SKILL.md is under ${FAIL} bytes`, () => {
  const files = skillFiles(path.join(PLUGIN, 'skills'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const size = Buffer.byteLength(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(PLUGIN, f);
    if (size > WARN) console.warn(`WARNING: ${rel} is ${size} bytes (warn above ${WARN}, fail at ${FAIL})`);
    assert.ok(size < FAIL, `${rel} is ${size} bytes`);
  }
});
