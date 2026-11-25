// C15: this hook runs with "onFailure": "block" in hooks.json, so a crash, a missing script or a timeout
// stops the action instead of letting it through (the default is to let it go ahead).
// Source: https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails ("Requires Claude Code
// v2.1.295 or later"). The docs do not say what an older version does with the unknown field.
// PreToolUse on Bash and PowerShell: no commit or merge straight onto main,
// no push of a secret file, no force push to or deletion of a protected branch.
// git pull and git rebase on main stay allowed: pulling main after a pull request
// was merged on GitHub is the normal flow.
// The check is best effort: it reads the command text, so it guards the
// commits Claude makes, which is how the people this tool is for work.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readInput, findProjectForGuard, block, emit, PROTECTED_BRANCHES, supabaseTarget } from './lib.mjs';
import { checkCommand, needsApproval, ASK_MSG, MAIN_PUSH_MSG } from './shell-rules.mjs';

const input = await readInput();
const project = findProjectForGuard(input);
if (!project) process.exit(0);

const command = String((input.tool_input && input.tool_input.command) || '');

const denied = checkCommand(command, supabaseTarget(project));
if (denied) block(denied);

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
        `Create a branch for the current work (for example: git switch -c stage-${project.state.stage ? String(project.state.stage).padStart(2, '0') : 'NN'}), ` +
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
  // A push whose destination ref is main or master, whatever the source is called.
  const unq = (t) => t.replace(/^["']+|["']+$/g, '');
  const VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
  const args = [];
  for (let i = 0; i < tokens.length; i++) {
    if (VALUE_OPTS.has(tokens[i])) { i++; continue; }
    if (!tokens[i].startsWith('-')) args.push(unq(tokens[i]));
  }
  const branchNow = currentBranch(git);
  const remote = args[0] || (branchNow ? (git(['config', `branch.${branchNow}.remote`]).stdout || '').trim() || 'origin' : null);
  const refspecs = args.slice(1);
  const tracked = (name) => !!remote && git(['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${name}`]).status === 0;
  const destinations = refspecs.length ? refspecs : (remote && branchNow ? [branchNow] : []);
  if (!deleting && !flags.includes('--all') && !mirror) {
    for (const t of destinations) {
      if (t.startsWith(':')) continue;
      const spec = t.replace(/^\+/, '');
      const [src, dst0] = spec.includes(':') ? [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)] : [spec, spec];
      const dst = (dst0 === 'HEAD' ? branchNow : dst0).replace(/^refs\/heads\//, '');
      if (!isProtected(dst)) continue;
      // The first push of a new repository: main goes to a remote that has no main yet.
      const srcName = (src === 'HEAD' ? branchNow : src).replace(/^refs\/heads\//, '');
      if (srcName === dst && branchNow === dst && !tracked(dst)) continue;
      block(MAIN_PUSH_MSG);
    }
  }
  if (forced && (mirror || isProtected(currentBranch(git)) || positional.some((t) => isProtected(destOf(t))))) {
    block(
      'Blocked by Focus Blueprint: a force push that can rewrite a protected branch (main or master) is not run. ' +
        'Work on a branch and merge through a pull request; history of main is never rewritten.'
    );
  }
}

// C6: nothing above blocked it; outward actions still wait for the student's yes.
if (needsApproval(command)) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: ASK_MSG } });
}
