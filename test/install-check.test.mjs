import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN } from './helpers.mjs';

test('install-check prints the documented JSON shape', () => {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'install-check.mjs')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.node, /^v\d+\.\d+\.\d+/);
  assert.equal(typeof out.nodeOk, 'boolean');
  assert.equal(out.nodeOk, Number(process.versions.node.split('.')[0]) >= 22);
  assert.equal(typeof out.git, 'boolean');
  assert.ok([true, false, 'unknown'].includes(out.playwrightMcp));
  assert.ok(out.superpowers && typeof out.superpowers === 'object');
  assert.ok([true, false, 'unknown'].includes(out.superpowers.installed));
  assert.ok(out.superpowers.version === null || typeof out.superpowers.version === 'string');
});

test('install-check reports unknown, not a hang, when claude is missing', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-bin-'));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'install-check.mjs')], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: bin },
  });
  fs.rmSync(bin, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.playwrightMcp, 'unknown');
  assert.equal(out.superpowers.installed, 'unknown');
});
