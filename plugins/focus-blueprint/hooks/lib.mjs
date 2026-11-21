// Shared helpers for the hook scripts. Node only, no dependencies, so the same
// file runs on macOS, Linux and Windows without a shell in between.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
