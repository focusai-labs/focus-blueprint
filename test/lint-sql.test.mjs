import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const { lintMigration } = await import(path.join(PLUGIN, 'scripts', 'blueprint-model', 'lint-sql.mjs'));
const rules = (sql, access = [], roles) => lintMigration(sql, access, roles).filter((f) => f.level === 'error').map((f) => f.rule);
const OK_T = 'create table public.t (id int, owner uuid);\nalter table public.t enable row level security;\n';
const SEL = 'create policy s on public.t for select to authenticated using (owner = auth.uid());\n';

const CASES = [
  ['rls missing', 'create table public.t (id int);', ['rls-missing']],
  ['rls missing, no schema', 'create table t (id int);', ['rls-missing']],
  ['rls present with policy', OK_T + SEL, []],
  ['service_only marker does not excuse a missing rls', '-- service_only\ncreate table t (id int);', ['rls-missing']],
  ['service_only marker on the line, rls on, no policy', 'create table t (id int); -- service_only\nalter table t enable row level security;', []],
  ['service_only marker above, rls on, no policy', '-- service_only\n' + OK_T, []],
  ['other schema is ignored', 'create table private.t (id int);', []],
  ['rls without policy', OK_T, ['no-policy']],
    ['disable rls', OK_T + SEL + 'alter table public.t disable row level security;', ['rls-disabled']],
  ['using true on update', OK_T + SEL + 'create policy u on public.t for update to authenticated using (true) with check (owner = auth.uid());', ['permissive-true']],
  ['with check true on insert', OK_T + SEL + 'create policy i on public.t for insert to authenticated with check (true);', ['permissive-true']],
  ['using true on delete', OK_T + SEL + 'create policy d on public.t for delete to authenticated using (true);', ['permissive-true']],
  ['using true on select is allowed', OK_T + 'create policy s on public.t for select to anon using (true);', []],
  ['true to service_role only', OK_T + SEL + 'create policy i on public.t for all to service_role using (true) with check (true);', []],
  ['true inside a comment is ignored', OK_T + SEL + '-- create policy x on t for delete using (true);\n', []],
  ['update without select', OK_T + 'create policy u on public.t for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());', ['update-without-select']],
  ['update with select for same role', OK_T + SEL + 'create policy u on public.t for update to authenticated using (owner = auth.uid());', []],
  ['update with an all policy', OK_T + 'create policy a on public.t for all to authenticated using (owner = auth.uid());', []],
  ['user_metadata in policy', OK_T + "create policy s on public.t for select to authenticated using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');", ['user-metadata']],
  ['raw_user_meta_data in policy', OK_T + 'create policy s on public.t for select using (exists (select 1 from auth.users u where u.raw_user_meta_data is not null));', ['user-metadata']],
  ['app_metadata is fine', OK_T + "create policy s on public.t for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');", []],
  ['definer without search_path', 'create function public.f() returns int language sql security definer as $$ select 1 $$;', ['definer-no-search-path']],
  ['definer with search_path', "create function public.f() returns int language sql security definer set search_path = '' as $$ select 1 $$;", []],
  ['invoker is fine', 'create function public.f() returns int language sql as $$ select 1 $$;', []],
  ['grant to anon with no access row', OK_T + SEL + 'grant select on public.t to anon;', ['anon-grant']],
  ['grant to anon on all tables', 'grant select on all tables in schema public to anon;', ['anon-grant']],
  ['grant usage on schema is fine', 'grant usage on schema public to anon;', []],
  ['grant to authenticated is fine', OK_T + SEL + 'grant select on public.t to authenticated;', []],
  ['default privileges to anon', 'alter default privileges in schema public grant select on tables to anon;', ['anon-grant']],
];
for (const [name, sql, want] of CASES) test(`lint-sql: ${name}`, () => assert.deepEqual(rules(sql), want));

test('lint-sql: anon grant is fine when the access rows give anon something', () => {
  const access = [{ object: 't', kind: 'table', rules: [{ role: 'anon', ops: ['select'], scope: 'all' }] }];
  assert.deepEqual(rules(OK_T + 'create policy s on public.t for select to anon using (true);\ngrant select on public.t to anon;', access), []);
  const none = [{ object: 't', kind: 'table', rules: [{ role: 'anon', ops: ['select'], scope: 'none' }] }];
  assert.deepEqual(rules(OK_T + SEL + 'grant select on public.t to anon;', none), ['anon-grant']);
});
test('lint-sql: a role of kind anon with another id counts', () => {
  const access = [{ object: 't', kind: 'table', rules: [{ role: 'visitor', ops: ['select'], scope: 'all' }] }];
  assert.deepEqual(rules(OK_T + 'create policy s on public.t for select to anon using (true);\ngrant select on public.t to anon;', access, [{ id: 'visitor', kind: 'anon' }]), []);
});
test('lint-sql: null access skips the anon grant rule', () => {
  assert.deepEqual(rules(OK_T + SEL + 'grant select on public.t to anon;', null), []);
});
test('lint-sql: strings and comments are stripped, line numbers are right', () => {
  const sql = "-- header\ninsert into x values ('create table public.fake (id int)');\n/* block\ncomment */\ncreate table public.t (id int);";
  const r = lintMigration(sql, []);
  assert.equal(r.length, 1);
  assert.equal(r[0].line, 5);
  assert.equal(r[0].rule, 'rls-missing');
  assert.ok(/^[֐-׿]/.test(r[0].message));
});
test('lint-sql: drop policy and drop table are followed', () => {
  assert.deepEqual(rules(OK_T + SEL + 'drop policy s on public.t;'), ['no-policy']);
  assert.deepEqual(rules('create table t (id int);\ndrop table t;'), []);
});

test('lint-sql: serviceOnly in access skips no-policy but not rls-missing', () => {
  const access = [{ object: 't', kind: 'table', serviceOnly: true, rules: [] }];
  assert.deepEqual(rules(OK_T, access), []);
  assert.deepEqual(rules('create table public.t (id int);', access), ['rls-missing']);
});

const POL = OK_T + 'create policy s on public.t for select to authenticated using (owner = auth.uid());\n';
const lvl = (sql, access = [], roles) => lintMigration(sql, access, roles).filter((f) => f.rule === 'policy-without-grant');
test('lint-sql: policy-without-grant is a warning', () => {
  const f = lvl(POL);
  assert.equal(f.length, 1); assert.equal(f[0].level, 'warn'); assert.equal(f[0].line, 3);
  assert.ok(/^[\u0590-\u05FF]/.test(f[0].message));
  assert.equal(lintMigration('create table t (id int);', [])[0].level, 'error', 'other findings stay errors');
});
for (const [name, extra, n] of [
  ['grant for the command', 'grant select on public.t to authenticated;', 0],
  ['grant all', 'grant all on public.t to authenticated;', 0],
  ['grant all privileges on table', 'grant all privileges on table public.t to authenticated;', 0],
  ['grant in a list', 'grant select, insert on public.t to authenticated, service_role;', 0],
  ['grant on all tables in schema', 'grant select on all tables in schema public to authenticated;', 0],
  ['default privileges', 'alter default privileges in schema public grant select on tables to authenticated;', 0],
  ['grant for another command', 'grant insert on public.t to authenticated;', 1],
  ['grant to another role', 'grant select on public.t to anon;', 1],
  ['no grant', '', 1],
]) test(`lint-sql: policy-without-grant, ${name}`, () => assert.equal(lvl(POL + extra).length, n));
test('lint-sql: policy-without-grant ignores public and service_role policies', () => {
  assert.equal(lvl(OK_T + 'create policy s on public.t for select using (true);').length, 0);
  assert.equal(lvl(OK_T + 'create policy s on public.t for select to service_role using (true);').length, 0);
});
test('lint-sql: policy-without-grant follows map roles and an all policy', () => {
  const roles = [{ id: 'visitor', kind: 'anon' }, { id: 'member', kind: 'user' }];
  assert.equal(lvl(OK_T + 'create policy s on public.t for select to visitor using (true);', [], roles).length, 1);
  assert.equal(lvl(OK_T + 'create policy s on public.t for select to visitor using (true);\ngrant select on public.t to anon;', [], roles).length, 0);
  assert.equal(lvl(OK_T + 'create policy s on public.t for all to member using (true);', [], roles).length, 1);
  assert.equal(lvl(OK_T + 'create policy s on public.t for all to authenticated using (true);\ngrant update on public.t to authenticated;', []).length, 0);
});

const live = (sql) => lintMigration(sql, [], undefined, { live: true }).filter((f) => f.rule === 'non-additive');
for (const [name, sql, n] of [
  ['drop table', 'drop table public.t;', 1],
  ['drop column', 'alter table public.t drop column c;', 1],
  ['drop policy', 'drop policy p on public.t;', 1],
  ['truncate', 'truncate public.t;', 1],
  ['delete without where', 'delete from public.t;', 1],
  ['delete with where is fine', 'delete from public.t where id = 1;', 0],
  ['rename table', 'alter table public.t rename to u;', 1],
  ['rename column', 'alter table public.t rename column a to b;', 1],
  ['column type change', 'alter table public.t alter column c type text;', 1],
  ['column type change, set data type', 'alter table public.t alter column c set data type bigint;', 1],
  ['add column is fine', 'alter table public.t add column c int;', 0],
  ['create index is fine', 'create index i on public.t (c);', 0],
  ['alter column set not null is fine', 'alter table public.t alter column c set not null;', 0],
  ['word drop in a string is fine', "insert into t values ('drop table x');", 0],
  ['word drop in a comment is fine', '-- drop table t\nselect 1;', 0],
  ['two statements, two findings', 'drop table a;\ntruncate b;', 2],
  ['approved with a reason above', '-- blueprint-approved: הלקוח אישר למחוק\ndrop table public.t;', 0],
  ['approved with a blank line between does not count', '-- blueprint-approved: x\n\ndrop table public.t;', 1],
  ['approved without a reason does not count', '-- blueprint-approved:\ndrop table public.t;', 1],
  ['approval only covers the next statement', '-- blueprint-approved: x\ndrop table a;\ndrop table b;', 1],
]) test(`lint-sql live: ${name}`, () => assert.equal(live(sql).length, n));
test('lint-sql live: off by default and level is error', () => {
  assert.equal(lintMigration('drop table public.t;', []).filter((f) => f.rule === 'non-additive').length, 0);
  const f = live('drop table public.t;\n')[0];
  assert.equal(f.level, 'error'); assert.equal(f.line, 1); assert.ok(/^[\u0590-\u05FF]/.test(f.message));
});
