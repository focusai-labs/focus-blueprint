// The local page server of Focus Blueprint. Node only, no dependencies.
// It listens on this machine alone, on a free port, behind a random token in
// the address, and writes what the user answers into the project folder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrateMap } from '../scripts/blueprint-model/map-model.mjs';
import { answersFile, loadCatalog, nameOfRound, questionsFor, readAnswers, readJsonStrict, unconfirmedIds, writeJsonAtomic, dataPath } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 1024 * 1024;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The address is printed as well, so the user can open it by hand.
  }
}

/**
 * Start the server. Resolves with the address once it is listening.
 * once: stop shortly after the first saved answer.
 */
const PAGES = new Set(['brain-dump', 'questionnaire', 'catalog', 'board', 'process']);
const STATIC = { 'ui.css': 'text/css; charset=utf-8', 'ui.js': 'text/javascript; charset=utf-8', 'strings.he.json': 'application/json; charset=utf-8' };
const NAME = /^[a-z0-9-]{1,40}$/;
const QID = /^[A-Za-z0-9_.֐-׿-]{1,100}$/;

function gitInfo(projectDir) {
  const run = (args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', timeout: 5000, windowsHide: true });
  const status = run(['status', '--porcelain']);
  if (status.error || status.status !== 0) return { available: false, branch: null, changed: 0, files: [] };
  const branch = run(['branch', '--show-current']);
  const files = status.stdout.split(/\r?\n/).filter(Boolean);
  return { available: true, branch: branch.status === 0 ? branch.stdout.trim() || null : null, changed: files.length, files: files.slice(0, 30) };
}

function listEvals(projectDir) {
  try {
    return fs.readdirSync(path.join(projectDir, 'evals')).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort().map((f) => ({ id: f.replace(/\.md$/, ''), file: `evals/${f}` }));
  } catch {
    return [];
  }
}

function boardState(projectDir) {
  const p = (...rel) => path.join(projectDir, ...rel);
  const state = readJsonStrict(p('.blueprint', 'state.json'), null);
  const closes = {};
  for (const [n, st] of Object.entries(state?.stages || {})) if (st && st.close) closes[n] = st.close;
  let stagesDef = [];
  try { stagesDef = readJsonStrict(dataPath('stages.json'), []).map((s) => ({ n: s.n, chapter: s.chapter, name: s.name })); } catch { /* optional */ }
  let lastSession = '';
  try { lastSession = fs.readFileSync(p('.blueprint', 'last-session.md'), 'utf8'); } catch { /* optional */ }
  return {
    state,
    map: readJsonStrict(p('.blueprint', 'map.json'), null),
    evals: listEvals(projectDir),
    changes: readJsonStrict(p('.blueprint', 'changes.json'), []),
    rulings: readJsonStrict(p('.blueprint', 'rulings.json'), []),
    closes,
    stagesDef,
    lastSession,
    git: gitInfo(projectDir),
  };
}

/** Merge one answer into its file. Returns { status, body }. */
function saveAnswer(projectDir, data) {
  const name = String(data.name || '');
  if (!NAME.test(name)) return { status: 400, body: { error: 'bad name' } };
  const file = answersFile(projectDir, name);
  const doc = readAnswers(projectDir, name);
  const now = new Date().toISOString();

  // The first form, still used by the probe: one free answer under the name.
  if (!('id' in data) && !('confirm' in data) && 'answer' in data) {
    doc.answer = data.answer;
    doc.savedAt = now;
    writeJsonAtomic(file, doc);
    return { status: 200, body: { ok: true } };
  }

  const id = String(data.id || '');
  if (!QID.test(id) || id === '__proto__') return { status: 400, body: { error: 'bad id' } };
  doc.answers = doc.answers && typeof doc.answers === 'object' ? doc.answers : {};
  const prev = Object.prototype.hasOwnProperty.call(doc.answers, id) ? doc.answers[id] : null;

  if (data.confirm === true) {
    if (!prev) return { status: 404, body: { error: 'nothing to confirm' } };
    doc.answers[id] = { ...prev, confirmed: true, decidedBy: 'user', at: now };
  } else if (data.pending === true) {
    doc.answers[id] = { value: null, pending: true, decidedBy: null, at: now };
  } else if (data.decidedBy === 'claude') {
    doc.answers[id] = { value: null, decidedBy: 'claude', at: now };
  } else if ('value' in data) {
    // A new value replaces the entry, so a prefill loses its "from the idea" mark.
    const entry = { value: data.value, decidedBy: 'user', at: now };
    if (typeof data.other === 'string') entry.other = data.other;
    doc.answers[id] = entry;
  } else {
    return { status: 400, body: { error: 'nothing to save' } };
  }
  doc.savedAt = now;
  writeJsonAtomic(file, doc);
  return { status: 200, body: { ok: true } };
}

function markDone(projectDir, data) {
  const name = String(data.name || '');
  if (!NAME.test(name)) return { status: 400, body: { error: 'bad name' } };
  const doc = readAnswers(projectDir, name);
  if (name === 'brain-dump') {
    const why = doc.answers?.why?.value;
    if (typeof why !== 'string' || !why.trim()) return { status: 400, body: { error: 'why missing' } };
  }
  const ids = unconfirmedIds(doc);
  if (ids.length) return { status: 409, body: { error: 'unconfirmed prefill', ids } };
  doc.done = true;
  doc.savedAt = new Date().toISOString();
  writeJsonAtomic(answersFile(projectDir, name), doc);
  return { status: 200, body: { ok: true } };
}

export async function startUi({ projectDir, once = false, idleMinutes = 30 } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const uiDir = path.join(projectDir, '.blueprint', 'ui');
  const answersDir = path.join(uiDir, 'answers');
  const infoFile = path.join(uiDir, 'server.json');
  fs.mkdirSync(answersDir, { recursive: true });

  let port = 0;
  let idleTimer = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    try {
      fs.unlinkSync(infoFile);
    } catch {
      // Already gone.
    }
    server.close();
    server.closeAllConnections();
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, idleMinutes * 60 * 1000);
  };

  const PLACEHOLDER_PAGE = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>הממשק המקומי</title></head><body><p>הממשק המקומי עובד</p></body></html>';

  const server = http.createServer(async (req, res) => {
    touch();
    // Only this machine, by its own name. A page on another site that points a
    // hostname at 127.0.0.1 arrives with a different Host and is refused.
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: 'forbidden' });

    const parts = new URL(req.url, 'http://local').pathname.split('/').filter(Boolean);
    if (parts[0] !== token) return send(res, 404, { error: 'not found' });
    const route = parts.slice(1).join('/');

    const query = new URL(req.url, 'http://local').searchParams;

    try {
      if (req.method === 'GET') {
        if (route === '') return send(res, 200, PLACEHOLDER_PAGE, 'text/html; charset=utf-8');
        if (PAGES.has(route)) return send(res, 200, fs.readFileSync(path.join(here, 'pages', `${route}.html`), 'utf8'), 'text/html; charset=utf-8');
        if (Object.hasOwn(STATIC, route)) {
          const file = path.join(here, 'pages', route);
          if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
          return send(res, 200, fs.readFileSync(file, 'utf8'), STATIC[route]);
        }
        if (route === 'api/questions') {
          const round = query.get('round') || 'a';
          const questions = questionsFor(projectDir, round, { screens: query.get('screens') });
          if (!questions) return send(res, 400, { error: 'bad round' });
          return send(res, 200, { round, name: nameOfRound(round), done: readAnswers(projectDir, nameOfRound(round)).done === true, questions });
        }
        if (route === 'api/answers') {
          const name = String(query.get('name') || '');
          if (!NAME.test(name)) return send(res, 400, { error: 'bad name' });
          return send(res, 200, readAnswers(projectDir, name));
        }
        if (route === 'process-svg.mjs') return send(res, 200, fs.readFileSync(path.join(here, 'process-svg.mjs'), 'utf8'), 'text/javascript; charset=utf-8');
        // The map as the pages read it: migrated in memory, never written back.
        if (route === 'api/map') return send(res, 200, migrateMap(readJsonStrict(path.join(projectDir, '.blueprint', 'map.json'), {})));
        // One evals/*.md file as plain text, so a case can link to its test.
        if (route === 'api/eval') {
          const rel = String(query.get('path') || '').replace(/\\/g, '/');
          const file = path.resolve(projectDir, rel);
          const inside = path.relative(path.join(projectDir, 'evals'), file);
          if (!rel.startsWith('evals/') || !rel.endsWith('.md') || inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
          return send(res, 200, fs.readFileSync(file, 'utf8'), 'text/plain; charset=utf-8');
        }
        if (route === 'api/state') return send(res, 200, boardState(projectDir));
        if (route === 'api/catalog') return send(res, 200, loadCatalog());
      }

      if (req.method === 'POST' && (route === 'api/answer' || route === 'api/done')) {
        // A JSON content type cannot be sent across sites without a preflight,
        // and this server answers none.
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          return send(res, 415, { error: 'json only' });
        }
        let data;
        try {
          data = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: 'bad request' });
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: 'bad request' });
        const result = route === 'api/answer' ? saveAnswer(projectDir, data) : markDone(projectDir, data);
        send(res, result.status, result.body);
        if (once && result.status === 200) setTimeout(close, 1000);
        return;
      }
    } catch (e) {
      return send(res, 500, { error: String(e && e.message ? e.message : e) });
    }

    return send(res, 404, { error: 'not found' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  const url = `http://127.0.0.1:${port}/${token}/`;
  fs.writeFileSync(infoFile, JSON.stringify({ url, port, pid: process.pid, startedAt: Date.now() }, null, 2));
  touch();

  return { url, port, close, closed: new Promise((resolve) => server.once('close', resolve)) };
}
