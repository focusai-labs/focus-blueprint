// The plugin files that live inside a student's project, so the commit gate and CI run without the plugin.
// One function serves `bp init` and `bp update`, so the two cannot drift.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { installGitHook } from './install-git-hook.mjs';

const sha = (file) => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

/** The [pluginFile, projectRelativePath] pairs the project holds a copy of. */
export function projectCopies(plugin) {
  const pairs = [
    [path.join(plugin, 'scripts', 'check-map.mjs'), 'scripts/blueprint-check.mjs'],
    [path.join(plugin, 'data', 'dimensions.json'), '.blueprint/dimensions.json'],
    [path.join(plugin, 'templates', 'github', 'blueprint-check.yml'), '.github/workflows/blueprint-check.yml'],
  ];
  const model = path.join(plugin, 'scripts', 'blueprint-model');
  if (fs.existsSync(model)) for (const f of walk(model)) pairs.push([path.join(model, f), `scripts/blueprint-model/${f}`]);
  return pairs.filter(([src]) => fs.existsSync(src));
}

/** Project copies whose content differs from the plugin's (a missing copy counts). */
export function staleCopies(plugin, dir) {
  const scoped = projectCopies(plugin).filter(([, rel]) => rel.startsWith('scripts/'));
  // A missing or unreadable project copy stays silent.
  return scoped.filter(([src, rel]) => { const mine = sha(path.join(dir, rel)); return mine !== null && sha(src) !== mine; }).map(([, rel]) => rel);
}

/** Copy the files and re-run the git hook installer. Returns the project paths that changed. */
export function syncProjectFiles(plugin, dir) {
  const changed = [];
  for (const [src, rel] of projectCopies(plugin)) {
    const to = path.join(dir, rel);
    if (sha(src) === sha(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to);
    changed.push(rel);
  }
  const hook = installGitHook(dir);
  return { changed, gitHook: hook.installed };
}
