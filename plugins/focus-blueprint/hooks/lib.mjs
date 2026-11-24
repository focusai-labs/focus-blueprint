// Shared helpers for the hook scripts. Node only, no dependencies, so the same
// file runs on macOS, Linux and Windows without a shell in between.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TERMS_VERSION = '2026-11-16';
export const PROTECTED_BRANCHES = ['main', 'master'];

const here = path.dirname(fileURLToPath(import.meta.url));

/** Read the hook's JSON input from stdin. A missing or broken input is an empty object. */
export async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Find the Blueprint project this hook is running in: the nearest folder, from
 * the working directory upward, that holds .blueprint/state.json. Returns null
 * outside a Blueprint project, and every hook then exits without a word.
 */
export function findProject(input) {
  const starts = [input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      const state = readJson(path.join(dir, '.blueprint', 'state.json'));
      if (state) return { dir, state };
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function stages() {
  return readJson(path.join(here, '..', 'data', 'stages.json')) || [];
}

export function stageInfo(n) {
  return stages().find((s) => s.n === n) || null;
}

/** The personal file lives outside any project and survives across projects. */
export function profileDir() {
  return process.env.FOCUS_BLUEPRINT_HOME || path.join(os.homedir(), '.focus-blueprint');
}

export function termsAccepted() {
  const profile = readJson(path.join(profileDir(), 'profile.json'));
  return Boolean(profile && profile.terms && profile.terms.version === TERMS_VERSION);
}

/** Print the hook's JSON output. Nothing else may go to stdout. */
export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

/** Block the action: exit code 2, and the reason on stderr goes to Claude. */
export function block(reason) {
  process.stderr.write(reason);
  process.exit(2);
}

/** A marker added to hook context only in a probe run, to prove delivery. */
export function probeMark(event) {
  return process.env.FOCUS_BLUEPRINT_PROBE ? ` [blueprint-probe:${event}]` : '';
}

/** Path relative to the project, with forward slashes on every platform. */
export function relative(projectDir, file) {
  return path.relative(projectDir, path.resolve(file)).split(path.sep).join('/');
}

/** Stages and capabilities that hit the three-round fix cap. Read only; a broken file is skipped. */
export function haltedItems(project) {
  const items = [];
  const st = (project.state && project.state.stages) || {};
  for (const n of Object.keys(st).sort((a, b) => Number(a) - Number(b))) {
    if (st[n] && st[n].halted === true) items.push(`stage ${n}`);
  }
  const map = readJson(path.join(project.dir, '.blueprint', 'map.json'));
  for (const c of (map && Array.isArray(map.capabilities) ? map.capabilities : [])) {
    if (c && c.halted === true) items.push(String(c.id));
  }
  return items;
}

export function haltedLine(item) {
  return `[HALTED] ${item}: שלושה סבבי תיקון לא סגרו את זה. לא מנסים תיקון נוסף. אומרים לסטודנט מה פתוח ולמה (openFindings), ומחכים לו.`;
}

/** Rulings the student has not been shown yet. A missing or broken file gives an empty list. */
export function unreportedRulings(project) {
  const list = readJson(path.join(project.dir, '.blueprint', 'rulings.json'));
  return Array.isArray(list) ? list.filter((r) => r && r.reported === false) : [];
}

/** Branch, dirty file count and branch age in days. Null when the folder is not a git repository. */
export function gitInfo(dir) {
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const b = git(['symbolic-ref', '--short', '-q', 'HEAD']);
  if (b.error || b.status !== 0) return null;
  const branch = (b.stdout || '').trim();
  const dirty = (git(['status', '--porcelain']).stdout || '').split('\n').filter(Boolean).length;
  let days = 0;
  if (!PROTECTED_BRANCHES.includes(branch)) {
    const base = PROTECTED_BRANCHES.find((m) => git(['rev-parse', '--verify', '-q', m]).status === 0);
    if (base) {
      const first = (git(['log', '--reverse', '--format=%ct', branch, `^${base}`]).stdout || '').split('\n')[0].trim();
      if (first) days = Math.max(0, Math.floor((Date.now() / 1000 - Number(first)) / 86400));
    }
  }
  return { branch, dirty, days };
}

/**
 * Like findProject, for the guards: a .blueprint folder whose state.json cannot be
 * parsed still counts as a Blueprint project, so the guards keep working. The state
 * is then empty (live is treated as false) and `stateBroken` is true. Nothing is written.
 */
export function findProjectForGuard(input) {
  const found = findProject(input);
  if (found) return found;
  const starts = [input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(dir, '.blueprint'))) {
        process.stderr.write('Focus Blueprint: .blueprint/state.json cannot be read; the guards run with the default rules and treat the project as not live.\n');
        return { dir, state: {}, stateBroken: true };
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * SQL with everything that cannot run blanked out: comments (also nested block
 * comments), 'strings' (with '' escapes), E'strings' (with backslash escapes),
 * $tag$dollar quoted bodies$tag$ and "quoted identifiers". One pass, so a quote
 * inside a comment and a comment marker inside a string are both handled.
 */
export function sanitizeSql(sql) {
  const s = String(sql || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const two = s.slice(i, i + 2);
    if (two === '--') {
      while (i < s.length && s[i] !== '\n') i++;
      out += ' ';
    } else if (two === '/*') {
      let depth = 1;
      i += 2;
      while (i < s.length && depth > 0) {
        if (s.slice(i, i + 2) === '/*') { depth++; i += 2; }
        else if (s.slice(i, i + 2) === '*/') { depth--; i += 2; }
        else i++;
      }
      out += ' ';
    } else if (c === "'" || ((c === 'E' || c === 'e') && s[i + 1] === "'" && !/[\w$]/.test(s[i - 1] || ''))) {
      const escaped = c !== "'";
      i += escaped ? 2 : 1;
      while (i < s.length) {
        if (escaped && s[i] === '\\') { i += 2; continue; }
        if (s[i] === "'") {
          if (s[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += "''";
    } else if (c === '"') {
      i++;
      while (i < s.length) {
        if (s[i] === '"') {
          if (s[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += '""';
    } else if (c === '$' && !/[\w$]/.test(s[i - 1] || '')) {
      const tag = s.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (tag) {
        const end = s.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? s.length : end + tag[0].length;
        out += "''";
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The production identity of the Supabase project, from the map's supabase service. Never throws. */
export function supabaseTarget(project) {
  const map = readJson(path.join(project.dir, '.blueprint', 'map.json')) || {};
  const svc = (Array.isArray(map.services) ? map.services : []).find((x) => x && x.id === 'supabase') || {};
  let ref = typeof svc.ref === 'string' && svc.ref.trim() ? svc.ref.trim() : null;
  if (!ref) {
    try { ref = fs.readFileSync(path.join(project.dir, 'supabase', '.temp', 'project-ref'), 'utf8').trim() || null; } catch { /* no linked project */ }
  }
  return {
    ref,
    branch: typeof svc.prodBranch === 'string' && svc.prodBranch.trim() ? svc.prodBranch.trim() : 'main',
    devTarget: typeof svc.devTarget === 'string' && svc.devTarget.trim() ? svc.devTarget.trim() : null,
    live: project.state && project.state.live === true,
  };
}

/** The Supabase ref in the map's supabase service, or null while the project has none. Never throws. */
export function mapSupabaseRef(project) {
  const map = readJson(path.join(project.dir, '.blueprint', 'map.json')) || {};
  const svc = (Array.isArray(map.services) ? map.services : []).find((x) => x && x.id === 'supabase') || {};
  return typeof svc.ref === 'string' && svc.ref.trim() ? svc.ref.trim() : null;
}

/**
 * What a configured MCP server says about itself, when it is a Supabase one (hosted URL or the stdio
 * package), else null: { ref, readOnly, docsOnly }. Never prints or returns a token.
 */
export function supabaseServerFacts(def) {
  if (!def || typeof def !== 'object') return null;
  const url = typeof def.url === 'string' ? def.url : '';
  if (/mcp\.supabase\.com/i.test(url)) {
    let q;
    try { q = new URL(url).searchParams; } catch { q = new URLSearchParams(url.split('?')[1] || ''); }
    return {
      ref: q.get('project_ref') || null,
      readOnly: /^(true|1)$/i.test(q.get('read_only') || ''),
      docsOnly: (q.get('features') || '').trim().toLowerCase() === 'docs',
    };
  }
  const args = Array.isArray(def.args) ? def.args.map(String) : [];
  const cmd = typeof def.command === 'string' ? def.command : '';
  if (![cmd, ...args].some((a) => a.includes('@supabase/mcp-server-supabase'))) return null;
  const flag = (name) => {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === `--${name}`) return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
    }
    return null;
  };
  const ro = flag('read-only');
  const ref = flag('project-ref');
  const features = flag('features');
  return {
    ref: typeof ref === 'string' && ref ? ref : null,
    readOnly: ro === true || (typeof ro === 'string' && /^(true|1)$/i.test(ro)),
    docsOnly: typeof features === 'string' && features.trim().toLowerCase() === 'docs',
  };
}

/** Should this Supabase server be flagged for a project whose own ref is ownRef (null when none yet)? */
export function supabaseServerUnsafe(facts, ownRef) {
  if (!facts || facts.docsOnly) return false;
  if (!ownRef || !facts.ref || facts.ref !== ownRef) return true;
  return !facts.readOnly;
}

/** git with an argument array. Returns { status, stdout }; status is null when git is missing. */
export function runGit(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: r.error ? null : r.status, stdout: r.stdout || '' };
}
