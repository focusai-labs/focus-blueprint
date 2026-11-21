import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const CHECK = path.join(PLUGIN, 'scripts', 'check-map.mjs');
const { checkMap } = await import(CHECK).catch(() => ({ checkMap: null }));

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const CATCH = 'לקוח בלי הרשאה לא רואה קבצים של לקוח אחר';
const EVAL = `# בדיקת קבלה: העלאה

<!-- catches -->
הבדיקה הזאת תופסת: ${CATCH}

## איך היא רצה
node --test

## מצב ריק, לפני שיש נתונים
<!-- fm:empty -->
בודקים שהרשימה ריקה ומוצגת הודעה.

## קלט שגוי או חסר
<!-- fm:wrong-input -->
שולחים קובץ ריק ומצפים לשגיאה.

## משתמש בלי הרשאה
<!-- fm:no-permission -->
לא רלוונטי: אין כאן משתמשים בלי הרשאה בכלל

## רשת איטית או בקשה שנכשלה
<!-- fm:network -->
מנתקים רשת ומצפים להודעה.

## לחיצה כפולה
<!-- fm:double-submit -->
לוחצים פעמיים ונוצרת שורה אחת.
`;
const BRIEF = `# תקציר בנייה: העלאה

## הקבצים שנוצרים או משתנים
<!-- brief:files -->
upload.js

## מה היכולת קוראת או מפעילה
<!-- brief:consumes -->
documents

## מה היכולת מוסיפה
<!-- brief:produces -->
כפתור

## הבדיקה
<!-- brief:test -->
evals/upload-docs.md

## ערכים מדויקים מהאפיון
<!-- brief:values -->
| ערך | מקור |
|---|---|
| עד 10MB | spec/prd.md |
`;

function w(dir, rel, content) {
  const f = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

function good(mut) {
  const redTxt = 'FAIL'; const greenTxt = 'PASS';
  const cap = {
    id: 'upload-docs', name: 'העלאה', screens: ['mockup/upload.html'], data: ['documents'], permissions: [],
    automations: ['n8n:monthly'], test: 'evals/upload-docs.md', status: 'real', builtAt: null, ux: null,
    brief: 'evals/briefs/upload-docs.md', catches: `הבדיקה הזאת תופסת: ${CATCH}`,
    evidence: {
      red: { path: 'evals/evidence/upload-docs.red.txt', exit: 1, at: '2026-11-21T10:00:00.000Z', sha256: sha(redTxt), mode: 'cmd' },
      green: { path: 'evals/evidence/upload-docs.green.txt', exit: 0, at: '2026-11-21T11:00:00.000Z', sha256: sha(greenTxt), mode: 'cmd' },
      adopted: false,
    },
    review: { at: 'x', spec: 'pass', quality: 'pass', path: 'evals/reviews/upload-docs.md' },
    rounds: 0, openFindings: [], halted: false,
  };
  const map = {
    schema: 1, capabilities: [cap],
    screens: [{ file: 'mockup/upload.html', name: 'x', persona: 'c', journeyStage: 'u', nav: 'linear' }],
    tables: [{ name: 'documents', migration: 'db/migrations/0001_documents.sql' }],
    automations: [{ id: 'n8n:monthly', where: 'n8n', copy: 'n8n/monthly.json' }], later: [],
  };
  const state = { schema: 2, stage: 13 };
  const files = {
    'mockup/upload.html': '<html></html>',
    'db/migrations/0001_documents.sql': 'create table documents (id int);',
    'n8n/monthly.json': '{"a":1}',
    'evals/upload-docs.md': EVAL, 'evals/briefs/upload-docs.md': BRIEF,
    'evals/evidence/upload-docs.red.txt': redTxt, 'evals/evidence/upload-docs.green.txt': greenTxt,
    'evals/reviews/upload-docs.md': 'ok', 'spec/prd.md': 'x\n<!-- prd:anti-goals -->\nכישלון הוא כשלקוח רואה קובץ של אחר.\n',
    'spec/builder-check.md': '<!-- bc:answered -->\na\n<!-- bc:ruled -->\nb\n<!-- bc:asked-student -->\nc\n',
    'spec/idea.md': '<!-- idea:words -->\nמילים\n<!-- idea:summary -->\nשורה א <!-- src:student -->\nשורה ב <!-- src:claude -->\n',
  };
  const ctx = { map, state, files, cap };
  if (mut) mut(ctx);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
  w(dir, '.blueprint/map.json', JSON.stringify(map));
  w(dir, '.blueprint/state.json', JSON.stringify(state));
  for (const [k, v] of Object.entries(files)) if (v !== null) w(dir, k, v);
  return dir;
}

const run = (mut) => checkMap(good(mut));
const has = (r, rule, sub) => r.errors.some((e) => e.rule === String(rule) && (!sub || e.message.includes(sub)));
const hasW = (r, rule) => r.warnings.some((e) => e.rule === String(rule));

test('a fully valid project passes', () => {
  const r = run();
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('rule 1: screen file missing', () => {
  const r = run((c) => { c.files['mockup/upload.html'] = null; });
  assert.ok(has(r, 1, 'המסך mockup/upload.html רשום במפה, אבל הקובץ לא קיים.'));
});
test('rule 2: unlisted mockup file', () => {
  const r = run((c) => { c.files['mockup/extra.html'] = 'x'; });
  assert.ok(has(r, 2, 'הקובץ mockup/extra.html נמצא בתיקיית mockup, אבל הוא לא רשום במפה כמסך.'));
});
test('rule 3: table without migration', () => {
  assert.ok(has(run((c) => { c.files['db/migrations/0001_documents.sql'] = null; }), 3, 'היכולת upload-docs משתמשת בטבלה documents, ואין קובץ מיגרציה שיוצר אותה.'));
  assert.ok(has(run((c) => { c.files['db/migrations/0001_documents.sql'] = 'select 1;'; }), 3));
  assert.ok(has(run((c) => { c.map.tables = []; }), 3));
});
test('rule 4: n8n copy missing and secrets', () => {
  assert.ok(has(run((c) => { c.files['n8n/monthly.json'] = null; }), 4, 'האוטומציה n8n:monthly רצה ב-n8n, ואין לה עותק בתיקייה n8n.'));
  const r = run((c) => { c.files['n8n/monthly.json'] = '{"apiKey": "abcdefghijklmnop1234"}'; });
  assert.ok(has(r, 4, 'בעותק של האוטומציה n8n:monthly יש משהו שנראה כמו מפתח או סוד. מוציאים אותו לפני commit.'));
});
test('rule 5: real without test file', () => {
  assert.ok(has(run((c) => { c.files['evals/upload-docs.md'] = null; }), 5, 'היכולת upload-docs מסומנת כאמיתית, ואין לה קובץ בדיקה.'));
});
test('rule 6: unknown screen', () => {
  assert.ok(has(run((c) => { c.cap.screens.push('mockup/ghost.html'); }), 6, 'היכולת upload-docs מפנה למסך mockup/ghost.html, שלא קיים במפה.'));
});

test('rule 8: brief complete', () => {
  assert.ok(has(run((c) => { c.files['evals/briefs/upload-docs.md'] = BRIEF.replace('<!-- brief:produces -->', ''); }), 8, 'בתקציר של upload-docs חסר החלק <!-- brief:produces -->.'));
  assert.ok(has(run((c) => { c.files['evals/briefs/upload-docs.md'] = BRIEF + '\n<<fill>>'; }), 8, 'בתקציר של upload-docs נשארו שדות למילוי.'));
  assert.ok(has(run((c) => { c.files['evals/briefs/upload-docs.md'] = BRIEF.replace('spec/prd.md', 'spec/none.md'); }), 8, 'בטבלת הערכים של upload-docs, המקור spec/none.md לא קיים.'));
  assert.ok(has(run((c) => { c.files['evals/briefs/upload-docs.md'] = null; }), 8));
});
test('rule 8: mock with brief only warns on markers', () => {
  const r = run((c) => { c.cap.status = 'mock'; c.files['evals/briefs/upload-docs.md'] = BRIEF.replace('<!-- brief:files -->', ''); });
  assert.ok(!has(r, 8));
  assert.ok(hasW(r, 8));
});
test('rule 9: failure modes', () => {
  assert.ok(has(run((c) => { c.files['evals/upload-docs.md'] = EVAL.replace('בודקים שהרשימה ריקה ומוצגת הודעה.', ''); }), 9, 'בבדיקה של upload-docs, מצב הכשל <!-- fm:empty --> נשאר ריק.'));
  assert.ok(has(run((c) => { c.files['evals/upload-docs.md'] = EVAL.replace('לא רלוונטי: אין כאן משתמשים בלי הרשאה בכלל', 'לא רלוונטי: קצר'); }), 9, 'fm:no-permission'));
  assert.ok(has(run((c) => { c.files['evals/upload-docs.md'] = EVAL.replace('שולחים קובץ ריק ומצפים לשגיאה.', '<<fill>>'); }), 9, 'fm:wrong-input'));
  assert.ok(has(run((c) => { c.files['evals/upload-docs.md'] = EVAL.replace('הבדיקה הזאת תופסת: ' + CATCH, 'הבדיקה הזאת תופסת:'); }), 9, 'לבדיקה של upload-docs אין משפט שאומר מה היא תופסת.'));
  assert.ok(has(run((c) => { c.files['evals/upload-docs.md'] = EVAL.replace('<!-- catches -->\n', '<!-- catches -->\n<<fill>>\n'); }), 9, 'אין משפט'));
});
test('rule 9: mock only warns', () => {
  const r = run((c) => { c.cap.status = 'mock'; c.files['evals/upload-docs.md'] = EVAL.replace('בודקים שהרשימה ריקה ומוצגת הודעה.', ''); });
  assert.ok(!has(r, 9)); assert.ok(hasW(r, 9));
});
test('rule 10: evidence', () => {
  assert.ok(has(run((c) => { c.cap.evidence.red = null; }), 10, 'היכולת upload-docs מסומנת כאמיתית בלי ראיה שהבדיקה נכשלה לפני הבנייה.'));
  assert.ok(has(run((c) => { c.cap.evidence.green = null; }), 10, 'היכולת upload-docs מסומנת כאמיתית בלי ראיה שהבדיקה עוברת אחרי הבנייה.'));
  assert.ok(has(run((c) => { c.files['evals/evidence/upload-docs.red.txt'] = 'tampered'; }), 10, 'קובץ הראיה של upload-docs השתנה מאז שנרשם.'));
  assert.ok(has(run((c) => { c.cap.evidence.red.at = '2026-11-21T12:00:00.000Z'; }), 10, 'סדר הראיות של upload-docs לא נכון: ההצלחה נרשמה לפני הכישלון.'));
  assert.ok(has(run((c) => { c.cap.evidence.red.exit = 0; }), 10, 'נכשלה'));
  assert.ok(has(run((c) => { c.cap.evidence.green.exit = 1; }), 10, 'עוברת'));
  assert.ok(has(run((c) => { c.cap.catches = 'משהו אחר'; }), 10, 'upload-docs'));
});
test('rule 10: adopted passes with a warning only', () => {
  const r = run((c) => { c.cap.evidence = { red: null, green: null, adopted: true }; c.cap.review = null; c.cap.catches = null; c.files['evals/briefs/upload-docs.md'] = null; });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((x) => x.rule === '10' && x.message === 'היכולת upload-docs קיימת מלפני הכלי, ולא נבנתה דרך התהליך.'));
  // key presence is not enough
  const r2 = run((c) => { c.cap.evidence = { red: null, green: null, adopted: false }; });
  assert.ok(has(r2, 10));
});
test('rule 10b: review', () => {
  assert.ok(has(run((c) => { c.cap.review = null; }), '10b', 'היכולת upload-docs מסומנת כאמיתית בלי סקירה שעברה.'));
  assert.ok(has(run((c) => { c.cap.review.quality = 'findings'; }), '10b', 'בלי סקירה שעברה'));
  assert.ok(has(run((c) => { c.files['evals/reviews/upload-docs.md'] = null; }), '10b'));
  assert.ok(has(run((c) => { c.cap.openFindings = ['x']; }), '10b', 'ליכולת upload-docs יש ממצאים פתוחים.'));
  assert.ok(has(run((c) => { c.cap.halted = true; }), '10b', 'היכולת upload-docs נעצרה אחרי שלושה סבבי תיקון.'));
});
test('rule 11: anti-goals warning from stage 5', () => {
  const r = run((c) => { c.files['spec/prd.md'] = 'x'; });
  assert.ok(hasW(r, 11)); assert.equal(r.ok, true);
  assert.equal(r.warnings.find((w) => w.rule === '11').message, 'ב-PRD עוד אין אנטי מטרה, כלומר מה ייחשב כישלון גם אם הכל עובד.');
  assert.ok(!hasW(run((c) => { c.state.stage = 4; c.files['spec/prd.md'] = 'x'; }), 11));
});
test('rule 12: builder check from stage 6', () => {
  const m = 'חסר הקובץ spec/builder-check.md, או אחד משלושת החלקים שלו.';
  assert.ok(has(run((c) => { c.files['spec/builder-check.md'] = null; }), 12, m));
  assert.ok(has(run((c) => { c.files['spec/builder-check.md'] = '<!-- bc:answered -->\n<!-- bc:ruled -->'; }), 12));
  assert.ok(!has(run((c) => { c.state.stage = 5; c.files['spec/builder-check.md'] = null; }), 12));
});
test('rule 13: idea provenance from stage 3', () => {
  assert.ok(has(run((c) => { c.files['spec/idea.md'] = '<!-- idea:summary -->\nx <!-- src:claude -->'; }), 13, 'בקובץ spec/idea.md חסר החלק <!-- idea:words -->.'));
  assert.ok(has(run((c) => { c.files['spec/idea.md'] = '<!-- idea:words -->\nw\n<!-- idea:summary -->\nשורה בלי סימון\nעוד <!-- src:claude -->'; }), 13, 'בסיכום הרעיון יש שורה שלא מסומן עליה אם הסטודנט אמר אותה או ש-Claude השלים אותה.'));
  // long student words: both kinds needed
  const long = 'א'.repeat(250);
  assert.ok(has(run((c) => { c.files['spec/idea.md'] = `<!-- idea:words -->\n${long}\n<!-- idea:summary -->\nx <!-- src:claude -->\ny <!-- src:claude -->`; }), 13));
  // short words: claude-only is fine
  assert.ok(!has(run((c) => { c.files['spec/idea.md'] = '<!-- idea:words -->\nקצר\n<!-- idea:summary -->\nx <!-- src:claude -->'; }), 13));
  assert.ok(!has(run((c) => { c.state.stage = 2; c.files['spec/idea.md'] = null; }), 13));
});
test('CRLF files are parsed', () => {
  const r = run((c) => { for (const k of ['evals/upload-docs.md', 'evals/briefs/upload-docs.md', 'spec/idea.md', 'spec/builder-check.md', 'spec/prd.md']) c.files[k] = c.files[k].replace(/\n/g, '\r\n'); });
  assert.deepEqual(r.errors, []);
});

test('CLI: JSON output and exit codes', () => {
  const ok = spawnSync(process.execPath, [CHECK], { cwd: good(), encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  const bad = spawnSync(process.execPath, [CHECK], { cwd: good((c) => { c.files['mockup/upload.html'] = null; }), encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const j = JSON.parse(bad.stdout);
  assert.equal(j.ok, false);
  assert.deepEqual(Object.keys(j.errors[0]).sort(), ['item', 'message', 'rule']);
});

test('check-map.mjs has no imports from the plugin', () => {
  const src = fs.readFileSync(CHECK, 'utf8');
  for (const m of src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) assert.ok(m[1].startsWith('node:'), m[1]);
});

test('bp init copies the checker and it runs standalone', () => {
  const dir = tmpProject();
  assert.equal(bp(dir, ['init', '--name', 'x']).code, 0);
  const copy = path.join(dir, 'scripts', 'blueprint-check.mjs');
  assert.ok(fs.existsSync(copy));
  const r = spawnSync(process.execPath, [copy], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test('rule 3: exact create table match', () => {
  const sql = (s) => (c) => { c.files['db/migrations/0001_documents.sql'] = s; };
  assert.ok(!has(run(sql('create table if not exists public."documents" (id int);')), 3));
  assert.ok(!has(run(sql('CREATE TABLE "public"."documents"\n(id int);')), 3));
  assert.ok(has(run(sql('-- create table documents (\nselect 1;')), 3));
  assert.ok(has(run(sql('/* create table documents (id int); */ select 1;')), 3));
  assert.ok(has(run(sql('create table documents_archive (id int);')), 3));
  assert.ok(has(run(sql('alter table documents add column x int;')), 3));
});
