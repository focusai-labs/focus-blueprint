import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN } from './helpers.mjs';
import { makeSampleProject } from './make-sample-project.mjs';
import { parseMcpList, buildMcpList } from '../plugins/focus-blueprint/scripts/mcp-list.mjs';

const SECRETS = ['sk-SECRET-AAA111', 'hunter2-PASSWORD', 'eyJTOKEN-BBB222', 'ghp_CCC333', 'postgres://u:pw-DDD444@db.example.com/x', 'ref-OTHER-zzz'];

const LIST = [
  'Checking MCP server health...',
  '',
  'plain: npx -y some-server --token sk-SECRET-AAA111 - ✓ Connected',
  'db: npx -y @supabase/mcp-server-supabase@latest --project-ref=ownref123 --read-only --access-token eyJTOKEN-BBB222 - ✓ Connected',
  'hosted: https://mcp.supabase.com/mcp?project_ref=ref-OTHER-zzz&token=ghp_CCC333 (HTTP) - ✗ Failed to connect',
  'claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ! Needs authentication',
  'plugin:foo:bar: node /x/y.js hunter2-PASSWORD - ✓ Connected',
].join('\n');

function sample() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-mcp-'));
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(home, { recursive: true });
  makeSampleProject(proj);
  const mapFile = path.join(proj, '.blueprint', 'map.json');
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.services = [{ id: 'supabase', ref: 'ownref123' }];
  fs.writeFileSync(mapFile, JSON.stringify(map));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { plain: { command: 'npx', args: ['-y', 'some-server', '--token', 'sk-SECRET-AAA111'], env: { DB: 'postgres://u:pw-DDD444@db.example.com/x' } } },
    projects: { [proj]: { mcpServers: { db: { command: 'npx', args: ['-y', '@supabase/mcp-server-supabase@latest', '--project-ref=ownref123', '--read-only', '--access-token', 'eyJTOKEN-BBB222'] } } } },
  }));
  fs.writeFileSync(path.join(proj, '.mcp.json'), JSON.stringify({
    mcpServers: { hosted: { type: 'http', url: 'https://mcp.supabase.com/mcp?project_ref=ref-OTHER-zzz&token=ghp_CCC333', headers: { Authorization: 'Bearer hunter2-PASSWORD' } } },
  }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, 'list.txt'), LIST + '\n');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\ncat "${path.join(root, 'list.txt')}"\n`, { mode: 0o755 });
  return { root, home, proj, bin };
}

test('parseMcpList reads names, transport and connection state', () => {
  const rows = parseMcpList(LIST);
  assert.deepEqual(rows.map((r) => [r.name, r.transport, r.connected]), [
    ['plain', 'stdio', true], ['db', 'stdio', true], ['hosted', 'http', false], ['claude.ai Gmail', 'http', false], ['plugin:foo:bar', 'stdio', true],
  ]);
});

test('bp mcp list prints only safe fields and no secret value', { skip: process.platform === 'win32' }, () => {
  const { root, home, proj, bin } = sample();
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'bp.mjs'), 'mcp', 'list', '--project', proj], {
    encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  for (const s of SECRETS) assert.ok(!r.stdout.includes(s) && !r.stderr.includes(s), `leaked ${s}`);
  for (const w of ['npx', 'Bearer', 'headers', 'env', 'url', 'command', 'args']) assert.ok(!r.stdout.includes(w), `leaked ${w}`);
  assert.ok(!/https?:\/\//.test(r.stdout));
  const out = JSON.parse(r.stdout);
  const by = Object.fromEntries(out.servers.map((s) => [s.name, s]));
  assert.deepEqual(by.plain, { name: 'plain', scope: 'user', transport: 'stdio', connected: true });
  assert.deepEqual(by.db, { name: 'db', scope: 'local', transport: 'stdio', connected: true, supabase: { scopedToThisProject: true, readOnly: true, docsOnly: false } });
  assert.deepEqual(by.hosted, { name: 'hosted', scope: 'project', transport: 'http', connected: false, supabase: { scopedToThisProject: false, readOnly: false, docsOnly: false } });
  assert.equal(by['claude.ai Gmail'].scope, 'claude.ai');
  assert.equal(by['plugin:foo:bar'].scope, 'unknown');
  for (const s of out.servers) assert.deepEqual(Object.keys(s).filter((k) => !['name', 'scope', 'transport', 'connected', 'supabase'].includes(k)), []);
});

test('bp mcp list without claude gives connected null, never a guess', () => {
  const rows = buildMcpList({ listText: null, userServers: { a: { command: 'x', args: ['secret-9'] } }, ownRef: null }).slice();
  assert.deepEqual(rows, [{ name: 'a', scope: 'user', transport: 'stdio', connected: null }]);
});

test('bp mcp list runs in a folder that is not a Blueprint project yet (stage 1 runs it before bp init)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-mcp-noproj-'));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'bp.mjs'), 'mcp', 'list'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: '', HOME: dir, USERPROFILE: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Array.isArray(JSON.parse(r.stdout).servers));
});
