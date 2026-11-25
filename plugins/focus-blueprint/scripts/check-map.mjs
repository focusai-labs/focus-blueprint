#!/usr/bin/env node
// Consistency checker for .blueprint/map.json. Self-contained on purpose:
// `bp init` copies this file into the student's repo as scripts/blueprint-check.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrateMap, canonicalHash, filesHash } from './blueprint-model/map-model.mjs';
import { renderBlock, extractBlocks, stampOf, GEN_KINDS } from './blueprint-model/render-blocks.mjs';
import { lintMigration, migrationFiles } from './blueprint-model/lint-sql.mjs';
import { scanText, isClientPath, isPublicEnvName, isSecretishName } from './blueprint-model/secrets.mjs';
import { parseVoices, assumptionsOf } from './blueprint-model/voices.mjs';

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

// Lines after a marker, up to the next marker comment or a markdown heading of the same or a higher level than the
// section's own heading (the nearest one above the marker). With no heading above, only a level 1 or 2 heading ends it.
// Deeper headings stay inside, so a section can have parts with headings of their own.
function sectionLines(text, marker) {
  const ls = lines(text);
  const i = ls.findIndex((l) => l.includes(mk(marker)));
  if (i < 0) return null;
  const level = (l) => { const m = /^(#{1,6})(?:\s|$)/.exec(l); return m ? m[1].length : 0; };
  let own = 2;
  for (let j = i - 1; j >= 0; j--) if (level(ls[j])) { own = level(ls[j]); break; }
  const out = [];
  for (let j = i + 1; j < ls.length; j++) {
    if (/^\s*<!--\s*[a-z-]+:/.test(ls[j]) || (level(ls[j]) && level(ls[j]) <= own)) break;
    out.push(ls[j]);
  }
  return out;
}
const hasMarker = (text, marker) => text.includes(mk(marker));
// Section text with the guidance comments removed, so a filled section is judged by what the student wrote.
const sectionText = (text, marker) => {
  const body = text && sectionLines(text, marker);
  return body ? body.join('\n').replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ').trim() : '';
};
const PRD_REQUIRED = [
  ['prd:success', 'מדדי הצלחה'],
  ['prd:edge-cases', 'מקרי קצה ומקרי כשל'],
  ['prd:open-questions', 'שאלות פתוחות'],
  ['prd:done', 'מתי העבודה גמורה'],
];
const listHe = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs[xs.length - 1]}`);
// The two PRD sections that rule 30 asks for when the system connects to a system that existed before it (C4).
const PRD_EXISTING = [
  ['prd:source-of-truth', 'איזו מערכת היא הבעלים של כל סוג מידע'],
  ['prd:existing-data', 'מידע שקיים עוד לפני המערכת'],
];
/** A section counts as filled when, without comments, it has a line that is not a table header or separator, and no fill marker. */
function sectionFilled(text, marker) {
  const body = text && sectionLines(text, marker);
  if (!body) return false;
  const ls = body.join('\n').replace(/<!--[\s\S]*?-->/g, ' ').split('\n').map((l) => l.trim());
  if (ls.some((l) => l.includes('<<fill>>'))) return false;
  const sep = (l) => /^\|?[\s|:-]+\|?$/.test(l) && l.includes('-');
  return ls.some((l, i) => l && !sep(l) && !(l.startsWith('|') && sep(ls[i + 1] || '')));
}

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

// The migration that creates a table: the path the map records, the same file name under
// supabase/migrations (where stage 10 writes them), or any migration file that creates it.
function migrationCreates(ctx, entry, table, migs) {
  const rec = entry.migration ? String(entry.migration).replace(/\\/g, '/') : '';
  const cands = [...new Set([rec, rec && !rec.includes('/') ? `supabase/migrations/${rec}` : '', ...migs].filter(Boolean))];
  return cands.some((f) => { const sql = ctx.read(f); return sql !== null && createsTable(sql, table); });
}

// Gates. `bp stage done N` moves the stage to N+1 before the closing commit, so a rule is an error
// only from the stage after the one whose work produces its data, and a warning before that.
const isReal = (c) => c.status === 'real';
const isAdopted = (c) => !!c.evidence && c.evidence.adopted === true;

const rules = [
  { id: '1', run({ map, ctx, stage, err, warn }) {
    const out = stage >= 8 ? err : warn;   // stage 7 builds the screen files
    for (const s of map.screens) if (!ctx.exists(s.file)) out('1', s.file, `המסך ${s.file} רשום במפה, אבל הקובץ לא קיים.`);
  } },
  { id: '2', run({ map, ctx, err }) {
    const known = new Set(map.screens.map((s) => String(s.file).replace(/\\/g, '/')));
    const walk = (rel) => {
      const d = ctx.p(rel);
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(r);
        else if (/\.html$/i.test(e.name) && !e.name.startsWith('_') && !/^prototype(-test)?\.html$/i.test(e.name) && !known.has(r)) err('2', r, `הקובץ ${r} נמצא בתיקיית mockup, אבל הוא לא רשום במפה כמסך.`);
      }
    };
    walk('mockup');
  } },
  { id: '3', run({ map, ctx, stage, err, warn }) {
    const out = stage >= 11 ? err : warn;   // stage 10 writes the migrations
    const migs = migrationFiles(ctx.dir).all;
    for (const c of map.capabilities) for (const t of c.data || []) {
      const entry = map.tables.find((x) => x.name === t);
      if (!entry || !migrationCreates(ctx, entry, t, migs)) out('3', c.id, `היכולת ${c.id} משתמשת בטבלה ${t}, ואין קובץ מיגרציה שיוצר אותה.`);
    }
  } },
  { id: '4', run({ map, ctx, err }) {
    for (const a of map.automations) {
      if (a.where !== 'n8n') continue;
      const txt = ctx.read(a.copy);
      if (txt === null) { err('4', a.id, `האוטומציה ${a.id} רצה ב-n8n, ואין לה עותק בתיקייה n8n.`); continue; }
      if (SECRET.test(txt) || scanText(txt).length) err('4', a.id, `בעותק של האוטומציה ${a.id} יש משהו שנראה כמו מפתח או סוד. מעבירים אותו ל-Credentials ב-n8n ומוחקים אותו מהעותק לפני ה-commit.`);
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
    const joined = sectionText(text, 'prd:anti-goals');
    const sentences = joined.split(/[.!?]+(?:\s|$)/).map((s) => s.trim()).filter(Boolean);
    if (!joined || joined.includes('<<fill>>') || sentences.length < 1 || sentences.length > 2) {
      warn('11', 'spec/prd.md', 'ב-PRD עוד לא כתוב מה ייחשב כישלון גם אם הכל עובד.');
    }
  } },
  { id: '14', run({ stage, ctx, warn }) {
    if (stage < 5) return;
    const text = ctx.read('spec/prd.md') || '';
    const empty = PRD_REQUIRED.filter(([m]) => {
      const body = sectionText(text, m);
      return !hasMarker(text, m) || !body || body.includes('<<fill>>');
    }).map(([, name]) => name);
    if (empty.length) warn('14', 'spec/prd.md', `בסעיפים האלה ב-PRD עוד אין תוכן: ${listHe(empty)}.`);
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
    const summary = sectionLines(text, 'idea:summary').filter((l) => l.trim() && !/^#{1,6}(\s|$)/.test(l));
    const kind = (l) => (/<!--\s*src:student\s*-->\s*$/.test(l) ? 'student' : /<!--\s*src:claude\s*-->\s*$/.test(l) ? 'claude' : null);
    if (summary.some((l) => !kind(l))) err('13', 'spec/idea.md', 'בסיכום הרעיון יש שורה שלא מסומן עליה אם הסטודנט אמר אותה או ש-Claude השלים אותה.');
    const kinds = new Set(summary.map(kind));
    const need = words.length < 200 ? ['claude'] : ['student', 'claude'];
    for (const k of need) {
      if (!kinds.has(k)) err('13', 'spec/idea.md', `בסיכום הרעיון אין אף שורה שמסומנת ${mk('src:' + k)}.`);
    }
  } },
];

// ---- walking the project (no network, skips heavy folders) ----
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.vercel', '.turbo', 'dist', 'build', 'coverage', '.blueprint', '.home', 'out']);
const MAX_FILE = 512 * 1024;
const MAX_GIT_FILE = 1024 * 1024;
function walkFiles(ctx, rel, accept, out = [], budget = { n: 5000 }) {
  const d = rel ? ctx.p(rel) : ctx.dir;
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (budget.n-- <= 0) return out;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkFiles(ctx, r, accept, out, budget); }
    else if (e.isFile() && accept(r, e.name)) out.push(r);
  }
  return out;
}
const readSmall = (ctx, rel) => { try { const st = fs.statSync(ctx.p(rel)); if (st.size > MAX_FILE) return null; return fs.readFileSync(ctx.p(rel), 'utf8'); } catch { return null; } };
const CODE_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?)$/i;
const TEST_RE = /(?:\.test\.|\.spec\.|(?:^|\/)__tests__\/)/;
const specDocs = (ctx) => walkFiles(ctx, 'spec', (r, n) => /\.md$/i.test(n));
const isoDay = (x) => String(x || '').slice(0, 10);
/** The Hebrew name of a dimension from data/dimensions.json, or its id when the data has no name. */
const dimLabel = (dimensions, id) => { const d = Array.isArray(dimensions) ? dimensions.find((x) => x && x.id === id) : null; return d && d.name ? d.name : id; };

const caps = (map) => new Set(map.capabilities.map((c) => c.id));
const screenFiles = (map) => new Set(map.screens.map((s) => String(s.file).replace(/\\/g, '/')));
const tableNames = (map) => new Set(map.tables.map((t) => t.name));

const newRules = [
  { id: '15', run({ map, ctx, err }) {
    for (const f of specDocs(ctx)) {
      const text = ctx.read(f);
      for (const b of extractBlocks(text)) {
        if (!GEN_KINDS.includes(b.kind)) continue;
        if (b.content !== renderBlock(map, b.kind)) err('15', f, `בקובץ ${f} החלק ${b.kind} לא תואם למפה. את החלק הזה הכלי כותב מהמפה, ולכן מתקנים את המפה ומריצים bp render.`);
      }
    }
  } },
  { id: '16', run({ map, ctx, err }) {
    for (const c of map.capabilities) {
      if (!isReal(c) || isAdopted(c) || !(c.files || []).length) continue;
      if (c.reviewedFilesHash !== filesHash(ctx.dir, c.files)) err('16', c.id, `הקבצים של היכולת ${c.id} השתנו מאז הסקירה האחרונה. עושים סקירה חדשה ורושמים אותה עם bp review record.`);
    }
  } },
  { id: '17', run({ map, ctx, warn }) {
    const now = canonicalHash(map);
    for (const f of specDocs(ctx)) {
      const st = stampOf(ctx.read(f) || '');
      if (st && st !== now) warn('17', f, `המסמך ${f} נוצר לפני השינוי האחרון במפה. מריצים bp render כדי לעדכן אותו.`);
    }
  } },
  { id: '18', run({ map, ctx, err }) {
    const sc = screenFiles(map); const cp = caps(map); const tb = tableNames(map);
    const file = (rule, where, label, rel) => { if (rel && !ctx.exists(rel)) err('18', where, `${label} מפנה לקובץ ${rel}, שלא קיים.`); };
    for (const p of map.processes) {
      for (const s of p.steps || []) {
        const w = `${p.id}.${s.id}`;
        if (s.screen && !sc.has(String(s.screen).replace(/\\/g, '/'))) err('18', w, `הצעד ${w} מפנה למסך ${s.screen}, שלא קיים במפה.`);
        if (s.capability && !cp.has(s.capability)) err('18', w, `הצעד ${w} מפנה ליכולת ${s.capability}, שלא קיימת במפה.`);
        for (const t of s.tables || []) if (!tb.has(t)) err('18', w, `הצעד ${w} מפנה לטבלה ${t}, שלא קיימת במפה.`);
        file('18', w, `הצעד ${w}`, s.test);
      }
      for (const t of p.timers || []) file('18', `${p.id}.${t.id}`, `הטיימר ${p.id}.${t.id}`, t.test);
      for (const c of p.cases || []) file('18', `${p.id}.${c.id}`, `המקרה ${p.id}.${c.id}`, c.eval);
    }
  } },
  { id: '19', run({ map, err }) {
    const ids = new Set(map.roles.map((r) => r.id));
    for (const p of map.processes) for (const s of p.steps || []) {
      if (typeof s.actor === 'string' && s.actor.startsWith('role:') && !ids.has(s.actor.slice(5))) err('19', `${p.id}.${s.id}`, `בצעד ${p.id}.${s.id} מופיע התפקיד ${s.actor.slice(5)}, שלא מוגדר ברשימת התפקידים.`);
    }
    for (const a of map.access) for (const r of a.rules || []) {
      if (r.role && !ids.has(r.role)) err('19', a.object, `בהרשאות של ${a.object} מופיע התפקיד ${r.role}, שלא מוגדר ברשימת התפקידים.`);
    }
  } },
  { id: '20', run({ map, stage, err }) {
    if (stage < 5) return;
    for (const p of map.processes) for (const s of p.steps || []) {
      const auto = ['system', 'ai'].includes(s.kind) || ['automation', 'ai'].includes(s.actor);
      if (auto && !(s.onFailure && String(s.onFailure).trim())) err('20', `${p.id}.${s.id}`, `בצעד האוטומטי ${p.id}.${s.id} לא כתוב מה קורה כשהוא נכשל. כותבים ב-onFailure מי מקבל התראה ומה המערכת עושה אז.`);
    }
  } },
  { id: '21', run({ map, stage, err, warn }) {
    const out = stage >= 13 ? err : warn;   // stage 12 turns the cases into acceptance tests
    for (const p of map.processes) {
      const cs = p.cases || [];
      if (!cs.some((c) => c.kind === 'happy') || !cs.some((c) => c.kind === 'problem' || c.kind === 'rejection')) out('21', p.id, `בתהליך ${p.id} חסרים מקרים. צריך לפחות מקרה תקין אחד ולפחות מקרה אחד של תקלה או דחייה.`);
      for (const c of cs) if (!c.eval) out('21', `${p.id}.${c.id}`, `למקרה ${p.id}.${c.id} אין עדיין בדיקה.`);
    }
  } },
  { id: '22', run({ changes, dimensions, err }) {
    changes.forEach((c, i) => {
      const open = (c.dimensions || []).filter((d) => d.status === 'open').map((d) => dimLabel(dimensions, d.id));
      if (c.decision === 'now' && c.done && open.length) err('22', `change:${i}`, `השינוי "${c.text}" סומן כגמור, אבל עוד פתוחים בו הממדים ${open.join(', ')}.`);
    });
  } },
  { id: '23', run({ ctx, stage, err, warn }) {
    if (stage < 4) return;
    const out = stage >= 5 ? err : warn;   // stage 4 writes the PRD
    const prd = ctx.read('spec/prd.md') || '';
    const listed = assumptionsOf(prd);
    for (const f of specDocs(ctx)) {
      const text = ctx.read(f);
      for (const v of parseVoices(text)) {
        if (!v.src) { out('23', `${f}:${v.line}`, `בקובץ ${f} בשורה ${v.line} חסר סימון מקור. מסמנים מי אמר את זה, או שזו הנחה.`); continue; }
        if (v.src === 'assumed' && !listed.some((a) => a === v.text.replace(/\s*$/, '') || (a.length > 8 && v.text.includes(a)) || (v.text.length > 8 && a.includes(v.text)))) {
          out('23', `${f}:${v.line}`, `בקובץ ${f} השורה ${v.line} מסומנת כהנחה, אבל היא לא מופיעה ברשימת ההנחות ב-PRD.`);
        }
      }
    }
  } },
  { id: '24', run({ map, ctx, state, opts, err, warn }) {
    const found = migrationFiles(ctx.dir);
    const files = found.all;
    if (!files.length) return;
    if (found.legacy.length) warn('24b', 'db/migrations', 'המיגרציות נמצאות בתיקייה db/migrations. כדאי להעביר אותן ל-supabase/migrations, כי משם ה-CLI של Supabase והחיבור ל-GitHub קוראים אותן. לפני ההעברה בודקים את ההיסטוריה עם supabase migration list --remote.');
    let sql = '';
    for (const f of files) sql += `${ctx.read(f)}\n`;
    let line = 1; const spans = files.map((f) => { const t = ctx.read(f); const s = { f, from: line }; line += t.split('\n').length; return s; });
    const gitList = (args) => { const r = spawnSync('git', args, { cwd: ctx.dir, encoding: 'utf8' }); return r.error || r.status !== 0 ? null : r.stdout.split('\n').map((x) => x.trim()).filter(Boolean); };
    const staged = gitList(['diff', '--cached', '--name-only', '--diff-filter=A']);
    const untracked = opts.preCommit ? [] : gitList(['ls-files', '--others', '--exclude-standard']);
    const liveSet = staged === null || untracked === null || state?.live !== true ? new Set() : new Set([...staged, ...untracked]);
    for (const sp of spans) {
      if (!liveSet.has(sp.f)) continue;
      for (const x of lintMigration(ctx.read(sp.f), map.access, map.roles, { live: true })) if (x.rule === 'non-additive') err('24', `${sp.f}:${x.line}`, x.message);
    }
    for (const x of lintMigration(sql, map.access, map.roles)) {
      const sp = [...spans].reverse().find((s) => s.from <= x.line) || spans[0];
      (x.level === 'warn' ? warn : err)('24', `${sp.f}:${x.line - sp.from + 1}`, x.message);
    }
  } },
  { id: '25', run({ ctx, err }) {
    const seen = new Set();
    for (const f of walkFiles(ctx, '', (r, n) => CODE_RE.test(n))) {
      const text = readSmall(ctx, f);
      if (text === null || !isClientPath(f, text)) continue;
      for (const h of scanText(text)) { const k = `${f}:${h.line}`; if (!seen.has(k)) { seen.add(k); err('25', k, `בקובץ ${f} בשורה ${h.line} יש ${h.name}. הקובץ הזה נשלח לדפדפן, ולכן כל מי שפותח את האתר יכול לראות את הסוד. מעבירים אותו לשרת ולמשתנה סביבה.`); } }
    }
    for (const f of walkFiles(ctx, '', (r, n) => /^\.env(?:\.|$)/.test(n))) {
      const text = readSmall(ctx, f); if (text === null) continue;
      text.split('\n').forEach((l, i) => {
        const m = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(l);
        if (!m || !isPublicEnvName(m[1])) return;
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (val && (scanText(val).length || isSecretishName(m[1]))) err('25', `${f}:${i + 1}`, `בקובץ ${f} בשורה ${i + 1} המשתנה ${m[1]} מחזיק סוד, ומשתנה עם הקידומת הזאת נשלח לדפדפן. נותנים לו שם בלי הקידומת וקוראים אותו רק בשרת.`);
      });
    }
    for (const f of walkFiles(ctx, '', (r, n) => CODE_RE.test(n))) {
      const text = readSmall(ctx, f); if (text === null || !isClientPath(f, text)) continue;
      const re = /(?:process\.env|import\.meta\.env)\.([A-Za-z0-9_]+)|(?:process\.env|import\.meta\.env)\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g; let m;
      while ((m = re.exec(text))) { const n = m[1] || m[2]; if (isPublicEnvName(n) && isSecretishName(n)) err('25', f, `בקובץ ${f} הקוד קורא למשתנה ${n}. לפי השם הוא סוד, ובגלל הקידומת שלו הוא נשלח לדפדפן.`); }
    }
  } },
  { id: '26', run({ map, stage, err, warn }) {
    if (stage < 10) return;
    const out = stage >= 11 ? err : warn;   // stage 10 writes the tables and their access rows
    const tb = tableNames(map);
    const rows = new Set(map.access.filter((a) => !a.kind || a.kind === 'table').map((a) => a.object));
    for (const t of tb) if (!rows.has(t)) out('26', t, `לטבלה ${t} אין עדיין שורות במטריצת ההרשאות.`);
    for (const o of rows) if (!tb.has(o)) out('26', o, `במטריצת ההרשאות יש שורות לטבלה ${o}, שלא רשומה ברשימת הטבלאות.`);
  } },
  { id: '27', run({ ctx, state, changes, err, dimensions }) {
    if (!state || state.track !== 'supabase-app' || !Array.isArray(dimensions)) return;
    const adv = new Set(dimensions.filter((d) => d && d.evidence === 'advisors').map((d) => d.id));
    changes.forEach((c, i) => {
      for (const d of c.dimensions || []) {
        if (!adv.has(d.id) || d.status !== 'closed') continue;
        const w = `change:${i}:${d.id}`;
        const text = d.proof ? ctx.read(d.proof) : null;
        const m = text && /^# supabase advisors (\d{4}-\d{2}-\d{2}(?:T[0-9:.+Z-]+)?)\s*$/m.exec(text.split('\n')[0]);
        if (!m) { err('27', w, `בממד ${dimLabel(dimensions, d.id)} של השינוי "${c.text}" חסרה הוכחה מה-advisors של Supabase. שומרים את הפלט שלהם בקובץ שמתחיל בשורה "# supabase advisors" ואחריה התאריך.`); continue; }
        const stamp = m[1].length > 10 ? Date.parse(m[1]) < Date.parse(c.at) : m[1] < isoDay(c.at);
        if (stamp) err('27', w, `ההוכחה מה-advisors בממד ${dimLabel(dimensions, d.id)} ישנה יותר מהשינוי "${c.text}". מריצים אותם שוב ושומרים פלט חדש.`);
      }
    });
  } },
  { id: '28', run({ map, ctx, warn }) {
    const declared = new Set(map.services.flatMap((s) => [...(s.secrets || []), ...(s.publicVars || [])]));
    const builtin = /^(?:NODE_ENV|MODE|DEV|PROD|SSR|BASE_URL|CI|PORT|HOST|HOSTNAME|TZ|NEXT_RUNTIME|NEXT_PHASE|VERCEL(?:_.*)?|npm_.*)$/;
    const first = new Map();
    for (const f of walkFiles(ctx, '', (r, n) => /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i.test(n) && !TEST_RE.test(r) && !/^scripts\/blueprint-/.test(r))) {
      const text = readSmall(ctx, f); if (text === null) continue;
      const re = /(?:process\.env|import\.meta\.env)\.([A-Za-z0-9_]+)|(?:process\.env|import\.meta\.env)\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g; let m;
      while ((m = re.exec(text))) { const n = m[1] || m[2]; if (!builtin.test(n) && !declared.has(n) && !first.has(n)) first.set(n, f); }
    }
    for (const [n, f] of first) warn('28', n, `הקוד בקובץ ${f} קורא למשתנה ${n}, ואף שירות במפה לא רושם אותו.`);
  } },
  { id: '29', run({ ctx, opts, errors, err }) {
    const git = (args, enc = 'utf8') => { const r = spawnSync('git', args, { cwd: ctx.dir, encoding: enc, maxBuffer: 64 * 1024 * 1024 }); return r.error || r.status !== 0 ? null : r.stdout; };
    const isText = (buf) => buf.length <= MAX_GIT_FILE && !buf.subarray(0, 8000).includes(0);
    const items = [];
    if (opts.preCommit) {
      const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
      if (names === null) return;
      for (const f of names.split('\0').filter(Boolean)) {
        const buf = git(['show', `:${f}`], 'buffer');
        if (buf && isText(buf)) items.push([f, buf.toString('utf8')]);
      }
    } else {
      const names = git(['ls-files', '-z', '-c', '-o', '--exclude-standard']);
      if (names === null) return;
      for (const f of [...new Set(names.split('\0').filter(Boolean))]) {
        let buf; try { const st = fs.statSync(ctx.p(f)); if (!st.isFile() || st.size > MAX_GIT_FILE) continue; buf = fs.readFileSync(ctx.p(f)); } catch { continue; }
        if (isText(buf)) items.push([f, buf.toString('utf8')]);
      }
    }
    for (const [f, text] of items) {
      for (const h of scanText(text, { file: f })) {
        const k = `${f}:${h.line}`;
        if (errors.some((e) => e.rule === '25' && e.item === k)) continue;
        err('29', k, `בקובץ ${f} בשורה ${h.line} יש ${h.name}. סוד שנכנס ל-Git נשאר בהיסטוריה גם אחרי שמוחקים אותו. מעבירים אותו למשתנה סביבה בקובץ שלא נכנס ל-Git.`);
      }
    }
  } },
  { id: '30', run({ map, ctx, stage, err, warn }) {
    if (stage < 4) return;
    const out = stage >= 5 ? err : warn;   // stage 4 writes the PRD
    const olds = map.services.filter((s) => s && s.existing === true).map((s) => s.name || s.id);
    if (!olds.length) return;
    const prd = ctx.read('spec/prd.md') || '';
    for (const [m, heading] of PRD_EXISTING) {
      if (!sectionFilled(prd, m)) out('30', 'spec/prd.md', `המערכת מתחברת למערכת שכבר הייתה בשימוש לפניה (${olds.join(', ')}), ולכן ב-PRD צריך למלא את הסעיף "${heading}", עם הסימון ${mk(m)}.`);
    }
  } },
];
rules.push(...newRules);

function loadDimensions(dir, opts) {
  if (opts && Array.isArray(opts.dimensions)) return opts.dimensions;
  const tryFile = (f) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(v) ? v : null; } catch { return null; } };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const plugin = path.resolve(here, '..');
  if (fs.existsSync(path.join(plugin, '.claude-plugin', 'plugin.json'))) { const v = tryFile(path.join(plugin, 'data', 'dimensions.json')); if (v) return v; }
  return tryFile(path.join(dir, '.blueprint', 'dimensions.json'));
}

const SUMMARY_HE = (errors) => {
  const top = errors.slice(0, 3).map((e) => e.message).join('\n');
  const count = errors.length === 1 ? 'יש בעיה אחת' : `יש ${errors.length} בעיות`;
  const more = errors.length - 3;
  const rest = more > 0 ? `\nלרשימה המלאה, עם ${more === 1 ? 'עוד בעיה אחת' : `עוד ${more} בעיות`}, מריצים node scripts/blueprint-check.mjs.` : '';
  return `ה-commit נעצר, כי ${count} שצריך לתקן.\n${top}${rest}`;
};

export function checkMap(projectDir, opts = {}) {
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
  map = migrateMap(map);
  let changes = [];
  try { const c = JSON.parse(fs.readFileSync(ctx.p('.blueprint/changes.json'), 'utf8')); if (Array.isArray(c)) changes = c; } catch { /* optional */ }
  const dimensions = loadDimensions(dir, opts);
  // opts.rule runs only that rule and ignores the project's stage (a stage gate counts as open), so a stage can prove one rule on demand.
  const only = opts.rule === undefined || opts.rule === null ? null : String(opts.rule);
  const stage = only ? 99 : Number(state && state.stage) || 0;
  const err = (rule, item, message) => errors.push({ rule, item, message });
  const warn = (rule, item, message) => warnings.push({ rule, item, message });
  if (only && !rules.some((r) => r.id === only)) {
    errors.push({ rule: only, item: '--rule', message: `Unknown rule id: ${only}` });
    return { ok: false, errors, warnings };
  }
  for (const r of rules.filter((x) => !only || x.id === only)) r.run({ map, ctx, stage, state, changes, dimensions, opts, errors, err, warn });
  return { ok: errors.length === 0, errors, warnings };
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--project');
  const ri = a.indexOf('--rule');
  const rule = ri >= 0 ? a[ri + 1] : null;
  if (ri >= 0 && !rule) { process.stderr.write('--rule needs a rule id, for example --rule 13\n'); process.exit(2); }
  const dir = i >= 0 ? a[i + 1] : a.find((x, n) => !x.startsWith('--') && (ri < 0 || n !== ri + 1)) || process.cwd();
  const report = checkMap(dir, { preCommit: a.includes('--pre-commit'), rule });
  if (a.includes('--pre-commit')) {
    if (!report.ok) process.stderr.write(`${SUMMARY_HE(report.errors)}\n`);
    process.exit(report.ok ? 0 : 1);
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}
