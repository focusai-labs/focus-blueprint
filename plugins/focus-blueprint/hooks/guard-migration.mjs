// PreToolUse on the Supabase apply_migration and execute_sql tools: a schema
// change goes through a migration file in the repository, and the SQL that runs
// is that file. After launch (state.live) only additive SQL runs at all.
// The SQL is scanned after strings and comments are blanked out (sanitizeSql).
import fs from 'node:fs';
import path from 'node:path';
import { readInput, findProjectForGuard, sanitizeSql, block } from './lib.mjs';

const input = await readInput();
const project = findProjectForGuard(input);
if (!project) process.exit(0);

const toolInput = input.tool_input || {};
const query = String(toolInput.query || toolInput.sql || '');
const toolName = String(input.tool_name || '');
const normalize = (sql) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
const clean = sanitizeSql(query);

const OBJECTS =
  'table|policy|function|procedure|view|schema|type|trigger|index|extension|sequence|role|user|database|publication|domain|rule|owned|system|default\\s+privileges|event\\s+trigger';
const DDL = new RegExp(
  `\\b(?:create\\s+(?:or\\s+replace\\s+)?(?:(?:temp|temporary|unlogged)\\s+)?(?:unique\\s+)?(?:materialized\\s+)?|drop\\s+(?:materialized\\s+)?|alter\\s+(?:materialized\\s+)?)(?:${OBJECTS})\\b` +
    '|(?:^|;)\\s*(?:grant|revoke|truncate|comment\\s+on|do)\\b',
  'i'
);

// After launch: no drop, no truncate, no delete without where, no rename, no column type change.
const nonAdditive = () => {
  if (/\bdrop\b|\btruncate\b/i.test(clean)) return true;
  for (const stmt of clean.split(';')) {
    if (/\bdelete\s+from\b/i.test(stmt) && !/\bwhere\b/i.test(stmt)) return true;
    if (/\balter\b/i.test(stmt) && /\brename\b/i.test(stmt)) return true;
    if (/\balter\s+(?:column\s+)?\S+\s+(?:set\s+data\s+)?type\b/i.test(stmt)) return true;
  }
  return false;
};

if (project.state.live === true && nonAdditive()) {
  block(
    'Blocked by Focus Blueprint: this project is live, and after launch the database changes are additive only. ' +
      'Drops, truncates, deletes without a where, renames and column type changes are not run. ' +
      'The change needs a two-step migration: add the new thing, move the data, and remove the old thing later. ' +
      'Ask the student before the removal step.'
  );
}

if (/execute_sql$/.test(toolName)) {
  if (!DDL.test(clean)) process.exit(0);
  block(
    'Blocked by Focus Blueprint: a schema change does not run through execute_sql. ' +
      'Save the SQL as a file under db/migrations/ first, then apply exactly the content of that file with apply_migration.'
  );
}

const dir = path.join(project.dir, 'db', 'migrations');
let found = false;
try {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.sql')) continue;
    if (normalize(fs.readFileSync(path.join(dir, name), 'utf8')) === normalize(query)) {
      found = true;
      break;
    }
  }
} catch {
  // No migrations folder yet: nothing matches.
}
if (found && query.trim()) process.exit(0);

const suggested = String(toolInput.name || 'change').replace(/[^a-z0-9_]+/gi, '_');
block(
  'Blocked by Focus Blueprint: this schema change has no matching migration file in the repository. ' +
    `Save the SQL as a file under db/migrations/ first (for example db/migrations/<timestamp>_${suggested}.sql), ` +
    'then apply exactly the content of that file.'
);
