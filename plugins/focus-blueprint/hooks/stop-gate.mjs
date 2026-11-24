// Stop: when the files the map knows have changed (git status), run the map check. Errors block the stop
// once per distinct error list; when the agent stopped again with the same list, the student is told instead.
// Read only. Silent when the project is clean, is not a Blueprint project, or anything fails.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readInput, findProject, readJson, runGit, emit } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const status = runGit(project.dir, ['status', '--porcelain', '-z', '--untracked-files=all']);
if (status.status !== 0) process.exit(0);
const changed = [];
const entries = status.stdout.split('\0').filter(Boolean);
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  changed.push(e.slice(3));
  if (/^[RC]/.test(e)) i++; // the original name of a rename follows
}
if (!changed.length) process.exit(0);

const map = readJson(path.join(project.dir, '.blueprint', 'map.json')) || {};
const known = new Set();
const add = (v) => { if (typeof v === 'string' && v) known.add(v.replace(/\\/g, '/')); };
for (const c of map.capabilities || []) {
  for (const k of ['screens', 'files']) for (const f of (c && c[k]) || []) add(f);
  add(c && c.test); add(c && c.brief);
}
for (const s of map.screens || []) add(typeof s === 'string' ? s : s && (s.file || s.path));
for (const t of map.tables || []) add(t && t.migration);
for (const a of map.automations || []) add(a && a.copy);
const PREFIXES = ['spec/', 'evals/', 'supabase/', 'db/', 'n8n/', 'mockup/', 'src/', 'app/', 'components/', 'lib/', 'pages/', 'public/', 'test/', 'tests/', '__tests__/'];
const isKnown = (p) => known.has(p) || p === '.blueprint/map.json' || PREFIXES.some((x) => p.startsWith(x)) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);
if (!changed.some(isKnown)) process.exit(0);

let report;
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const mod = await import(pathToFileURL(path.join(here, '..', 'scripts', 'check-map.mjs')).href);
  report = mod.checkMap(project.dir, {});
} catch {
  process.exit(0);
}
const errors = (report && report.errors) || [];
if (!errors.length) process.exit(0);

const hash = crypto.createHash('sha1').update(errors.map((e) => `${e.rule}:${e.item}`).sort().join('\n')).digest('hex');
const marker = `[blueprint-stop:${hash}]`;

/** The last marker in the transcript, read from the end. Null when there is none. */
function lastMarker(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 4 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const all = [...buf.toString('utf8').matchAll(/\[blueprint-stop:([0-9a-f]{40})\]/g)];
      return all.length ? all[all.length - 1][1] : null;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

if (input.stop_hook_active === true) {
  const prev = input.transcript_path ? lastMarker(input.transcript_path) : null;
  // The same list again means no progress; a missing marker cannot prove progress either. Either way, stop the loop.
  if (prev === hash || prev === null) {
    emit({ systemMessage: `הסוכן עצר, ועדיין יש בעיות שהבודק מצא. שלוש הראשונות מופיעות כאן, והרשימה המלאה מתקבלת עם node scripts/blueprint-check.mjs.\n${errors.slice(0, 3).map((e) => e.message).join('\n')}` });
    process.exit(0);
  }
}

const top = errors.slice(0, 5).map((e, i) => `${i + 1}. ${e.message}`).join('\n');
const more = errors.length > 5 ? `\n(${errors.length - 5} more; the full list comes from: node scripts/blueprint-check.mjs)` : '';
emit({
  decision: 'block',
  reason: `Focus Blueprint: the map check found ${errors.length} problem(s) in the files changed in this session. Fix them before finishing, or tell the student what stays open and why.\n${top}${more}\n${marker}`,
});
