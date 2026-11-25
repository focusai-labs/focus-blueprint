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

test('install-check parses claude --version and compares it with 2.1.277', async () => {
  const { parseClaudeVersion, versionAtLeast } = await import('../plugins/focus-blueprint/scripts/install-check.mjs');
  assert.equal(parseClaudeVersion('2.1.283 (Claude Code)\n'), '2.1.283');
  assert.equal(parseClaudeVersion('Claude Code v2.1.277'), '2.1.277');
  assert.equal(parseClaudeVersion(''), 'unknown');
  assert.equal(parseClaudeVersion('command not found'), 'unknown');
  assert.equal(parseClaudeVersion(null), 'unknown');
  assert.equal(versionAtLeast('2.1.277'), true);
  assert.equal(versionAtLeast('2.1.278'), true);
  assert.equal(versionAtLeast('2.2.0'), true);
  assert.equal(versionAtLeast('10.0.0'), true);
  assert.equal(versionAtLeast('2.1.276'), false);
  assert.equal(versionAtLeast('2.0.999'), false);
  assert.equal(versionAtLeast('unknown'), false);
});

test('install-check reports claudeCli, a fake claude is read, a missing one is unknown', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-bin-'));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const run = () => JSON.parse(spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'install-check.mjs')], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: bin } }).stdout);
  let out = run();
  assert.deepEqual(out.claudeCli, { version: 'unknown', ok: null });
  if (process.platform !== 'win32') {
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.290 (Claude Code)"\n', { mode: 0o755 });
    out = run();
    assert.deepEqual(out.claudeCli, { version: '2.1.290', ok: true });
  }
  fs.rmSync(bin, { recursive: true, force: true });
});
