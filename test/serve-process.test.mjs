// serve.mjs opens the process map page directly, so a skill can point the student at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const SERVE = path.join(PLUGIN, 'ui', 'serve.mjs');

test('serve.mjs --page process prints the address of the process map, and the page answers', async () => {
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  const child = spawn(process.execPath, [SERVE, '--project', dir, '--page', 'process', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const line = await new Promise((resolve, reject) => {
      child.stdout.once('data', (d) => resolve(String(d).trim()));
      child.once('exit', (code) => reject(new Error(`serve.mjs exited with ${code}`)));
    });
    assert.match(line, /^URL http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/process$/);
    const r = await fetch(line.slice(4));
    assert.equal(r.status, 200);
    assert.match(await r.text(), /data-page="process"/);
  } finally { child.kill(); }
});

test('serve.mjs still refuses a page it does not know', () => {
  const dir = tmpProject();
  const r = spawnSync(process.execPath, [SERVE, '--project', dir, '--page', 'nope', '--no-open'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown page "nope"/);
});
