// The local commit gate end to end, in a throwaway repository. Skips when git is missing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { bp } from './helpers.mjs';
import { installGitHook } from '../plugins/focus-blueprint/scripts/install-git-hook.mjs';

const hasGit = !spawnSync('git', ['--version']).error;
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const FAKE_KEY = () => 'sb_' + 'secret_' + 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7';

test('git hook end to end: blocks a client secret, passes when removed, --no-verify bypasses, CRLF-proof', { skip: !hasGit && 'git is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-'));
  git(dir, 'init', '-q', '-b', 'work');
  git(dir, 'config', 'user.name', 'Focus AI');
  git(dir, 'config', 'user.email', 'noreply@focusai.co.il');
  assert.equal(bp(dir, ['init', '--name', 'e2e']).code, 0); // copies the checker and installs the hook
  assert.equal(installGitHook(dir).installed, true); // idempotent
  assert.ok(fs.existsSync(path.join(dir, 'scripts', 'blueprint-check.mjs')));

  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  const file = path.join(dir, 'public', 'app.js');
  fs.writeFileSync(file, `const key = "${FAKE_KEY()}";\n`);
  git(dir, 'add', '-A');
  const blocked = git(dir, 'commit', '-m', 'with a key');
  assert.notEqual(blocked.status, 0, blocked.stdout + blocked.stderr);
  assert.ok(blocked.stderr.includes('ה-commit נעצר'), blocked.stderr);

  fs.writeFileSync(file, 'const key = process.env.KEY;\n');
  git(dir, 'add', '-A');
  const passed = git(dir, 'commit', '-m', 'clean');
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);

  // The local gate can be bypassed; that is why the server-side check exists.
  fs.writeFileSync(file, `const key = "${FAKE_KEY()}";\n`);
  git(dir, 'add', '-A');
  const bypass = git(dir, 'commit', '--no-verify', '-m', 'bypass');
  assert.equal(bypass.status, 0, bypass.stdout + bypass.stderr);

  // A checkout on a machine with core.autocrlf=true must not put CR in the hook.
  git(dir, 'config', 'core.autocrlf', 'true');
  fs.rmSync(path.join(dir, '.githooks', 'pre-commit'));
  const co = git(dir, 'checkout', '--', '.githooks/pre-commit');
  assert.equal(co.status, 0, co.stderr);
  assert.ok(!fs.readFileSync(path.join(dir, '.githooks', 'pre-commit'), 'utf8').includes('\r'));
});
