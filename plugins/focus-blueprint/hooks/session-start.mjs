// SessionStart: tell the user one line, and give Claude the project state.
// Outside a Blueprint project this prints nothing.
import fs from 'node:fs';
import path from 'node:path';
import { readInput, findProject, stages, stageInfo, termsAccepted, haltedItems, haltedLine, unreportedRulings, gitInfo, emit, probeMark } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const { dir, state } = project;
const total = stages().length;
const stage = stageInfo(state.stage);
const next = stageInfo(state.stage + 1);
const accepted = termsAccepted();

const stageText = stage ? `${state.stage} of ${total}, "${stage.name}", chapter "${stage.chapter}"` : `${state.stage} (unknown stage number)`;
const git = gitInfo(dir);
const gitLine = git ? `Git: branch ${git.branch}, ${git.dirty} dirty files, ${git.days} days` : '';

let driftLine = '';
if (state.track !== 'static') {
  const last = state.lastDriftCheck ? Date.parse(state.lastDriftCheck) : NaN;
  if (Number.isNaN(last)) driftLine = 'Drift: last check: never, run /focus-blueprint:drift-check first';
  else if (Date.now() - last > 24 * 3600e3) driftLine = `Drift: last check: ${state.lastDriftCheck}, run /focus-blueprint:drift-check first`;
}

const rulings = unreportedRulings(project).length;
const rulingsLine = rulings ? `Rulings: ${rulings} unreported, run bp.mjs ruling list --unreported` : '';

let lastSession = '';
try {
  lastSession = fs.readFileSync(path.join(dir, '.blueprint', 'last-session.md'), 'utf8').split(/\r?\n/).slice(0, 30).join('\n').trim();
} catch {
  // No notes from the last session.
}

const context = [
  `Focus Blueprint project "${state.project}". Project root: ${dir}.`,
  `Current stage: ${stageText}. Status: ${state.status || 'unknown'}.`,
  next ? `Next stage: ${next.n}, "${next.name}".` : 'This is the last stage.',
  'The state file is .blueprint/state.json. The entry command /focus-blueprint:blueprint reports the stage and continues from it.',
  gitLine,
  driftLine,
  rulingsLine,
  ...haltedItems(project).map(haltedLine),
  lastSession ? `Last session notes (.blueprint/last-session.md):\n${lastSession}` : '',
  accepted
    ? ''
    : 'The terms of use have not been accepted on this machine yet. No stage runs before the user accepts them through the entry command.',
]
  .filter(Boolean)
  .join('\n');

const output = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context + probeMark('SessionStart'),
  },
};

// The line the user sees. After a compaction the conversation is already
// running, so only the context is refreshed.
if (input.source !== 'compact') {
  output.systemMessage = accepted
    ? `הכלי Focus Blueprint: הפרויקט "${state.project}" בשלב ${state.stage} מתוך ${total}${stage ? `, ${stage.name}` : ''}.`
    : 'הכלי Focus Blueprint ניתן לשימוש כמו שהוא, בלי אחריות. כל החלטה, תוצר, חשבון ותשלום הם באחריותך. לפני שמתחילים צריך לקרוא ולאשר את תנאי השימוש.';
}

emit(output);
