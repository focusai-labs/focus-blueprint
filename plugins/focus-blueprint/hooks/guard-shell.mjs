// PreToolUse on Bash and PowerShell: no commit or merge straight onto main,
// no push of a secret file, no force push to or deletion of a protected branch.
// git pull and git rebase on main stay allowed: pulling main after a pull request
// was merged on GitHub is the normal flow.
// The check is best effort: it reads the command text, so it guards the
// commits Claude makes, which is how the people this tool is for work.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readInput, findProjectForGuard, block, PROTECTED_BRANCHES } from './lib.mjs';

const input = await readInput();
const project = findProjectForGuard(input);
if (!project) process.exit(0);

const command = String((input.tool_input && input.tool_input.command) || '');

const SECRET_PATTERNS = [/(^|\/)\.env(\..*)?$/i, /\.pem$/i, /key[^/]*\.json$/i];
const TEMPLATE = /\.(example|sample|template)$/i;
const isProtected = (name) => PROTECTED_BRANCHES.includes(name);

/** Every "git <sub>" in the command (also quoted, absolute, or with options before the subcommand). */
function findAllGit(sub) {
  const re = new RegExp(`(?:^|[\\s;&|(\`'"/\\\\])git((?:\\s+-\\S+(?:\\s+[^\\s-]\\S*)?)*)\\s+${sub}(?=$|[\\s;&|)\`'"])([^;&|\\n]*)`, 'g');
  return [...command.matchAll(re)].map((m) => ({ opts: m[1], rest: m[2] || '', index: m.index }));
}

// A switch to main or master earlier in the command: the later merge or commit lands there.
const SWITCH_TO_PROTECTED = /git(?:\s+-\S+(?:\s+[^\s-]\S*)?)*\s+(?:(?:switch|checkout)(?:\s+-\S+)*|branch\s+-[fF]\S*)\s+(?:main|master)(?=$|[\s;&|)`'"])/g;
const switchesBefore = (index) => [...command.matchAll(SWITCH_TO_PROTECTED)].some((m) => m.index < index);

function cwdFor(opts) {
  let cwd = input.cwd || project.dir;
  const dashC = opts.match(/\s-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (dashC) cwd = path.resolve(cwd, dashC[1] || dashC[2] || dashC[3]);
  return cwd;
}
const gitIn = (cwd) => (args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const currentBranch = (git) => (git(['symbolic-ref', '--short', '-q', 'HEAD']).stdout || '').trim();
const landsOnProtected = (git, g) => isProtected(currentBranch(git)) || switchesBefore(g.index);
const branchLabel = (git, g) => (isProtected(currentBranch(git)) ? currentBranch(git) : 'main');

for (const g of findAllGit('commit')) {
  const git = gitIn(cwdFor(g.opts));
  // The very first commit of a new repository has nowhere else to go.
  if (landsOnProtected(git, g) && git(['rev-parse', '--verify', '-q', 'HEAD']).status === 0) {
    block(
      `Blocked by Focus Blueprint: this project does not take commits directly on "${branchLabel(git, g)}". ` +
        `Create a branch for the current work (for example: git switch -c stage-${project.state.stage || 'N'}), ` +
        'commit there, and merge it through a pull request.'
    );
  }
}

const merges = findAllGit('merge');
const isAbort = (g) => /(^|\s)--abort(\s|$)/.test(g.rest);
if (merges.length && !merges.every(isAbort)) {
  for (const g of merges.filter((x) => !isAbort(x))) {
    const git = gitIn(cwdFor(g.opts));
    if (landsOnProtected(git, g)) {
      block(
        `Blocked by Focus Blueprint: this project does not merge directly on "${branchLabel(git, g)}". ` +
          'Open a pull request for the branch and merge it there after the check passes.'
      );
    }
  }
}

for (const g of findAllGit('push')) {
  const git = gitIn(cwdFor(g.opts));
  const list = (args) => (git(['-c', 'core.quotepath=off', ...args]).stdout || '').split('\0');
  const files = [...new Set([...list(['ls-files', '-z']), ...list(['diff', '--cached', '--name-only', '-z'])])];
  const secrets = files.filter((f) => f && !TEMPLATE.test(f) && SECRET_PATTERNS.some((re) => re.test(f)));
  if (secrets.length) {
    block(
      `Blocked by Focus Blueprint: git push would publish files that look like secrets: ${secrets.slice(0, 5).join(', ')}. ` +
        'Remove them from git (git rm --cached <file>), add them to .gitignore, rotate the key if it was ever committed, and push again.'
    );
  }

  const tokens = g.rest.split(/\s+/).filter(Boolean);
  const flags = tokens.filter((t) => t.startsWith('-'));
  const positional = tokens.filter((t) => !t.startsWith('-'));
  const mirror = flags.includes('--mirror') || (flags.includes('--all') && (flags.some((t) => /^--force(-with-lease(=.*)?)?$|^-[a-zA-Z]*f[a-zA-Z]*$/.test(t)) || positional.some((t) => t.startsWith('+'))));
  const deleting = flags.includes('--delete') || flags.some((t) => /^-[a-zA-Z]*d[a-zA-Z]*$/.test(t));
  // Destination side of src:dst, without + and refs/heads/.
  const destOf = (t) => t.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '');
  const forced =
    mirror ||
    flags.some((t) => /^--force(-with-lease(=.*)?)?$/.test(t) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t)) ||
    positional.some((t) => t.startsWith('+'));
  const deletesProtected = positional.some((t) => (t.startsWith(':') || deleting) && isProtected(destOf(t)));
  if (deletesProtected) {
    block('Blocked by Focus Blueprint: deleting the protected branch main or master on the remote is not run. Ask the owner first.');
  }
  if (forced && (mirror || isProtected(currentBranch(git)) || positional.some((t) => isProtected(destOf(t))))) {
    block(
      'Blocked by Focus Blueprint: a force push that can rewrite a protected branch (main or master) is not run. ' +
        'Work on a branch and merge through a pull request; history of main is never rewritten.'
    );
  }
}
