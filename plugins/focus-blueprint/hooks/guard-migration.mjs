// PreToolUse on the Supabase apply_migration tool: a schema change goes through
// a migration file in the repository, and the SQL that runs is that file.
import fs from 'node:fs';
import path from 'node:path';
import { readInput, findProject, block } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const toolInput = input.tool_input || {};
const query = String(toolInput.query || '');
const normalize = (sql) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();

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
