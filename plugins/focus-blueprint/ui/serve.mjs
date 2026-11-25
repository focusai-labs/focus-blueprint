// Command line entry of the local page server.
//   node serve.mjs --project <folder> [--page brain-dump|questionnaire|directions|board|process]
//                  [--round context|a|b|c|d] [--screens a,b] [--once] [--no-open] [--detach]
// Prints one line, "URL <address>", and keeps running until it is idle or stopped.
// With --detach the server runs as a detached child (log in .blueprint/ui/serve.log); this
// command prints the same line and exits 0 at once, so the conversation is not blocked.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startUi, openBrowser } from './server.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const projectDir = path.resolve(value('--project') || process.cwd());
const once = args.includes('--once');
const noOpen = args.includes('--no-open') || Boolean(process.env.FOCUS_BLUEPRINT_NO_OPEN);
const page = value('--page');
const round = value('--round');
const screens = value('--screens');

if (page && !['brain-dump', 'questionnaire', 'directions', 'board', 'process'].includes(page)) {
  console.error(`serve: unknown page "${page}"`);
  process.exit(1);
}

if (args.includes('--detach')) {
  const logDir = path.join(projectDir, '.blueprint', 'ui');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'serve.log');
  const fd = fs.openSync(logFile, 'w');
  const childArgs = [fileURLToPath(import.meta.url), ...args.filter((a) => a !== '--detach')];
  if (!args.includes('--project')) childArgs.push('--project', projectDir);
  const child = spawn(process.execPath, childArgs, { detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
  let spawnError = null;
  let exited = null;
  child.on('error', (e) => { spawnError = e; });
  child.on('exit', (code) => { exited = code; });
  child.unref();
  fs.closeSync(fd);
  const deadline = Date.now() + 20000;
  let url = null;
  while (Date.now() < deadline && !url && !spawnError && exited === null) {
    await new Promise((r) => setTimeout(r, 50));
    const m = fs.readFileSync(logFile, 'utf8').match(/^URL .+$/m);
    if (m) url = m[0].trim();
  }
  if (!url) {
    console.error(`serve: the server did not start${spawnError ? `: ${spawnError.message}` : ''}. See ${logFile}`);
    try { child.kill(); } catch { /* already gone */ }
    process.exit(1);
  }
  console.log(url);
  process.exit(0);
}

const ui = await startUi({ projectDir, once, page, round, screens });
let target = ui.url;
if (page) {
  const q = new URLSearchParams();
  if (round) q.set('round', round);
  if (screens) q.set('screens', screens);
  target += page + (q.size ? `?${q}` : '');
}
console.log(`URL ${target}`);
if (!noOpen) openBrowser(target);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => ui.close());
await ui.closed;
