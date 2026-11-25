// C15: this hook runs with "onFailure": "block" in hooks.json, so a crash, a missing script or a timeout
// stops the action instead of letting it through (the default is to let it go ahead).
// Source: https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails ("Requires Claude Code
// v2.1.295 or later"). The docs do not say what an older version does with the unknown field.
// PreToolUse on Write, Edit and MultiEdit: a secret does not go into a file that git tracks or would track.
// Only the new text is scanned. Secrets in files that git ignores are allowed. Read only.
import path from 'node:path';
import { readInput, findProjectForGuard, relative, runGit, emit } from './lib.mjs';
import { scanText, isPublicEnvName, isSecretishName } from '../scripts/blueprint-model/secrets.mjs';

const input = await readInput();
const project = findProjectForGuard(input);
if (!project) process.exit(0);

const ti = input.tool_input || {};
const file = ti.file_path;
if (!file) process.exit(0);
const rel = relative(project.dir, path.resolve(input.cwd || project.dir, file));
if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0);

const texts = [];
if (typeof ti.content === 'string') texts.push(ti.content);
if (typeof ti.new_string === 'string') texts.push(ti.new_string);
if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e && typeof e.new_string === 'string') texts.push(e.new_string);
if (!texts.length) process.exit(0);
const text = texts.join('\n');

const name = rel.split('/').pop();
const isEnv = /^\.env(\..+)?$/.test(name);
const isTemplate = /^\.env\.(example|sample|template)$/.test(name);
const ignored = () => runGit(project.dir, ['check-ignore', '-q', '--', rel]).status === 0;

const deny = (reason) => {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
  process.exit(0);
};
const WHERE = 'Keep the value in a .env.local file that .gitignore lists, read it from process.env in server code, and set it in the hosting service as an environment variable.';

if (isEnv) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !isPublicEnvName(m[1])) continue;
    const hits = scanText(line);
    if (hits.length) deny(`Blocked by Focus Blueprint: ${m[1]} is a public variable that the framework ships to the browser, and its value looks like a ${hits[0].name}. A public name never holds a secret. Rename it without the public prefix and keep it on the server. ${WHERE}`);
    if (isSecretishName(m[1])) deny(`Blocked by Focus Blueprint: ${m[1]} has a secret-looking name, but its prefix ships it to the browser. Rename it without the public prefix and keep it on the server. ${WHERE}`);
  }
  if (!isTemplate && !ignored()) {
    deny(`Blocked by Focus Blueprint: ${rel} is an env file that git does not ignore. Add it to .gitignore first (for example the line ".env*" with "!.env.example"), then write it.`);
  }
}

const hits = scanText(text, { file: rel });
if (hits.length && !ignored()) {
  const h = hits[0];
  deny(`Blocked by Focus Blueprint: the text for ${rel} contains a ${h.name} (line ${h.line} of the new text), and git does not ignore this file, so the value would reach the repository history. ${WHERE}`);
}
process.exit(0);
