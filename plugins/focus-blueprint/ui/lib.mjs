// Shared logic of the local pages: question banks, answer files, progress.
// Used by server.mjs and wait.mjs. Node only, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from '../scripts/bp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN = path.resolve(here, '..');
export { writeJsonAtomic };

export const ROUND_FILES = { context: 'context', a: 'round-a', b: 'round-b', c: 'round-c', d: 'round-d' };

/** A missing file gives the fallback; anything else unreadable throws, so a damaged file is never overwritten. */
export function readJsonStrict(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return fallback;
    throw new Error(`cannot read ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

/** Same override rule as bp.mjs: FOCUS_BLUEPRINT_DATA first, then the plugin's own data. */
export function dataPath(...rel) {
  const override = process.env.FOCUS_BLUEPRINT_DATA;
  if (override) {
    const p = path.join(override, ...rel);
    if (fs.existsSync(p)) return p;
  }
  return path.join(PLUGIN, 'data', ...rel);
}

export const answersFile = (projectDir, name) => path.join(projectDir, '.blueprint', 'ui', 'answers', `${name}.json`);

export function readAnswers(projectDir, name) {
  return readJsonStrict(answersFile(projectDir, name), null) || { name, answers: {}, done: false };
}

/** Round name (context|a|b|c|d) to the answers file name. */
export const nameOfRound = (round) => ROUND_FILES[round] || null;

export function loadBank(round) {
  const file = ROUND_FILES[round];
  if (!file) return null;
  return readJsonStrict(dataPath('questions', `${file}.json`), null)?.questions || [];
}

const slug = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '') || 'screen';

/** Round C: one copy of every template per screen. screens: [{ id, label }]. */
export function expandScreens(templates, screens) {
  const out = [];
  for (const s of screens) {
    for (const q of templates) {
      const sub = (v) => (typeof v === 'string' ? v.split('{screen}').join(s.label) : v);
      out.push({ ...q, id: q.id.split('{screen}').join(s.id), text: sub(q.text), writes: q.writes ? q.writes.split('{screen}').join(s.id) : q.writes, screen: s.id });
    }
  }
  return out;
}

/**
 * The screens round C asks about, as [{ id: slug(file), label: name }].
 * With a query (comma separated), a value names a map screen by its file name without .html, its
 * full path, slug(file) or its name; a value that names no screen is left out. Without a query,
 * only the screens whose file is already built (when projectDir is given), or all while none is.
 */
export function screensFor(map, query, projectDir) {
  const all = (Array.isArray(map?.screens) ? map.screens : []).filter((s) => s && typeof s.file === 'string' && s.file);
  const entry = (s) => ({ id: slug(s.file), label: s.name || s.file });
  const base = (f) => path.posix.basename(f).replace(/\.html?$/i, '');
  if (query) {
    const out = [];
    for (const v of String(query).split(',').map((x) => x.trim()).filter(Boolean)) {
      const hit = all.find((s) => base(s.file) === base(v) || s.file === v || slug(s.file) === v || s.name === v);
      if (hit && !out.some((x) => x.id === slug(hit.file))) out.push(entry(hit));
    }
    return out;
  }
  if (projectDir) {
    const built = all.filter((s) => {
      if (s.file.startsWith('/') || s.file.split('/').includes('..')) return false;
      try { return fs.statSync(path.join(projectDir, ...s.file.split('/'))).isFile(); } catch { return false; }
    });
    if (built.length) return built.map(entry);
  }
  return all.map(entry);
}

/** Earlier answers by question id, across every round, plus state.context under the c-0N ids. */
function answerValues(projectDir, state) {
  const values = {};
  const dir = path.join(projectDir, '.blueprint', 'ui', 'answers');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* none yet */ }
  for (const f of files) {
    const doc = readJsonStrict(path.join(dir, f), null);
    for (const [id, a] of Object.entries(doc?.answers || {})) {
      if (a && a.value != null && a.confirmed !== false) values[id] = a.value;
    }
  }
  const ctx = state?.context;
  if (ctx) {
    ['payer', 'approver', 'users', 'owner'].forEach((k, i) => {
      const id = `c-0${i + 1}`;
      if (!(id in values) && ctx[k] != null) values[id] = ctx[k];
    });
  }
  return values;
}

export function whenHolds(when, values) {
  if (!when) return true;
  return Object.entries(when).every(([id, allowed]) => {
    const v = values[id];
    if (v == null) return false;
    const have = Array.isArray(v) ? v : [v];
    return have.some((x) => allowed.includes(x));
  });
}

/**
 * The visible questions of a round, each with its saved answer (or null).
 * Questions marked "by": "claude" are checked by Claude, not asked of the student, so they are left out
 * unless the caller asks for them with { includeClaude: true }.
 */
export function questionsFor(projectDir, round, { screens, includeClaude = false } = {}) {
  let bank = loadBank(round);
  if (!bank) return null;
  const state = readJsonStrict(path.join(projectDir, '.blueprint', 'state.json'), null);
  if (round === 'c') {
    const map = readJsonStrict(path.join(projectDir, '.blueprint', 'map.json'), null);
    bank = expandScreens(bank, screensFor(map, screens, projectDir));
  }
  const saved = readAnswers(projectDir, ROUND_FILES[round]).answers || {};
  const values = answerValues(projectDir, state);
  return bank.filter((q) => (includeClaude || q.by !== 'claude') && whenHolds(q.when, values)).map((q) => ({ ...q, answer: saved[q.id] || null }));
}

export const isPrefill = (a) => Boolean(a) && a.from === 'idea' && a.confirmed === false;
export const isAnswered = (a) => Boolean(a) && !isPrefill(a) && (a.value != null || a.pending === true || a.decidedBy === 'claude');

export function unconfirmedIds(doc) {
  return Object.entries(doc?.answers || {}).filter(([, a]) => isPrefill(a)).map(([id]) => id);
}

/** { answered, total } for a round; total is null when the file has no bank (brain dump, probe). */
export function progress(projectDir, name) {
  const doc = readAnswers(projectDir, name);
  const round = Object.keys(ROUND_FILES).find((r) => ROUND_FILES[r] === name);
  const answered = Object.values(doc.answers || {}).filter(isAnswered).length;
  if (!round) return { answered, total: null, done: doc.done === true };
  const qs = questionsFor(projectDir, round);
  const total = qs ? qs.length : null;
  const ids = new Set((qs || []).map((q) => q.id));
  return { answered: Object.entries(doc.answers || {}).filter(([id, a]) => (!qs || ids.has(id)) && isAnswered(a)).length, total, done: doc.done === true };
}

// ---------------------------------------------------------------- the three directions
// The project's mockup/_direction-1..3.html files. See the contract in the docs of
// the design-system stage: style blocks in the head, <svg id="symbols">, an h1
// .dir-name, a p .dir-move, and screens between <!-- screen:key --> markers.

export const DIRECTION_NUMBERS = [1, 2, 3];
const SCREEN_KEY = /^[A-Za-z0-9_-]{1,40}$/;

const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plainText = (html) => decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

let mainScreenText = null;
function mainScreenCaption() {
  if (mainScreenText) return mainScreenText;
  try { mainScreenText = JSON.parse(fs.readFileSync(path.join(here, 'pages', 'strings.he.json'), 'utf8')).directions.mainScreen; } catch { /* fall back */ }
  if (typeof mainScreenText !== 'string') mainScreenText = 'המסך המרכזי';
  return mainScreenText;
}

export function directionFile(projectDir, n) {
  return path.join(projectDir, 'mockup', `_direction-${n}.html`);
}

/** Parse one direction file's text. Pure: no file access. */
export function parseDirectionHtml(html, n) {
  const src = String(html);
  const head = (/<head[^>]*>([\s\S]*?)<\/head>/i.exec(src) || [])[1] || '';
  const bodyInner = (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(src) || [])[1] ?? src;
  const symbolsMatch = /<svg\b[^>]*\bid=["']symbols["'][^>]*>[\s\S]*?<\/svg>/i.exec(bodyInner);
  const symbols = symbolsMatch ? symbolsMatch[0] : '';
  const nameHtml = (/<h1\b[^>]*\bclass=["'][^"']*\bdir-name\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i.exec(bodyInner) || [])[1];
  const moveHtml = (/<p\b[^>]*\bclass=["'][^"']*\bdir-move\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(bodyInner) || [])[1];
  const titleHtml = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1];
  // Direction rules are scoped to a class such as "d1" on the element that holds the screens.
  const wrapMatch = /\bclass=["']phones\s+([^"']+)["']/.exec(bodyInner);
  const wrapClass = wrapMatch ? wrapMatch[1].trim() : '';
  const captionOf = (mainHtml) => {
    const m = /<main\b[^>]*\bdata-caption=(?:"([^"]*)"|'([^']*)')/i.exec(mainHtml || '');
    return m ? plainText(m[1] ?? m[2]) : '';
  };

  const deviceOf = (mainHtml) => {
    const m = /<main\b[^>]*\bdata-device=(?:"([^"]*)"|'([^']*)')/i.exec(mainHtml || '');
    return m && String(m[1] ?? m[2]).trim().toLowerCase() === 'desktop' ? 'desktop' : 'phone';
  };

  const screens = [];
  const re = /<!--\s*screen:([A-Za-z0-9_-]+)\s*-->([\s\S]*?)<!--\s*\/screen:\1\s*-->/g;
  let m;
  while ((m = re.exec(bodyInner))) {
    const key = m[1];
    if (!SCREEN_KEY.test(key) || screens.some((s) => s.key === key)) continue;
    const mainM = /<main\b[\s\S]*<\/main>/i.exec(m[2]);
    const block = mainM ? mainM[0] : m[2].trim();
    screens.push({ key, caption: captionOf(block) || key, device: deviceOf(block), html: block });
  }
  if (!screens.length) {
    const block = bodyInner.replace(symbolsMatch ? symbolsMatch[0] : '', '').trim();
    screens.push({ key: 'main', caption: captionOf(block) || mainScreenCaption(), device: deviceOf(block), html: block });
  }
  return {
    n,
    name: plainText(nameHtml) || plainText(titleHtml) || '',
    move: plainText(moveHtml),
    head,
    symbols,
    wrapClass,
    screens,
  };
}

/** Every direction file that exists, parsed. Missing or unreadable files are skipped. */
export function loadDirections(projectDir) {
  const out = [];
  for (const n of DIRECTION_NUMBERS) {
    let html;
    try { html = fs.readFileSync(directionFile(projectDir, n), 'utf8'); } catch { continue; }
    out.push(parseDirectionHtml(html, n));
  }
  return out;
}

/** The shape of api/directions. */
export function directionsSummary(projectDir) {
  const dirs = loadDirections(projectDir);
  const screens = [];
  for (const d of dirs) for (const s of d.screens) if (!screens.some((x) => x.key === s.key)) screens.push({ key: s.key, caption: s.caption, device: s.device });
  return { directions: dirs.map((d) => ({ n: d.n, name: d.name, move: d.move, screens: d.screens.map((s) => ({ key: s.key, caption: s.caption, device: s.device })) })), screens };
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** One screen of one direction as a full document, or null. baseHref: absolute path of the mockup folder on this server. */
export function directionScreenDocument(projectDir, n, key, baseHref) {
  const d = loadDirections(projectDir).find((x) => x.n === n);
  const s = d && d.screens.find((x) => x.key === key);
  if (!s) return null;
  const keep = d.head
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*\bcharset=[^>]*>/gi, '')
    .replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '');
  const body = d.wrapClass ? `<div class="${escAttr(d.wrapClass)}">\n${s.html}\n</div>` : s.html;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${escAttr(baseHref)}"><title>${escAttr(s.caption)}</title>${keep}</head><body>${d.symbols}${body}</body></html>`;
}
