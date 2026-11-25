import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN = path.join(ROOT, 'plugins', 'focus-blueprint');

export function tmpProject({ state = null, map = null, git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
  if (git) spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (state) {
    fs.mkdirSync(path.join(dir, '.blueprint'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.blueprint', 'state.json'), JSON.stringify(state, null, 2));
    fs.writeFileSync(path.join(dir, '.blueprint', 'map.json'), JSON.stringify(map || { schema: 1, capabilities: [], screens: [], tables: [], automations: [], later: [] }, null, 2));
  }
  return dir;
}

/** A profile that accepted the current terms, written into the test's own profile folder. */
export function acceptTerms(home) {
  const version = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'terms', 'terms.json'), 'utf8')).version;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'profile.json'), JSON.stringify({ terms: { version, acceptedAt: '2026-01-01' }, defaults: {}, projects: [], designSystems: [] }));
}

export function bp(dir, args, env = {}) {
  if (args[0] === 'init' && !env.FOCUS_BLUEPRINT_HOME && !fs.existsSync(path.join(dir, '.home', 'profile.json'))) acceptTerms(path.join(dir, '.home'));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'bp.mjs'), ...args, '--project', dir], {
    encoding: 'utf8', env: { ...process.env, FOCUS_BLUEPRINT_HOME: path.join(dir, '.home'), ...env },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim(), json: safe(r.stdout) };
}

export function hook(name, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', `${name}.mjs`)], {
    input: JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, FOCUS_BLUEPRINT_HOME: path.join(input.cwd || '', '.home'), ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, json: safe(r.stdout) };
}

function safe(s) { try { return JSON.parse(s); } catch { return null; } }
