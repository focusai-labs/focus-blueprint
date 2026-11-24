import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const CHECK = path.join(PLUGIN, 'scripts', 'check-map.mjs');
const M = path.join(PLUGIN, 'scripts', 'blueprint-model');
const { checkMap } = await import(CHECK);
const { migrationFiles } = await import(path.join(M, 'lint-sql.mjs'));
const { migrateMap, canonicalHash, filesHash } = await import(path.join(M, 'map-model.mjs'));
const { renderBlock, replaceBlocks, stampDocument } = await import(path.join(M, 'render-blocks.mjs'));

const baseMap = () => ({
  schema: 2, capabilities: [], screens: [{ file: 'mockup/a.html', name: 'א', persona: 'c', journeyStage: 'u', nav: 'x' }], tables: [], automations: [], later: [],
  roles: [{ id: 'client', name: 'לקוח', kind: 'user' }], access: [], services: [],
  processes: [{ id: 'p', name: 'תהליך', stages: [{ id: 's', name: 'שלב' }], timers: [], cases: [{ id: 'c1', kind: 'happy', text: 'רגיל', eval: 'evals/e.md' }, { id: 'c2', kind: 'problem', text: 'תקלה', eval: 'evals/e.md' }],
    steps: [{ id: 's1', stage: 's', actor: 'role:client', kind: 'human', text: 'מעלה', screen: 'mockup/a.html', capability: null, tables: [], permission: null, test: null, onFailure: null, next: [], src: 'client' }] }],
});
function proj({ map, state = { schema: 2, stage: 2, track: 'supabase-app' }, changes, files = {}, opts } = {}) {
  const m = map ? map(baseMap()) : baseMap();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
  const w = (rel, c) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  w('.blueprint/map.json', JSON.stringify(m)); w('.blueprint/state.json', JSON.stringify(state));
  if (changes) w('.blueprint/changes.json', JSON.stringify(changes));
  w('mockup/a.html', '<html></html>'); w('evals/e.md', 'x');
  for (const [k, v] of Object.entries(files)) w(k, v);
  return { dir, report: checkMap(dir, opts), m };
}
const has = (r, rule, list = 'errors') => r[list].some((e) => e.rule === String(rule));
const T = (name, fn) => test(name, fn);

T('baseline project has no errors and no warnings', () => { const { report } = proj(); assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []); });

// 15 and 17
const doc = (m, edit) => { let t = replaceBlocks('# PRD\n<!-- gen:roles -->\n<!-- /gen:roles -->\n', m); if (edit) t = t.replace('לקוח', 'לקוחה'); return stampDocument(t, m); };
T('rule 15: untouched block passes', () => { const m = baseMap(); assert.ok(!has(proj({ files: { 'spec/prd.md': doc(m) } }).report, 15)); });
T('rule 15: hand edit inside a block fails', () => { const m = baseMap(); assert.ok(has(proj({ files: { 'spec/prd.md': doc(m, true) } }).report, 15)); });
T('rule 17: old stamp warns, current stamp does not', () => {
  const m = baseMap();
  assert.ok(!has(proj({ files: { 'spec/prd.md': doc(m) } }).report, 17, 'warnings'));
  const old = doc(m).replace(/^<!-- blueprint-map: [0-9a-f]{64}/, `<!-- blueprint-map: ${'0'.repeat(64)}`);
  assert.ok(has(proj({ files: { 'spec/prd.md': old } }).report, 17, 'warnings'));
});
T('rule 17: the stamp matches the migrated map', () => { const m = baseMap(); assert.equal(canonicalHash(migrateMap(m)), canonicalHash(m)); });

// 16
T('rule 16: reviewed hash must match the files', () => {
  const files = { 'src/x.ts': 'one' };
  const cap = (h) => (m) => { m.capabilities = [{ id: 'c', name: 'c', screens: [], data: [], permissions: [], automations: [], status: 'real', files: ['src/x.ts'], reviewedFilesHash: h, evidence: { adopted: true } }]; return m; };
  const dir0 = proj({ files, map: cap(null) }).dir;
  const ok = proj({ files, map: cap(filesHash(dir0, ['src/x.ts'])) });
  assert.ok(!has(ok.report, 16));
  assert.ok(has(proj({ files, map: cap('f'.repeat(64)) }).report, 16) === false, 'adopted capability is exempt');
  const mk = (h) => (m) => { const r = cap(h)(m); r.capabilities[0].evidence = {}; return r; };
  assert.ok(has(proj({ files, map: mk('f'.repeat(64)) }).report, 16));
  assert.ok(!has(proj({ files, map: mk(filesHash(dir0, ['src/x.ts'])) }).report, 16));
});

// 18
T('rule 18: unknown references fail', () => {
  const bad = (f) => (m) => { f(m.processes[0].steps[0]); return m; };
  assert.ok(has(proj({ map: bad((s) => { s.screen = 'nope.html'; }) }).report, 18));
  assert.ok(has(proj({ map: bad((s) => { s.capability = 'nope'; }) }).report, 18));
  assert.ok(has(proj({ map: bad((s) => { s.tables = ['nope']; }) }).report, 18));
  assert.ok(has(proj({ map: bad((s) => { s.test = 'evals/missing.md'; }) }).report, 18));
  assert.ok(has(proj({ map: (m) => { m.processes[0].cases[0].eval = 'evals/missing.md'; return m; } }).report, 18));
  assert.ok(has(proj({ map: (m) => { m.processes[0].timers = [{ id: 't', text: 'x', duration: 'P1D', onExpire: 'y', test: 'evals/missing.md' }]; return m; } }).report, 18));
  assert.ok(!has(proj({ map: bad((s) => { s.test = 'evals/e.md'; }) }).report, 18));
});

// 19
T('rule 19: roles must exist', () => {
  assert.ok(has(proj({ map: (m) => { m.processes[0].steps[0].actor = 'role:ghost'; return m; } }).report, 19));
  assert.ok(has(proj({ map: (m) => { m.access = [{ object: 'd', kind: 'table', rules: [{ role: 'ghost', ops: ['select'], scope: 'own' }] }]; return m; } }).report, 19));
  assert.ok(!has(proj({ map: (m) => { m.access = [{ object: 'd', kind: 'view', rules: [{ role: 'client', ops: ['select'], scope: 'own' }] }]; return m; } }).report, 19));
});

// 20
const auto = (m) => { Object.assign(m.processes[0].steps[0], { kind: 'system', actor: 'automation', onFailure: null }); return m; };
T('rule 20: automatic step needs onFailure from stage 5', () => {
  assert.ok(has(proj({ map: auto, state: { stage: 5, track: 'supabase-app' } }).report, 20));
  assert.ok(!has(proj({ map: auto, state: { stage: 4, track: 'supabase-app' } }).report, 20));
  assert.ok(!has(proj({ map: (m) => { auto(m); m.processes[0].steps[0].onFailure = 'התראה'; return m; }, state: { stage: 9, track: 'supabase-app' } }).report, 20));
  assert.ok(has(proj({ map: (m) => { Object.assign(m.processes[0].steps[0], { kind: 'ai', actor: 'ai', onFailure: '' }); return m; }, state: { stage: 6, track: 'supabase-app' } }).report, 20));
});

// 21
T('rule 21: cases warn before stage 13 and fail from stage 13', () => {
  const noCases = (m) => { m.processes[0].cases = [{ id: 'c1', kind: 'happy', text: 'x', eval: null }]; return m; };
  const early = proj({ map: noCases, state: { stage: 12, track: 'supabase-app' } }).report;
  assert.ok(has(early, 21, 'warnings') && !has(early, 21), 'stage 12 writes the case tests, so its own close only warns');
  const late = proj({ map: noCases, state: { stage: 13, track: 'supabase-app' } }).report;
  assert.ok(has(late, 21));
  assert.ok(!has(proj({ state: { stage: 13, track: 'supabase-app' } }).report, 21));
  assert.ok(!has(proj({ map: (m) => { m.processes[0].cases = [{ id: 'a', kind: 'happy', text: 'x', eval: 'evals/e.md' }, { id: 'b', kind: 'rejection', text: 'x', eval: 'evals/e.md' }]; return m; }, state: { stage: 13, track: 'supabase-app' } }).report, 21));
});

// 22
T('rule 22: now change marked done with an open dimension fails', () => {
  const ch = (o) => [{ at: '2026-11-24T10:00:00Z', kind: 'field', text: 'ש', decision: 'now', dimensions: [{ id: 'data', status: 'open' }], ...o }];
  assert.ok(has(proj({ changes: ch({ done: true }) }).report, 22));
  assert.ok(!has(proj({ changes: ch({}) }).report, 22));
  assert.ok(!has(proj({ changes: ch({ done: true, dimensions: [{ id: 'data', status: 'closed' }] }) }).report, 22));
});

// 23
const VO = (lines) => `# x\n<!-- voices -->\n${lines}\n<!-- /voices -->\n<!-- prd:assumptions -->\n- הנחה אחת\n`;
T('rule 23: voices markers warn in stage 4 and fail from stage 5', () => {
  const at = (stage, text) => proj({ files: { 'spec/prd.md': VO(text) }, state: { stage, track: 'supabase-app' } }).report;
  assert.ok(has(at(5, 'שורה בלי סימון'), 23));
  const four = at(4, 'שורה בלי סימון');
  assert.ok(!has(four, 23) && has(four, 23, 'warnings'), 'stage 4 writes the PRD, so its own close only warns');
  assert.ok(!has(at(3, 'שורה בלי סימון'), 23) && !has(at(3, 'שורה בלי סימון'), 23, 'warnings'));
  assert.ok(!has(at(5, 'שורה <!-- src:client -->\nעוד <!-- src:ours -->'), 23));
});
T('rule 23: an assumed line must be listed in the PRD assumptions', () => {
  assert.ok(!has(proj({ files: { 'spec/prd.md': VO('הנחה אחת <!-- src:assumed -->') }, state: { stage: 5, track: 'supabase-app' } }).report, 23));
  assert.ok(has(proj({ files: { 'spec/prd.md': VO('הנחה אחרת לגמרי <!-- src:assumed -->') }, state: { stage: 5, track: 'supabase-app' } }).report, 23));
});

// 24
const BAD_SQL = 'create table public.t (id int);\n';
const GOOD_SQL = 'create table public.t (id int);\nalter table public.t enable row level security;\ncreate policy s on public.t for select to authenticated using (true);\n';
T('rule 24: lint findings in supabase/migrations fail, with file and line', () => {
  const r = proj({ files: { 'supabase/migrations/20261121100000_t.sql': BAD_SQL } }).report;
  const e = r.errors.find((x) => x.rule === '24');
  assert.ok(e && e.item === 'supabase/migrations/20261121100000_t.sql:1');
  assert.ok(!has(proj({ files: { 'supabase/migrations/20261121100000_t.sql': GOOD_SQL } }).report, 24));
});
T('rule 24: policies in a later file count, and lines map back to the right file', () => {
  const r = proj({ files: { 'supabase/migrations/20261121100000_a.sql': 'create table public.t (id int);\nalter table public.t enable row level security;\n', 'supabase/migrations/20261121100100_b.sql': 'select 1;\ncreate policy s on public.t for delete using (true);\ncreate policy r on public.t for select using (true);\n' } }).report;
  const e = r.errors.filter((x) => x.rule === '24');
  assert.equal(e.length, 1); assert.equal(e[0].item, 'supabase/migrations/20261121100100_b.sql:2');
});
T('rule 24b: legacy db/migrations is linted and warns once', () => {
  const r = proj({ files: { 'db/migrations/0001_t.sql': BAD_SQL } }).report;
  assert.ok(has(r, 24) && has(r, '24b', 'warnings'));
  assert.equal(r.warnings.filter((w) => w.rule === '24b').length, 1);
  assert.ok(!has(proj({ files: { 'supabase/migrations/20261121100000_t.sql': GOOD_SQL } }).report, '24b', 'warnings'));
});
T('rule 24: a policy-without-grant finding is a warning, not an error', () => {
  const sql = 'create table public.t (id int);\nalter table public.t enable row level security;\ncreate policy s on public.t for select to authenticated using (true);\n';
  const r = proj({ files: { 'supabase/migrations/20261121100000_t.sql': sql } }).report;
  assert.ok(!has(r, 24));
  assert.ok(has(r, 24, 'warnings'));
  assert.ok(!has(proj({ files: { 'supabase/migrations/20261121100000_t.sql': sql + 'grant select on public.t to authenticated;' } }).report, 24, 'warnings'));
});
T('migrationFiles lists supabase first, then legacy', () => {
  const { dir } = proj({ files: { 'supabase/migrations/2_b.sql': '', 'supabase/migrations/1_a.sql': '', 'supabase/migrations/readme.md': '', 'db/migrations/0001.sql': '' } });
  const f = migrationFiles(dir);
  assert.deepEqual(f.supabase, ['supabase/migrations/1_a.sql', 'supabase/migrations/2_b.sql']);
  assert.deepEqual(f.legacy, ['db/migrations/0001.sql']);
  assert.deepEqual(f.all, [...f.supabase, ...f.legacy]);
  assert.deepEqual(migrationFiles(os.tmpdir() + '/does-not-exist-xyz').all, []);
});

// 25
const SK = `sb_secret_${'a'.repeat(30)}`;
T('rule 25: secret in a client path or a public env var fails', () => {
  assert.ok(has(proj({ files: { 'app/page.tsx': `const k = "${SK}";` } }).report, 25));
  assert.ok(has(proj({ files: { 'public/app.js': `var k = "${SK}";` } }).report, 25));
  assert.ok(!has(proj({ files: { 'app/api/x/route.ts': `const k = "${SK}";` } }).report, 25));
  assert.ok(!has(proj({ files: { 'app/actions.ts': `'use server'\nconst k = "${SK}";` } }).report, 25));
  assert.ok(!has(proj({ files: { 'src/lib/server/db.ts': `const k = "${SK}";` } }).report, 25));
  assert.ok(has(proj({ files: { '.env.local': `NEXT_PUBLIC_KEY=${SK}\n` } }).report, 25));
  assert.ok(has(proj({ files: { '.env': 'VITE_SERVICE_ROLE_KEY=abc123\n' } }).report, 25));
  assert.ok(!has(proj({ files: { '.env.local': `SUPABASE_SECRET_KEY=${SK}\nNEXT_PUBLIC_URL=https://x.supabase.co\n` } }).report, 25));
  assert.ok(has(proj({ files: { 'components/a.tsx': 'const k = process.env.NEXT_PUBLIC_SERVICE_ROLE_KEY;' } }).report, 25));
});
T('rule 4 also uses the secret patterns', () => {
  const map = (m) => { m.automations = [{ id: 'n8n:x', where: 'n8n', copy: 'n8n/x.json' }]; return m; };
  assert.ok(has(proj({ map, files: { 'n8n/x.json': `{"u":"https://h.n8n.cloud/webhook/x?token=abcdefgh1234"}` } }).report, 4));
  assert.ok(!has(proj({ map, files: { 'n8n/x.json': '{"a":1}' } }).report, 4));
});

// 26
T('rule 26: tables and access rows warn in stage 10 and must match from stage 11', () => {
  const tab = (m) => { m.tables = [{ name: 'docs', migration: 'x.sql' }]; return m; };
  const both = (m) => { tab(m); m.access = [{ object: 'docs', kind: 'table', rules: [] }]; return m; };
  const ghost = (m) => { m.access = [{ object: 'ghost', kind: 'table', rules: [] }]; return m; };
  const at = (map, stage) => proj({ map, state: { stage, track: 'supabase-app' } }).report;
  assert.ok(has(at(tab, 11), 26));
  assert.ok(!has(at(tab, 10), 26) && has(at(tab, 10), 26, 'warnings'), 'stage 10 writes the tables, so its own close only warns');
  assert.ok(!has(at(tab, 9), 26) && !has(at(tab, 9), 26, 'warnings'));
  assert.ok(has(at(ghost, 11), 26));
  assert.ok(!has(at(ghost, 10), 26), 'access rows from stage 4 wait for their tables');
  assert.ok(!has(at(both, 11), 26));
});

// 27
const DIMS = [{ id: 'data', evidence: 'advisors' }, { id: 'copy' }];
const adv = (first) => ({ 'evidence/adv.txt': `${first}\nno issues\n` });
const change = (o = {}) => [{ at: '2026-11-24T10:00:00Z', kind: 'field', text: 'ש', decision: 'now', dimensions: [{ id: 'data', status: 'closed', proof: 'evidence/adv.txt' }], ...o }];
T('rule 27: advisors evidence must be fresh', () => {
  const r = (first, extra = {}, ch = change()) => proj({ changes: ch, files: adv(first), opts: { dimensions: DIMS }, ...extra }).report;
  assert.ok(!has(r('# supabase advisors 2026-11-24'), 27));
  assert.ok(!has(r('# supabase advisors 2026-11-25'), 27));
  assert.ok(has(r('# supabase advisors 2026-11-23'), 27));
  assert.ok(has(r('supabase advisors 2026-11-25'), 27));
  assert.ok(has(r('# supabase advisors 2026-11-24T09:00:00Z'), 27));
  assert.ok(!has(r('# supabase advisors 2026-11-24T11:00:00Z'), 27));
  assert.ok(has(proj({ changes: change({ dimensions: [{ id: 'data', status: 'closed', proof: 'evidence/missing.txt' }] }), opts: { dimensions: DIMS } }).report, 27));
});
T('rule 27: only closed advisors dimensions on the supabase-app track; no dimensions file means skip', () => {
  const bad = adv('# supabase advisors 2026-01-01');
  assert.ok(!has(proj({ changes: change({ dimensions: [{ id: 'data', status: 'na', proof: null }] }), files: bad, opts: { dimensions: DIMS } }).report, 27));
  assert.ok(!has(proj({ changes: change({ dimensions: [{ id: 'copy', status: 'closed', proof: 'evidence/adv.txt' }] }), files: bad, opts: { dimensions: DIMS } }).report, 27));
  assert.ok(!has(proj({ changes: change(), files: bad, state: { stage: 13, track: 'static' }, opts: { dimensions: DIMS } }).report, 27));
  assert.ok(!has(proj({ changes: change(), files: bad }).report, 27));
  const { dir } = proj({ changes: change(), files: { ...bad, '.blueprint/dimensions.json': JSON.stringify(DIMS) } });
  assert.ok(has(checkMap(dir), 27), 'reads .blueprint/dimensions.json');
});

// 28
T('rule 28: undeclared env var warns', () => {
  const code = { 'src/server.ts': 'const a = process.env.RESEND_KEY; const b = import.meta.env.VITE_X; const c = process.env.NODE_ENV;' };
  const w = proj({ files: code }).report;
  assert.ok(has(w, 28, 'warnings') && w.warnings.filter((x) => x.rule === '28').length === 2);
  const declared = proj({ files: code, map: (m) => { m.services = [{ id: 'r', secrets: ['RESEND_KEY'], publicVars: ['VITE_X'] }]; return m; } }).report;
  assert.ok(!has(declared, 28, 'warnings'));
});

// CLI
T('--pre-commit: exit 1 with a Hebrew summary on errors, 0 otherwise, no JSON', () => {
  const bad = proj({ files: { 'supabase/migrations/20261121100000_t.sql': BAD_SQL } }).dir;
  const r = spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: bad, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^[֐-׿]/);
  assert.equal(r.stdout, '');
  const ok = spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: proj().dir, encoding: 'utf8' });
  assert.equal(ok.status, 0); assert.equal(ok.stderr, '');
});
T('--pre-commit finishes fast on a normal project', () => {
  const files = {}; for (let i = 0; i < 300; i++) files[`src/f${i}.ts`] = 'export const a = 1;\n'.repeat(50);
  const { dir } = proj({ files });
  const t = Date.now(); spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: dir });
  assert.ok(Date.now() - t < 5000);
});

// bp change open honors the track
T('bp change open: only dimensions whose tracks include the project track', () => {
  const dir = tmpProject();
  assert.equal(bp(dir, ['init', '--name', 'x']).code, 0);
  const plugin = path.join(dir, '.blueprint');
  fs.writeFileSync(path.join(plugin, 'dimensions.json'), '[]');
  const dimFile = path.join(PLUGIN, 'data', 'dimensions.json');
  const had = fs.existsSync(dimFile);
  const prev = had ? fs.readFileSync(dimFile, 'utf8') : null;
  fs.writeFileSync(dimFile, JSON.stringify([{ id: 'a', opensOn: ['table'], tracks: ['supabase-app'] }, { id: 'b', opensOn: ['table'], tracks: ['static'] }]));
  try {
    const open = () => bp(dir, ['change', 'open', 'x', '--kind', 'table']).json.dimensions.map((d) => d.id).sort();
    const st = path.join(plugin, 'state.json');
    const s = JSON.parse(fs.readFileSync(st, 'utf8'));
    s.track = null; fs.writeFileSync(st, JSON.stringify(s));
    assert.deepEqual(open(), ['a', 'b']);
    s.track = 'static'; fs.writeFileSync(st, JSON.stringify(s));
    assert.deepEqual(open(), ['b']);
  } finally { if (had) fs.writeFileSync(dimFile, prev); else fs.rmSync(dimFile); }
});

// 29
import { spawnSync as sp } from 'node:child_process';
const git = (dir, ...a) => sp('git', a, { cwd: dir, encoding: 'utf8' });
const FAKE = `sk_live_${'c'.repeat(24)}`;
const repo = (files) => { const { dir } = proj({ files }); git(dir, 'init', '-q'); return dir; };
T('rule 29: a secret in any file git would track fails, outside client paths too', () => {
  const dir = repo({ 'scripts/send.mjs': `const k = "${FAKE}";` });
  const r = checkMap(dir);
  assert.ok(has(r, 29));
  assert.equal(r.errors.find((e) => e.rule === '29').item, 'scripts/send.mjs:1');
});
T('rule 29: gitignored, binary and big files are skipped', () => {
  const dir = repo({ '.gitignore': 'secret.txt\n', 'secret.txt': FAKE, 'blob.bin': `\0\0${FAKE}`, 'big.txt': `${FAKE}\n${'x'.repeat(1100000)}` });
  assert.ok(!has(checkMap(dir), 29));
});
T('rule 29: blueprint-allow-secret is honored, and clean files pass', () => {
  assert.ok(!has(checkMap(repo({ 'a.test.js': `const k = "${FAKE}"; // blueprint-allow-secret` })), 29));
  assert.ok(!has(checkMap(repo({ 'a.js': 'const a = 1;' })), 29));
});
T('rule 29: skipped silently outside a git repo', () => {
  const { report } = proj({ files: { 'scripts/send.mjs': `const k = "${FAKE}";` } });
  assert.ok(!has(report, 29));
});
T('rule 29: a hit that rule 25 already reported is not reported twice', () => {
  const r = checkMap(repo({ 'app/page.tsx': `const k = "${FAKE}";` }));
  assert.ok(has(r, 25)); assert.ok(!has(r, 29));
});
T('rule 29: --pre-commit scans the staged version', () => {
  const dir = repo({ 'scripts/send.mjs': `const k = "${FAKE}";` });
  git(dir, 'add', 'scripts/send.mjs');
  fs.writeFileSync(path.join(dir, 'scripts/send.mjs'), 'const k = 1;');
  const r = spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  git(dir, 'add', 'scripts/send.mjs');
  assert.equal(spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: dir, encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(dir, 'scripts/send.mjs'), `const k = "${FAKE}";`);
  assert.equal(spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: dir, encoding: 'utf8' }).status, 0, 'unstaged leak is not a commit problem');
  assert.ok(has(checkMap(dir), 29), 'but a normal run sees it');
});

// rule 24 live
const SAFE = '-- service_only\ncreate table public.t (id int);\nalter table public.t enable row level security;\n';
const DROP = 'drop table public.old;\n';
const MIG = 'supabase/migrations/20261121100000_a.sql';
const liveState = { stage: 2, track: 'supabase-app', live: true };
T('rule 24: non-additive SQL in a new migration fails once the project is live', () => {
  const dir = repo({ [MIG]: SAFE + DROP });
  const r = checkMap(dir);
  fs.writeFileSync(path.join(dir, '.blueprint/state.json'), JSON.stringify(liveState));
  const e = checkMap(dir).errors.filter((x) => x.rule === '24');
  assert.equal(e.length, 1); assert.equal(e[0].item, `${MIG}:4`);
});
T('rule 24: not live means no non-additive check; approved comment exempts', () => {
  const dir = repo({ [MIG]: SAFE + DROP });
  assert.ok(!checkMap(dir).errors.some((x) => x.rule === '24' && x.item.endsWith(':4')));
  fs.writeFileSync(path.join(dir, '.blueprint/state.json'), JSON.stringify(liveState));
  fs.writeFileSync(path.join(dir, MIG), SAFE + '-- blueprint-approved: הלקוח אישר\n' + DROP);
  assert.ok(!has(checkMap(dir), 24));
});
T('rule 24: only migrations new since the last commit count as live', () => {
  const dir = repo({ [MIG]: SAFE + DROP });
  fs.writeFileSync(path.join(dir, '.blueprint/state.json'), JSON.stringify(liveState));
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x');
  assert.ok(!has(checkMap(dir), 24), 'committed file is old');
  const second = 'supabase/migrations/20261122100000_b.sql';
  fs.writeFileSync(path.join(dir, second), DROP);
  assert.ok(has(checkMap(dir), 24), 'untracked file is new');
  git(dir, 'add', second);
  assert.ok(has(checkMap(dir), 24), 'staged-added file is new');
});
T('rule 24: --pre-commit checks live only for staged-added files, and no git means no live check', () => {
  const dir = repo({ [MIG]: SAFE + DROP });
  fs.writeFileSync(path.join(dir, '.blueprint/state.json'), JSON.stringify(liveState));
  assert.equal(spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: dir, encoding: 'utf8' }).status, 0, 'untracked, not staged');
  git(dir, 'add', MIG);
  assert.equal(spawnSync(process.execPath, [CHECK, '--pre-commit'], { cwd: dir, encoding: 'utf8' }).status, 1);
  const { dir: nogit } = proj({ state: liveState, files: { [MIG]: SAFE + DROP } });
  assert.ok(!has(checkMap(nogit), 24));
});
