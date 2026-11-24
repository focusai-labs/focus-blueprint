import test from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN, ROOT, tmpProject, bp } from './helpers.mjs';

const DIR = path.join(PLUGIN, 'templates', 'docs');
const KINDS = ['pre-build', 'change', 'report', 'handover'];
const CONTEXTS = ['client', 'org', 'self'];
const DISCLAIMER = 'אינו ייעוץ משפטי, עסקי, חשבונאי או מקצועי אחר';

const DOCS = [...KINDS.flatMap((k) => CONTEXTS.map((c) => `${k}-${c}`)), 'handover-client-developer', 'handover-client-accounts'];

test('fourteen document templates, each a draft with placeholders', () => {
  for (const d of DOCS) {
    const f = path.join(DIR, `${d}.md`);
    assert.ok(fs.existsSync(f), `${d}.md`);
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(s.includes(DISCLAIMER), `${d}.md carries the draft line`);
    assert.match(s, /\{\{[a-z_]+\}\}/, `${d}.md has placeholders`);
  }
});

test('the quote carries what Israeli law and practice require', () => {
  const s = fs.readFileSync(path.join(DIR, 'pre-build-client.md'), 'utf8');
  for (const h of ['## מי מציע', '## מה לא כלול', '## תנאי תשלום', '## זכויות יוצרים ובעלות', '## תוקף ההצעה', '## אישור ההצעה', '## זכות ביטול']) {
    assert.ok(s.includes(h), h);
  }
});

test('handover documents never ask for secrets', () => {
  for (const d of ['handover-client', 'handover-client-developer', 'handover-client-accounts', 'handover-org', 'handover-self']) {
    const s = fs.readFileSync(path.join(DIR, `${d}.md`), 'utf8');
    assert.match(s, /לא מכיל[הא]? אף סיסמה/, `${d}.md says it holds no secrets`);
  }
});

test('the PRD skeleton has each marker exactly once', () => {
  const s = fs.readFileSync(path.join(DIR, 'prd.md'), 'utf8');
  for (const m of ['problem', 'intent', 'users', 'goals', 'non-goals', 'anti-goals', 'success', 'capabilities', 'edge-cases', 'data', 'permissions', 'autonomy', 'track', 'decisions', 'builder', 'assumptions', 'open-questions', 'done', 'later']) {
    const n = s.split(`<!-- prd:${m} -->`).length - 1;
    assert.equal(n, 1, `prd:${m}`);
    const i = s.indexOf(`<!-- prd:${m} -->`);
    const prev = s.slice(0, i).trimEnd().split('\n').pop();
    assert.match(prev, /^## /, `prd:${m} sits right under its heading`);
  }
});

// ---------- C3 reflect-back and C5 milestone templates ----------
const { parseVoices } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'blueprint-model', 'voices.mjs')).href);
const { GEN_KINDS, renderBlock, replaceBlocks, extractBlocks } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'blueprint-model', 'render-blocks.mjs')).href);
const FIXTURE_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'map', 'accountant.json'), 'utf8'));
const NEW_DOCS = ['reflect-client', 'reflect-org', 'milestone-client', 'milestone-org', 'milestone-self'];
const read = (d) => fs.readFileSync(path.join(DIR, `${d}.md`), 'utf8');
/** The text a reader sees: comments removed. */
const visible = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const headings = (s) => s.split('\n').filter((l) => /^#{2,3} /.test(l)).map((l) => l.replace(/^#+ /, '').trim());
const markers = (s, re) => (s.match(re) || []).length;

test('the reflect and milestone templates are drafts with placeholders, at the names other skills point at', () => {
  for (const d of NEW_DOCS) {
    const s = read(d);
    assert.ok(s.includes(DISCLAIMER), `${d}.md carries the draft line`);
    assert.match(s, /\{\{[a-z_]+\}\}/, `${d}.md has placeholders`);
    assert.ok(!/[—–]/.test(s), `${d}.md has no em or en dash`);
    assert.equal(markers(s, /<!-- voices -->/g), markers(s, /<!-- \/voices -->/g), `${d}.md voices markers are balanced`);
    for (const b of s.matchAll(/<!-- gen:([a-z]+) -->/g)) assert.ok(GEN_KINDS.includes(b[1]), `${d}.md gen:${b[1]} is a known kind`);
  }
});

test('reflect templates: every claim in a voices section carries a src marker, and assumptions have their own list', () => {
  for (const d of ['reflect-client', 'reflect-org']) {
    const s = read(d);
    const v = parseVoices(s);
    assert.ok(v.length >= 15, `${d}.md marks its claims (${v.length})`);
    assert.deepEqual(v.filter((x) => !x.src).map((x) => x.line), [], `${d}.md lines without a src marker`);
    for (const k of ['client', 'ours', 'assumed']) assert.ok(v.some((x) => x.src === k), `${d}.md uses src:${k}`);
    // no voices section is left open across a heading of a section without claims
    const opened = s.split('<!-- voices -->').slice(1).map((part) => part.split('<!-- /voices -->')[0]);
    for (const part of opened) assert.ok(!/^## /m.test(part), `${d}.md: a voices section stays inside one section`);
  }
});

test('reflect templates have the sections the research requires, conditional ones marked', () => {
  const need = {
    'reflect-client': ['מה אנחנו מבקשים מכם', 'מה שמענו מכם', 'התהליך כפי שהבנו אותו היום', 'מה מסביב לתהליך', 'המטרות, ואיך נדע שהצלחנו', 'מה בדקנו בעצמנו', 'מידע אישי', 'ההנחות שלנו', 'שאלות פתוחות', 'ההיקף המעודכן', 'מה צריך מכם כדי להתחיל', 'הצעד הבא, ואיך מאשרים'],
    'reflect-org': ['מה אנחנו מבקשים', 'מה שמענו', 'התהליך כפי שהבנו אותו היום', 'מה מסביב לתהליך', 'המטרות, ואיך נדע שהצלחנו', 'מה בדקנו בעצמנו', 'מידע אישי', 'ההנחות שלנו', 'שאלות פתוחות', 'ההיקף המעודכן', 'מי מממן ומי אחראי אחרי ההשקה', 'מה צריך מהארגון כדי להתחיל', 'ההחלטה'],
  };
  for (const [d, hs] of Object.entries(need)) {
    const s = read(d);
    const have = headings(s);
    for (const h of hs) assert.ok(have.includes(h), `${d}.md: ${h}`);
    for (const f of ['מספר המסמך: {{doc_id}}', 'גרסה: {{version}}']) assert.ok(s.includes(f), `${d}.md: ${f}`);
    const personal = s.slice(s.indexOf('## מידע אישי'));
    assert.match(personal.split('\n## ')[0], /תלוי במצב: כשהמערכת תשמור או תעבד מידע על אנשים/, `${d}.md: personal data shows only when there is personal data`);
    assert.match(s, /<!-- gen:processes -->\n<!-- \/gen:processes -->/, `${d}.md: the process map comes from the map`);
  }
});

test('reflect templates end with an explicit confirmation request and a review window; silence is never acceptance', () => {
  for (const [d, last] of [['reflect-client', 'הצעד הבא, ואיך מאשרים'], ['reflect-org', 'ההחלטה']]) {
    const s = read(d);
    const hs = headings(s);
    assert.equal(hs[hs.length - 1], last, `${d}.md ends with the confirmation`);
    const end = s.slice(s.lastIndexOf(`## ${last}`));
    assert.match(end, /\{\{review_days\}\} ימי עבודה/, `${d}.md gives a review window`);
    assert.match(end, /\{\{reply_by\}\}/, `${d}.md names the reply date`);
    assert.match(visible(end), /- \[ \] /, `${d}.md asks to pick an answer`);
    assert.match(visible(end), /____________/, `${d}.md has a signature line`);
    assert.match(visible(end), /עד ש(?:תאשרו|תגיע החלטה) בכתב/, `${d}.md: no written answer, no go`);
  }
  const c = read('reflect-client');
  assert.ok(c.includes('6(ב)') && c.includes('קביעת המציע שהעדר תגובה מצד הניצע ייחשב לקיבול, אין לה תוקף'), 'the client variant cites Contracts Law s.6(ב)');
  assert.ok(!/ייחשב (?:כ|ל)אישור|נחשב כמאושר/.test(visible(c)), 'no deemed confirmation in the client text');
});

test('milestone templates: the what-runs-where page is built from gen blocks, and bp render fills them from the map', () => {
  const map = { ...FIXTURE_MAP, services: [{ id: 'supabase', name: 'Supabase', purpose: 'מסד נתונים', owner: 'client', payer: 'client', plan: 'pro', planReason: 'גיבוי יומי' }] };
  for (const d of ['milestone-client', 'milestone-org', 'milestone-self']) {
    const s = read(d);
    for (const k of ['services', 'processes', 'timers']) assert.match(s, new RegExp(`<!-- gen:${k} -->\\n<!-- /gen:${k} -->`), `${d}.md has an empty gen:${k} block`);
    const out = replaceBlocks(s, map);
    for (const b of extractBlocks(out)) assert.equal(b.content, renderBlock(map, b.kind), `${d}.md gen:${b.kind} renders from the map`);
    assert.equal(replaceBlocks(out, map), out, `${d}.md: a second render changes nothing`);
    assert.match(out, /Supabase/, `${d}.md shows the services`);
    for (const h of ['איפה יש AI']) assert.ok(headings(s).includes(h), `${d}.md: ${h}`);
    assert.ok(headings(s).some((h) => /נתקע/.test(h)), `${d}.md: how you know something is stuck`);
  }
});

test('milestone client: delivery report, signable acceptance with a review window, and payment as a pointer to the quote', () => {
  const s = read('milestone-client');
  const hs = headings(s);
  for (const h of ['פרטי המסירה', 'חלק ראשון: דוח המסירה', 'המצב בקצרה', 'מה נמסר', 'מה לא נמסר או נדחה', 'הבדיקות', 'תנאי הקבלה', 'מגבלות ידועות ונושאים פתוחים', 'שאלות להחלטה', 'מה צריך מכם', 'הצעדים הבאים', 'חלק שני: קבלת אבן הדרך', 'שאלות הקבלה', 'ההחלטה', 'מה הקבלה פותחת', 'מה הקבלה לא אומרת', 'חלק שלישי: מה רץ, איפה ומתי']) {
    assert.ok(hs.includes(h), `milestone-client.md: ${h}`);
  }
  const decision = s.slice(s.indexOf('### ההחלטה'), s.indexOf('### מה הקבלה פותחת'));
  assert.match(decision, /\{\{review_days\}\} ימי עבודה/);
  assert.equal((visible(decision).match(/- \[ \] /g) || []).length, 3, 'accepted, accepted with exceptions, not accepted');
  assert.match(visible(decision), /חתימה: ____________/);
  assert.match(decision, /6\(ב\)/, 'silence is not acceptance');
  const pay = s.slice(s.indexOf('### מה הקבלה פותחת'), s.indexOf('### מה הקבלה לא אומרת'));
  assert.match(visible(pay), /בהצעת המחיר/, 'payment points to the quote');
  assert.ok(!/\d+\s*יום/.test(visible(pay)), 'no payment term invented in the visible text');
  assert.match(pay, /חוק מוסר תשלומים לספקים/);
  assert.match(pay, /ייעוץ משפטי/);
  const v = parseVoices(s);
  assert.deepEqual(v.filter((x) => !x.src).map((x) => x.line), [], 'milestone-client.md lines without a src marker');
});

test('milestone org: business and IT acceptance, a go or no-go decision, and no payment', () => {
  const s = read('milestone-org');
  const hs = headings(s);
  for (const h of ['חלק ראשון: דוח המסירה', 'התקציב ועלות ההפעלה מול התוכנית', 'חלק שני: הקבלה של מי שעובד בתהליך', 'חלק שלישי: הקבלה של המחשוב', 'חלק רביעי: ההחלטה על ההמשך']) assert.ok(hs.includes(h), `milestone-org.md: ${h}`);
  assert.ok(!/חשבונית/.test(visible(s)), 'no invoice inside one organization');
  assert.match(s, /\{\{review_days\}\} ימי עבודה/);
  assert.deepEqual(parseVoices(s).filter((x) => !x.src).map((x) => x.line), []);
});

test('milestone self: a short checkpoint without acceptance, signature or payment', () => {
  const s = read('milestone-self');
  const hs = headings(s);
  for (const h of ['מה נבנה, מול רשימת הגמור', 'מגבלות ידועות', 'מה רץ, איפה ומתי', 'איפה יש AI', 'איך אדע שמשהו נתקע', 'העלות בפועל מול מה שציפיתי']) assert.ok(hs.includes(h), `milestone-self.md: ${h}`);
  assert.ok(!/____________|חתימה|חשבונית|- \[ \] /.test(visible(s)), 'nothing to sign');
});

test('a reflect and a milestone document copied into spec/ pass the voice and gen-block rules after bp render', async () => {
  const { checkMap } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'check-map.mjs')).href);
  const dir = tmpProject({ state: { schema: 2, project: 't', stage: 4, status: 'in_progress', track: 'supabase-app', live: false, stages: {}, lastDriftCheck: null }, map: FIXTURE_MAP });
  fs.mkdirSync(path.join(dir, 'spec'), { recursive: true });
  // The PRD lists the assumption of the reflect document word for word.
  fs.writeFileSync(path.join(dir, 'spec', 'prd.md'), '# PRD\n\n## הנחות\n<!-- prd:assumptions -->\n\n- {{assumption}}\n');
  fs.copyFileSync(path.join(DIR, 'reflect-client.md'), path.join(dir, 'spec', 'reflect.md'));
  fs.copyFileSync(path.join(DIR, 'milestone-client.md'), path.join(dir, 'spec', 'milestone-1.md'));
  const before = checkMap(dir).errors.filter((e) => e.rule === '15').map((e) => e.item);
  assert.ok(before.includes('spec/milestone-1.md'), 'unrendered gen blocks are caught');
  for (const f of ['spec/reflect.md', 'spec/milestone-1.md']) assert.equal(bp(dir, ['render', '--file', f]).code, 0, f);
  const errs = checkMap(dir).errors.filter((e) => e.rule === '15' || e.rule === '23');
  assert.deepEqual(errs, []);
  assert.match(fs.readFileSync(path.join(dir, 'spec', 'reflect.md'), 'utf8').split('\n')[0], /^<!-- blueprint-map: [0-9a-f]{64} -->$/);
});
