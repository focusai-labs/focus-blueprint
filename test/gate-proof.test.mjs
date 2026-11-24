// D9: the gate proof of stage 11. The commands in the reference text are run here against the real hooks,
// so the text and the gates cannot drift apart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { PLUGIN, bp, hook } from './helpers.mjs';
import { scanText } from '../plugins/focus-blueprint/scripts/blueprint-model/secrets.mjs';

const DOC = path.join(PLUGIN, 'skills', 'stage-11-skeleton', 'references', 'gate-proof.md');
const doc = fs.readFileSync(DOC, 'utf8');
const hasGit = !spawnSync('git', ['--version']).error;

// Every command the proof runs, exactly as the reference text writes it.
const C = {
  branch: 'git branch --show-current',
  clean: 'git status --porcelain',
  check: 'node scripts/blueprint-check.mjs',
  hooksPath: 'git config --get core.hooksPath',
  head: 'git rev-parse --short HEAD',
  ignored: 'git check-ignore -q blueprint-gate-proof.html',
  builder: `node -e "console.log(['sb','secret',require('crypto').randomBytes(16).toString('hex')].join('_'))"`,
  secretFile: 'blueprint-gate-proof.html',
  secretLine: '<script>const key = "<הפלט>";</script>',
  exists: `node -e "console.log(require('fs').existsSync('blueprint-gate-proof.html'))"`,
  rmSecret: `node -e "require('fs').rmSync('blueprint-gate-proof.html',{force:true})"`,
  migration: 'supabase/migrations/99999999999999_blueprint_gate_proof.sql',
  migrationSql: 'create table public.blueprint_gate_proof (id bigint primary key);',
  add: 'git add -- supabase/migrations/99999999999999_blueprint_gate_proof.sql',
  commit: 'git commit -m "blueprint gate proof"',
  unstage: 'git reset -q -- supabase/migrations/99999999999999_blueprint_gate_proof.sql',
  rmMigration: `node -e "require('fs').rmSync('supabase/migrations/99999999999999_blueprint_gate_proof.sql',{force:true})"`,
  undo: 'git reset --soft HEAD~1',
  noVerify: 'git commit --no-verify --dry-run -m "blueprint gate proof"',
  mcpSql: 'begin; create table public.blueprint_gate_proof (id bigint); rollback;',
  mcpCheck: "select to_regclass('public.blueprint_gate_proof') as remains;",
  evidence: 'docs/evidence/gates.txt',
  install: 'bp githook install',
};

/** Runs one command of the text without a shell: git with its arguments, or node -e with its script. */
function run(dir, command) {
  if (command.startsWith('node -e "')) {
    return spawnSync(process.execPath, ['-e', command.slice('node -e "'.length, -1)], { cwd: dir, encoding: 'utf8' });
  }
  const args = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
  assert.equal(args.shift(), 'git', command);
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

const fenced = (s) => s.replace(/```[\s\S]*?```/g, '');
const spans = (s) => [...fenced(s).matchAll(/`([^`]+)`/g)].map((m) => m[1]);

test('gate proof text: four gates, the commands, the evidence file, and no secret written into the plugin', () => {
  for (const [k, v] of Object.entries(C)) assert.ok(doc.includes(v), `the text holds ${k}: ${v}`);
  for (const g of ['guard-secrets', 'guard-shell', 'guard-migration', 'ה-hook של git לפני commit']) assert.ok(doc.includes(g), g);
  assert.deepEqual(scanText(doc), [], 'no key in the reference text');
  const example = (doc.match(/```text\n([\s\S]*?)```/) || [])[1];
  assert.ok(example, 'an evidence example');
  assert.match(example.split('\n')[0], /^# blueprint gates \d{4}-\d{2}-\d{2}T[\d:]+Z$/);
  assert.deepEqual(scanText(example), [], 'the evidence format looks like no secret');
  for (const r of ['pass', 'fail', 'na', 'not-run']) assert.ok(doc.includes(`\`${r}\``), `result ${r}`);
});

test('gate proof text: every command is one plain command that runs the same in Bash, PowerShell and cmd', () => {
  const commands = spans(doc).filter((s) => /^(git|node|bp) /.test(s));
  assert.ok(commands.length >= 15, `${commands.length} commands`);
  for (const c of commands) {
    assert.ok(!/&&|\|\||\s\|\s|>|\$\(|\\$|^rm |\brm -|\bcat |\bexport |\bset -/.test(c), `shell-specific: ${c}`);
    if (c.startsWith('node -e ')) assert.ok(!c.slice(9, -1).includes('"') && !c.includes('$'), `quotes inside node -e: ${c}`);
  }
});

test('gate proof: the fake key is built at runtime, and the plugin scanner sees it as a secret', () => {
  const r = run(process.cwd(), C.builder);
  assert.equal(r.status, 0, r.stderr);
  const key = r.stdout.trim();
  assert.match(key, /^sb_secret_[0-9a-f]{32}$/);
  assert.equal(scanText(C.secretLine.replace('<הפלט>', key))[0].name, 'Supabase secret key');
  assert.ok(!doc.includes(key));
  assert.notEqual(run(process.cwd(), C.builder).stdout.trim(), key, 'a new value on every run');
});

test('gate proof end to end: each planted violation is stopped by its gate, and nothing remains', { skip: !hasGit && 'git is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-gates-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Focus AI');
  git('config', 'user.email', 'noreply@focusai.co.il');
  assert.equal(bp(dir, ['init', '--name', 'gates']).code, 0);
  assert.equal(bp(dir, ['state', 'set', 'track=supabase-app']).code, 0);
  fs.mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'supabase', 'migrations', '20261101000000_init.sql'), '-- service_only\ncreate table public.notes (id bigint primary key);\nalter table public.notes enable row level security;\n');
  git('add', '-A');
  const first = git('commit', '-qm', 'init');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  git('switch', '-qc', 'stage-11');

  // Before: a stage branch, a clean tree, a green check, the hook in place.
  assert.equal(run(dir, C.branch).stdout.trim(), 'stage-11');
  assert.equal(run(dir, C.clean).stdout, '');
  const base = spawnSync(process.execPath, ['scripts/blueprint-check.mjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(base.status, 0, base.stdout);
  assert.equal(run(dir, C.hooksPath).stdout.trim(), '.githooks');
  const head = run(dir, C.head).stdout.trim();

  // Gate 1: a fake secret into a client file, denied before the write.
  assert.equal(run(dir, C.ignored).status, 1);
  const key = run(dir, C.builder).stdout.trim();
  const g1 = hook('guard-secrets', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, C.secretFile), content: `${C.secretLine.replace('<הפלט>', key)}\n` } });
  assert.equal(g1.json && g1.json.hookSpecificOutput.permissionDecision, 'deny', g1.out + g1.err);
  assert.match(g1.json.hookSpecificOutput.permissionDecisionReason, /^Blocked by Focus Blueprint.*Supabase secret key/);
  assert.equal(run(dir, C.exists).stdout.trim(), 'false');

  // Gate 2: a migration without RLS, stopped by the git hook.
  fs.writeFileSync(path.join(dir, ...C.migration.split('/')), `${C.migrationSql}\n`);
  assert.equal(run(dir, C.add).status, 0);
  const g2 = run(dir, C.commit);
  assert.notEqual(g2.status, 0, 'the commit must be stopped');
  assert.match(g2.stderr, /ה-commit נעצר/);
  assert.match(g2.stderr, /blueprint_gate_proof/);
  assert.equal(run(dir, C.unstage).status, 0);
  assert.equal(run(dir, C.rmMigration).status, 0);
  assert.equal(run(dir, C.clean).stdout, '');

  // Gate 3: a commit that skips the hook, denied before it runs.
  const g3 = hook('guard-shell', { cwd: dir, tool_name: 'Bash', tool_input: { command: C.noVerify } });
  assert.equal(g3.code, 2);
  assert.match(g3.err, /^Blocked by Focus Blueprint.*--no-verify/);

  // Gate 4: DDL through the Supabase MCP, denied; the read that checks nothing remains passes.
  const g4 = hook('guard-migration', { cwd: dir, tool_name: 'mcp__supabase__execute_sql', tool_input: { query: C.mcpSql } });
  assert.equal(g4.code, 2);
  assert.match(g4.err, /^Blocked by Focus Blueprint: execute_sql runs only read-only SQL/);
  assert.equal(hook('guard-migration', { cwd: dir, tool_name: 'mcp__supabase__execute_sql', tool_input: { query: C.mcpCheck } }).code, 0);

  // After: the same commit, a clean tree, no planted file.
  assert.equal(run(dir, C.head).stdout.trim(), head);
  assert.equal(run(dir, C.clean).stdout, '');
  assert.ok(!fs.existsSync(path.join(dir, C.secretFile)));
  assert.ok(!fs.existsSync(path.join(dir, ...C.migration.split('/'))));
});
