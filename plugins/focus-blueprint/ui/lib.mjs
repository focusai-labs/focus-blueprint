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
export const CATALOG_DIMENSIONS = ['visual', 'nav', 'structure', 'login', 'density'];

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

export function screensFor(map, query) {
  if (query) {
    return String(query).split(',').map((v) => v.trim()).filter(Boolean).map((v) => ({ id: slug(v), label: v }));
  }
  return (map?.screens || []).map((s) => ({ id: slug(s.file), label: s.name || s.file }));
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

/** The visible questions of a round, each with its saved answer (or null). */
export function questionsFor(projectDir, round, { screens } = {}) {
  let bank = loadBank(round);
  if (!bank) return null;
  const state = readJsonStrict(path.join(projectDir, '.blueprint', 'state.json'), null);
  if (round === 'c') {
    const map = readJsonStrict(path.join(projectDir, '.blueprint', 'map.json'), null);
    bank = expandScreens(bank, screensFor(map, screens));
  }
  const saved = readAnswers(projectDir, ROUND_FILES[round]).answers || {};
  const values = answerValues(projectDir, state);
  return bank.filter((q) => whenHolds(q.when, values)).map((q) => ({ ...q, answer: saved[q.id] || null }));
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

/** Catalog files with each example's HTML embedded, ready for an iframe srcdoc. */
export function loadCatalog() {
  const out = {};
  for (const dim of CATALOG_DIMENSIONS) {
    const list = readJsonStrict(dataPath('catalog', `${dim}.json`), []);
    out[dim] = list.map((e) => {
      let html = '';
      const name = path.basename(String(e.example || ''));
      if (name) {
        try { html = fs.readFileSync(dataPath('catalog', 'examples', name), 'utf8'); } catch { /* no example yet */ }
      }
      return { ...e, html };
    });
  }
  return out;
}
