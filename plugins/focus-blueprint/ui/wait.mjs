// Wait until the user saves an answer in the local page, then print it.
//   node wait.mjs --project <folder> --name <answer name> [--timeout <seconds>]
// Exit 0 with the answer as JSON, or exit 3 with the word TIMEOUT.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const projectDir = path.resolve(value('--project', process.cwd()));
const name = value('--name', 'probe');
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

const deadline = Date.now() + timeoutMs;
for (;;) {
  try {
    if (fs.statSync(file).mtimeMs >= since - 1000) {
      process.stdout.write(fs.readFileSync(file, 'utf8'));
      process.exit(0);
    }
  } catch {
    // Not saved yet.
  }
  if (Date.now() > deadline) {
    process.stdout.write('TIMEOUT');
    process.exit(3);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
