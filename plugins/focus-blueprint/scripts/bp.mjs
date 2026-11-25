#!/usr/bin/env node
// Focus Blueprint state CLI (contract C4). Node only, no dependencies.
// Output is JSON on stdout; an error is one line on stderr and exit code 1.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findProject, profileDir, termsAccepted } from '../hooks/lib.mjs';
import { installGitHook } from './install-git-hook.mjs';
import { syncProjectFiles } from './project-files.mjs';
import { impact, migrateMapInPlace, filesHash, NODE_TYPES } from './blueprint-model/map-model.mjs';
import { questionsFor, ROUND_FILES } from '../ui/lib.mjs';
import { saveAnswer } from '../ui/server.mjs';
import { renderDoc } from './render-doc.mjs';
import { buildPrototype, scanPrototype } from './prototype.mjs';
import { addNote, doneNote, listNotes } from './prototype-notes.mjs';
import { replaceBlocks, stampDocument, extractBlocks } from './blueprint-model/render-blocks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(here, '..');
const CAP = 3;
const BOOL_FLAGS = new Set(['unreported', 'baseline', 'client', 'test', 'open']);

const ROLE_KINDS = ['anon', 'user', 'staff', 'admin', 'service'];
/** The branch a stage works on: stage-02, two digits, like the skill folders. */
export const stageBranch = (n) => `stage-${String(n).padStart(2, '0')}`;
const ACCESS_KINDS = ['table', 'view', 'function', 'bucket', 'realtime'];
const STEP_KINDS = ['system', 'human', 'ai', 'external', 'rejection'];
const CASE_KINDS = ['happy', 'problem', 'rejection'];
const SRCS = ['client', 'ours', 'assumed'];
// change kinds: the old log kinds plus any node type; value = the node type the kind itself opens
const KIND_TYPE = { wording: 'content', track: null };
const CHANGE_KINDS = ['wording', 'track', 'migration', ...NODE_TYPES];
const arr = (x) => (Array.isArray(x) ? x : []);
const validActor = (a) => typeof a === 'string' && (['screen', 'server', 'automation', 'ai'].includes(a) || /^role:.+/.test(a) || /^external:.+/.test(a));
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const textOrNull = (v) => v === undefined || v === null || typeof v === 'string';
const idList = (v) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
const PROCESS_DEFAULTS = {
  stage: {},
  step: { screen: null, capability: null, tables: [], permission: null, test: null, onFailure: null, next: [], src: null, source: '' },
  timer: { duration: null, onExpire: null, test: null },
  case: { eval: null },
};

/** Output printed as plain lines instead of JSON. */
class RawText { constructor(text) { this.text = text; } }
const MODEL_LINES = {
  fable: 'מומלץ לעבוד בשלב הזה עם Fable, המודל החזק ביותר, ומחליפים אליו ב-/model fable. אם ליד Fable כתוב "Requires usage credits", השימוש בו מחויב בקרדיטים נוספים, ואפשר להישאר עם Opus.',
  opus: 'מומלץ לעבוד בשלב הזה עם Opus, שהוא ברירת המחדל. אם החלפתם מודל, חוזרים אליו ב-/model opus.',
  sonnet: 'השלב הזה מכני יותר, ולכן מספיק לעבוד בו עם Sonnet, שצורך פחות מהמכסה. מחליפים אליו ב-/model sonnet.',
};
const stageList = () => readJsonFile(path.join(PLUGIN, 'data', 'stages.json'), []);

/** The opening every stage starts with: where the student is, the goal, what will be true at the end, the model to use. */
function stageOpening(n) {
  const st = stageList().find((x) => x.n === n) || fail(`stage ${n} is not in stages.json`);
  const req = readJsonFile(path.join(PLUGIN, 'data', 'requirements', 'default.json'), {});
  const items = arr(req && req.stages && req.stages[String(n)]);
  return [
    `זה שלב ${n} מתוך 15, ${st.name}, בפרק "${st.chapter}".`,
    st.goal,
    'מה יהיה נכון בסוף השלב:',
    ...items.map((i) => `- ${i}`),
    MODEL_LINES[st.session_model],
  ].join('\n');
}

/** The line that closes a stage: which stage comes next and the command that opens it. */
function stageNext(n) {
  if (n >= 15) return 'זה היה השלב האחרון, וכל 15 השלבים הושלמו.';
  const nx = stageList().find((x) => x.n === n + 1);
  return `השלב הבא הוא שלב ${nx.n}, ${nx.name}. פותחים שיחה חדשה ומקלידים /focus-blueprint:${nx.skill}`;
}

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };

// ---------- small helpers ----------
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

function atomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } throw e; }
}
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomic(file, JSON.stringify(obj, null, 2) + '\n');
}
function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomic(file, text);
}
/** Missing file gives the fallback; any other problem stops the command and never lets the file be overwritten. */
function readJsonFile(file, fallback = undefined) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return fallback;
    return fail(`cannot read ${file}: ${e.message}`);
  }
  try { return JSON.parse(raw); } catch (e) { return fail(`${file} is not valid JSON (left untouched): ${e.message}`); }
}
const parseVal = (s) => { try { return JSON.parse(s); } catch { return s; } };

export function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  if (keys.some((k) => ['__proto__', 'constructor', 'prototype'].includes(k))) fail(`refused key: ${dotted}`);
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}
function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Split argv into positionals and flags. */
function parseArgs(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k)) flags[k] = true;
      else { if (i + 1 >= argv.length) fail(`flag --${k} needs a value`); flags[k] = argv[++i]; }
    } else pos.push(a);
  }
  return { pos, flags };
}
/** key=value tokens to an object; values stay strings (callers parse). */
function kv(tokens) {
  const out = {};
  for (const t of tokens) {
    const i = t.indexOf('=');
    if (i < 1) fail(`expected key=value, got "${t}"`);
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

function jsonFlag(ctx, what) {
  if (ctx.flags.json === undefined) fail(`${what} needs --json '<object>'`);
  let o; try { o = JSON.parse(ctx.flags.json); } catch { fail(`${what}: --json is not valid JSON`); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail(`${what}: --json must be an object`);
  return o;
}

function dataFile(...rel) {
  const override = process.env.FOCUS_BLUEPRINT_DATA;
  if (override) {
    const p = path.join(override, ...rel);
    if (fs.existsSync(p)) return p;
  }
  return path.join(PLUGIN, 'data', ...rel);
}
function dataDirs(sub) {
  const dirs = [];
  if (process.env.FOCUS_BLUEPRINT_DATA) dirs.push(path.join(process.env.FOCUS_BLUEPRINT_DATA, sub));
  dirs.push(path.join(PLUGIN, 'data', sub));
  return dirs.filter((d) => fs.existsSync(d));
}

// ---------- context ----------
function makeCtx(flags, { needProject = true } = {}) {
  const ctx = { flags, dir: null, _state: null, _map: null, mapWasOld: false };
  ctx.resolve = () => {
    if (ctx.dir) return ctx.dir;
    if (flags.project) {
      const start = path.resolve(flags.project);
      const found = findProject({ cwd: start });
      if (!found || !(found.dir === start || start.startsWith(found.dir + path.sep))) fail(`no Blueprint project at ${start}`);
      ctx.dir = found.dir;
    } else {
      const found = findProject({ cwd: process.cwd() });
      if (!found) fail('not inside a Blueprint project (no .blueprint/state.json found)');
      ctx.dir = found.dir;
    }
    return ctx.dir;
  };
  ctx.p = (...rel) => path.join(ctx.resolve(), ...rel);
  ctx.state = () => (ctx._state ||= readJsonFile(ctx.p('.blueprint', 'state.json')) || fail('state.json is unreadable'));
  ctx.saveState = () => { ctx.state().updatedAt = nowIso(); writeJsonAtomic(ctx.p('.blueprint', 'state.json'), ctx._state); return ctx._state; };
  ctx.map = () => {
    if (!ctx._map) {
      const m = readJsonFile(ctx.p('.blueprint', 'map.json')) || fail('map.json is unreadable');
      ctx.mapWasOld = m.schema !== 2;
      ctx._map = migrateMapInPlace(m);   // in memory only; it reaches the disk with the next write
    }
    return ctx._map;
  };
  ctx.touch = () => { const s = ctx.state(); s.updatedAt = nowIso(); writeJsonAtomic(ctx.p('.blueprint', 'state.json'), s); };
  ctx.saveMap = () => { migrateMapInPlace(ctx._map); ctx.mapWasOld = false; writeJsonAtomic(ctx.p('.blueprint', 'map.json'), ctx._map); ctx.touch(); return ctx._map; };
  ctx.json = (name, fallback) => readJsonFile(ctx.p('.blueprint', name), fallback);
  ctx.saveJson = (name, v) => { writeJsonAtomic(ctx.p('.blueprint', name), v); ctx.touch(); };
  ctx.capability = (id) => ctx.map().capabilities.find((c) => c.id === id) || fail(`unknown capability: ${id}`);
  return ctx;
}

// ---------- semver ----------
function semver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function semCmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

// ---------- eval / brief file helpers ----------
function catchesOf(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const i = lines.findIndex((l) => l.includes('<!-- catches -->'));
  if (i < 0) return null;
  const valid = (s) => {
    const x = s.trim();
    return x && !x.includes('<<fill>>') && x.replace('הבדיקה הזאת תופסת:', '').trim() ? x : null;
  };
  const rest = lines[i].replace('<!-- catches -->', '').trim();
  if (rest) return valid(rest);
  for (let j = i + 1; j < lines.length; j++) {
    if (/<!--\s*fm:/.test(lines[j]) || /^#/.test(lines[j])) return null;
    if (lines[j].trim()) return valid(lines[j]);
  }
  return null;
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** One validation for a stage, step, timer or case, used by both `add` and `set`. */
function checkProcessItem(sub, e, proc) {
  const stageIds = arr(proc.stages).map((x) => x.id);
  const stageList = stageIds.join(', ') || '(none yet)';
  if (sub === 'stage') { if (!isText(e.name)) fail('stage needs "name"'); return; }
  if (!isText(e.text)) fail(`${sub} needs "text"`);
  if (sub === 'step') {
    if (!STEP_KINDS.includes(e.kind)) fail(`step kind must be ${STEP_KINDS.join('|')}`);
    if (!stageIds.includes(e.stage)) fail(`step stage must be one of the process stages: ${stageList}`);
    if (!validActor(e.actor)) fail('step actor must be role:<id>, screen, server, automation, ai or external:<name>');
    if (e.src !== undefined && e.src !== null && !SRCS.includes(e.src)) fail(`src must be ${SRCS.join('|')}`);
    for (const k of ['tables', 'next']) if (!idList(e[k])) fail(`step ${k} must be a list of ids`);
    for (const k of ['screen', 'capability', 'permission', 'test', 'onFailure', 'source']) if (!textOrNull(e[k])) fail(`step ${k} must be text or null`);
  } else if (sub === 'timer') {
    if (e.stage !== undefined && e.stage !== null && !stageIds.includes(e.stage)) fail(`timer stage must be one of the process stages: ${stageList}`);
    for (const k of ['duration', 'onExpire', 'test']) if (!textOrNull(e[k])) fail(`timer ${k} must be text or null`);
  } else {
    if (!CASE_KINDS.includes(e.kind)) fail(`case kind must be ${CASE_KINDS.join('|')}`);
    if (!textOrNull(e.eval)) fail('case eval must be a file path or null');
  }
}

function realMissing(ctx, cap) {
  const miss = [];
  const exists = (rel) => rel && fs.existsSync(ctx.p(rel));
  if (!exists(cap.test)) miss.push('test');
  if (!exists(cap.brief)) miss.push('brief');
  const adopted = cap.evidence && cap.evidence.adopted === true;
  if (!adopted) {
    const ev = cap.evidence || {};
    for (const color of ['red', 'green']) {
      const e = ev[color];
      if (!e) { miss.push(color); continue; }
      const f = ctx.p(e.path || '');
      if (!e.path || !fs.existsSync(f) || sha256(f) !== e.sha256) miss.push(`${color} (file missing or changed)`);
      else if (color === 'red' && !(e.exit !== 0)) miss.push('red (exit must be non-zero)');
      else if (color === 'green' && e.exit !== 0) miss.push('green (exit must be zero)');
    }
    if (ev.red && ev.green && !(ev.red.at < ev.green.at)) miss.push('red must come before green');
    if (!cap.catches) miss.push('catches');
    const r = cap.review;
    if (r && (r.spec === 'not_run' || r.quality === 'not_run')) miss.push('review: הסוקר לא רץ עד הסוף, ולכן אין כאן אישור. מריצים אותו שוב.');
    else if (!r || r.spec !== 'pass' || r.quality !== 'pass') miss.push('review (both verdicts must be pass)');
  }
  if (cap.openFindings && cap.openFindings.length) miss.push('openFindings not empty');
  if (cap.halted) miss.push('halted');
  return miss;
}

// ---------- commands ----------
export const commands = {
  init(args, ctx) {
    const { flags } = ctx;
    if (!flags.name) fail('init needs --name "<project>"');
    const mode = flags.mode || 'default';
    if (!['default', 'final-project'].includes(mode)) fail('--mode must be default or final-project');
    const dir = flags.project ? path.resolve(flags.project) : process.cwd();
    ctx.dir = dir;
    if (!termsAccepted()) fail('עוד לא אישרתם את תנאי השימוש. מקלידים /blueprint, קוראים את התנאים ומאשרים, ורק אחר כך פותחים פרויקט.');
    if (fs.existsSync(path.join(dir, '.blueprint', 'state.json'))) fail('already initialised: .blueprint/state.json exists');
    const tpl = path.join(PLUGIN, 'templates');
    const state = {
      schema: 2, project: flags.name, createdAt: today(), updatedAt: nowIso(), stage: 1, status: 'in_progress', mode,
      context: null, track: null, live: false, connections: {},
      where: { repo: '', supabaseRef: '', vercelProject: '', n8nBase: '' },
      stages: { 1: { status: 'in_progress', startedAt: nowIso(), branch: stageBranch(1) } }, pending: [], superpowers: { installed: false, version: null }, lastDriftCheck: null,
    };
    writeJsonAtomic(path.join(dir, '.blueprint', 'map.json'), migrateMapInPlace({ schema: 2 }));
    writeJsonAtomic(path.join(dir, '.blueprint', 'changes.json'), []);
    writeJsonAtomic(path.join(dir, '.blueprint', 'verified.json'), {});
    writeJsonAtomic(path.join(dir, '.blueprint', 'rulings.json'), []);
    for (const f of ['spec', 'mockup', 'db', 'evals', 'n8n', 'docs', path.join('.github', 'workflows'), 'scripts']) fs.mkdirSync(path.join(dir, f), { recursive: true });
    for (const [name, to] of [['README-spec.md', 'spec'], ['README-evals.md', 'evals'], ['README-n8n.md', 'n8n']]) {
      const src = path.join(tpl, 'project', name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, to, 'README.md'));
    }
    syncProjectFiles(PLUGIN, dir);
    // AGENTS.md block
    const rules = fs.readFileSync(path.join(tpl, 'agents-rules.md'), 'utf8');
    const agents = path.join(dir, 'AGENTS.md');
    const cur = fs.existsSync(agents) ? fs.readFileSync(agents, 'utf8') : '';
    if (!cur.includes('<!-- focus-blueprint -->')) {
      writeTextAtomic(agents, cur ? cur.replace(/\s*$/, '\n\n') + rules : rules);
    }
    // Claude Code reads AGENTS.md only when no CLAUDE.md exists, so a new CLAUDE.md imports it.
    // An existing CLAUDE.md is left unchanged (the session-start hook warns when it lacks the import).
    const claudeMd = path.join(dir, 'CLAUDE.md');
    if (!fs.existsSync(claudeMd)) writeTextAtomic(claudeMd, '@AGENTS.md\n');
    // .gitignore
    const gi = path.join(dir, '.gitignore');
    const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    const haveLines = new Set(have.split(/\r?\n/).map((l) => l.trim()));
    const add = fs.readFileSync(path.join(tpl, 'project', 'gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !haveLines.has(l));
    if (add.length || !fs.existsSync(gi)) writeTextAtomic(gi, (have ? have.replace(/\s*$/, '\n') : '') + add.join('\n') + '\n');
    writeJsonAtomic(path.join(dir, '.blueprint', 'state.json'), state);
    const hook = installGitHook(dir);
    return { ok: true, dir, stage: 1, gitHook: hook.installed };
  },

  update(args, ctx) {
    const dir = ctx.resolve();
    if (!fs.existsSync(path.join(dir, '.blueprint', 'state.json'))) fail('not a Blueprint project: .blueprint/state.json is missing');
    const r = syncProjectFiles(PLUGIN, dir);
    return { ok: true, dir, changed: r.changed, gitHook: r.gitHook };
  },

  state(args, ctx) {
    const [sub, ...rest] = args;
    if (sub === 'get') return rest[0] ? getPath(ctx.state(), rest[0]) ?? null : ctx.state();
    if (sub === 'set') {
      if (!rest.length) fail('state set needs key=value');
      const s = ctx.state();
      for (const [k, v] of Object.entries(kv(rest))) setPath(s, k, parseVal(v));
      return ctx.saveState();
    }
    return fail('usage: state get [path] | state set key=value ...');
  },

  stage(args, ctx) {
    const [sub, nRaw, ...rest] = args;
    const n = Number(nRaw);
    if (!Number.isInteger(n) || n < 1 || n > 15) fail('stage number must be 1-15');
    if (sub === 'intro') return new RawText(stageOpening(n));
    const s = ctx.state();
    if (sub === 'start') {
      const prev = { ...(s.stages[n] || {}) }; delete prev.close; delete prev.doneAt;
      s.stages[n] = { ...prev, status: 'in_progress', startedAt: nowIso(), branch: stageBranch(n) };
      s.stage = n; s.status = 'in_progress';
      return { ...ctx.saveState(), opening: stageOpening(n) };
    }
    if (sub === 'done') {
      const { status, note, proof } = ctx.flags;
      if (!['done', 'done_with_concerns', 'blocked', 'needs_context'].includes(status)) fail('stage done needs --status done|done_with_concerns|blocked|needs_context');
      if (status === 'done' && !proof) fail('status done needs --proof (the quoted output)');
      if (status === 'done_with_concerns' && (!proof || !note)) fail('status done_with_concerns needs --proof and --note');
      if ((status === 'blocked' || status === 'needs_context') && !note) fail(`status ${status} needs --note`);
      if (n !== s.stage) fail(`stage done ${n} refused: the current stage is ${s.stage}`);
      const stOpen = (s.stages[n] && s.stages[n].openFindings) || [];
      if (status === 'done' && stOpen.length) fail(`stage ${n} still has open findings: ${stOpen.join(' | ')}`);
      const open = ctx.json('rulings.json', []).filter((r) => r.stage === n && !r.reported);
      if (open.length) fail(`stage ${n} has unreported rulings, show them to the student then run "ruling report --stage ${n}": ${open.map((r) => `${r.id} ${r.decision}`).join(' | ')}`);
      const p = proof ? (proof.length > 600 ? proof.slice(0, 600) + '...' : proof) : '';
      const at = nowIso();
      const st = (s.stages[n] ||= { startedAt: at, branch: stageBranch(n) });
      st.close = { status, note: note || '', proof: p, at };
      if (status === 'done' || status === 'done_with_concerns') {
        st.status = 'done'; st.doneAt = at;
        if (n < 15) { s.stage = n + 1; s.status = 'not_started'; } else { s.stage = n; s.status = 'done'; }
      } else { st.status = status; s.stage = n; s.status = status; }
      const out = { ...ctx.saveState() };
      if (st.status === 'done') out.next = stageNext(n);
      return out;
    }
    return fail('usage: stage intro N | stage start N | stage done N --status ...');
  },

  round(args, ctx) {
    const [sub, kind, id, ...rest] = args;
    if (!['add', 'clear'].includes(sub)) fail('usage: round add|clear stage N|capability <id>');
    let target;
    if (kind === 'stage') {
      const n = Number(id); if (!Number.isInteger(n)) fail('stage number needed');
      target = ctx.state().stages[n] || fail(`stage ${n} was never started`);
    } else if (kind === 'capability') target = ctx.capability(id);
    else return fail('round target must be stage or capability');
    target.rounds ||= 0; target.openFindings ||= [];
    if (sub === 'clear') {
      target.rounds = 0; target.openFindings = []; target.halted = false;
    } else {
      if (!ctx.flags.note) fail('round add needs --note');
      target.rounds += 1; target.openFindings.push(ctx.flags.note);
      if (target.rounds >= CAP) target.halted = true;
    }
    if (kind === 'stage') ctx.saveState(); else ctx.saveMap();
    return { rounds: target.rounds, cap: CAP, stop: target.rounds >= CAP, halted: Boolean(target.halted) };
  },

  ruling(args, ctx) {
    const [sub, ...rest] = args;
    const file = 'rulings.json';
    const list = ctx.json(file, []);
    if (sub === 'add') {
      const o = kv(rest);
      for (const k of ['decision', 'why', 'price']) if (!o[k] || !o[k].trim()) fail(`ruling add needs ${k}="..."`);
      const stage = o.stage !== undefined ? Number(o.stage) : ctx.state().stage;
      if (!Number.isInteger(stage)) fail('stage must be a number');
      if (o.capability) ctx.capability(o.capability);
      const max = list.reduce((m, r) => Math.max(m, Number(String(r.id).slice(2)) || 0), 0);
      const entry = { id: `r-${String(max + 1).padStart(3, '0')}`, at: nowIso(), stage, capability: o.capability || null, decision: o.decision, why: o.why, priceIfWrong: o.price, by: 'claude', reported: false };
      list.push(entry); ctx.saveJson(file, list);
      return entry;
    }
    const match = (r) => (ctx.flags.stage === undefined || r.stage === Number(ctx.flags.stage));
    if (sub === 'list') return list.filter((r) => match(r) && (!ctx.flags.unreported || !r.reported));
    if (sub === 'report') {
      const hit = list.filter((r) => !r.reported && match(r));
      for (const r of hit) r.reported = true;
      ctx.saveJson(file, list);
      return hit;
    }
    return fail('usage: ruling add|list|report');
  },

  prefill(args, ctx) {
    const [round, qid, ...rest] = args;
    if (!round || !qid) fail('usage: prefill <round> <qid> value=<json> quote="..."');
    const o = kv(rest);
    if (o.value === undefined) fail('prefill needs value=<json>');
    if (!o.quote || !o.quote.trim()) fail('prefill needs quote="<the student\'s words>"');
    let entry = null;
    for (const d of dataDirs('questions')) {
      for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json'))) {
        const bank = readJsonFile(path.join(d, f), []);
        const arr = Array.isArray(bank) ? bank : (bank.questions || []);
        entry ||= arr.find((q) => q.id === qid) || null;
      }
    }
    if (!entry) fail(`question not found in the bank: ${qid}`);
    if (entry.prefillable === false || entry.type === 'scale' || entry.type === 'pairs') fail(`question ${qid} is not prefillable`);
    if (!/^[a-z0-9-]+$/.test(round)) fail('round must match [a-z0-9-]+');
    const idea = ctx.p('spec', 'idea.md');
    if (!fs.existsSync(idea)) fail('spec/idea.md does not exist');
    if (!fs.readFileSync(idea, 'utf8').includes(o.quote)) fail('quote is not in spec/idea.md');
    const name = /^[a-d]$/.test(round) ? `round-${round}` : round;
    const file = ctx.p('.blueprint', 'ui', 'answers', `${name}.json`);
    const doc = readJsonFile(file, { name, answers: {}, done: false, savedAt: '' });
    const prev = doc.answers[qid];
    if (prev && prev.confirmed !== false) fail(`question ${qid} already has an answer, never overwritten`);
    doc.answers[qid] = { value: parseVal(o.value), decidedBy: null, at: nowIso(), from: 'idea', quote: o.quote, confirmed: false };
    doc.savedAt = nowIso();
    writeJsonAtomic(file, doc); ctx.touch();
    return doc.answers[qid];
  },

  // answer set <round> <id> --value "<text>": Claude's own answer to a question, saved the way the UI server saves one.
  answer(args, ctx) {
    const [sub, round, qid] = args;
    if (sub !== 'set' || !round || !qid) fail('usage: answer set <round> <id> --value "<text>"');
    if (!Object.hasOwn(ROUND_FILES, round)) fail(`round must be one of ${Object.keys(ROUND_FILES).join(', ')}`);
    const value = ctx.flags.value;
    if (typeof value !== 'string' || !value.trim()) fail('answer set needs --value "<text>"');
    const ids = (questionsFor(ctx.resolve(), round, { includeClaude: true }) || []).map((q) => q.id);
    if (!ids.includes(qid)) fail(`question ${qid} is not in round ${round}${round === 'c' ? ' (round C ids are per built screen, such as c-click-<screen>)' : ''}`);
    const r = saveAnswer(ctx.resolve(), { name: ROUND_FILES[round], id: qid, value, decidedBy: 'claude' });
    if (r.status !== 200) fail(`answer not saved: ${JSON.stringify(r.body)}`);
    return { round, id: qid, value, decidedBy: 'claude' };
  },

  junction(args, ctx) {
    const [sub, id] = args;
    if (sub !== 'eligible' || !id) fail('usage: junction eligible <id>');
    const jf = dataFile('junctions', `${id}.json`);
    const j = readJsonFile(jf);
    if (!j) fail(`junction not found: ${id}`);
    const answers = {};
    const adir = ctx.p('.blueprint', 'ui', 'answers');
    if (fs.existsSync(adir)) {
      for (const f of fs.readdirSync(adir).filter((x) => x.endsWith('.json'))) {
        for (const [q, a] of Object.entries((readJsonFile(path.join(adir, f), {}) || {}).answers || {})) if (a && a.confirmed !== false) answers[q] = a;
      }
    }
    const ruled = (opt) => Object.entries(opt.ruledOutWhen || {}).some(([q, vals]) => {
      const a = answers[q]; if (!a) return false;
      const have = Array.isArray(a.value) ? a.value : [a.value];
      return have.some((v) => vals.includes(v));
    });
    const options = j.options.filter((o) => !ruled(o));
    const rec = j.recommend && options.some((o) => o.id === j.recommend.option);
    return rec || !j.recommend ? { options, recommend: j.recommend ?? null } : { options, recommend: null, recommendRuledOut: j.recommend.option };
  },

  brief(args, ctx) {
    const [id] = args; if (!id) fail('usage: brief <capability-id>');
    const cap = ctx.capability(id);
    const file = ctx.p('evals', 'briefs', `${id}.md`);
    if (fs.existsSync(file)) fail(`brief already exists: evals/briefs/${id}.md`);
    let t = fs.readFileSync(path.join(PLUGIN, 'templates', 'project', 'brief-template.md'), 'utf8').replace(/\r\n/g, '\n');
    const lines = (arr, prefix = '') => arr.map((x) => `- ${prefix}${x}`);
    const sect = (marker, pre, keepFill = true) => {
      const body = `<!-- brief:${marker} -->\n${[...pre, ...(keepFill ? ['<<fill>>'] : [])].join('\n')}`;
      t = t.replace(`<!-- brief:${marker} -->\n<<fill>>`, () => body);
    };
    t = t.replace('<<fill>>', () => cap.name || id);
    sect('files', lines(cap.screens || []));
    sect('consumes', [...lines(cap.data || [], 'table: '), ...lines(cap.permissions || [], 'permission: ')]);
    sect('produces', lines(cap.automations || [], 'automation: '));
    sect('test', cap.test ? [`- ${cap.test}`] : []);
    writeTextAtomic(file, t);
    cap.brief = `evals/briefs/${id}.md`; ctx.saveMap();
    return { capability: id, brief: cap.brief };
  },

  eval(args, ctx) {
    const [sub, id] = args;
    if (sub !== 'new' || !id) fail('usage: eval new <capability-id>');
    const cap = ctx.capability(id);
    const file = ctx.p('evals', `${id}.md`);
    if (fs.existsSync(file)) fail(`eval already exists: evals/${id}.md`);
    let t = fs.readFileSync(path.join(PLUGIN, 'templates', 'project', 'eval-template.md'), 'utf8').replace(/\r\n/g, '\n');
    t = t.replace('<<fill>>', () => cap.name || id);
    writeTextAtomic(file, t);
    cap.test = `evals/${id}.md`; ctx.saveMap();
    return { capability: id, test: cap.test };
  },

  evidence(args, ctx) {
    const [color, id] = args;
    if (!['red', 'green'].includes(color) || !id) fail('usage: evidence red|green <capability-id> (--cmd "..." | --report <file> --result pass|fail)');
    const cap = ctx.capability(id);
    const testFile = ctx.p(cap.test || path.join('evals', `${id}.md`));
    if (!fs.existsSync(testFile)) fail(`eval file missing for ${id}: run "eval new ${id}"`);
    const catches = catchesOf(testFile);
    if (!catches) fail(`eval file has no catches sentence (<!-- catches -->): ${cap.test || id}`);
    cap.evidence ||= { red: null, green: null, adopted: false };
    if (color === 'green' && !cap.evidence.red) fail('green refused: no red evidence yet (see it fail first)');
    let exit; let body; let mode;
    const { cmd, report, result } = ctx.flags;
    if (cmd) {
      mode = 'cmd';
      if (process.platform === 'win32') {
        // cmd.exe exits 1 for an unknown command, like a failing test, so look the program up first.
        const first = String(cmd).trim().match(/^"([^"]+)"|^(\S+)/);
        const prog = first ? (first[1] || first[2]) : '';
        const known = prog && (fs.existsSync(path.resolve(ctx.resolve(), prog)) || spawnSync('where', [prog], { encoding: 'utf8' }).status === 0);
        if (!known) fail(`the command did not run (${prog || 'empty command'} was not found); fix the command, nothing recorded`);
      }
      const r = spawnSync(cmd, { shell: true, timeout: 120000, cwd: ctx.resolve(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.error || r.status === null || r.status === 126 || r.status === 127) fail(`the command did not run (${r.error ? r.error.message : r.status === null ? 'timeout or killed' : 'exit ' + r.status}); fix the command, nothing recorded`);
      exit = r.status;
      body = `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n[${r.error.message}]` : ''}`;
    } else if (report) {
      mode = 'report';
      if (!['pass', 'fail'].includes(result)) fail('--report needs --result pass|fail');
      const src = path.resolve(ctx.resolve(), report);
      if (!fs.existsSync(src)) fail(`report file not found: ${report}`);
      body = fs.readFileSync(src, 'utf8');
      exit = result === 'pass' ? 0 : 1;
    } else return fail('evidence needs --cmd "<command>" or --report <file> --result pass|fail');
    if (color === 'red' && exit === 0) fail('the test passed before the build: it catches nothing');
    if (color === 'green' && exit !== 0) fail('green refused: the run failed');
    const rel = `evals/evidence/${id}.${color}.txt`;
    writeTextAtomic(ctx.p(rel), body);
    let at = nowIso();
    if (color === 'green' && cap.evidence.red && at <= cap.evidence.red.at) at = new Date(Date.parse(cap.evidence.red.at) + 1).toISOString();
    cap.evidence[color] = { path: rel, exit, at, sha256: sha256(ctx.p(rel)), mode };
    cap.catches = catches;
    ctx.saveMap();
    return { capability: id, color, evidence: cap.evidence[color] };
  },

  githook(args, ctx) {
    if (args[0] !== 'install') fail('usage: githook install');
    const dir = ctx.resolve();
    const r = installGitHook(dir);
    if (!r.installed) fail('this folder is not a git repository, so there is no commit gate to install');
    return { ok: true, dir, hooksPath: '.githooks' };
  },

  review(args, ctx) {
    const [sub, id] = args;
    if (sub !== 'record' || !id) fail('usage: review record <id> --spec pass|findings|not_run --quality pass|findings|not_run --path <file>');
    const cap = ctx.capability(id);
    const { spec, quality, path: rp } = ctx.flags;
    for (const [k, v] of [['spec', spec], ['quality', quality]]) if (!['pass', 'findings', 'not_run'].includes(v)) fail(`--${k} must be pass, findings or not_run`);
    const rel0 = rp ? path.relative(ctx.resolve(), path.resolve(ctx.resolve(), rp)) : '';
    if (rp && (rel0.startsWith('..') || path.isAbsolute(rel0))) fail('review path must be inside the project folder');
    if (!rp || !fs.existsSync(path.resolve(ctx.resolve(), rp))) fail(`review file not found: ${rp || '(no --path)'}`);
    if (!cap.evidence || !cap.evidence.green) fail('review refused: no green evidence yet');
    cap.review = { at: nowIso(), spec, quality, path: rel0.split(path.sep).join('/') };
    cap.reviewedFilesHash = filesHash(ctx.resolve(), cap.files);
    ctx.saveMap();
    return cap.review;
  },

  route(args, ctx) {
    const [slot] = args;
    const map = readJsonFile(dataFile('superpowers-map.json'));
    if (!map) fail('superpowers-map.json not found');
    const sl = map.slots && map.slots[slot];
    if (!sl) fail(`unknown slot: ${slot} (expected ${Object.keys(map.slots || {}).join(', ')})`);
    const sp = ctx.state().superpowers || {};
    const ours = (reason) => ({ slot, use: sl.ours, source: 'ours', reason });
    if (!sp.installed) return ours('not installed');
    const v = semver(sp.version);
    if (!v) return ours('version unknown');
    if (!/^\d+\.\d+\.\d+$/.test(String(sp.version))) return ours(`version ${sp.version} is a pre-release, outside tested ${sl.tested.min}-${sl.tested.max}`);
    const lo = semver(sl.tested.min); const hi = semver(sl.tested.max);
    if (semCmp(v, lo) < 0 || semCmp(v, hi) > 0) return ours(`version ${sp.version} outside tested ${sl.tested.min}-${sl.tested.max}`);
    return { slot, use: sl.superpowers, source: 'superpowers', reason: `version ${sp.version} inside tested ${sl.tested.min}-${sl.tested.max}` };
  },

  map(args, ctx) {
    const [sub, kind, ...rest] = args;
    const m = ctx.map();
    if (sub === 'add') {
      const key = { screen: ['screens', 'file'], capability: ['capabilities', 'id'], table: ['tables', 'name'], automation: ['automations', 'id'] }[kind];
      if (!key) fail('usage: map add screen|capability|table|automation \'<json>\'');
      let obj; try { obj = JSON.parse(rest[0]); } catch { fail('map add needs a JSON object'); }
      if (!obj || typeof obj !== 'object' || !obj[key[1]]) fail(`${kind} needs "${key[1]}"`);
      m[key[0]] ||= [];
      if (m[key[0]].some((x) => x[key[1]] === obj[key[1]])) fail(`duplicate ${kind} ${key[1]}: ${obj[key[1]]}`);
      if (kind === 'capability') {
        obj = { screens: [], data: [], permissions: [], automations: [], files: [], reviewedFilesHash: null, test: null, status: 'mock', builtAt: null, ux: null, brief: null, catches: null, review: null, rounds: 0, openFindings: [], halted: false, ...obj };
        obj.evidence = { red: null, green: null, adopted: false, ...(obj.evidence || {}) };
      }
      m[key[0]].push(obj); ctx.saveMap();
      return obj;
    }
    if (sub === 'set') {
      if (kind !== 'capability') fail('usage: map set capability <id> key=value ...');
      const [id, ...toks] = rest;
      const cap = ctx.capability(id);
      const o = kv(toks);
      const own = { evidence: 'evidence red|green', review: 'review record', halted: 'round clear', rounds: 'round add|clear', openFindings: 'round add|clear', builtAt: 'status=real', reviewedFilesHash: 'review record' };
      for (const k of Object.keys(o)) { const top = k.split('.')[0]; if (own[top]) fail(`map set refuses "${k}": use "${own[top]}"`); }
      const status = o.status;
      if (status !== undefined && !['mock', 'real'].includes(status)) fail('status must be mock or real');
      for (const [k, v] of Object.entries(o)) if (k !== 'status') setPath(cap, k, parseVal(v));
      if (status === 'real') {
        if (ctx.flags.baseline) { cap.evidence ||= { red: null, green: null, adopted: false }; cap.evidence.adopted = true; }
        else {
          const miss = realMissing(ctx, cap);
          if (miss.length) fail(`${id} cannot be real, missing: ${miss.join(', ')}`);
        }
        cap.status = 'real'; cap.builtAt = nowIso();
      } else if (status === 'mock') {
        cap.status = 'mock'; cap.builtAt = null;
        cap.evidence ||= { red: null, green: null, adopted: false }; cap.evidence.adopted = false;
      }
      ctx.saveMap();
      return cap;
    }
    if (sub === 'later') {
      if (kind !== 'add' || !rest[0]) fail('usage: map later add "<text>" [--stage N]');
      m.later ||= [];
      const max = m.later.reduce((x, l) => Math.max(x, Number(String(l.id).replace('later-', '')) || 0), 0);
      const stage = ctx.flags.stage !== undefined ? Number(ctx.flags.stage) : ctx.state().stage;
      const entry = { id: `later-${max + 1}`, text: rest[0], addedAt: today(), stage };
      m.later.push(entry); ctx.saveMap();
      return entry;
    }
    if (sub === 'impact') {
      if (!kind) fail('usage: map impact <type:id>');
      try { return impact(m, kind); } catch (e) { return fail(e.message); }
    }
    return fail('usage: map add|set|later|impact ...');
  },

  role(args, ctx) {
    const [sub, id] = args;
    const m = ctx.map();
    if (sub === 'list') return m.roles;
    if (sub !== 'add' || !id) fail('usage: role add <id> --name "<name>" --kind anon|user|staff|admin|service | role list');
    const { name, kind } = ctx.flags;
    if (!name) fail('role add needs --name');
    if (!ROLE_KINDS.includes(kind)) fail(`--kind must be ${ROLE_KINDS.join('|')}`);
    if (m.roles.some((r) => r.id === id)) fail(`duplicate role: ${id}`);
    const entry = { id, name, kind };
    m.roles.push(entry); ctx.saveMap();
    return entry;
  },

  access(args, ctx) {
    const [sub, object] = args;
    if (sub !== 'set' || !object) fail('usage: access set <object> --json \'<obj>\' [--label "<שם בעברית>"]');
    const o = jsonFlag(ctx, 'access set');
    const entry = { object, kind: 'table', exposed: true, serviceOnly: false, owner: null, sensitive: [], rules: [], ...o };
    entry.object = object;
    if (ctx.flags.label !== undefined) entry.label = ctx.flags.label;
    if (entry.label !== undefined && (typeof entry.label !== 'string' || !entry.label.trim())) fail('label must be a non-empty string');
    if (!ACCESS_KINDS.includes(entry.kind)) fail(`kind must be ${ACCESS_KINDS.join('|')}`);
    if (!Array.isArray(entry.rules) || !Array.isArray(entry.sensitive)) fail('rules and sensitive must be arrays');
    for (const r of entry.rules) {
      if (!r || typeof r.role !== 'string' || !Array.isArray(r.ops) || !['own', 'all', 'none'].includes(r.scope)) fail('each rule needs role, ops[] and scope own|all|none');
      r.rowRule ??= ''; r.columns ??= null;
    }
    const m = ctx.map();
    const i = m.access.findIndex((a) => a.object === object);
    if (i < 0) m.access.push(entry); else m.access[i] = entry;
    ctx.saveMap();
    return entry;
  },

  service(args, ctx) {
    const [sub, id] = args;
    if (!['add', 'set'].includes(sub) || !id) fail('usage: service add|set <id> --json \'<obj>\'');
    const o = jsonFlag(ctx, `service ${sub}`);
    for (const k of ['owner', 'payer']) if (o[k] !== undefined && o[k] !== null && !['client', 'me', 'org'].includes(o[k])) fail(`${k} must be client|me|org`);
    // existing: true marks a system that was in use before this one (a CRM, accounting, a sheet); check rule 30 reads it
    if (o.existing !== undefined && typeof o.existing !== 'boolean') fail('existing must be true or false');
    const m = ctx.map();
    const i = m.services.findIndex((x) => x.id === id);
    let entry;
    if (sub === 'add') {
      if (i >= 0) fail(`duplicate service: ${id}`);
      if (!o.name) fail('service add needs "name" in the JSON');
      entry = { name: id, purpose: '', owner: null, payer: null, plan: null, planReason: '', docs: '', secrets: [], publicVars: [], webhooksIn: [], webhooksOut: [], capabilities: [], renewal: null, ...o, id };
      m.services.push(entry);
    } else {
      if (i < 0) fail(`unknown service: ${id}`);
      entry = m.services[i] = { ...m.services[i], ...o, id };
    }
    ctx.saveMap();
    return entry;
  },

  process(args, ctx) {
    const [sub, a2, a3, a4] = args;
    const m = ctx.map();
    if (sub === 'add') {
      if (!a2) fail('usage: process add <id> --name "<name>"');
      if (!ctx.flags.name) fail('process add needs --name');
      if (m.processes.some((p) => p.id === a2)) fail(`duplicate process: ${a2}`);
      const entry = { id: a2, name: ctx.flags.name, stages: [], actors: [], steps: [], timers: [], cases: [] };
      m.processes.push(entry); ctx.saveMap();
      return entry;
    }
    const lists = { stage: 'stages', step: 'steps', timer: 'timers', case: 'cases' };
    const usage = 'usage: process add <id> --name ... | process stage|step|timer|case add <process> --json \'<obj>\' | process step|timer|case set <process> <id> --json \'<partial>\'';
    const isSet = a2 === 'set';
    if (!lists[sub] || !['add', 'set'].includes(a2) || !a3 || (isSet && (sub === 'stage' || !a4))) fail(usage);
    const proc = m.processes.find((p) => p.id === a3) || fail(`unknown process: ${a3}`);
    for (const k of ['stages', 'actors', 'steps', 'timers', 'cases']) if (!Array.isArray(proc[k])) proc[k] = [];
    const list = proc[lists[sub]];
    const o = jsonFlag(ctx, `process ${sub} ${a2}`);
    let entry;
    if (!isSet) {
      if (!o.id || typeof o.id !== 'string') fail(`${sub} needs "id"`);
      if (list.some((x) => x.id === o.id)) fail(`duplicate ${sub} id: ${o.id}`);
      entry = { ...PROCESS_DEFAULTS[sub], ...o };
      checkProcessItem(sub, entry, proc);
      list.push(entry);
      if (sub === 'step' && !proc.actors.includes(entry.actor)) proc.actors.push(entry.actor);
    } else {
      // set: merge the partial into the existing item, then validate the result exactly as add does
      const i = list.findIndex((x) => x.id === a4);
      if (i < 0) fail(`unknown ${sub} in ${a3}: ${a4}`);
      if (o.id !== undefined && o.id !== a4) fail(`${sub} set cannot change the id; add a new ${sub} instead`);
      const before = list[i];
      entry = { ...before, ...o, id: a4 };
      checkProcessItem(sub, entry, proc);
      list[i] = entry;
      if (sub === 'step' && entry.actor !== before.actor) {
        if (!proc.actors.includes(entry.actor)) proc.actors.push(entry.actor);
        if (!list.some((s) => s.actor === before.actor)) proc.actors = proc.actors.filter((a) => a !== before.actor);
      }
    }
    ctx.saveMap();
    return entry;
  },

  render(args, ctx) {
    const rel = ctx.flags.file || path.join('spec', 'prd.md');
    const file = path.resolve(ctx.resolve(), rel);
    const inside = path.relative(ctx.resolve(), file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) fail('--file must be inside the project folder');
    if (!fs.existsSync(file)) fail(`file not found: ${rel}`);
    const m = ctx.map();
    if (ctx.mapWasOld) ctx.saveMap();   // the stamp must match the map as it is on disk
    const before = fs.readFileSync(file, 'utf8');
    const out = stampDocument(replaceBlocks(before, m), m);
    if (out !== before) writeTextAtomic(file, out);
    return { file: inside.split(path.sep).join('/'), stamp: out.split('\n')[0], blocks: extractBlocks(out).map((b) => b.kind), changed: out !== before };
  },

  change(args, ctx) {
    const [sub, a2, a3] = args;
    if (sub === 'open') {
      const text = a2;
      if (!text) fail('usage: change open "<text>" --kind <k> [--ref type:id,type:id] [--decision now|later]');
      const kind = ctx.flags.kind;
      if (!CHANGE_KINDS.includes(kind)) fail(`--kind must be ${CHANGE_KINDS.join('|')}`);
      const decision = ctx.flags.decision || 'now';
      if (!['now', 'later'].includes(decision)) fail('--decision must be now or later');
      const refs = (ctx.flags.ref || '').split(',').map((x) => x.trim()).filter(Boolean);
      const m = ctx.map();
      const nodes = new Set(); const opens = new Set();
      // Dimensions open on the kind and on the refs' own types. The impact walk (three links) only lists the
      // nodes to update: on a connected map it reaches almost every type, and matching on it opened 27 of 31.
      for (const r of refs) { let i; try { i = impact(m, r); } catch (e) { fail(e.message); } i.nodes.forEach((n) => nodes.add(n)); opens.add(String(r).split(':')[0]); }
      const own = KIND_TYPE[kind] === undefined ? kind : KIND_TYPE[kind];
      if (own) opens.add(own);
      const dimFile = dataFile('dimensions.json');
      let dims = []; let note;
      const all = fs.existsSync(dimFile) ? readJsonFile(dimFile, []) : null;
      if (!Array.isArray(all)) note = 'הקובץ data/dimensions.json חסר, ולכן לא נפתח אף ממד.';
      else dims = all.filter((d) => arr(d.opensOn).some((t) => opens.has(t)) && (!ctx.state().track || !Array.isArray(d.tracks) || d.tracks.includes(ctx.state().track))).map((d) => ({ id: d.id, status: 'open', proof: null, reason: '', at: '' }));
      const list = ctx.json('changes.json', []);
      const ns = [...nodes];
      const entry = {
        at: nowIso(), kind, text, decision, stage: ctx.state().stage,
        impact: { tables: ns.filter((n) => n.startsWith('table:')).length, permissions: ns.filter((n) => n.startsWith('permission:')).length, automations: ns.filter((n) => n.startsWith('automation:')).length, screens: ns.filter((n) => n.startsWith('screen:')).map((n) => n.slice(7)) },
        nodes: ns, dimensions: dims,
      };
      list.push(entry); ctx.saveJson('changes.json', list);
      return { index: list.length - 1, ...entry, opens: [...opens].sort(), ...(note ? { note } : {}) };
    }
    if (sub === 'dimension') {
      const [idx, dim] = [a2, a3];
      const status = ctx.flags.status;
      if (idx === undefined || !dim || !['closed', 'na'].includes(status)) fail('usage: change dimension <index> <dim> --status closed|na --proof <file> [--reason "..."]');
      const list = ctx.json('changes.json', []);
      const entry = list[Number(idx)] || fail(`no change at index ${idx}`);
      const d = arr(entry.dimensions).find((x) => x.id === dim) || fail(`the change has no dimension ${dim}`);
      if (status === 'closed') {
        if (!ctx.flags.proof) fail('closed needs --proof <file>');
        const abs = path.resolve(ctx.resolve(), ctx.flags.proof);
        const rel = path.relative(ctx.resolve(), abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) fail('proof must be inside the project folder');
        if (!fs.existsSync(abs)) fail(`proof file not found: ${ctx.flags.proof}`);
        d.proof = rel.split(path.sep).join('/');
      } else {
        if (!ctx.flags.reason || !ctx.flags.reason.trim()) fail('na needs --reason');
        d.proof = null;
      }
      d.status = status; d.reason = ctx.flags.reason || ''; d.at = nowIso();
      ctx.saveJson('changes.json', list);
      return { index: Number(idx), dimensions: entry.dimensions };
    }
    return fail('usage: change open "<text>" --kind <k> | change dimension <index> <dim> --status ...');
  },

  log(args, ctx) {
    const [sub, ...rest] = args;
    if (sub === 'done') {
      const list = ctx.json('changes.json', []);
      const entry = list[Number(rest[0])];
      if (rest[0] === undefined || !/^\d+$/.test(rest[0]) || !entry) fail('usage: log done <index> (index into changes.json, from 0)');
      if (entry.decision !== 'now') fail('only a change with decision now can be marked done');
      const open = arr(entry.dimensions).filter((d) => d.status === 'open').map((d) => d.id);
      if (open.length) fail(`אי אפשר לסגור את השינוי, עוד פתוחים: ${open.join(', ')}`);
      entry.done = true; entry.doneAt = nowIso();
      ctx.saveJson('changes.json', list);
      return { index: Number(rest[0]), done: true };
    }
    if (sub !== 'add') fail('usage: log add kind=<kind> text="<text>" decision=now|later | log done <index>');
    const o = kv(rest);
    if (!['wording', 'field', 'screen', 'capability', 'permission', 'track'].includes(o.kind)) fail('kind must be wording|field|screen|capability|permission|track');
    if (!o.text) fail('log add needs text');
    if (!['now', 'later'].includes(o.decision)) fail('decision must be now or later');
    let impact = { tables: 0, permissions: 0, automations: 0, screens: [] };
    if (o.impact) { const p = parseVal(o.impact); if (typeof p !== 'object' || !p) fail('impact must be JSON'); impact = { ...impact, ...p }; }
    const list = ctx.json('changes.json', []);
    const entry = { at: nowIso(), kind: o.kind, text: o.text, impact, decision: o.decision, stage: o.stage !== undefined ? Number(o.stage) : ctx.state().stage };
    list.push(entry); ctx.saveJson('changes.json', list);
    return entry;
  },

  pending(args, ctx) {
    const [sub, qid] = args;
    if (!['add', 'clear'].includes(sub) || !qid) fail('usage: pending add|clear <qid>');
    const s = ctx.state(); s.pending ||= [];
    if (sub === 'add') { if (!s.pending.includes(qid)) s.pending.push(qid); }
    else s.pending = s.pending.filter((x) => x !== qid);
    ctx.saveState();
    return { pending: s.pending };
  },

  verified(args, ctx) {
    const [sub, ...rest] = args;
    const v = ctx.json('verified.json', {});
    if (sub === 'set') {
      const o = kv(rest);
      if (!o.topic || !o.url || !o.summary) fail('verified set needs topic, url, summary');
      if (o.ttlDays !== undefined && !/^\d+$/.test(o.ttlDays)) fail('ttlDays must be a non-negative integer');
      v[o.topic] = { url: o.url, checkedAt: today(), summary: o.summary, ttlDays: o.ttlDays !== undefined ? Number(o.ttlDays) : 30 };
      ctx.saveJson('verified.json', v);
      return { topic: o.topic, ...v[o.topic] };
    }
    if (sub === 'get') {
      const e = v[rest[0]];
      if (!e) return { topic: rest[0], found: false, fresh: false };
      const ageDays = (Date.parse(today()) - Date.parse(e.checkedAt)) / 86400000;
      return { topic: rest[0], found: true, ...e, fresh: ageDays < e.ttlDays };
    }
    return fail('usage: verified set ... | verified get <topic>');
  },

  'accept-terms'() {
    const terms = readJsonFile(dataFile('terms', 'terms.json'));
    if (!terms || !terms.version) fail('terms.json not found');
    const file = path.join(profileDir(), 'profile.json');
    const p = readJsonFile(file, {}) || {};
    p.terms = { version: terms.version, acceptedAt: nowIso() };
    p.defaults ||= {}; p.projects ||= []; p.designSystems ||= [];
    writeJsonAtomic(file, p);
    return p;
  },

  profile(args) {
    const [sub, ...rest] = args;
    const file = path.join(profileDir(), 'profile.json');
    const p = readJsonFile(file, { terms: null, defaults: {}, projects: [], designSystems: [] }) || {};
    if (sub === 'get') return rest[0] ? getPath(p, rest[0]) ?? null : p;
    if (sub === 'set') {
      if (!rest.length) fail('profile set needs key=value');
      for (const [k, v] of Object.entries(kv(rest))) setPath(p, k, parseVal(v));
      writeJsonAtomic(file, p);
      return p;
    }
    return fail('usage: profile get [path] | profile set key=value');
  },

  connections(args, ctx) {
    const [sub, name, ...rest] = args;
    if (sub !== 'set' || !name) fail('usage: connections set <name> ok=true|false [note="..."]');
    const o = kv(rest);
    if (!['true', 'false'].includes(o.ok)) fail('ok must be true or false');
    const s = ctx.state(); s.connections ||= {};
    s.connections[name] = { ok: o.ok === 'true', checkedAt: today(), note: o.note || '' };
    ctx.saveState();
    return s.connections[name];
  },

  // prototype build [--test] | scan [--test]: the built screens joined into one self-contained file, mockup/prototype.html
  // (--test: mockup/prototype-test.html, without the page map and the device toggle, for a test with a real person).
  prototype(args, ctx) {
    const [sub] = args;
    if (sub === 'notes') {
      // notes [--open] | notes add --screen <map file> --text "<text>" [--source artifact|local] [--ref <id>] | notes done <id> [--how "<what changed>"]
      const root = ctx.resolve();
      const unwrap = (r) => (r.status === 200 ? r.body : fail(`prototype notes: ${r.body.error}`));
      if (args[1] === 'add') return unwrap(addNote(root, { screen: ctx.flags.screen, text: ctx.flags.text, source: ctx.flags.source || 'local', ref: ctx.flags.ref || null }));
      if (args[1] === 'done') {
        if (!args[2]) fail('usage: prototype notes done <id> [--how "<what changed>"]');
        return unwrap(doneNote(root, args[2], ctx.flags.how || null));
      }
      if (args[1]) fail('usage: prototype notes [--open] | prototype notes add --screen <file> --text "<text>" | prototype notes done <id>');
      return { notes: listNotes(root, { openOnly: ctx.flags.open === true }) };
    }
    if (!['build', 'scan'].includes(sub)) fail('usage: prototype build [--test] | prototype scan [--test] | prototype notes');
    const root = ctx.resolve();
    const test = ctx.flags.test === true;
    const rel = test ? 'mockup/prototype-test.html' : 'mockup/prototype.html';
    if (sub === 'build') {
      const { html, report } = buildPrototype(root, { test });
      writeTextAtomic(path.join(root, rel), html);
      const out = { file: rel, total: report.total, built: report.built, missing: report.missing, bytes: report.bytes };
      if (report.external.length) out.external = report.external;
      if (report.unresolved.length) out.unresolved = report.unresolved;
      if (report.tooLarge) { out.tooLarge = true; out.largest = report.largest; }
      return out;
    }
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) fail(`${rel} does not exist. Run: prototype build${test ? ' --test' : ''}`);
    return scanPrototype(fs.readFileSync(file, 'utf8'));
  },

  // doc html <file.md> [--client]: one self-contained HTML page into docs/rendered/. Read-only on the map.
  doc(args, ctx) {
    const [sub, rel] = args;
    if (sub !== 'html' || !rel) fail('usage: doc html <file.md> [--client]');
    const root = ctx.resolve();
    const file = path.resolve(process.cwd(), rel);
    const rootFile = path.resolve(root, rel);
    const src = fs.existsSync(file) && !path.relative(root, file).startsWith('..') ? file : rootFile;
    const inside = path.relative(root, src);
    if (inside.startsWith('..') || path.isAbsolute(inside)) fail('the file must be inside the project folder');
    if (!fs.existsSync(src)) fail(`file not found: ${rel}`);
    const tokensFile = path.join(root, 'design', 'tokens.css');
    const tokens = fs.existsSync(tokensFile) ? fs.readFileSync(tokensFile, 'utf8') : '';
    const client = ctx.flags.client === true || ctx.flags.client === 'true';
    const html = renderDoc(fs.readFileSync(src, 'utf8'), ctx.map(), tokens, { client });
    const name = path.basename(src).replace(/\.md$/i, '');
    const outRel = path.join('docs', 'rendered', `${name}${client ? '.client' : ''}.html`);
    writeTextAtomic(path.join(root, outRel), html);
    return { file: outRel.split(path.sep).join('/'), version: client ? 'client' : 'review', tokens: Boolean(tokens) };
  },
};

export function run(argv) {
  const { pos, flags } = parseArgs(argv);
  const [cmd, ...args] = pos;
  if (!cmd || !commands[cmd]) fail(`unknown command: ${cmd || '(none)'}. Commands: ${Object.keys(commands).join(', ')}`);
  const ctx = makeCtx(flags);
  return commands[cmd](args, ctx);
}

function isMain() {
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); } catch { return false; }
}
if (isMain()) {
  try {
    const out = run(process.argv.slice(2));
    process.stdout.write((out instanceof RawText ? out.text : JSON.stringify(out === undefined ? null : out, null, 2)) + '\n');
  } catch (e) {
    process.stderr.write(`bp: ${String(e && e.message ? e.message : e).replace(/\r?\n/g, ' ')}\n`);
    process.exit(1);
  }
}
