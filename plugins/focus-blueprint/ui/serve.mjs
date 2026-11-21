// Command line entry of the local page server.
//   node serve.mjs --project <folder> [--once] [--no-open]
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

const ui = await startUi({ projectDir, once });
console.log(`URL ${ui.url}`);
if (!noOpen) openBrowser(ui.url);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => ui.close());
await ui.closed;
