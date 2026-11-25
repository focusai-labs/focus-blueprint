// Command line entry of the local page server.
//   node serve.mjs --project <folder> [--page brain-dump|questionnaire|directions|board|process|prototype]
//                  [--round context|a|b|c|d] [--screens a,b] [--once] [--no-open]
// Prints one line, "URL <address>", and keeps running until it is idle or stopped.
import path from 'node:path';
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

if (page && !['brain-dump', 'questionnaire', 'directions', 'board', 'process', 'prototype'].includes(page)) {
  console.error(`serve: unknown page "${page}"`);
  process.exit(1);
}

const ui = await startUi({ projectDir, once });
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
