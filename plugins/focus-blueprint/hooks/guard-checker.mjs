// PreToolUse on Write, Edit, MultiEdit and NotebookEdit: Claude does not rewrite the files that run the check (C3).
// Silent outside a Blueprint project. The tool itself writes these files through Node, not through Claude's tools.
import path from 'node:path';
import { readInput, findProjectForGuard, block } from './lib.mjs';
import { isCheckerFile, CHECKER_MSG } from './checker-files.mjs';

const input = await readInput();
const project = findProjectForGuard(input);
if (!project) process.exit(0);

const ti = input.tool_input || {};
const file = ti.file_path || ti.notebook_path || ti.path;
if (typeof file !== 'string' || !file) process.exit(0);
const abs = path.resolve(input.cwd || project.dir, file);
const rel = path.relative(project.dir, abs).split(path.sep).join('/');
if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0);
if (isCheckerFile(rel)) block(CHECKER_MSG);
process.exit(0);
