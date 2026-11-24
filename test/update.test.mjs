// bp update refreshes the plugin copies inside a project; session-start flags a stale copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { bp, hook, PLUGIN } from './helpers.mjs';
import { tmpProject } from './helpers.mjs';

function project() {
  const dir = tmpProject();
  const r = bp(dir, ['init', '--name', 'demo']);
  assert.equal(r.code, 0, r.err);
  return dir;
}
const read = (dir, ...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const modelFile = fs.readdirSync(path.join(PLUGIN, 'scripts', 'blueprint-model')).find((f) => f.endsWith('.mjs'));

test('update refreshes stale copies and leaves student files alone', () => {
  const dir = project();
  const check = path.join(dir, 'scripts', 'blueprint-check.mjs');
  fs.writeFileSync(check, '// old');
  fs.writeFileSync(path.join(dir, 'scripts', 'blueprint-model', modelFile), '// old');
  fs.writeFileSync(path.join(dir, '.blueprint', 'dimensions.json'), '[]');
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'blueprint-check.yml'), '# old');
  fs.writeFileSync(path.join(dir, 'student.txt'), 'mine');
  const before = Object.fromEntries(['state.json', 'map.json', 'changes.json'].map((f) => [f, read(dir, '.blueprint', f)]));
  const r = bp(dir, ['update']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.changed.includes('scripts/blueprint-check.mjs'));
  assert.ok(r.json.changed.includes(`scripts/blueprint-model/${modelFile}`));
  assert.ok(r.json.changed.includes('.blueprint/dimensions.json'));
  assert.ok(r.json.changed.includes('.github/workflows/blueprint-check.yml'));
  assert.equal(read(dir, 'scripts', 'blueprint-check.mjs'), fs.readFileSync(path.join(PLUGIN, 'scripts', 'check-map.mjs'), 'utf8'));
  assert.equal(read(dir, 'student.txt'), 'mine');
  for (const f of Object.keys(before)) assert.equal(read(dir, '.blueprint', f), before[f]);
  assert.deepEqual(bp(dir, ['update']).json.changed, []);
});

const start = (dir) => hook('session-start', { cwd: dir, source: 'startup' });

test('session-start flags a stale copy and is silent on a fresh one', () => {
  const dir = project();
  const fresh = start(dir).json;
  assert.doesNotMatch(fresh.hookSpecificOutput.additionalContext, /older than the installed plugin/);
  assert.doesNotMatch(fresh.systemMessage || '', /ישן/);
  fs.writeFileSync(path.join(dir, 'scripts', 'blueprint-check.mjs'), '// old');
  const stale = start(dir).json;
  assert.match(stale.hookSpecificOutput.additionalContext, /The project's copy of the Blueprint checker is older than the installed plugin\. Run: node ".*bp\.mjs" update/);
  assert.match(stale.systemMessage, /הבודק שבתוך הפרויקט ישן מהגרסה המותקנת של הכלי\. Claude יעדכן אותו עם bp update\./);
  bp(dir, ['update']);
  assert.doesNotMatch(start(dir).json.hookSpecificOutput.additionalContext, /older than the installed plugin/);
  fs.writeFileSync(path.join(dir, 'scripts', 'blueprint-model', modelFile), '// old');
  assert.match(start(dir).json.hookSpecificOutput.additionalContext, /older than the installed plugin/);
});
