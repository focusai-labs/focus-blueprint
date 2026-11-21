// PreToolUse on Bash and PowerShell: no commit straight onto main.
// The check is best effort: it reads the command text, so it guards the
// commits Claude makes, which is how the people this tool is for work.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readInput, findProject, block, PROTECTED_BRANCHES } from './lib.mjs';

const input = await readInput();
const project = findProject(input);
if (!project) process.exit(0);

const command = String((input.tool_input && input.tool_input.command) || '');

// "git commit", also with options before the subcommand: git -C dir commit, git -c k=v commit.
const match = command.match(/(?:^|[\s;&|(`])git((?:\s+-\S+(?:\s+[^\s-]\S*)?)*)\s+commit(?=$|[\s;&|)`])/);
if (!match) process.exit(0);

let cwd = input.cwd || project.dir;
const dashC = match[1].match(/\s-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
if (dashC) cwd = path.resolve(cwd, dashC[1] || dashC[2] || dashC[3]);

const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const branch = (git(['symbolic-ref', '--short', '-q', 'HEAD']).stdout || '').trim();
if (!PROTECTED_BRANCHES.includes(branch)) process.exit(0);

// The very first commit of a new repository has nowhere else to go.
const hasCommits = git(['rev-parse', '--verify', '-q', 'HEAD']).status === 0;
if (!hasCommits) process.exit(0);

block(
  `Blocked by Focus Blueprint: this project does not take commits directly on "${branch}". ` +
    `Create a branch for the current work (for example: git switch -c stage-${project.state.stage}), ` +
    'commit there, and merge it through a pull request.'
);
