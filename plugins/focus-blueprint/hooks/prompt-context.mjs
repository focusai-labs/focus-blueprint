// UserPromptSubmit: a short factual reminder that travels with every prompt,
// so a change asked for in plain conversation is not built past the documents.
// Stages 9 to 12 add the line about not asking "continue?"; a halted item adds its own line.
import { readInput, findProject, stageInfo, haltedItems, haltedLine, emit, probeMark } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const { state } = project;
const stage = stageInfo(state.stage);
const lines = [`Focus Blueprint: שלב ${state.stage}, ${stage ? stage.name : '?'}. שינוי בהיקף עובר דרך /blueprint.`];
if (state.stage >= 9 && state.stage <= 12) {
  lines.push(
    'בשלב הזה לא שואלים אם להמשיך. מכריעים, ורושמים כל הכרעה ב-bp.mjs ruling add. עוצרים ושואלים רק לפני מחיקת נתונים, לפני שינוי בהרשאות או במפתחות, לפני פעולה שעולה כסף או עולה לאוויר, או כשכל דרך בתוכנית היא ניחוש.'
  );
}
for (const item of haltedItems(project)) lines.push(haltedLine(item));

emit({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: lines.join('\n') + probeMark('UserPromptSubmit'),
  },
});
