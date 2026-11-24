// SessionStart: tell the user one line, and give Claude the project state.
// Outside a Blueprint project this prints nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInput, findProject, stages, stageInfo, termsAccepted, haltedItems, haltedLine, unreportedRulings, gitInfo, emit, probeMark, readJson, runGit } from './lib.mjs';

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

const hooksPath = git ? runGit(dir, ['config', '--get', 'core.hooksPath']).stdout.trim() : '.githooks';
const hookLine = git && hooksPath !== '.githooks'
  ? `Git hook: core.hooksPath is not .githooks in this clone, so the commit gate does not run. Run: node "${path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bp.mjs')}" githook install --project "${dir}"`
  : '';

/** Supabase MCP connections that see every project of the account. Silent on any read error. */
function unscopedSupabase() {
  const found = [];
  const home = os.homedir();
  const scan = (servers, where) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [name, def] of Object.entries(servers)) {
      const url = def && typeof def.url === 'string' ? def.url : '';
      if (/mcp\.supabase\.com/i.test(url) && !/[?&]project_ref=/i.test(url)) found.push(`${name} (${where})`);
    }
  };
  try {
    const cj = readJson(path.join(home, '.claude.json'));
    if (cj) {
      scan(cj.mcpServers, '~/.claude.json');
      const proj = cj.projects && (cj.projects[dir] || cj.projects[dir.split(path.sep).join('/')]);
      if (proj) scan(proj.mcpServers, '~/.claude.json project');
    }
    const mj = readJson(path.join(dir, '.mcp.json'));
    if (mj) scan(mj.mcpServers, '.mcp.json');
    const ip = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
    if (ip && ip.plugins && typeof ip.plugins === 'object') {
      for (const key of Object.keys(ip.plugins)) {
        const [pname, market] = key.split('@');
        if (pname === 'supabase' && market !== 'supabase-agent-skills') found.push(`plugin ${key}`);
      }
    }
  } catch {
    return [];
  }
  return found;
}
const unscoped = unscopedSupabase();
const unscopedLine = unscoped.length
  ? `Supabase MCP: ${unscoped.join(', ')} has no project_ref, so it sees every project of the account. This project works only with a connection scoped to one project (project_ref and read_only in the URL). Tell the student to disable the unscoped connection here through /mcp, and never call its tools.`
  : '';

const context = [
  `Focus Blueprint project "${state.project}". Project root: ${dir}.`,
  `Current stage: ${stageText}. Status: ${state.status || 'unknown'}.`,
  next ? `Next stage: ${next.n}, "${next.name}".` : 'This is the last stage.',
  'The state file is .blueprint/state.json. The entry command /focus-blueprint:blueprint reports the stage and continues from it.',
  gitLine,
  hookLine,
  unscopedLine,
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

if (unscoped.length) {
  const note = 'יש כאן חיבור ל-Supabase שרואה את כל הפרויקטים בחשבון. בפרויקט הזה עובדים רק עם חיבור שמוגבל לפרויקט אחד, ולכן כדאי לכבות את החיבור הזה כאן דרך /mcp.';
  output.systemMessage = output.systemMessage ? `${output.systemMessage}\n${note}` : note;
}

emit(output);
