#!/usr/bin/env node
// Prints one JSON line describing what is installed. Every child process has a
// timeout; a timeout, a missing binary or a non-zero exit means "unknown".
import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 10000;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true });
  if (r.error || r.signal || r.status !== 0) return null;
  return r.stdout || '';
}

const major = Number(process.versions.node.split('.')[0]);
const result = {
  node: `v${process.versions.node}`,
  nodeOk: major >= 22,
  git: run('git', ['--version']) !== null,
  playwrightMcp: 'unknown',
  superpowers: { installed: 'unknown', version: 'unknown' },
};

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
