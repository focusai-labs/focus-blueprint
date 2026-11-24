// T3: stop gate, secrets guard, guard-shell additions, guard-migration, migration lint, installer, session start.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { bp, hook, tmpProject, PLUGIN } from './helpers.mjs';
import { checkCommand } from '../plugins/focus-blueprint/hooks/shell-rules.mjs';
import { installGitHook } from '../plugins/focus-blueprint/scripts/install-git-hook.mjs';

const sh = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const GITCFG = ['-c', 'user.name=t', '-c', 'user.email=t@t.t'];
const FAKE_KEY = () => 'sb_' + 'secret_' + 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7';
const state = (over = {}) => ({ schema: 2, project: 'p', stage: 3, status: 'in_progress', track: 'supabase-app', live: false, stages: {}, lastDriftCheck: null, ...over });
function proj(over = {}, map) {
  const dir = tmpProject({ state: state(over), map });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  sh(dir, 'add', '-A');
  sh(dir, ...GITCFG, 'commit', '-qm', 'init');
  sh(dir, 'switch', '-c', 'work');
  return dir;
}
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const shell = (dir, command) => hook('guard-shell', { cwd: dir, tool_name: 'Bash', tool_input: { command } });

// ---------- guard-shell table ----------
const PROD = { ref: 'abcdefghijklmnopqrst', branch: 'main', devTarget: 'dev-branch', live: true };
const DENY = [
  'git commit --no-verify -m x', 'git commit -n -m x', 'git commit -nm x', 'git commit -anm "x"', 'git commit -m x -n', 'git commit -m "a b" --no-verify',
  'git  commit   --no-verif -m x', 'git add . && git commit --no-verify -m x', 'cd app; git commit -n', 'git -C app commit -n -m x',
  'git push --no-verify', 'git merge --no-verify feat', "git 'commit' '--no-verify'", 'git push origin work --no-verify && echo ok',
  'git config core.hooksPath /dev/null', 'git config --local core.hooksPath ""', 'git config --unset core.hooksPath', 'git -c core.hooksPath=/dev/null commit -m x',
  'git -c core.hookspath=x push', 'git config --global core.hooksPath ~/h',
  'rm -rf .githooks', 'rm .githooks/pre-commit', 'rm -f ./.githooks/pre-commit', 'mv .githooks .githooks.off', 'chmod -x .githooks/pre-commit',
  'Remove-Item -Recurse .githooks', 'Remove-Item .githooks\\pre-commit', 'Move-Item .githooks old', 'del .githooks\\pre-commit', 'git rm .githooks/pre-commit',
  'ls && rm -rf ".githooks"', 'echo > .githooks/pre-commit',
  'supabase db push --remote --yes', 'supabase db push --remote', 'supabase db push --remote=abcdefghijklmnopqrst --yes', 'supabase db push --remote=main',
  'supabase db push --remote=postgresql://u:p@host:5432/db', 'supabase db push --linked', 'supabase db push --project-ref abcdefghijklmnopqrst', 'supabase db push --db-url postgres://x',
  'supabase db push --project-ref=other', 'npx supabase db push --remote', 'cd x && supabase  db  push  --remote --yes', 'supabase --debug db push --remote', 'supabase.exe db push --remote',
  'supabase db reset --remote', 'supabase db reset --linked', 'supabase db reset --remote=dev-branch', 'supabase migration repair --remote 123 --status applied', 'supabase migration repair 123 --linked',
  'SUPABASE_YES=1 supabase db push --remote=dev-branch', 'export SUPABASE_YES=true', '$env:SUPABASE_YES = "1"; supabase db push', 'env SUPABASE_YES=1 supabase db push --remote=dev-branch',
];
const ALLOW = [
  'git commit -m "fix: no-verify docs"', 'git commit -m "use -n here"', 'git commit -am "note"', 'git commit -mn', 'git log -n 5', 'git push origin work', 'git merge feat',
  'git config user.name x', 'git config --get core.autocrlf', 'git status', 'ls .githooks', 'cat .githooks/pre-commit', 'git add .githooks/pre-commit',
  'supabase db push --dry-run', 'supabase db push --remote --dry-run', 'supabase db push --linked --dry-run', 'supabase db push', 'supabase db push --local',
  'supabase db push --remote=dev-branch --yes', 'supabase db reset', 'supabase db reset --local', 'supabase migration new add_docs', 'supabase migration list', 'supabase migration repair 123 --local',
  'supabase start', 'rm -rf node_modules', 'mv a.txt b.txt',
];
test('shell rules, live project: table of denied commands', () => {
  for (const c of DENY) assert.ok(checkCommand(c, PROD), `should deny: ${c}`);
});
test('shell rules: table of allowed commands', () => {
  for (const c of ALLOW) assert.equal(checkCommand(c, PROD), null, `should allow: ${c}`);
});
test('shell rules, before launch: push to the linked project is allowed, the other rules stay', () => {
  const pre = { ...PROD, live: false };
  for (const c of ['supabase db push --remote --yes', 'supabase db push --linked', 'supabase db push --remote=abcdefghijklmnopqrst', 'supabase db push --remote=main', 'supabase db push --db-url postgres://x']) {
    assert.equal(checkCommand(c, pre), null, c);
  }
  for (const c of ['supabase db reset --remote', 'supabase db reset --linked', 'supabase migration repair 1 --linked', 'SUPABASE_YES=1 supabase db push --remote', 'git commit --no-verify']) {
    assert.ok(checkCommand(c, pre), c);
  }
});
test('shell rules: no known production ref means every remote target except devTarget is production', () => {
  const none = { ref: null, branch: 'main', devTarget: 'dev-branch', live: true };
  assert.ok(checkCommand('supabase db push --remote=whatever', none));
  assert.ok(checkCommand('supabase db push --remote', none));
  assert.equal(checkCommand('supabase db push --remote=dev-branch', none), null);
  assert.equal(checkCommand('supabase db push --remote=whatever', { ...PROD }), null); // known ref: another ref is a dev project
});

test('guard-shell hook: reads the production identity from the map and the live flag from state', () => {
  const map = { schema: 2, capabilities: [], screens: [], tables: [], automations: [], later: [], services: [{ id: 'supabase', ref: 'prodref123456789012', prodBranch: 'release', devTarget: 'dev1' }] };
  const live = proj({ live: true }, map);
  assert.equal(shell(live, 'supabase db push --remote=prodref123456789012').code, 2);
  assert.equal(shell(live, 'supabase db push --remote=release').code, 2);
  assert.equal(shell(live, 'supabase db push --remote=devproj12345678901').code, 0);
  assert.equal(shell(live, 'supabase db push --remote --dry-run').code, 0);
  assert.match(shell(live, 'git commit --no-verify -m x').err, /no-verify/);
  const pre = proj({ live: false }, map);
  assert.equal(shell(pre, 'supabase db push --remote --yes').code, 0);
  assert.equal(shell(pre, 'supabase db reset --remote').code, 2);
  const fb = proj({ live: true }, undefined);
  write(fb, 'supabase/.temp/project-ref', 'linkedref12345678901\n');
  assert.equal(shell(fb, 'supabase db push --remote=linkedref12345678901').code, 2);
  assert.equal(shell(fb, 'supabase db push --remote=other').code, 0);
  assert.equal(shell(tmpProject({}), 'git commit --no-verify').code, 0); // silent outside a project
});

// ---------- guard-secrets ----------
const secrets = (dir, tool_name, tool_input) => hook('guard-secrets', { cwd: dir, tool_name, tool_input });
const decision = (r) => r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision;
const reason = (r) => r.json.hookSpecificOutput.permissionDecisionReason;

test('guard-secrets: a secret into a tracked path is denied for Write, Edit and MultiEdit; ignored files pass', () => {
  const dir = proj();
  write(dir, '.gitignore', '.env.local\n.env\nsecrets/\n');
  const f = path.join(dir, 'src', 'a.js');
  const r = secrets(dir, 'Write', { file_path: f, content: `const k = "${FAKE_KEY()}";` });
  assert.equal(decision(r), 'deny'); assert.match(reason(r), /Supabase secret key/); assert.match(reason(r), /\.env\.local/);
  assert.equal(decision(secrets(dir, 'Edit', { file_path: f, old_string: 'x', new_string: `k=${FAKE_KEY()}` })), 'deny');
  assert.equal(decision(secrets(dir, 'MultiEdit', { file_path: f, edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: FAKE_KEY() }] })), 'deny');
  assert.equal(r.code, 0);
  assert.equal(secrets(dir, 'Write', { file_path: f, content: 'const k = process.env.KEY;' }).out, '');
  assert.equal(secrets(dir, 'Write', { file_path: path.join(dir, 'secrets', 'k.txt'), content: FAKE_KEY() }).out, '');
  assert.equal(secrets(dir, 'Write', { file_path: path.join(dir, '.env.local'), content: `SUPABASE_SECRET_KEY=${FAKE_KEY()}\n` }).out, '');
  assert.equal(secrets(dir, 'Edit', { file_path: f, old_string: FAKE_KEY(), new_string: 'x' }).out, ''); // old text is not scanned
});
test('guard-secrets: env files', () => {
  const dir = proj();
  const w = (name, content) => secrets(dir, 'Write', { file_path: path.join(dir, name), content });
  let r = w('.env.production', 'A=1\n'); assert.equal(decision(r), 'deny'); assert.match(reason(r), /\.gitignore first/);
  assert.equal(w('.env.example', 'A=\n').out, '');
  write(dir, '.gitignore', '.env*\n!.env.example\n');
  assert.equal(w('.env.production', 'A=1\n').out, '');
  r = w('.env.local', `NEXT_PUBLIC_KEY=${FAKE_KEY()}\n`); assert.equal(decision(r), 'deny'); assert.match(reason(r), /public variable/);
  r = w('.env.local', 'NEXT_PUBLIC_SERVICE_ROLE_KEY=abc\n'); assert.equal(decision(r), 'deny');
  r = w('.env.example', 'VITE_API_SECRET=\n'); assert.equal(decision(r), 'deny');
  assert.equal(w('.env.local', 'NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co\nSERVICE_KEY=abc\n').out, '');
});
test('guard-secrets: silent outside a Blueprint project and for paths outside it', () => {
  assert.equal(secrets(tmpProject({}), 'Write', { file_path: 'x.js', content: FAKE_KEY() }).out, '');
  const dir = proj();
  assert.equal(secrets(dir, 'Write', { file_path: path.join(os.tmpdir(), 'other.js'), content: FAKE_KEY() }).out, '');
});

// ---------- guard-migration ----------
const mcp = (dir, name, input = {}) => hook('guard-migration', { cwd: dir, tool_name: name, tool_input: input });
test('guard-migration: every mutating tool is denied on any server name, read-only SQL passes', () => {
  const dir = proj();
  const tools = ['apply_migration', 'execute_sql', 'deploy_edge_function', 'create_branch', 'delete_branch', 'merge_branch', 'reset_branch', 'rebase_branch', 'create_project', 'pause_project', 'restore_project', 'confirm_cost', 'create_notebook', 'run_notebook', 'delete_notebook'];
  for (const t of tools) {
    for (const server of ['mcp__supabase__', 'mcp__plugin_supabase_supabase__', 'mcp__claude_ai_Supabase__']) {
      const r = mcp(dir, server + t, { query: 'create table t (i int)' });
      assert.equal(r.code, 2, server + t);
      assert.match(r.err, /supabase migration new/); assert.match(r.err, /supabase\/migrations/); assert.match(r.err, /merge deploys/);
    }
  }
  for (const q of ['select 1', 'SELECT * FROM t WHERE x = 1;', 'explain select 1', 'show all', 'values (1),(2)', 'table t', 'with a as (select 1) select * from a', "select 'insert into x'", 'select 1; select 2']) {
    assert.equal(mcp(dir, 'mcp__supabase__execute_sql', { query: q }).code, 0, q);
  }
  for (const q of ['insert into t values (1)', 'with a as (insert into t values (1) returning *) select * from a', 'select 1; delete from t', 'update t set a=1', 'merge into t using s on true when matched then delete', 'explain analyze update t set a=1', 'select * into t2 from t', 'select 1 for update', 'call f()']) {
    assert.equal(mcp(dir, 'mcp__supabase__execute_sql', { query: q }).code, 2, q);
  }
  assert.equal(mcp(tmpProject({}), 'mcp__supabase__create_branch').code, 0);
});
test('guard-migration: the hooks.json matcher covers every guarded tool', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
  const entry = cfg.hooks.PreToolUse.find((e) => e.hooks[0].args[0].endsWith('guard-migration.mjs'));
  const re = new RegExp(`^(?:${entry.matcher})$`);
  for (const t of ['apply_migration', 'execute_sql', 'deploy_edge_function', 'create_branch', 'delete_branch', 'merge_branch', 'reset_branch', 'rebase_branch', 'create_project', 'pause_project', 'restore_project', 'confirm_cost', 'create_notebook', 'run_notebook', 'delete_notebook']) {
    assert.ok(re.test(`mcp__supabase__${t}`), t); assert.ok(re.test(`mcp__plugin_supabase_supabase__${t}`), t);
  }
  assert.ok(!re.test('mcp__supabase__list_tables'));
  for (const e of Object.values(cfg.hooks).flat().flatMap((x) => x.hooks)) assert.ok(Array.isArray(e.args) && e.command === 'node');
  assert.ok(cfg.hooks.Stop[0].hooks.some((h) => h.args[0].endsWith('stop-gate.mjs') && h.timeout === 20));
});

// ---------- PostToolUse migration lint ----------
test('post-edit: lints a migration file and returns the findings as additionalContext', () => {
  const dir = proj();
  write(dir, 'supabase/migrations/20261124_a.sql', 'create table public.t (id int);\n');
  const r = hook('post-edit', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'supabase', 'migrations', '20261124_a.sql') } });
  assert.equal(r.code, 0);
  assert.match(r.json.hookSpecificOutput.additionalContext, /migration lint found/);
  write(dir, 'supabase/migrations/20261124_b.sql', '-- service_only\ncreate table public.u (id int);\nalter table public.u enable row level security;\n');
  const ok = hook('post-edit', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'supabase', 'migrations', '20261124_b.sql') } });
  assert.ok(!ok.json || !/migration lint found/.test(ok.json.hookSpecificOutput.additionalContext));
});
test('post-edit lint: live applies the additive rule only to an untracked file', () => {
  const dir = proj({ live: true });
  write(dir, 'supabase/migrations/1_old.sql', 'drop table public.x;\n');
  sh(dir, 'add', '-A'); sh(dir, ...GITCFG, 'commit', '-qm', 'old');
  write(dir, 'supabase/migrations/2_new.sql', 'drop table public.y;\n');
  const lint = (f) => hook('post-edit', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'supabase', 'migrations', f) } });
  assert.match(lint('2_new.sql').json.hookSpecificOutput.additionalContext, /migration lint found/);
  const old = lint('1_old.sql');
  assert.ok(!old.json || !/migration lint found/.test(old.json.hookSpecificOutput.additionalContext));
});

// ---------- stop gate ----------
const stop = (dir, extra = {}) => hook('stop-gate', { cwd: dir, hook_event_name: 'Stop', ...extra });
function dirtyProject() {
  const dir = proj();
  write(dir, 'public/app.js', `const k = "${FAKE_KEY()}";\n`);
  return dir;
}
test('stop-gate: silent when clean, when nothing the map knows changed, and outside a project', () => {
  assert.equal(stop(proj()).out, '');
  const dir = proj(); write(dir, 'notes/readme.txt', 'x');
  assert.equal(stop(dir).out, '');
  assert.equal(stop(tmpProject({})).out, '');
});
test('stop-gate: blocks with up to 5 messages and a marker; the same marker means no progress', () => {
  const dir = dirtyProject();
  const first = stop(dir);
  assert.equal(first.code, 0);
  assert.equal(first.json.decision, 'block');
  assert.match(first.json.reason, /\[blueprint-stop:[0-9a-f]{40}\]/);
  assert.ok(first.json.reason.split('\n').filter((l) => /^\d\. /.test(l)).length <= 5);
  const tr = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', text: 'old [blueprint-stop:' + '0'.repeat(40) + ']' }) + '\n' + JSON.stringify({ type: 'user', text: first.json.reason }) + '\n');
  const again = stop(dir, { stop_hook_active: true, transcript_path: tr });
  assert.equal(again.json.decision, undefined);
  assert.match(again.json.systemMessage, /^הסוכן עצר, ועדיין יש בעיות שהבודק מצא\. שלוש הראשונות מופיעות כאן, והרשימה המלאה מתקבלת עם node scripts\/blueprint-check\.mjs\.\n/);
  // a different last marker: block again
  fs.writeFileSync(tr, JSON.stringify({ text: '[blueprint-stop:' + 'a'.repeat(40) + ']' }) + '\n');
  assert.equal(stop(dir, { stop_hook_active: true, transcript_path: tr }).json.decision, 'block');
  // fixed: clean
  fs.rmSync(path.join(dir, 'public', 'app.js'));
  assert.equal(stop(dir, { stop_hook_active: true, transcript_path: tr }).out, '');
});
test('stop-gate: writes nothing', () => {
  const dir = dirtyProject();
  const before = sh(dir, 'status', '--porcelain').stdout + fs.readFileSync(path.join(dir, '.blueprint', 'state.json'), 'utf8');
  stop(dir);
  assert.equal(sh(dir, 'status', '--porcelain').stdout + fs.readFileSync(path.join(dir, '.blueprint', 'state.json'), 'utf8'), before);
});

// ---------- installer, session start ----------
test('installGitHook: writes the hook, LF, mode, attributes, config; idempotent; non-repo is a no-op', () => {
  const dir = tmpProject({});
  const r1 = installGitHook(dir);
  assert.equal(r1.installed, true);
  const hookFile = path.join(dir, '.githooks', 'pre-commit');
  const text = fs.readFileSync(hookFile, 'utf8');
  assert.ok(text.startsWith('#!/bin/sh\n')); assert.ok(!text.includes('\r'));
  assert.ok(text.includes('לא מצאתי את Node.js, ולכן אי אפשר לבדוק את ה-commit. מתקינים Node.js ומנסים שוב.'));
  assert.ok(text.trimEnd().endsWith('exec node scripts/blueprint-check.mjs --pre-commit'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(hookFile).mode & 0o777, 0o755);
  assert.equal(sh(dir, 'config', 'core.hooksPath').stdout.trim(), '.githooks');
  assert.match(sh(dir, 'ls-files', '-s', '.githooks/pre-commit').stdout, /^100755/);
  installGitHook(dir); installGitHook(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8').split('\n').filter((l) => l === '.githooks/* text eol=lf').length, 1);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-nogit-'));
  assert.equal(installGitHook(bare).installed, false);
  assert.ok(!fs.existsSync(path.join(bare, '.githooks')));
  const appendTo = tmpProject({}); fs.writeFileSync(path.join(appendTo, '.gitattributes'), '* text=auto');
  installGitHook(appendTo);
  assert.equal(fs.readFileSync(path.join(appendTo, '.gitattributes'), 'utf8'), '* text=auto\n.githooks/* text eol=lf\n');
});
test('bp init installs the hook in a git repo; bp githook install repairs a clone', () => {
  const dir = tmpProject({});
  assert.equal(bp(dir, ['init', '--name', 'p']).code, 0);
  assert.equal(sh(dir, 'config', 'core.hooksPath').stdout.trim(), '.githooks');
  sh(dir, 'config', '--unset', 'core.hooksPath');
  const ctx = hook('session-start', { cwd: dir, source: 'startup' }).json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /core\.hooksPath is not \.githooks/); assert.match(ctx, /githook install/);
  assert.equal(bp(dir, ['githook', 'install']).code, 0);
  assert.equal(sh(dir, 'config', 'core.hooksPath').stdout.trim(), '.githooks');
  assert.doesNotMatch(hook('session-start', { cwd: dir, source: 'startup' }).json.hookSpecificOutput.additionalContext, /hooksPath/);
});
test('session-start: unscoped Supabase MCP servers and plugins are reported; scoped ones and read errors are silent', () => {
  const dir = proj();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-home-'));
  const env = { HOME: home, USERPROFILE: home };
  const NOTE = 'יש כאן חיבור ל-Supabase שרואה את כל הפרויקטים בחשבון. בפרויקט הזה עובדים רק עם חיבור שמוגבל לפרויקט אחד, ולכן כדאי לכבות את החיבור הזה כאן דרך /mcp.';
  const run = () => hook('session-start', { cwd: dir, source: 'startup' }, env);
  assert.ok(!(run().json.systemMessage || '').includes(NOTE));
  fs.writeFileSync(path.join(home, '.claude.json'), '{broken');
  assert.ok(!(run().json.systemMessage || '').includes(NOTE));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { supabase: { type: 'http', url: 'https://mcp.supabase.com/mcp' } } }));
  let r = run();
  assert.ok(r.json.systemMessage.includes(NOTE)); assert.match(r.json.hookSpecificOutput.additionalContext, /no project_ref/);
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { supabase: { url: 'https://mcp.supabase.com/mcp?project_ref=abc&read_only=true' } } }));
  assert.ok(!(run().json.systemMessage || '').includes(NOTE));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [dir]: { mcpServers: { s: { url: 'https://mcp.supabase.com/mcp?features=docs' } } } } }));
  assert.ok(run().json.systemMessage.includes(NOTE));
  fs.writeFileSync(path.join(home, '.claude.json'), '{}');
  write(dir, '.mcp.json', JSON.stringify({ mcpServers: { s: { url: 'https://mcp.supabase.com/mcp' } } }));
  assert.ok(run().json.systemMessage.includes(NOTE));
  fs.rmSync(path.join(dir, '.mcp.json'));
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  const plug = (key) => fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [key]: [{}] } }));
  plug('supabase@supabase-community'); assert.ok(run().json.systemMessage.includes(NOTE));
  plug('supabase@supabase-agent-skills'); assert.ok(!(run().json.systemMessage || '').includes(NOTE));
});

// ---------- bp review not_run ----------
test('review: not_run is accepted and never counts as a pass', () => {
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  const okc = 'node -e "process.exit(0)"'; const badc = 'node -e "process.exit(1)"';
  bp(dir, ['map', 'add', 'capability', JSON.stringify({ id: 'up', name: 'x', screens: ['mockup/a.html'], data: ['documents'], permissions: ['client:create:documents:own'], automations: ['n8n:x'] })]);
  bp(dir, ['eval', 'new', 'up']);
  const f = path.join(dir, 'evals', 'up.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('הבדיקה הזאת תופסת: <<fill>>', 'הבדיקה הזאת תופסת: לקוח שרואה קבצים של לקוח אחר'));
  bp(dir, ['brief', 'up']);
  bp(dir, ['evidence', 'red', 'up', '--cmd', badc]); bp(dir, ['evidence', 'green', 'up', '--cmd', okc]);
  write(dir, 'evals/reviews/up.md', 'r');
  const rec = (spec, quality) => bp(dir, ['review', 'record', 'up', '--spec', spec, '--quality', quality, '--path', 'evals/reviews/up.md']);
  assert.equal(rec('maybe', 'pass').code, 1);
  assert.equal(rec('not_run', 'pass').code, 0);
  let r = bp(dir, ['map', 'set', 'capability', 'up', 'status=real']);
  assert.equal(r.code, 1); assert.ok(r.err.includes('הסוקר לא רץ עד הסוף, ולכן אין כאן אישור. מריצים אותו שוב.'));
  assert.equal(rec('pass', 'not_run').code, 0);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'status=real']).code, 1);
  assert.equal(rec('pass', 'pass').code, 0);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'status=real']).code, 0);
});
