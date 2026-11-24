// Pure model helpers for .blueprint/map.json (schema 2). Node builtins only, no imports
// from outside this folder: the folder is copied into a student's repo next to blueprint-check.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const NODE_TYPES = ['screen', 'capability', 'table', 'field', 'permission', 'role', 'access', 'service', 'secret', 'automation', 'webhook', 'process', 'step', 'timer', 'case', 'ai', 'dependency', 'domain', 'email', 'plan', 'content', 'release'];
const DEPTH = 3;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const arr = (x) => (Array.isArray(x) ? x : []);

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
/** sha256 (hex) of the map with every object key sorted, so key order never changes the hash. */
export function canonicalHash(map) { return sha(JSON.stringify(canon(map))); }

/** Changes the map in place from schema 1 to schema 2 (adds the empty arrays). Idempotent. */
export function migrateMapInPlace(map) {
  if (!map || typeof map !== 'object') return map;
  map.schema = 2;
  for (const k of ['capabilities', 'screens', 'tables', 'automations', 'later', 'roles', 'access', 'services', 'processes']) if (!Array.isArray(map[k])) map[k] = [];
  for (const c of map.capabilities) {
    if (!Array.isArray(c.files)) c.files = [];
    if (c.reviewedFilesHash === undefined) c.reviewedFilesHash = null;
  }
  return map;
}
/** Returns a migrated copy; the input is not touched. */
export function migrateMap(map) { return migrateMapInPlace(JSON.parse(JSON.stringify(map ?? {}))); }

/**
 * Hash over a capability's files: sorted paths, each with the sha256 of its content
 * (a missing file counts as "missing"). root is the project folder.
 */
export function filesHash(root, files) {
  const list = [...new Set(arr(files).map((f) => String(f).split(path.sep).join('/')))].sort();
  const lines = list.map((f) => {
    let h = 'missing';
    try { h = sha(fs.readFileSync(path.join(root, f))); } catch { /* missing file */ }
    return `${f}:${h}`;
  });
  return sha(lines.join('\n'));
}

const permParts = (p) => String(p).split(':');
const stepRef = (p, s) => `step:${p.id}.${s.id}`;

function build(map) {
  const nodes = new Map(); // ref -> { ref, type, id }
  const adj = new Map();
  const node = (type, id) => {
    const ref = `${type}:${id}`;
    if (!nodes.has(ref)) { nodes.set(ref, { ref, type, id: String(id) }); adj.set(ref, adj.get(ref) || new Set()); }
    return ref;
  };
  const edge = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  };
  for (const r of arr(map.roles)) node('role', r.id);
  for (const s of arr(map.screens)) node('screen', s.file);
  for (const t of arr(map.tables)) node('table', t.name);
  for (const a of arr(map.automations)) node('automation', a.id);
  for (const c of arr(map.capabilities)) {
    const cr = node('capability', c.id);
    for (const s of arr(c.screens)) edge(cr, node('screen', s));
    for (const t of arr(c.data)) edge(cr, node('table', t));
    for (const a of arr(c.automations)) edge(cr, node('automation', a));
    for (const p of arr(c.permissions)) {
      const pr = node('permission', p); edge(cr, pr);
      const [role, , table] = permParts(p);
      if (role) edge(pr, node('role', role));
      if (table) edge(pr, node('table', table));
    }
  }
  for (const a of arr(map.access)) {
    const ar = node('access', a.object); edge(ar, node('table', a.object));
    for (const f of [a.owner, ...arr(a.sensitive)].filter(Boolean)) { const fr = node('field', `${a.object}.${f}`); edge(fr, ar); edge(fr, node('table', a.object)); }
    for (const rule of arr(a.rules)) if (rule.role) edge(ar, node('role', rule.role));
  }
  for (const s of arr(map.services)) {
    const sr = node('service', s.id);
    for (const x of arr(s.secrets)) edge(sr, node('secret', x));
    for (const x of [...arr(s.webhooksIn), ...arr(s.webhooksOut)]) edge(sr, node('webhook', x));
    for (const x of arr(s.capabilities)) edge(sr, node('capability', x));
    if (s.plan) edge(sr, node('plan', s.id));
  }
  for (const p of arr(map.processes)) {
    const pr = node('process', p.id);
    for (const s of arr(p.steps)) {
      const sr = node('step', `${p.id}.${s.id}`); edge(pr, sr);
      if (s.screen) edge(sr, node('screen', s.screen));
      if (s.capability) edge(sr, node('capability', s.capability));
      for (const t of arr(s.tables)) edge(sr, node('table', t));
      if (s.permission) { const pm = node('permission', s.permission); edge(sr, pm); const [role, , table] = permParts(s.permission); if (role) edge(pm, node('role', role)); if (table) edge(pm, node('table', table)); }
      if (typeof s.actor === 'string' && s.actor.startsWith('role:')) edge(sr, node('role', s.actor.slice(5)));
      if (s.kind === 'ai' || s.actor === 'ai') edge(sr, node('ai', `${p.id}.${s.id}`));
      for (const n of arr(s.next)) edge(sr, node('step', `${p.id}.${n}`));
    }
    for (const t of arr(p.timers)) edge(pr, node('timer', `${p.id}.${t.id}`));
    for (const c of arr(p.cases)) edge(pr, node('case', `${p.id}.${c.id}`));
  }
  return { nodes, adj };
}

/** Every node the map declares (plus the ones it points at): [{ ref: "table:documents", type, id }], sorted by ref. */
export function nodesOf(map) {
  return [...build(map).nodes.values()].sort((a, b) => (a.ref < b.ref ? -1 : 1));
}

/**
 * What a change to `ref` (for example "table:documents") touches. Walks the links up to
 * three steps; a role is reached but never walked through (it would pull in everything).
 * Returns { nodes: [refs, the start first, then sorted], opens: [node types, sorted] }.
 */
export function impact(map, ref) {
  const m = migrateMap(map);
  const { adj } = build(m);
  const i = String(ref).indexOf(':');
  if (i < 1) throw new Error(`bad node ref: ${ref}`);
  const seen = new Set([ref]);
  let frontier = [ref];
  for (let d = 0; d < DEPTH; d++) {
    const next = [];
    for (const r of frontier) {
      if (r !== ref && r.startsWith('role:')) continue;
      for (const n of adj.get(r) || []) if (!seen.has(n)) { seen.add(n); next.push(n); }
    }
    frontier = next;
  }
  const rest = [...seen].filter((r) => r !== ref).sort();
  const nodes = [ref, ...rest];
  const opens = [...new Set(nodes.map((r) => r.slice(0, r.indexOf(':'))))].sort();
  return { nodes, opens };
}
