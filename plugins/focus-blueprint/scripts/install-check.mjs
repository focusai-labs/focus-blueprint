#!/usr/bin/env node
// Prints one JSON line describing what is installed. Every child process has a
// timeout; a timeout, a missing binary or a non-zero exit means "unknown".
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 10000;
// Version of a standalone `claude` CLI on PATH, if any. The VS Code extension bundles its own private
// copy and does not put claude on PATH, so this is not the version of the running session.
export const MIN_CLAUDE_CODE = '2.1.277';

/** "2.1.283 (Claude Code)" -> "2.1.283"; anything else -> "unknown". */
export function parseClaudeVersion(text) {
  const m = String(text ?? '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : 'unknown';
}

/** True when version is min or later; false for "unknown" or anything unparsable. */
export function versionAtLeast(version, min = MIN_CLAUDE_CODE) {
  const a = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  const b = String(min).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  }
  return true;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true });
  if (r.error || r.signal || r.status !== 0) return null;
  return r.stdout || '';
}

// On Windows claude is often a .cmd shim that only a shell finds, so retry through one.
function claudeCliVersion() {
  let out = run('claude', ['--version']);
  if (out === null && process.platform === 'win32') {
    const r = spawnSync('claude --version', { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true, shell: true });
    if (!r.error && !r.signal && r.status === 0) out = r.stdout || '';
  }
  return out === null ? 'unknown' : parseClaudeVersion(out);
}

function main() {
const major = Number(process.versions.node.split('.')[0]);
const result = {
  node: `v${process.versions.node}`,
  nodeOk: major >= 22,
  git: run('git', ['--version']) !== null,
  claudeCli: { version: claudeCliVersion(), ok: null },
  playwrightMcp: 'unknown',
  superpowers: { installed: 'unknown', version: 'unknown' },
};

// ok is null, never false, when there is no version to compare.
result.claudeCli.ok = result.claudeCli.version === 'unknown' ? null : versionAtLeast(result.claudeCli.version);

const mcp = run('claude', ['mcp', 'list']);
if (mcp !== null) result.playwrightMcp = /playwright/i.test(mcp);

const plugins = run('claude', ['plugin', 'list']);
if (plugins !== null) {
  const lines = plugins.split('\n');
  const i = lines.findIndex((l) => /superpowers/i.test(l));
  if (i === -1) {
    result.superpowers = { installed: false, version: null };
  } else {
    // Versions sit on the line itself or on the "Version:" line right below it.
    const near = lines.slice(i, i + 4).join('\n');
    const v = near.match(/(?:Version:\s*|@|\bv)(\d+\.\d+\.\d+[^\s]*)/i);
    result.superpowers = { installed: true, version: v ? v[1] : 'unknown' };
  }
}

process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
