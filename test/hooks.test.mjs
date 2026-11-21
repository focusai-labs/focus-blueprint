// Task 2: the upgraded hooks. Each test feeds the hook's stdin JSON and asserts exit code and output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { hook, tmpProject } from './helpers.mjs';

const baseState = (over = {}) => ({
  schema: 2, project: 'p', stage: 3, status: 'in_progress', track: 'supabase-app', live: false,
  stages: {}, lastDriftCheck: null, ...over,
});
const sh = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const GITCFG = ['-c', 'user.name=t', '-c', 'user.email=t@t.t'];
function repo(opts = {}) {
  const dir = tmpProject({ state: baseState(opts.state), map: opts.map });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  sh(dir, 'add', '-A');
  sh(dir, ...GITCFG, 'commit', '-qm', 'init');
  return dir;
}
const shell = (dir, command) => hook('guard-shell', { cwd: dir, tool_name: 'Bash', tool_input: { command } });
const ctx = (r) => r.json.hookSpecificOutput.additionalContext;
const writeBp = (dir, name, data) => fs.writeFileSync(path.join(dir, '.blueprint', name), typeof data === 'string' ? data : JSON.stringify(data));

test('guard-shell: git merge on main is blocked, on a branch allowed, --abort allowed', () => {
  const dir = repo();
  const r = shell(dir, 'git merge feature');
  assert.equal(r.code, 2);
  assert.match(r.err, /merge/);
  assert.equal(shell(dir, 'git merge --abort').code, 0);
  sh(dir, 'switch', '-c', 'stage-3');
  assert.equal(shell(dir, 'git merge feature').code, 0);
});

test('guard-shell: git push with a secret file tracked or staged is blocked', () => {
  for (const name of ['.env', '.env.local', 'cert.pem', 'api-key-prod.json']) {
    const dir = repo();
    sh(dir, 'switch', '-c', 'stage-3');
    fs.writeFileSync(path.join(dir, name), 'x');
    sh(dir, 'add', '-f', name);
    sh(dir, ...GITCFG, 'commit', '-qm', 'oops');
    const r = shell(dir, 'git push origin stage-3');
    assert.equal(r.code, 2, name);
    assert.match(r.err, new RegExp(name.replace('.', '\\.')));
  }
  const staged = repo();
  sh(staged, 'switch', '-c', 'b');
  fs.writeFileSync(path.join(staged, '.env'), 'x');
  sh(staged, 'add', '-f', '.env');
  assert.equal(shell(staged, 'git push').code, 2);
  const clean = repo();
  sh(clean, 'switch', '-c', 'b');
  assert.equal(shell(clean, 'git push -u origin b').code, 0);
});

test('guard-shell: force push to a protected branch is blocked, force push on a feature branch is not', () => {
  const dir = repo();
  for (const c of ['git push --force', 'git push -f origin main', 'git push --force-with-lease']) {
    const r = shell(dir, c);
    assert.equal(r.code, 2, c);
    assert.match(r.err, /force/i);
  }
  assert.equal(shell(dir, 'git push origin main').code, 0);
  sh(dir, 'switch', '-c', 'feat');
  assert.equal(shell(dir, 'git push --force origin feat').code, 0);
  assert.equal(shell(dir, 'git push -f origin main').code, 2);
});

const sqlTool = (dir, tool_name, query) => hook('guard-migration', { cwd: dir, tool_name, tool_input: { query, name: 'x' } });

test('guard-migration: execute_sql DDL is blocked with a pointer to db/migrations and apply_migration; select passes', () => {
  const dir = repo();
  for (const q of ['create table t (id int)', 'ALTER  TABLE t add column c int', 'drop policy p on t', 'create or replace function f() returns int as $$ select 1 $$', 'create view v as select 1', 'drop schema s', 'create type ty as enum (\'a\')']) {
    if (/create or replace/i.test(q)) continue;
    const r = sqlTool(dir, 'mcp__supabase__execute_sql', q);
    assert.equal(r.code, 2, q);
    assert.match(r.err, /db\/migrations\//);
    assert.match(r.err, /apply_migration/);
  }
  assert.equal(sqlTool(dir, 'mcp__supabase__execute_sql', 'select * from documents').code, 0);
});

test('guard-migration: after launch, destructive SQL is blocked even through apply_migration with a file', () => {
  const dir = repo({ state: { live: true } });
  const q = 'alter table documents drop column note;';
  fs.mkdirSync(path.join(dir, 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'db', 'migrations', '0002_drop.sql'), q);
  const r = sqlTool(dir, 'mcp__supabase__apply_migration', q);
  assert.equal(r.code, 2);
  assert.match(r.err, /additive/i);
  const d2 = sqlTool(dir, 'mcp__supabase__apply_migration', 'drop table documents');
  assert.equal(d2.code, 2);
  const pre = repo({ state: { live: false } });
  fs.mkdirSync(path.join(pre, 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(pre, 'db', 'migrations', '0002_drop.sql'), q);
  assert.equal(sqlTool(pre, 'mcp__supabase__apply_migration', q).code, 0);
});

test('hooks.json routes apply_migration and execute_sql to guard-migration', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'plugins', 'focus-blueprint', 'hooks', 'hooks.json'), 'utf8'));
  const g = cfg.hooks.PreToolUse.find((x) => x.hooks[0].args[0].endsWith('guard-migration.mjs'));
  const re = new RegExp(`^(?:${g.matcher})$`);
  assert.ok(re.test('mcp__supabase__apply_migration'));
  assert.ok(re.test('mcp__supabase__execute_sql'));
  assert.ok(re.test('mcp__plugin_x_Supabase__execute_sql'));
  assert.ok(!re.test('mcp__supabase__list_tables'));
});

test('session-start: Git line with branch, dirty count and branch age', () => {
  const dir = repo();
  let c = ctx(hook('session-start', { cwd: dir }));
  assert.match(c, /Git: branch main, 0 dirty files, 0 days/);
  sh(dir, 'switch', '-c', 'stage-3');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
  sh(dir, 'add', 'b.txt');
  const old = String(Math.floor(Date.now() / 1000) - 3 * 86400 - 100);
  spawnSync('git', [...GITCFG, 'commit', '-qm', 'old'], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: old + ' +0000', GIT_COMMITTER_DATE: old + ' +0000' } });
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  fs.writeFileSync(path.join(dir, 'd.txt'), 'd');
  c = ctx(hook('session-start', { cwd: dir }));
  assert.match(c, /Git: branch stage-3, 2 dirty files, 3 days/);
});

test('session-start: Drift line when never checked or older than 24 hours, not when fresh or static', () => {
  const never = ctx(hook('session-start', { cwd: repo() }));
  assert.match(never, /Drift: last check: never, run \/focus-blueprint:drift-check first/);
  const old = ctx(hook('session-start', { cwd: repo({ state: { lastDriftCheck: new Date(Date.now() - 30 * 3600e3).toISOString() } }) }));
  assert.match(old, /Drift: last check: .*run \/focus-blueprint:drift-check first/);
  const fresh = ctx(hook('session-start', { cwd: repo({ state: { lastDriftCheck: new Date(Date.now() - 3600e3).toISOString() } }) }));
  assert.doesNotMatch(fresh, /Drift:/);
  const stat = ctx(hook('session-start', { cwd: repo({ state: { track: 'static' } }) }));
  assert.doesNotMatch(stat, /Drift:/);
});

test('session-start: first 30 lines of last-session.md', () => {
  const dir = repo();
  const lines = Array.from({ length: 40 }, (_, i) => `שורה ${i + 1}`);
  writeBp(dir, 'last-session.md', lines.join('\n'));
  const c = ctx(hook('session-start', { cwd: dir }));
  assert.match(c, /שורה 30(\n|$)/);
  assert.doesNotMatch(c, /שורה 31/);
  assert.doesNotMatch(ctx(hook('session-start', { cwd: repo() })), /last-session/);
});

test('post-edit: new migration, new n8n export and PRD change after the screens map', () => {
  const map = { schema: 1, capabilities: [], screens: [], tables: [{ name: 'a', migration: 'db/migrations/0001_a.sql' }], automations: [{ id: 'n8n:x', where: 'n8n', copy: 'n8n/x.json' }], later: [] };
  const dir = repo({ state: { stage: 6 }, map });
  const edit = (rel) => hook('post-edit', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, rel) } });
  assert.equal(edit('db/migrations/0001_a.sql').out, '');
  assert.match(ctx(edit('db/migrations/0002_b.sql')), /db\/migrations\/0002_b\.sql.*map/);
  assert.equal(edit('n8n/x.json').out, '');
  assert.match(ctx(edit('n8n/y.json')), /n8n\/y\.json.*map/);
  assert.match(ctx(edit('spec/prd.md')), /PRD changed after the screens map: run \/focus-blueprint:change/);
  const early = repo({ state: { stage: 5 } });
  assert.equal(hook('post-edit', { cwd: early, tool_input: { file_path: path.join(early, 'spec', 'prd.md') } }).out, '');
});

test('prompt-context: one line outside the build stages, two with ruling add in 9 to 12', () => {
  const at = (stage) => ctx(hook('prompt-context', { cwd: repo({ state: { stage } }), prompt: 'x' }));
  const s8 = at(8);
  assert.equal(s8.split('\n').length, 1);
  assert.match(s8, /^Focus Blueprint: שלב 8, הצגה לאדם אמיתי\. שינוי בהיקף עובר דרך \/blueprint\./);
  for (const n of [9, 12]) {
    const t = at(n);
    assert.equal(t.split('\n').length, 2, String(n));
    assert.match(t.split('\n')[1], /ruling add/);
    assert.ok(t.split('\n')[1].length <= 400);
    assert.ok(t.length < 700, `len ${t.length}`);
  }
  assert.equal(at(13).split('\n').length, 1);
});

test('halted: prompt-context and session-start name the item, only when halted', () => {
  const map = { schema: 1, capabilities: [{ id: 'upload-docs', halted: true }, { id: 'other', halted: false }], screens: [], tables: [], automations: [], later: [] };
  const dir = repo({ state: { stage: 12, stages: { 12: { halted: true }, 11: { halted: false } } }, map });
  for (const name of ['prompt-context', 'session-start']) {
    const lines = ctx(hook(name, { cwd: dir })).split('\n').filter((l) => l.startsWith('[HALTED]'));
    assert.equal(lines.length, 2, name);
    assert.ok(lines.some((l) => l.startsWith('[HALTED] stage 12:')));
    assert.ok(lines.some((l) => l.startsWith('[HALTED] upload-docs:')));
    assert.match(lines[0], /openFindings/);
  }
  const clean = repo({ state: { stage: 12 } });
  for (const name of ['prompt-context', 'session-start']) {
    assert.doesNotMatch(ctx(hook(name, { cwd: clean })), /HALTED/);
  }
});

test('session-start: Rulings line only with unreported entries', () => {
  const dir = repo();
  writeBp(dir, 'rulings.json', [{ id: 'r-001', reported: false }, { id: 'r-002', reported: true }, { id: 'r-003', reported: false }]);
  assert.match(ctx(hook('session-start', { cwd: dir })), /Rulings: 2 unreported, run bp\.mjs ruling list --unreported/);
  writeBp(dir, 'rulings.json', [{ id: 'r-001', reported: true }]);
  assert.doesNotMatch(ctx(hook('session-start', { cwd: dir })), /Rulings:/);
});

test('corrupt json files never crash a hook and are never rewritten', () => {
  const dir = repo();
  writeBp(dir, 'rulings.json', '{broken');
  writeBp(dir, 'map.json', '{broken');
  const before = fs.readFileSync(path.join(dir, '.blueprint', 'rulings.json'), 'utf8');
  for (const name of ['session-start', 'prompt-context']) assert.equal(hook(name, { cwd: dir }).code, 0);
  assert.equal(hook('post-edit', { cwd: dir, tool_input: { file_path: path.join(dir, 'spec', 'prd.md') } }).code, 0);
  assert.equal(fs.readFileSync(path.join(dir, '.blueprint', 'rulings.json'), 'utf8'), before);
});

test('every hook stays silent outside a Blueprint project (new matchers)', () => {
  const dir = tmpProject({});
  assert.equal(shell(dir, 'git push --force').code, 0);
  assert.equal(sqlTool(dir, 'mcp__supabase__execute_sql', 'drop table t').code, 0);
  assert.equal(hook('session-start', { cwd: dir }).out, '');
});

test('guard-migration: execute_sql blocks every DDL form, passes data statements and comment-only DDL words', () => {
  const dir = repo();
  const blocked = [
    'create or replace function f() returns int as $$ select 1 $$ language sql',
    'CREATE OR REPLACE VIEW v AS select 1',
    'create or replace trigger t before insert on x for each row execute function f()',
    'create unique index i on t (c)', 'create index concurrently i on t (c)',
    'create trigger t after insert on x for each row execute function f()',
    'create extension if not exists pgcrypto', 'create sequence s',
    'create materialized view mv as select 1',
    'drop index i', 'drop trigger t on x', 'drop extension e', 'drop sequence s', 'drop view v', 'drop materialized view mv',
    'alter policy p on t using (true)', 'alter function f() owner to x', 'alter view v rename to w', 'alter schema s rename to t', 'alter type ty add value \'b\'', 'alter sequence s restart',
    'grant select on t to anon', 'REVOKE all on t from anon', 'truncate t', 'select 1;\n  truncate\n t',
    'create\n  table\n  t (id int)',
  ];
  for (const q of blocked) {
    const r = sqlTool(dir, 'mcp__supabase__execute_sql', q);
    assert.equal(r.code, 2, q);
    assert.match(r.err, /apply_migration/);
  }
  const passes = [
    'select * from create_log', 'insert into grants_table values (1)', 'update t set c = 1', 'delete from t where id = 1',
    'select * from t -- create table x', '/* drop table t */ select 1', 'select 1\n-- grant all\n',
  ];
  for (const q of passes) assert.equal(sqlTool(dir, 'mcp__supabase__execute_sql', q).code, 0, q);
});

// ---- review fixes ----
const sqlRun = (dir, tool, input) => hook('guard-migration', { cwd: dir, tool_name: tool, tool_input: input });
const stageFile = (dir, rel, content = 'x') => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
  sh(dir, 'add', '-f', rel);
};

test('secret guard: non-ASCII folders and upper case names are still caught', () => {
  for (const rel of ['תיקייה/.env', 'config/.ENV.production', 'my.PEM']) {
    const dir = repo();
    sh(dir, 'switch', '-c', 'b');
    stageFile(dir, rel);
    const r = shell(dir, 'git push origin b');
    assert.equal(r.code, 2, rel);
    assert.match(r.err, /secrets/);
  }
  const ok = repo();
  sh(ok, 'switch', '-c', 'b');
  stageFile(ok, '.env.example');
  stageFile(ok, 'תיקייה/readme.txt');
  assert.equal(shell(ok, 'git push origin b').code, 0);
});

test('merge guard: every merge segment is checked, only all-abort passes', () => {
  const dir = repo();
  assert.equal(shell(dir, 'git merge --abort && git merge x').code, 2);
  assert.equal(shell(dir, 'git merge x; git merge --abort').code, 2);
  assert.equal(shell(dir, 'git merge --abort').code, 0);
});

test('a switch to main earlier in the command makes the target protected', () => {
  const dir = repo();
  sh(dir, 'switch', '-c', 'feat');
  for (const c of ['git switch main && git merge x', 'git checkout main; git commit -m x', 'git checkout -B main && git merge x', 'git checkout master && git merge x', 'git branch -f main && git merge x']) {
    assert.equal(shell(dir, c).code, 2, c);
  }
  assert.equal(shell(dir, 'git switch feat && git merge x').code, 0);
  assert.equal(shell(dir, 'git merge x').code, 0);
});

test('force push and delete: refspecs are normalised', () => {
  const dir = repo();
  sh(dir, 'switch', '-c', 'feat');
  for (const c of [
    'git push --force origin HEAD:refs/heads/main', 'git push origin +feat:main', 'git push origin +main', 'git push --mirror',
    'git push origin :main', 'git push --delete origin main', 'git push -d origin master', 'git push origin :refs/heads/main',
  ]) assert.equal(shell(dir, c).code, 2, c);
  for (const c of ['git push origin feat:feat', 'git push origin +feat', 'git push --force origin feat', 'git push origin :feat', 'git push --delete origin feat']) {
    assert.equal(shell(dir, c).code, 0, c);
  }
});

test('pull and rebase on main stay allowed', () => {
  const dir = repo();
  assert.equal(shell(dir, 'git pull --ff-only').code, 0);
  assert.equal(shell(dir, 'git rebase origin/main').code, 0);
});

test('absolute and quoted git are caught', () => {
  const dir = repo();
  for (const c of ['/usr/bin/git merge x', 'bash -c "git merge x"', "sh -c 'git commit -m x'", 'C:\\Git\\bin\\git merge x']) {
    assert.equal(shell(dir, c).code, 2, c);
  }
});

test('corrupt state.json: shell guards still run with the default protected branches, file untouched', () => {
  const dir = repo();
  const file = path.join(dir, '.blueprint', 'state.json');
  fs.writeFileSync(file, '{bad');
  assert.equal(shell(dir, 'git merge x').code, 2);
  const ok = shell(dir, 'git status');
  assert.equal(ok.code, 0);
  assert.match(ok.err, /state\.json/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
});

test('sql scanning: string literals are blanked, comments stripped after', () => {
  const dir = repo();
  const q = (s) => sqlRun(dir, 'mcp__supabase__execute_sql', { query: s });
  for (const s of ["select '--'; drop table x", "select '/*'; drop table x; select '*/'", "select E'it\\'s'; drop table x", 'select $a$ -- $a$; drop table x', "select 'a''b'; create table x (i int)"]) {
    assert.equal(q(s).code, 2, s);
  }
  for (const s of ["insert into t values ('drop table')", "select 'it''s create table'", 'select $$ drop table x $$', 'select 1 /* nested /* drop table */ still */']) {
    assert.equal(q(s).code, 0, s);
  }
});

test('execute_sql: wider DDL list, query or sql key', () => {
  const dir = repo();
  const blocked = [
    'create temp table t (i int)', 'create temporary table t (i int)', 'create unlogged table t (i int)', 'create role r', 'create user u',
    'create database d', 'create publication p for all tables', 'create domain d as int', 'create rule r as on insert to t do nothing',
    'create event trigger e on ddl_command_end execute function f()', 'alter role r with password \'x\'', 'alter user u set x = 1',
    'alter system set x = 1', 'alter default privileges in schema s grant select on tables to r', 'drop role r', 'drop owned by r',
    "comment on table t is 'x'", 'do $$ begin drop table x; end $$',
  ];
  for (const s of blocked) {
    assert.equal(sqlRun(dir, 'mcp__supabase__execute_sql', { query: s }).code, 2, s);
    assert.equal(sqlRun(dir, 'mcp__supabase__execute_sql', { sql: s }).code, 2, 'sql key: ' + s);
  }
});

test('live project: only additive SQL, through apply_migration with a file and through execute_sql', () => {
  const dir = repo({ state: { live: true } });
  fs.mkdirSync(path.join(dir, 'db', 'migrations'), { recursive: true });
  const bad = [
    'drop index i', 'drop view v', 'drop policy p on t', 'truncate t', 'delete from t', 'delete from t;',
    'alter table t rename to u', 'alter table t rename column a to b', 'alter table t alter column c type text',
    'alter table t alter column c set data type text', 'alter table t alter column c drop not null', 'alter table t alter column c drop default',
    'alter table t drop constraint k',
  ];
  bad.forEach((s, i) => {
    fs.writeFileSync(path.join(dir, 'db', 'migrations', `${100 + i}_x.sql`), s);
    for (const tool of ['mcp__supabase__apply_migration', 'mcp__supabase__execute_sql']) {
      const r = sqlRun(dir, tool, { query: s, name: 'x' });
      assert.equal(r.code, 2, `${tool}: ${s}`);
      assert.match(r.err, /additive/i);
      assert.match(r.err, /two-step/i);
    }
  });
  const good = 'alter table t add column c int;';
  fs.writeFileSync(path.join(dir, 'db', 'migrations', '900_ok.sql'), good);
  assert.equal(sqlRun(dir, 'mcp__supabase__apply_migration', { query: good, name: 'ok' }).code, 0);
  assert.equal(sqlRun(dir, 'mcp__supabase__execute_sql', { query: 'delete from t where id = 1' }).code, 0);
  assert.equal(sqlRun(dir, 'mcp__supabase__execute_sql', { query: 'select 1' }).code, 0);
});

test('push --all with a force is blocked from any branch; .env names are case-insensitive', () => {
  const dir = repo();
  sh(dir, 'switch', '-c', 'feat');
  for (const c of ['git push --all --force', 'git push --all -f origin', 'git push --all --force-with-lease', 'git push --all origin +feat', 'git push -f --all']) {
    assert.equal(shell(dir, c).code, 2, c);
  }
  assert.equal(shell(dir, 'git push --all origin').code, 0);
  for (const rel of ['.ENV', '.Env.local']) {
    const d = repo();
    sh(d, 'switch', '-c', 'b');
    stageFile(d, rel);
    assert.equal(shell(d, 'git push origin b').code, 2, rel);
  }
  const ok = repo();
  sh(ok, 'switch', '-c', 'b');
  stageFile(ok, '.ENV.EXAMPLE');
  stageFile(ok, '.Env.Sample');
  assert.equal(shell(ok, 'git push origin b').code, 0);
});

// Task 4: the Stop hook asks for the session summary when the state changed.
const stop = (dir, over = {}) => hook('stop-summary', { cwd: dir, stop_hook_active: false, ...over });
const touch = (file, secondsAgo) => { const t = new Date(Date.now() - secondsAgo * 1000); fs.utimesSync(file, t, t); };
const ruling = (i, over = {}) => ({ id: `r-${i}`, at: '', stage: 12, capability: null, decision: `החלטה ${i}`, why: `סיבה ${i}`, priceIfWrong: `מחיר ${i}`, by: 'claude', reported: false, ...over });
const closedState = (close) => baseState({ stage: 5, status: 'in_progress', stages: { 4: { status: 'done', close } } });

test('stop: a changed state with a close and two rulings asks for the summary with both', () => {
  const dir = tmpProject({ state: closedState({ status: 'done_with_concerns', note: 'הערה מיוחדת על הסגירה', proof: 'ok', at: '' }) });
  writeBp(dir, 'rulings.json', [ruling(1), ruling(2), ruling(3, { reported: true, decision: 'כבר הוצגה' })]);
  const r = stop(dir);
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'Stop');
  const c = ctx(r);
  assert.match(c, /last-session\.md/);
  assert.match(c, /סגירת השלב האחרון: שלב 4, גמור עם ספקות\. הערה מיוחדת על הסגירה/);
  assert.match(c, /הכרעות שעוד לא הוצגו לסטודנט \(2\)/);
  assert.ok(c.indexOf('החלטה 2') < c.indexOf('החלטה 1'), 'newest first');
  assert.match(c, /למה: סיבה 1\. המחיר אם זה שגוי: מחיר 1\. שלב 12\./);
  assert.match(c, /ruling report/);
  assert.doesNotMatch(c, /כבר הוצגה/);
  assert.doesNotMatch(c, /אין הכרעות חדשות/);
});

test('stop: blocked and needs_context say the stage is not done', () => {
  for (const [status, word] of [['blocked', 'תקוע'], ['needs_context', 'חסר מידע']]) {
    const dir = tmpProject({ state: baseState({ stage: 3, status, stages: { 3: { status, close: { status, note: 'צריך מפתח', proof: '', at: '' } } } }) });
    const c = ctx(stop(dir));
    assert.match(c, new RegExp(`שלב 3, ${word}\\.`));
    assert.match(c, /השלב עוד לא גמור, וזה מה שנדרש מהסטודנט: צריך מפתח/);
  }
});

test('stop: no rulings gives the none line and no ruling text', () => {
  const dir = tmpProject({ state: closedState({ status: 'done', note: '', proof: 'x', at: '' }) });
  writeBp(dir, 'rulings.json', []);
  const c = ctx(stop(dir));
  assert.match(c, /אין הכרעות חדשות\./);
  assert.doesNotMatch(c, /ruling report/);
  assert.match(c, /שלב 4, גמור\./);
});

test('stop: fifty rulings stay under 3000 characters, the latest ten with a count of the rest', () => {
  const dir = tmpProject({ state: closedState({ status: 'done_with_concerns', note: 'ה'.repeat(2000), proof: 'x', at: '' }) });
  writeBp(dir, 'rulings.json', Array.from({ length: 50 }, (_, i) => ruling(i + 1, { decision: 'ד'.repeat(500), why: 'ס'.repeat(500), priceIfWrong: 'מ'.repeat(500) })));
  const c = ctx(stop(dir));
  assert.ok(c.length < 3000, String(c.length));
  assert.match(c, /\(50\)/);
  assert.match(c, /יש עוד \d+ הכרעות שלא מוצגות כאן\./);
  assert.match(c, /ruling report/);
});

test('stop: stop_hook_active, a fresher summary, and no project give no output', () => {
  const dir = tmpProject({ state: closedState({ status: 'done', note: '', proof: 'x', at: '' }) });
  assert.deepEqual([stop(dir, { stop_hook_active: true }).out, stop(dir, { stop_hook_active: true }).code], ['', 0]);
  const summary = path.join(dir, '.blueprint', 'last-session.md');
  fs.writeFileSync(summary, 'סיכום');
  touch(path.join(dir, '.blueprint', 'state.json'), 100);
  touch(summary, 10);
  const fresh = stop(dir);
  assert.equal(fresh.out, '');
  assert.equal(fresh.code, 0);
  touch(summary, 200);
  assert.match(ctx(stop(dir)), /last-session\.md/);
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-none-'));
  const r = stop(none, { cwd: none });
  assert.equal(r.out, '');
  assert.equal(r.code, 0);
});

test('stop: a corrupt rulings file does not crash and is not rewritten', () => {
  const dir = tmpProject({ state: closedState({ status: 'done', note: '', proof: 'x', at: '' }) });
  writeBp(dir, 'rulings.json', '{broken');
  const r = stop(dir);
  assert.equal(r.code, 0);
  assert.match(ctx(r), /אין הכרעות חדשות/);
  assert.equal(fs.readFileSync(path.join(dir, '.blueprint', 'rulings.json'), 'utf8'), '{broken');
});
