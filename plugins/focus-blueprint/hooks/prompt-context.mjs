// UserPromptSubmit: a short factual reminder that travels with every prompt,
// so a change asked for in plain conversation is not built past the documents.
// Stages 9 to 12 add the line about not asking "continue?"; a halted item adds its own line.
import { readInput, findProject, stageInfo, haltedItems, haltedLine, emit, probeMark } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const { state } = project;
const stage = stageInfo(state.stage);
const lines = [`הפרויקט בשלב ${state.stage} מתוך 15, ${stage ? stage.name : '?'}. שינוי בהיקף עובר דרך /blueprint.`];
if (state.stage >= 9 && state.stage <= 12) {
  lines.push(
    'זה שלב בנייה, ולכן כל הכרעה נרשמת ביומן ההכרעות (bp.mjs ruling add), והעבודה נעצרת לשאלה רק לפני מחיקת נתונים, לפני שינוי בהרשאות או במפתחות, לפני פעולה שעולה כסף או מעלה משהו לאוויר, וכשאי אפשר להמשיך בלי לנחש.'
  );
}
for (const item of haltedItems(project)) lines.push(haltedLine(item));

emit({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: lines.join('\n') + probeMark('UserPromptSubmit'),
  },
});
