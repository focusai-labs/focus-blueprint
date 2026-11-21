// Stop: when the state changed since the last session summary, ask Claude to write
// .blueprint/last-session.md. Carries the last stage close and the rulings the student
// has not seen. Read only: no file is written here, and a broken file is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { readInput, findProject, unreportedRulings, emit } from './lib.mjs';

const MAX_CHARS = 2900;
const MAX_RULINGS = 10;
const WORDS = { done: 'גמור', done_with_concerns: 'גמור עם ספקות', blocked: 'תקוע', needs_context: 'חסר מידע' };

const input = await readInput();
if (input.stop_hook_active === true) process.exit(0);
const project = findProject(input);
if (!project) process.exit(0);

const mtime = (file) => {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
};
const stateTime = mtime(path.join(project.dir, '.blueprint', 'state.json'));
const summaryTime = mtime(path.join(project.dir, '.blueprint', 'last-session.md'));
if (stateTime === null || (summaryTime !== null && summaryTime >= stateTime)) process.exit(0);

const cut = (value, max) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

/** The current stage's close, else the highest-numbered stage that has one. */
function lastClose(state) {
  const st = state.stages && typeof state.stages === 'object' ? state.stages : {};
  const has = (n) => st[n] && st[n].close && WORDS[st[n].close.status];
  if (has(state.stage)) return { n: state.stage, close: st[state.stage].close };
  const closed = Object.keys(st).filter((n) => has(n)).sort((a, b) => Number(b) - Number(a));
  return closed.length ? { n: Number(closed[0]), close: st[closed[0]].close } : null;
}

const lines = ['הכלי Focus Blueprint: קובץ המצב השתנה מאז הסיכום האחרון. לפני שמסיימים, כתבו את .blueprint/last-session.md בעברית, עד 30 שורות, בשלושה חלקים: מה נעשה, מה פתוח ומה הצעד הבא.'];

const last = lastClose(project.state);
if (last) {
  const { status, note } = last.close;
  const text = cut(note, 300);
  const open = status === 'blocked' || status === 'needs_context';
  lines.push(`סגירת השלב האחרון: שלב ${last.n}, ${WORDS[status]}. ${open ? `השלב עוד לא גמור, וזה מה שנדרש מהסטודנט: ${text}` : text}`.trimEnd());
}

const rulings = unreportedRulings(project).slice().reverse();
const build = (shown) => {
  const out = lines.slice();
  if (!rulings.length) {
    out.push('אין הכרעות חדשות.');
  } else {
    out.push(`הכרעות שעוד לא הוצגו לסטודנט (${rulings.length}):`);
    for (const r of rulings.slice(0, shown)) {
      out.push(`- הוחלט: ${cut(r.decision, 100)}. למה: ${cut(r.why, 100)}. המחיר אם זה שגוי: ${cut(r.priceIfWrong, 100)}. שלב ${r.stage}.`);
    }
    if (rulings.length > shown) out.push(`יש עוד ${rulings.length - shown} הכרעות שלא מוצגות כאן.`);
    out.push('כוללים אותן בסיכום, ואחרי שהסטודנט ראה אותן מריצים bp.mjs ruling report.');
  }
  return out.join('\n');
};

let shown = Math.min(MAX_RULINGS, rulings.length);
let text = build(shown);
while (text.length > MAX_CHARS && shown > 0) text = build(--shown);
if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1) + '…';

emit({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } });
