// C3: the files that run the check. Claude does not write, move, delete or re-point them;
// they change only through the tool (bp update, bp init, bp githook install), which writes through Node.
// Pure helpers, no disk access.

export const CHECKER_MSG = 'את הקבצים של הבדיקה משנים רק דרך הכלי, בפקודה bp update, כדי שהבדיקה לא תיכבה בלי שאף אחד ירגיש.';

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^["']+|["']+$/g, '').replace(/\/{2,}/g, '/');
const FILE_RES = [
  /(^|\/)\.githooks\/pre-commit$/i,
  /(^|\/)scripts\/blueprint-check\.mjs$/i,
  /(^|\/)scripts\/blueprint-model(\/|$)/i,
  /(^|\/)\.github\/workflows\/blueprint-check\.yml$/i,
];
// Folders that hold them: removing or moving the whole folder switches the check off too.
const DIR_RES = [/(^|\/)\.githooks\/?$/i, /(^|\/)scripts\/?$/i, /(^|\/)\.github(\/workflows)?\/?$/i];

/** True when the path (relative or absolute, any slash style) is one of the check's own files. */
export function isCheckerFile(p) {
  const n = norm(p).replace(/\/\.\//g, '/').replace(/^\.\//, '');
  return FILE_RES.some((re) => re.test(n));
}

/** True when the path is a folder that contains the check's files (for rm and mv only). */
export function isCheckerDir(p) {
  const n = norm(p).replace(/\/\.\//g, '/').replace(/^\.\//, '');
  return DIR_RES.some((re) => re.test(n));
}
