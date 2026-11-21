// PostToolUse on Write and Edit: compare the edited file with the project map.
// A screen that the map does not know is a change, and Claude gets a note.
import path from 'node:path';
import { readInput, findProject, readJson, relative, emit, probeMark } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const file = input.tool_input && input.tool_input.file_path;
if (!file) process.exit(0);

const rel = relative(project.dir, file);
if (rel.startsWith('..')) process.exit(0); // a file outside the project

const map = readJson(path.join(project.dir, '.blueprint', 'map.json')) || {};
const screens = new Set((map.capabilities || []).flatMap((c) => c.screens || []));

const notes = [];
if (/^mockup\/.+\.html$/.test(rel) && !screens.has(rel)) {
  notes.push(
    `Focus Blueprint: the file ${rel} is a screen that the project map (.blueprint/map.json) does not list. ` +
      'A new screen is a change to the scope: it is recorded in the specification and in the map before more is built on it.'
  );
}

const tables = new Set((map.tables || []).map((t) => t && t.migration));
if (/^db\/migrations\/.+\.sql$/.test(rel) && !tables.has(rel)) {
  notes.push(`Focus Blueprint: the migration ${rel} is not listed in the project map (.blueprint/map.json, tables[].migration). Add the table to the map.`);
}
const copies = new Set((map.automations || []).map((a) => a && a.copy));
if (/^n8n\/.+\.json$/.test(rel) && !copies.has(rel)) {
  notes.push(`Focus Blueprint: the n8n export ${rel} is not listed in the project map (.blueprint/map.json, automations[].copy). Add the automation to the map.`);
}
if (rel === 'spec/prd.md' && Number(project.state.stage) >= 6) {
  notes.push('Focus Blueprint: PRD changed after the screens map: run /focus-blueprint:change');
}

const mark = probeMark('PostToolUse');
if (!notes.length && !mark) process.exit(0);

emit({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: (notes.join(' ') || `Focus Blueprint saw the edit of ${rel}.`) + mark,
  },
});
