// C15: this hook runs with "onFailure": "block" in hooks.json, so a crash, a missing script or a timeout
// stops the action instead of letting it through (the default is to let it go ahead).
// Source: https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails ("Requires Claude Code
// v2.1.295 or later"). The docs do not say what an older version does with the unknown field.
// PreToolUse on every mutating Supabase MCP tool, on any server name. In a Blueprint project the database
// changes only through a migration file made by `supabase migration new`, tested on a dev target and deployed
// by the merge. The only call that passes is execute_sql whose SQL is read-only.
import { readInput, findProjectForGuard, sanitizeSql, block } from './lib.mjs';

const input = await readInput();
const project = findProjectForGuard(input);
if (!project) process.exit(0);

const toolInput = input.tool_input || {};
const query = String(toolInput.query || toolInput.sql || '');
const tool = String(input.tool_name || '').split('__').pop();
const clean = sanitizeSql(query);

const GIT_PATH =
  'Schema changes go through Git: create the file with "supabase migration new <name>" in supabase/migrations, test it on a dev target ' +
  '(local stack, a branch or a dev project: supabase db push --remote=<dev> --yes), commit it, and open a pull request. The merge deploys it to production.';

/** Read-only: every statement starts with select, explain, show, values or table, or is a with that holds no insert, update, delete or merge. */
function readOnly(sql) {
  const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
  return stmts.every((st) => {
    const first = (st.match(/^\(*\s*([a-z]+)/i) || [])[1];
    const f = String(first || '').toLowerCase();
    if (f === 'with') return !/\b(?:insert|update|delete|merge)\b/i.test(st);
    if (['select', 'values', 'table'].includes(f)) return !/\binto\b/i.test(st) && !/\bfor\s+(?:update|share|no\s+key\s+update|key\s+share)\b/i.test(st);
    if (f === 'explain') return !/\b(?:insert|update|delete|merge)\b/i.test(st);
    if (f === 'show') return true;
    return false;
  });
}

const additiveBreak = () => {
    if (/\bdrop\b|\btruncate\b/i.test(clean)) return true;
    for (const stmt of clean.split(';')) {
      if (/\bdelete\s+from\b/i.test(stmt) && !/\bwhere\b/i.test(stmt)) return true;
      if (/\balter\b/i.test(stmt) && /\brename\b/i.test(stmt)) return true;
      if (/\balter\s+(?:column\s+)?\S+\s+(?:set\s+data\s+)?type\b/i.test(stmt)) return true;
    }
    return false;
  };
if (project.state.live === true && additiveBreak()) {
  block('Blocked by Focus Blueprint: this project is live, and after launch the database changes are additive only (no drops, truncates, deletes without a where, renames or type changes). A removal is a two-step migration: add the new thing, move the data, remove the old thing later, and ask the student before the removal step. ' + GIT_PATH);
}

if (tool === 'execute_sql') {
  if (readOnly(clean)) process.exit(0);
  block('Blocked by Focus Blueprint: execute_sql runs only read-only SQL (select, explain, show, values, table, or a with that does not write) in this project. ' + GIT_PATH);
}

block(`Blocked by Focus Blueprint: the Supabase tool ${tool} changes a hosted project and is not run by the agent in this project. ` + GIT_PATH);
