// The review of the wired prototype (mockup/prototype.html): notes and approval per screen,
// the rounds, and the snapshot of each finished round. Node only, no dependencies.
// Storage: .blueprint/ui/answers/prototype.json
//   { round, done, screens: { "<file>": { status: "approved" | "note" | "open", note } },
//     history: [{ round, screens }], updatedAt }
// and .blueprint/ui/prototype/round-<n>.html, a copy of the prototype when the round was finished.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonStrict, writeJsonAtomic } from './lib.mjs';

export const MAX_NOTE = 5000;
export const MAX_ROUND = 9999;

const answersPath = (projectDir) => path.join(projectDir, '.blueprint', 'ui', 'answers', 'prototype.json');
export const snapshotFile = (projectDir, n) => path.join(projectDir, '.blueprint', 'ui', 'prototype', `round-${n}.html`);

/** The files of the map's screens. */
export function mapScreenFiles(projectDir) {
  const map = readJsonStrict(path.join(projectDir, '.blueprint', 'map.json'), null);
  return (Array.isArray(map?.screens) ? map.screens : []).map((s) => (s && typeof s.file === 'string' ? s.file : '')).filter(Boolean);
}

const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

function readDoc(projectDir) {
  const raw = readJsonStrict(answersPath(projectDir), null);
  const doc = isObj(raw) ? raw : {};
  return {
    round: Number.isInteger(doc.round) && doc.round >= 1 ? doc.round : 1,
    done: doc.done === true,
    screens: isObj(doc.screens) ? doc.screens : {},
    history: Array.isArray(doc.history) ? doc.history : [],
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
  };
}

function writeDoc(projectDir, doc) {
  doc.updatedAt = new Date().toISOString();
  writeJsonAtomic(answersPath(projectDir), doc);
}

/**
 * The document of each screen as the bundler stored it: a JSON script block of the prototype that maps
 * a screen file (or its name inside mockup/) to its document text. Returns { file: text } or null when
 * the prototype carries none, in which case only a whole-file comparison is possible.
 */
export function extractScreenDocs(html, files) {
  const out = {};
  const keyOf = (k) => files.find((f) => {
    const short = f.replace(/^mockup\//, '');
    return f === k || short === k || short.replace(/\.html?$/i, '') === k;
  });
  const textOf = (v) => {
    if (typeof v === 'string') return v;
    if (isObj(v)) for (const key of ['doc', 'html', 'document']) if (typeof v[key] === 'string') return v[key];
    return null;
  };
  const walk = (node, depth) => {
    if (!isObj(node) || depth > 4) return;
    for (const [k, v] of Object.entries(node)) {
      const file = keyOf(k);
      const text = file ? textOf(v) : null;
      if (file && text != null) out[file] = text;
      else walk(v, depth + 1);
    }
  };
  for (const m of String(html).matchAll(/<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let json;
    try { json = JSON.parse(m[1]); } catch { continue; }
    walk(json, 0);
  }
  return Object.keys(out).length ? out : null;
}

/** Is the screen's content the same in both versions of the prototype? */
function sameScreen(file, prevHtml, curHtml, prevDocs, curDocs) {
  if (prevHtml == null || curHtml == null) return false;
  if (prevDocs && curDocs) return Object.hasOwn(prevDocs, file) && Object.hasOwn(curDocs, file) && prevDocs[file] === curDocs[file];
  return prevHtml === curHtml;
}

function startNextRound(projectDir, doc, file) {
  const files = mapScreenFiles(projectDir);
  let prevHtml = null;
  let curHtml = null;
  try { prevHtml = fs.readFileSync(snapshotFile(projectDir, doc.round), 'utf8'); } catch { /* no snapshot: nothing counts as unchanged */ }
  try { curHtml = fs.readFileSync(file, 'utf8'); } catch { /* unreadable: nothing counts as unchanged */ }
  const prevDocs = prevHtml == null ? null : extractScreenDocs(prevHtml, files);
  const curDocs = curHtml == null ? null : extractScreenDocs(curHtml, files);
  const screens = {};
  for (const [f, s] of Object.entries(doc.screens)) {
    if (s && s.status === 'approved' && sameScreen(f, prevHtml, curHtml, prevDocs, curDocs)) screens[f] = { status: 'approved', note: '' };
  }
  const next = { ...doc, round: doc.round + 1, done: false, screens };
  writeDoc(projectDir, next);
  return next;
}

/**
 * The shape of GET api/prototype. file: the real path of mockup/prototype.html, or null when it is not there.
 * The first read after a finished round starts the next one.
 */
export function prototypeState(projectDir, file) {
  let doc = readDoc(projectDir);
  if (file && doc.done) doc = startNextRound(projectDir, doc, file);
  let previousRound = null;
  if (doc.round > 1) {
    const hist = doc.history.find((x) => x && x.round === doc.round - 1);
    previousRound = { n: doc.round - 1, screens: isObj(hist?.screens) ? hist.screens : {}, snapshot: fs.existsSync(snapshotFile(projectDir, doc.round - 1)) };
  }
  return { exists: Boolean(file), round: doc.round, done: doc.done, screens: doc.screens, previousRound };
}

/** POST api/prototype-note: { file, note?, approved? }. Returns { status, body }. */
export function savePrototypeNote(projectDir, data, file) {
  const files = mapScreenFiles(projectDir);
  if (typeof data.file !== 'string' || !files.includes(data.file)) return { status: 400, body: { error: 'unknown screen' } };
  const hasNote = 'note' in data;
  const hasApproved = 'approved' in data;
  if (hasNote && (typeof data.note !== 'string' || data.note.length > MAX_NOTE)) return { status: 400, body: { error: 'bad note' } };
  if (hasApproved && typeof data.approved !== 'boolean') return { status: 400, body: { error: 'bad approved' } };
  if (!hasNote && !hasApproved) return { status: 400, body: { error: 'nothing to save' } };
  if (!file) return { status: 404, body: { error: 'no prototype' } };
  const doc = readDoc(projectDir);
  if (doc.done) return { status: 409, body: { error: 'round done' } };
  const prev = isObj(doc.screens[data.file]) ? doc.screens[data.file] : { status: 'open', note: '' };
  const note = hasNote ? data.note : typeof prev.note === 'string' ? prev.note : '';
  const approved = hasApproved ? data.approved : prev.status === 'approved';
  const status = approved ? 'approved' : note.trim() ? 'note' : 'open';
  doc.screens[data.file] = { status, note };
  writeDoc(projectDir, doc);
  return { status: 200, body: { ok: true, status } };
}

/** POST api/prototype-done: snapshot the prototype, close the round. */
export function finishPrototypeRound(projectDir, file) {
  if (!file) return { status: 404, body: { error: 'no prototype' } };
  const doc = readDoc(projectDir);
  if (doc.done) return { status: 200, body: { ok: true, round: doc.round } };
  const target = snapshotFile(projectDir, doc.round);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.copyFileSync(file, tmp);
  fs.renameSync(tmp, target);
  doc.history = doc.history.filter((x) => !x || x.round !== doc.round);
  doc.history.push({ round: doc.round, screens: doc.screens });
  doc.done = true;
  writeDoc(projectDir, doc);
  return { status: 200, body: { ok: true, round: doc.round } };
}
