// Wait until the user saves in the local page, then print the saved file.
//   node wait.mjs --project <folder> --name <answer name> [--until done] [--timeout <seconds>]
// Without --until: exit 0 as soon as the file was saved after the server started.
// With --until done: exit 0 only when the file says done: true; progress goes to stderr
// ("answered: 7/22") whenever it changes. Exit 3 with the word TIMEOUT otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { progress } from './lib.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const projectDir = path.resolve(value('--project', process.cwd()));
const name = value('--name', 'probe');
const until = value('--until', '');
const timeoutMs = Number(value('--timeout', '280')) * 1000;

const uiDir = path.join(projectDir, '.blueprint', 'ui');
const file = path.join(uiDir, 'answers', `${name}.json`);

// An answer counts only if it was saved after the server now running started.
let since = 0;
try {
  since = JSON.parse(fs.readFileSync(path.join(uiDir, 'server.json'), 'utf8')).startedAt || 0;
} catch {
  // No server file: accept any answer.
}

let lastLine = '';
const deadline = Date.now() + timeoutMs;
for (;;) {
  try {
    if (fs.statSync(file).mtimeMs >= since - 1000) {
      if (until === 'done') {
        const p = progress(projectDir, name);
        const line = `answered: ${p.answered}${p.total != null ? `/${p.total}` : ''}`;
        if (line !== lastLine) {
          process.stderr.write(`${line}\n`);
          lastLine = line;
        }
        if (p.done) {
          process.stdout.write(fs.readFileSync(file, 'utf8'));
          process.exit(0);
        }
      } else {
        process.stdout.write(fs.readFileSync(file, 'utf8'));
        process.exit(0);
      }
    }
  } catch {
    // Not saved yet, or being replaced.
  }
  if (Date.now() > deadline) {
    process.stdout.write('TIMEOUT');
    process.exit(3);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
