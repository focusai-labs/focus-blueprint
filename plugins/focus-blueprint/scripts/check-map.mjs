#!/usr/bin/env node
// Consistency checker for .blueprint/map.json. Self-contained on purpose:
// `bp init` copies this file into the student's repo as scripts/blueprint-check.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FM = ['fm:empty', 'fm:wrong-input', 'fm:no-permission', 'fm:network', 'fm:double-submit'];
const BRIEF = ['brief:files', 'brief:consumes', 'brief:produces', 'brief:test', 'brief:values'];
const SECRET = /(api[_-]?key|secret|token)"?\s*[:=]\s*"?[A-Za-z0-9_\-]{16,}/i;
const PREFIX = 'הבדיקה הזאת תופסת:';
const mk = (m) => `<!-- ${m} -->`;

const norm = (s) => String(s).replace(/\r\n?/g, '\n');
const lines = (s) => norm(s).split('\n');

function makeCtx(dir) {
  const p = (rel) => path.join(dir, ...String(rel).split(/[\\/]/));
  const exists = (rel) => !!rel && fs.existsSync(p(rel));
  const read = (rel) => (exists(rel) ? norm(fs.readFileSync(p(rel), 'utf8')) : null);
  const readJson = (rel) => { try { return JSON.parse(read(rel)); } catch { return null; } };
  const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(p(rel))).digest('hex');
  return { dir, p, exists, read, sha };
}

// Lines after a marker, up to the next marker comment or markdown heading.
function sectionLines(text, marker) {
  const ls = lines(text);
  const i = ls.findIndex((l) => l.includes(mk(marker)));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < ls.length; j++) {
    if (/^\s*<!--\s*[a-z-]+:/.test(ls[j]) || /^#/.test(ls[j])) break;
    out.push(ls[j]);
  }
  return out;
}
const hasMarker = (text, marker) => text.includes(mk(marker));

// Same extraction as bp.mjs: the rest of the marker line, or the first non-empty line after it.
function catchesOf(text) {
  const ls = lines(text);
  const i = ls.findIndex((l) => l.includes('<!-- catches -->'));
  if (i < 0) return null;
  const valid = (s) => {
    const x = s.trim();
    return x && !x.includes('<<fill>>') && x.replace(PREFIX, '').trim() ? x : null;
  };
  const rest = ls[i].replace('<!-- catches -->', '').trim();
  if (rest) return valid(rest);
  for (let j = i + 1; j < ls.length; j++) {
    if (/<!--\s*fm:/.test(ls[j]) || /^#/.test(ls[j])) return null;
    if (ls[j].trim()) return valid(ls[j]);
  }
  return null;
}

function createsTable(sql, name) {
  const clean = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:"?[A-Za-z0-9_]+"?\\s*\\.\\s*)?"?${esc}"?(?=\\s|\\()`, 'i');
  return re.test(clean);
}

const isReal = (c) => c.status === 'real';
const isAdopted = (c) => !!c.evidence && c.evidence.adopted === true;

const rules = [
  { id: '1', run({ map, ctx, err }) {
    for (const s of map.screens) if (!ctx.exists(s.file)) err('1', s.file, `המסך ${s.file} רשום במפה, אבל הקובץ לא קיים.`);
  } },
  { id: '2', run({ map, ctx, err }) {
    const known = new Set(map.screens.map((s) => String(s.file).replace(/\\/g, '/')));
    const walk = (rel) => {
      const d = ctx.p(rel);
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(r);
        else if (/\.html$/i.test(e.name) && !known.has(r)) err('2', r, `הקובץ ${r} נמצא בתיקיית mockup, אבל הוא לא רשום במפה כמסך.`);
      }
    };
    walk('mockup');
  } },
  { id: '3', run({ map, ctx, err }) {
    for (const c of map.capabilities) for (const t of c.data || []) {
      const entry = map.tables.find((x) => x.name === t);
      const sql = entry && ctx.read(entry.migration);
      const ok = sql && createsTable(sql, t);
      if (!ok) err('3', c.id, `היכולת ${c.id} משתמשת בטבלה ${t}, ואין קובץ מיגרציה שיוצר אותה.`);
    }
  } },
  { id: '4', run({ map, ctx, err }) {
    for (const a of map.automations) {
      if (a.where !== 'n8n') continue;
      const txt = ctx.read(a.copy);
      if (txt === null) { err('4', a.id, `האוטומציה ${a.id} רצה ב-n8n, ואין לה עותק בתיקייה n8n.`); continue; }
      if (SECRET.test(txt)) err('4', a.id, `בעותק של האוטומציה ${a.id} יש משהו שנראה כמו מפתח או סוד. מוציאים אותו לפני commit.`);
    }
  } },
  { id: '5', run({ map, ctx, err }) {
    for (const c of map.capabilities) if (isReal(c) && !ctx.exists(c.test)) err('5', c.id, `היכולת ${c.id} מסומנת כאמיתית, ואין לה קובץ בדיקה.`);
  } },
  { id: '6', run({ map, err }) {
    const known = new Set(map.screens.map((s) => s.file));
    for (const c of map.capabilities) for (const s of c.screens || []) {
      if (!known.has(s)) err('6', c.id, `היכולת ${c.id} מפנה למסך ${s}, שלא קיים במפה.`);
    }
  } },
  { id: '8', run({ map, ctx, err, warn }) {
    for (const c of map.capabilities) {
      const real = isReal(c);
      if (real && isAdopted(c)) continue;
      const text = c.brief ? ctx.read(c.brief) : null;
      if (text === null) {
        if (real) err('8', c.id, `לא נמצא קובץ תקציר ליכולת ${c.id}.`);
        continue;
      }
      const out = real ? err : warn;
      for (const m of BRIEF) if (!hasMarker(text, m)) out('8', c.id, `בתקציר של ${c.id} חסר החלק ${mk(m)}.`);
      if (!real) continue;
      if (text.includes('<<fill>>')) err('8', c.id, `בתקציר של ${c.id} נשארו שדות למילוי.`);
      const vals = sectionLines(text, 'brief:values') || [];
      const rows = vals.filter((l) => l.trim().startsWith('|')).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim()));
      for (const cells of rows.slice(2)) {
        const src = cells[1] || '';
        if (src.includes('<<fill>>')) continue;
        if (!src || !ctx.exists(src)) err('8', c.id, `בטבלת הערכים של ${c.id}, המקור ${src} לא קיים.`);
      }
    }
  } },
  { id: '9', run({ map, ctx, err, warn }) {
    for (const c of map.capabilities) {
      if (!c.test || !ctx.exists(c.test)) continue;
      const real = isReal(c);
      if (real && isAdopted(c)) continue;
      const out = real ? err : warn;
      const text = ctx.read(c.test);
      for (const m of FM) {
        const body = hasMarker(text, m) ? sectionLines(text, m).join('\n').trim() : '';
        let ok = !!body && !body.includes('<<fill>>');
        if (ok && body.startsWith('לא רלוונטי:')) ok = body.slice('לא רלוונטי:'.length).trim().length >= 10;
        if (!ok) out('9', c.id, `בבדיקה של ${c.id}, מצב הכשל ${mk(m)} נשאר ריק.`);
      }
      if (!catchesOf(text)) out('9', c.id, `לבדיקה של ${c.id} אין משפט שאומר מה היא תופסת.`);
    }
  } },
  { id: '10', run({ map, ctx, err, warn }) {
    for (const c of map.capabilities) {
      if (!isReal(c)) continue;
      if (isAdopted(c)) { warn('10', c.id, `היכולת ${c.id} קיימת מלפני הכלי, ולא נבנתה דרך התהליך.`); continue; }
      const ev = c.evidence || {};
      const noRed = `היכולת ${c.id} מסומנת כאמיתית בלי ראיה שהבדיקה נכשלה לפני הבנייה.`;
      const noGreen = `היכולת ${c.id} מסומנת כאמיתית בלי ראיה שהבדיקה עוברת אחרי הבנייה.`;
      const changed = `קובץ הראיה של ${c.id} השתנה מאז שנרשם.`;
      const check = (e, msg, exitOk) => {
        if (!e) { err('10', c.id, msg); return; }
        if (!e.path || !ctx.exists(e.path)) { err('10', c.id, msg); return; }
        if (ctx.sha(e.path) !== e.sha256) { err('10', c.id, changed); return; }
        if (!exitOk(e.exit)) err('10', c.id, msg);
      };
      check(ev.red, noRed, (x) => x !== 0);
      check(ev.green, noGreen, (x) => x === 0);
      if (ev.red && ev.green && !(ev.red.at < ev.green.at)) err('10', c.id, `בראיות של ${c.id} ההצלחה נרשמה לפני הכישלון, אבל הכישלון צריך לבוא קודם.`);
      const text = c.test ? ctx.read(c.test) : null;
      const sentence = text ? catchesOf(text) : null;
      if (sentence && c.catches !== sentence) err('10', c.id, `היכולת ${c.id} מסומנת כאמיתית, והמשפט של מה הבדיקה תופסת לא תואם לקובץ הבדיקה.`);
    }
  } },
  { id: '10b', run({ map, ctx, err }) {
    for (const c of map.capabilities) {
      if (!isReal(c)) continue;
      if (!isAdopted(c)) {
        const r = c.review;
        if (!r || r.spec !== 'pass' || r.quality !== 'pass' || !r.path || !ctx.exists(r.path)) {
          err('10b', c.id, `היכולת ${c.id} מסומנת כאמיתית בלי סקירה שעברה.`);
        }
      }
      if (c.openFindings && c.openFindings.length) err('10b', c.id, `ליכולת ${c.id} יש ממצאים פתוחים.`);
      if (c.halted) err('10b', c.id, `היכולת ${c.id} נעצרה אחרי שלושה סבבי תיקון.`);
    }
  } },
  { id: '11', run({ stage, ctx, warn }) {
    if (stage < 5) return;
    const text = ctx.read('spec/prd.md');
    const body = text && sectionLines(text, 'prd:anti-goals');
    const joined = body ? body.join(' ').trim() : '';
    const sentences = joined.split(/[.!?]+(?:\s|$)/).map((s) => s.trim()).filter(Boolean);
    if (!joined || joined.includes('<<fill>>') || sentences.length < 1 || sentences.length > 2) {
      warn('11', 'spec/prd.md', 'ב-PRD עוד לא כתוב מה ייחשב כישלון גם אם הכל עובד.');
    }
  } },
  { id: '12', run({ stage, ctx, err }) {
    if (stage < 6) return;
    const text = ctx.read('spec/builder-check.md');
    if (text === null || !['bc:answered', 'bc:ruled', 'bc:asked-student'].every((m) => hasMarker(text, m))) {
      err('12', 'spec/builder-check.md', 'חסר הקובץ spec/builder-check.md, או אחד משלושת החלקים שלו.');
    }
  } },
  { id: '13', run({ stage, ctx, err }) {
    if (stage < 3) return;
    const text = ctx.read('spec/idea.md') || '';
    let missing = false;
    for (const m of ['idea:words', 'idea:summary']) {
      if (!hasMarker(text, m)) { err('13', 'spec/idea.md', `בקובץ spec/idea.md חסר החלק ${mk(m)}.`); missing = true; }
    }
    if (missing) return;
    const words = sectionLines(text, 'idea:words').join('\n').trim();
    const summary = sectionLines(text, 'idea:summary').filter((l) => l.trim());
    const kind = (l) => (/<!--\s*src:student\s*-->\s*$/.test(l) ? 'student' : /<!--\s*src:claude\s*-->\s*$/.test(l) ? 'claude' : null);
    if (summary.some((l) => !kind(l))) err('13', 'spec/idea.md', 'בסיכום הרעיון יש שורה שלא מסומן עליה אם הסטודנט אמר אותה או ש-Claude השלים אותה.');
    const kinds = new Set(summary.map(kind));
    const need = words.length < 200 ? ['claude'] : ['student', 'claude'];
    for (const k of need) {
      if (!kinds.has(k)) err('13', 'spec/idea.md', `בסיכום הרעיון אין אף שורה שמסומנת ${mk('src:' + k)}.`);
    }
  } },
];

export function checkMap(projectDir) {
  const dir = path.resolve(projectDir || '.');
  const ctx = makeCtx(dir);
  const errors = []; const warnings = [];
  let map = null; let state = null;
  try { map = JSON.parse(fs.readFileSync(ctx.p('.blueprint/map.json'), 'utf8')); } catch { /* reported below */ }
  try { state = JSON.parse(fs.readFileSync(ctx.p('.blueprint/state.json'), 'utf8')); } catch { /* optional */ }
  if (!map) {
    errors.push({ rule: '0', item: '.blueprint/map.json', message: 'הקובץ .blueprint/map.json חסר, או שהוא לא קובץ JSON תקין.' });
    return { ok: false, errors, warnings };
  }
  map.capabilities = map.capabilities || []; map.screens = map.screens || [];
  map.tables = map.tables || []; map.automations = map.automations || [];
  const stage = Number(state && state.stage) || 0;
  const err = (rule, item, message) => errors.push({ rule, item, message });
  const warn = (rule, item, message) => warnings.push({ rule, item, message });
  for (const r of rules) r.run({ map, ctx, stage, err, warn });
  return { ok: errors.length === 0, errors, warnings };
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--project');
  const dir = i >= 0 ? a[i + 1] : a.find((x) => !x.startsWith('--')) || process.cwd();
  const report = checkMap(dir);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}
