// SessionStart: tell the user one line, and give Claude the project state.
// Outside a Blueprint project this prints nothing.
import { readInput, findProject, stages, stageInfo, termsAccepted, emit, probeMark } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const { dir, state } = project;
const total = stages().length;
const stage = stageInfo(state.stage);
const next = stageInfo(state.stage + 1);
const accepted = termsAccepted();

const stageText = stage ? `${state.stage} of ${total}, "${stage.name}", chapter "${stage.chapter}"` : `${state.stage} (unknown stage number)`;
const context = [
  `Focus Blueprint project "${state.project}". Project root: ${dir}.`,
  `Current stage: ${stageText}. Status: ${state.status || 'unknown'}.`,
  next ? `Next stage: ${next.n}, "${next.name}".` : 'This is the last stage.',
  'The state file is .blueprint/state.json. The entry command /focus-blueprint:blueprint reports the stage and continues from it.',
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
