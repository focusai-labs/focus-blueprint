// Installs the Blueprint commit gate: .githooks/pre-commit, LF line endings, core.hooksPath. Idempotent.
// installGitHook(dir) returns { ok, installed }; installed is false when dir is not a git repository.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PRE_COMMIT = `#!/bin/sh
if ! command -v node >/dev/null 2>&1; then
  echo "לא מצאתי את Node.js, ולכן אי אפשר לבדוק את ה-commit. מתקינים Node.js ומנסים שוב." >&2
  exit 1
fi
exec node scripts/blueprint-check.mjs --pre-commit
`;
const ATTR = '.githooks/* text eol=lf';

const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

export function installGitHook(dir) {
  const root = path.resolve(dir);
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.error || inside.status !== 0) return { ok: true, installed: false };
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  const hook = path.join(root, '.githooks', 'pre-commit');
  if (!fs.existsSync(hook) || fs.readFileSync(hook, 'utf8') !== PRE_COMMIT) fs.writeFileSync(hook, PRE_COMMIT);
  try { fs.chmodSync(hook, 0o755); } catch { /* no unix modes on this file system */ }

  const attrs = path.join(root, '.gitattributes');
  const cur = fs.existsSync(attrs) ? fs.readFileSync(attrs, 'utf8') : '';
  if (!cur.split(/\r?\n/).some((l) => l.trim() === ATTR)) {
    fs.writeFileSync(attrs, (cur && !cur.endsWith('\n') ? `${cur}\n` : cur) + `${ATTR}\n`);
  }
  git(root, ['config', 'core.hooksPath', '.githooks']);
  git(root, ['add', '--chmod=+x', '--', '.githooks/pre-commit']);
  return { ok: true, installed: true };
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const r = installGitHook(process.argv[2] || process.cwd());
  process.stdout.write(JSON.stringify(r) + '\n');
}
