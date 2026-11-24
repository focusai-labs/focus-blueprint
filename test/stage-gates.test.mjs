// Stage gates. `bp stage done N` moves the stage to N+1 before the closing commit, so a rule turns
// into an error only from the stage after the one whose work produces its data. The end-to-end
// walk closes every stage with the data that stage writes and runs the commit gate after each close.
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN, bp } from './helpers.mjs';

const { checkMap } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'check-map.mjs')).href);
const J = (o) => JSON.stringify(o);
const hasGit = !spawnSync('git', ['--version']).error;

function proj({ map = {}, stage, files = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const w = (rel, c) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  w('.blueprint/map.json', J({ schema: 2, capabilities: [], screens: [], tables: [], automations: [], later: [], roles: [], access: [], services: [], processes: [], ...map }));
  w('.blueprint/state.json', J({ schema: 2, stage, track: 'supabase-app' }));
  for (const [k, v] of Object.entries(files)) w(k, v);
  return checkMap(dir);
}
const has = (r, rule, list = 'errors') => r[list].some((e) => e.rule === String(rule));

// ---------- rule 1: the screen files are built in stage 7 ----------
test('rule 1: a registered screen without its file warns until stage 7 closes, and fails from stage 8', () => {
  const map = { screens: [{ file: 'mockup/upload.html', name: 'העלאה', persona: 'p', journeyStage: 'u', nav: 'fixed' }] };
  for (const stage of [5, 6, 7]) {
    const r = proj({ map, stage });
    assert.ok(!has(r, 1) && has(r, 1, 'warnings'), `stage ${stage}`);
  }
  assert.ok(has(proj({ map, stage: 8 }), 1));
  assert.ok(!has(proj({ map, stage: 8, files: { 'mockup/upload.html': '<html></html>' } }), 1));
});

// ---------- rule 2: the design directions of stage 6 are drafts ----------
test('rule 2: files whose name starts with an underscore are drafts, every other mockup page must be a screen', () => {
  const files = { 'mockup/_direction-1.html': 'x', 'mockup/_direction-2.html': 'x', 'mockup/drafts/_old.html': 'x' };
  for (const stage of [7, 13]) assert.ok(!has(proj({ stage, files }), 2), `stage ${stage}`);
  assert.ok(has(proj({ stage: 7, files: { 'mockup/extra.html': 'x' } }), 2));
});

// ---------- rule 3: the migrations are written in stage 10 ----------
const SQL = 'create table public.documents (id uuid primary key, client_id uuid not null);\nalter table public.documents enable row level security;\n';
const capMap = (tables) => ({ capabilities: [{ id: 'up', name: 'העלאה', screens: [], data: ['documents'], permissions: [], automations: [], status: 'mock', evidence: { adopted: false } }], tables });
test('rule 3: a capability table without a migration warns until stage 10 closes, and fails from stage 11', () => {
  const map = capMap([{ name: 'documents', migration: 'supabase/migrations/20261125090000_documents.sql' }]);
  for (const stage of [9, 10]) {
    const r = proj({ map, stage });
    assert.ok(!has(r, 3) && has(r, 3, 'warnings'), `stage ${stage}`);
  }
  assert.ok(has(proj({ map, stage: 11 }), 3));
  assert.ok(has(proj({ map: capMap([]), stage: 11, files: { 'supabase/migrations/20261125090000_documents.sql': SQL } }), 3), 'the table must be in the map');
});
test('rule 3: the migration resolves in supabase/migrations, by its path, its file name or any file that creates the table', () => {
  const file = 'supabase/migrations/20261125090000_documents.sql';
  const ok = (tables, files) => assert.ok(!has(proj({ map: capMap(tables), stage: 11, files }), 3), J(tables));
  ok([{ name: 'documents', migration: file }], { [file]: SQL });
  ok([{ name: 'documents', migration: '20261125090000_documents.sql' }], { [file]: SQL });
  ok([{ name: 'documents' }], { [file]: SQL });
  ok([{ name: 'documents', migration: 'supabase/migrations/20261124000000_renamed.sql' }], { [file]: SQL });
  ok([{ name: 'documents', migration: 'db/migrations/0001_documents.sql' }], { 'db/migrations/0001_documents.sql': SQL });
  assert.ok(has(proj({ map: capMap([{ name: 'documents', migration: file }]), stage: 11, files: { [file]: 'select 1;\n' } }), 3));
});

// ---------- the walk ----------
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
function filledPrd() {
  let inside = false;
  return fs.readFileSync(path.join(PLUGIN, 'templates', 'docs', 'prd.md'), 'utf8').split('\n').map((l) => {
    if (/<!--\s*voices\s*-->/.test(l)) { inside = true; return l; }
    if (/<!--\s*\/voices\s*-->/.test(l)) { inside = false; return l; }
    if (!l.includes('<<fill>>')) return l;
    const t = l.replace(/<<fill>>/g, 'מה שהלקוחה אמרה בשיחה');
    return inside ? `${t} <!-- src:client -->` : t;
  }).join('\n');
}
const MIGRATION = `create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  file_path text not null
);
alter table public.documents enable row level security;
create policy "clients read their documents" on public.documents for select to authenticated using (client_id = (select auth.uid()));
create policy "clients add their documents" on public.documents for insert to authenticated with check (client_id = (select auth.uid()));
`;

test('every stage closes through the real bp stage done, and the commit gate passes right after each close', { skip: !hasGit && 'git is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-walk-'));
  git(dir, 'init', '-q', '-b', 'main');
  const run = (...args) => { const r = bp(dir, args); assert.equal(r.code, 0, `bp ${args.join(' ')}: ${r.err}`); return r; };
  const write = (rel, text) => { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const gate = (n) => {
    git(dir, 'add', '-A');
    for (const script of [path.join(PLUGIN, 'scripts', 'check-map.mjs'), path.join(dir, 'scripts', 'blueprint-check.mjs')]) {
      const r = spawnSync(process.execPath, [script, '--pre-commit'], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, `the commit after stage ${n} closed was stopped by ${path.basename(script)}:\n${r.stderr}${r.stdout}`);
    }
  };
  const stage = (n, work) => {
    run('stage', 'start', String(n));
    work();
    run('stage', 'done', String(n), '--status', 'done', '--proof', `stage ${n} proof`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'state.json'), 'utf8')).stage, n + 1);
    gate(n);
  };

  run('init', '--name', 'walk');
  stage(1, () => { run('connections', 'set', 'github', 'ok=true'); run('connections', 'set', 'playwright', 'ok=true'); });
  stage(2, () => write('spec/idea.md', '<!-- idea:words -->\nרואת חשבון רודפת אחרי קבלות כל חודש.\n\n<!-- idea:summary -->\n- הבעיה היא רדיפה חודשית אחרי קבלות. <!-- src:student -->\n- ההצלחה היא חודש שנסגר בזמן. <!-- src:claude -->\n'));
  stage(3, () => {
    run('state', 'set', 'context={"payer":"client","approver":"outside-person","users":"many","owner":"client"}');
    write('spec/decisions.md', '# החלטות\n\n| שאלה | תשובה | מי החליט |\n|---|---|---|\n| מי משלם | לקוח | הסטודנט |\n');
    write('spec/users.md', '# משתמשים\n\nלקוח ורואת חשבון.\n');
    run('role', 'add', 'client', '--name', 'לקוח', '--kind', 'user');
    run('role', 'add', 'staff', '--name', 'רואת החשבון', '--kind', 'staff');
    run('process', 'add', 'collect', '--name', 'איסוף המסמכים החודשי');
    for (const [id, name] of [['remind', 'תזכורת'], ['upload', 'העלאה'], ['review', 'בדיקה']]) run('process', 'stage', 'add', 'collect', '--json', J({ id, name }));
    run('process', 'step', 'add', 'collect', '--json', J({ id: 's1', stage: 'remind', actor: 'automation', kind: 'system', text: 'שולחים תזכורת ללקוחות שלא העלו', next: ['s2'], src: 'client' }));
    run('process', 'step', 'add', 'collect', '--json', J({ id: 's2', stage: 'upload', actor: 'role:client', kind: 'human', text: 'הלקוח מעלה קבלות', next: ['s3'], src: 'client' }));
    run('process', 'step', 'add', 'collect', '--json', J({ id: 's3', stage: 'review', actor: 'role:staff', kind: 'human', text: 'רואת החשבון מאשרת', src: 'ours' }));
  });
  stage(4, () => {
    run('state', 'set', 'track=supabase-app');
    run('log', 'add', 'kind=track', 'text=אפליקציה על Supabase', 'decision=now', 'stage=4');
    run('service', 'add', 'supabase', '--json', J({ name: 'Supabase', purpose: 'מסד נתונים והתחברות', owner: 'client', payer: 'client', plan: 'pro', docs: 'https://supabase.com/docs' }));
    run('service', 'add', 'crm', '--json', J({ name: 'Fireberry', purpose: 'ה-CRM שהמשרד כבר עובד איתו', owner: 'client', payer: 'client', existing: true }));
    run('access', 'set', 'documents', '--json', J({ owner: 'client_id', rules: [{ role: 'client', ops: ['select', 'insert'], scope: 'own', rowRule: 'רק את המסמכים שלו' }] }));
    run('process', 'step', 'set', 'collect', 's1', '--json', J({ onFailure: 'התראה לרואת החשבון' }));
    run('process', 'case', 'add', 'collect', '--json', J({ id: 'c1', kind: 'happy', text: 'הלקוח מעלה שלוש קבלות והכל תקין' }));
    run('process', 'case', 'add', 'collect', '--json', J({ id: 'c2', kind: 'problem', text: 'הקובץ לא נקרא והלקוח מתבקש להעלות שוב' }));
    run('process', 'case', 'add', 'collect', '--json', J({ id: 'c3', kind: 'rejection', text: 'רואת החשבון דוחה קבלה של חודש אחר' }));
    run('process', 'timer', 'add', 'collect', '--json', J({ id: 't1', text: 'מסמך תקף 90 יום', duration: 'P90D', onExpire: 'התראה ללקוח', stage: 'review' }));
    run('map', 'later', 'add', 'חיבור לוואטסאפ', '--stage', '4');
    write('spec/prd.md', filledPrd());
    write('spec/prd-review.md', '# סקירת ה-PRD\n\nאין ממצאים פתוחים.\n');
    run('render');
  });
  stage(5, () => {
    write('spec/journeys.md', '# מסעות\n\nהלקוח מקבל תזכורת, מעלה ורואה אישור.\n');
    write('spec/screens-map.md', '# מפת מסכים\n\nהעלאה ובדיקה.\n');
    run('map', 'add', 'screen', J({ file: 'mockup/upload.html', name: 'העלאה', persona: 'client-1', journeyStage: 'העלאה', nav: 'fixed' }));
    run('map', 'add', 'screen', J({ file: 'mockup/review.html', name: 'בדיקה', persona: 'staff-1', journeyStage: 'בדיקה', nav: 'free' }));
    run('process', 'step', 'set', 'collect', 's2', '--json', J({ text: 'הלקוח מצלם ומעלה את הקבלות' }));
    run('render');
    write('spec/builder-check.md', '<!-- bc:paraphrase -->\nההסבר תאם את הכוונה.\n\n<!-- bc:answered -->\nאין.\n\n<!-- bc:ruled -->\nאין.\n\n<!-- bc:asked-student -->\nאין.\n');
  });
  stage(6, () => {
    write('design/tokens.css', ':root { --color-primary: #5b3fd6; }\n');
    for (const n of [1, 2, 3]) write(`mockup/_direction-${n}.html`, `<html><body>כיוון ${n}</body></html>\n`);
  });
  stage(7, () => {
    write('mockup/upload.html', '<html><body>העלאה</body></html>\n');
    write('mockup/review.html', '<html><body>בדיקה</body></html>\n');
    write('mockup/mock-data.js', 'export const docs = [];\n');
    run('process', 'step', 'set', 'collect', 's2', '--json', J({ screen: 'mockup/upload.html' }));
    run('process', 'step', 'set', 'collect', 's3', '--json', J({ screen: 'mockup/review.html' }));
    run('render');
  });
  stage(8, () => { write('spec/usability-test.md', '# בדיקה עם אדם אמיתי\n\nעבר.\n'); write('docs/pre-build.md', '# לפני הבנייה\n\nאושר.\n'); });
  stage(9, () => {
    write('spec/inventory.md', '# מלאי\n\nשתי יכולות.\n');
    run('map', 'add', 'capability', J({ id: 'upload-docs', name: 'העלאת מסמכים', screens: ['mockup/upload.html'], data: ['documents'], permissions: ['client:insert:documents:own'], automations: [], status: 'mock' }));
    run('map', 'add', 'capability', J({ id: 'review-docs', name: 'בדיקת מסמכים', screens: ['mockup/review.html'], data: ['documents'], permissions: ['staff:select:documents:all'], automations: [], status: 'mock' }));
  });
  stage(10, () => {
    write('supabase/migrations/20261125090000_documents.sql', MIGRATION);
    run('map', 'add', 'table', J({ name: 'documents', migration: 'supabase/migrations/20261125090000_documents.sql' }));
    run('access', 'set', 'documents', '--json', J({ owner: 'client_id', rules: [{ role: 'client', ops: ['select', 'insert'], scope: 'own', rowRule: 'רק את המסמכים שלו' }] }));
    write('db/schema.md', '# סכמה\n\nטבלה אחת.\n');
    run('render');
  });
  stage(11, () => { write('app/page.js', 'export default function Page() { return null; }\n'); run('state', 'set', 'where.vercelProject=walk'); });
  stage(12, () => {
    for (const c of ['c1', 'c2', 'c3']) {
      write(`evals/cases/collect-${c}.md`, `# ${c}\n\nבהינתן לקוח עם קבלות, כש-הוא מעלה, אז רואת החשבון רואה אותן.\n`);
      run('process', 'case', 'set', 'collect', c, '--json', J({ eval: `evals/cases/collect-${c}.md` }));
    }
    run('render');
  });
});
