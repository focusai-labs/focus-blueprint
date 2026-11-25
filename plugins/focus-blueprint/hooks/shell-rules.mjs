// Pure command rules for guard-shell: git hook bypasses and the Supabase CLI rules (C9).
// checkCommand returns an English reason when the command must be denied, else null.
// Nothing here touches the disk; the caller passes in what it read from the map.

/** Split a command line into segments of tokens. Quotes are removed, separators are ; & | ( ) ` and newlines. */
export function tokenize(command) {
  const segments = [];
  let tokens = [];
  let cur = '';
  let has = false;
  let quote = null;
  const endToken = () => { if (has) tokens.push(cur); cur = ''; has = false; };
  const endSegment = () => { endToken(); if (tokens.length) segments.push(tokens); tokens = []; };
  const s = String(command || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && (s[i + 1] === '"' || s[i + 1] === '\\')) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (/\s/.test(c) && c !== '\n') endToken();
    else if (';&|()`\n'.includes(c)) endSegment();
    else { cur += c; has = true; }
  }
  endSegment();
  return segments;
}

const base = (t) => String(t).replace(/\\/g, '/').split('/').pop().replace(/\.(exe|cmd|ps1)$/i, '').toLowerCase();
const isAssign = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);
const abbrev = (tok, full, min) => tok.startsWith(min) && full.startsWith(tok);

/** { sub, opts, rest, c: [config keys from -c] } for a segment that runs git, else null. */
function parseGit(seg) {
  const gi = seg.findIndex((t) => base(t) === 'git');
  if (gi < 0) return null;
  const cfg = [];
  let i = gi + 1;
  const withValue = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
  while (i < seg.length && seg[i].startsWith('-')) {
    if (seg[i] === '-c') { cfg.push(String(seg[i + 1] || '')); i += 2; }
    else if (seg[i].startsWith('-c') && seg[i].length > 2 && !seg[i].startsWith('--')) { cfg.push(seg[i].slice(2)); i++; }
    else if (withValue.has(seg[i])) i += 2;
    else if (/^--config-env=/.test(seg[i])) { cfg.push(seg[i].slice(13)); i++; }
    else i++;
  }
  return { sub: seg[i] || '', args: seg.slice(i + 1), cfg };
}

const NO_VERIFY = (t) => t.startsWith('--no-v') && abbrev(t, '--no-verify', '--no-v');
// Short options of git commit that take a value: the rest of the token is that value.
const SHORT_WITH_VALUE = 'mFCcSu';
const hasShortN = (t) => {
  if (!/^-[A-Za-z]/.test(t) || t.startsWith('--')) return false;
  for (const ch of t.slice(1)) {
    if (ch === 'n') return true;
    if (SHORT_WITH_VALUE.includes(ch)) return false;
  }
  return false;
};

const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'mv', 'chmod', 'chown', 'del', 'erase', 'rd', 'ri', 'mi', 'rni', 'ren', 'rename', 'rename-item', 'remove-item', 'move-item', 'set-itemproperty', 'truncate', 'shred']);
const touchesHooks = (t) => /(^|[\/\\"'=])\.githooks([\/\\]|$)/.test(String(t).replace(/\\/g, '/').replace(/^['"]/, '')) || /\.githooks/.test(t);

const VALUE_FLAGS = new Set(['--workdir', '--profile', '--network-id', '--dns-resolver', '-o', '--output', '--create-ticket', '--db-url', '--project-ref', '--project-id']);

const REMOTE_MSG = 'שינוי במסד הנתונים האמיתי נעשה רק דרך מיגרציה שעוברת PR. הפקודה הזו פונה למסד המרוחק, ולכן היא נחסמה.';
// Always blocked, with or without a remote flag: they change the hosted project itself.
const ALWAYS_BLOCKED = [['functions', 'deploy'], ['secrets', 'set'], ['secrets', 'unset'], ['branches', 'delete'], ['projects', 'delete']];
// Read-only or local-state subcommands the skills use; they stay allowed against a remote target in a live project.
const READ_ONLY = [['migration', 'list'], ['db', 'advisors'], ['db', 'pull'], ['db', 'diff'], ['db', 'lint'], ['db', 'dump'], ['inspect'], ['gen', 'types'], ['projects', 'list'], ['link'], ['functions', 'list'], ['functions', 'download'], ['secrets', 'list'], ['branches', 'list'], ['branches', 'get']];
export const MAIN_PUSH_MSG = 'דחיפה ישירה ל-main נחסמה. עובדים בענף, פותחים PR וממזגים אחרי שהבדיקה עוברת.';
const startsWith = (words, prefix) => prefix.every((w, i) => words[i] === w);

/** Target of the remote flags: 'local' (none), 'dev' or 'prod'. */
function remoteTarget(flags, prod) {
  let target = 'local';
  const bump = (t) => { if (t === 'prod' || (t === 'dev' && target === 'local')) target = t; };
  for (const f of flags) {
    if (f === '--remote' || f === '--linked' || f === '--project-ref' || f === '--db-url') bump('prod');
    else if (/^--(?:project-ref|db-url)=/.test(f)) bump('prod');
    else if (f.startsWith('--remote=')) {
      const v = f.slice(9);
      const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
      if (isUrl) bump('prod');
      else if (prod.ref ? (v === prod.ref || v === prod.branch) : (v === prod.branch || v !== prod.devTarget)) bump('prod');
      else bump('dev');
    }
  }
  return target;
}

function supabaseCheck(seg, prod) {
  const si = seg.findIndex((t) => base(t) === 'supabase');
  if (si < 0) return null;
  const args = seg.slice(si + 1);
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (!args[i].startsWith('-')) words.push(args[i]);
  }
  const flags = args.filter((a) => a.startsWith('-'));
  if (ALWAYS_BLOCKED.some((p) => startsWith(words, p))) return REMOTE_MSG;
  if (flags.includes('--dry-run')) return null;
  const isPush = words[0] === 'db' && words[1] === 'push';
  const isReset = words[0] === 'db' && words[1] === 'reset';
  const isRepair = words[0] === 'migration' && words[1] === 'repair';
  if (!isPush && !isReset && !isRepair) {
    // Deny by default: any other subcommand that targets the remote database is blocked in a live project.
    if (!prod.live || READ_ONLY.some((p) => startsWith(words, p))) return null;
    return remoteTarget(flags, prod) === 'prod' ? REMOTE_MSG : null;
  }

  const target = remoteTarget(flags, prod);
  if (target === 'local') return null;
  if (isReset) return 'Blocked by Focus Blueprint: supabase db reset against a hosted database is not run. It erases the data. Test the migration on the local stack (supabase db reset without --remote) or on a branch, and let the merge deploy it.';
  if (isRepair) return 'Blocked by Focus Blueprint: supabase migration repair against a hosted database is not run. It rewrites the migration history that the GitHub integration relies on. Ask the owner.';
  if (target === 'prod' && prod.live) {
    return 'Blocked by Focus Blueprint: supabase db push to the production database is not run, because the project is live. Create the file with supabase migration new, test it with supabase db push --remote=<dev branch or dev project ref> or locally, commit it, and open a pull request; the merge deploys it. Use --dry-run to preview.';
  }
  return null;
}

/**
 * prod: { ref, branch, devTarget, live }. Returns a reason string or null.
 */
export function checkCommand(command, prod = {}) {
  const p = { ref: prod.ref || null, branch: prod.branch || 'main', devTarget: prod.devTarget || null, live: prod.live === true };
  const raw = String(command || '');

  if (/\bSUPABASE_YES\s*=|\$env:SUPABASE_YES/i.test(raw)) {
    return 'Blocked by Focus Blueprint: SUPABASE_YES is not set by the agent. It would confirm hosted database changes without a human. Run the command without it and let the student confirm.';
  }
  if (/>>?\s*['"]?[^\s'"]*\.githooks[\/\\]/.test(raw)) {
    return 'Blocked by Focus Blueprint: the files in .githooks/ are the commit gate and are not overwritten from the shell. Ask the owner.';
  }

  for (const seg of tokenize(raw)) {
    const g = parseGit(seg);
    if (g) {
      if (g.cfg.some((c) => /^core\.hookspath/i.test(c))) {
        return 'Blocked by Focus Blueprint: core.hooksPath is not changed with git -c. The commit gate lives in .githooks/ and stays on.';
      }
      if (g.sub === 'config' && g.args.some((a) => /core\.hookspath/i.test(a))) {
        return 'Blocked by Focus Blueprint: core.hooksPath is not touched. It points git at the commit gate in .githooks/. To restore it run: bp githook install.';
      }
      const dry = g.args.includes('--dry-run');
      if (g.sub === 'commit' && g.args.some((a) => NO_VERIFY(a) || hasShortN(a))) {
        return 'Blocked by Focus Blueprint: git commit --no-verify (or -n) skips the commit gate. Fix what the gate reports, then commit again.';
      }
      if ((g.sub === 'push' || g.sub === 'merge') && g.args.some(NO_VERIFY)) {
        return `Blocked by Focus Blueprint: git ${g.sub} --no-verify skips the hooks. Fix what they report, then run it again.`;
      }
      if ((g.sub === 'rm' || g.sub === 'mv') && g.args.some(touchesHooks) && !dry) {
        return 'Blocked by Focus Blueprint: .githooks/ is the commit gate and is not removed or moved. Ask the owner.';
      }
    }
    // Skip leading assignments and wrappers to find the program.
    let k = 0;
    while (k < seg.length && (isAssign(seg[k]) || ['sudo', 'command', 'env', 'time', 'nohup', 'xargs'].includes(base(seg[k])))) k++;
    if (k < seg.length && DELETERS.has(base(seg[k])) && seg.slice(k + 1).some(touchesHooks)) {
      return 'Blocked by Focus Blueprint: .githooks/ is the commit gate. It is not deleted, moved or chmod-ed from the shell. Ask the owner.';
    }
    if (k < seg.length && base(seg[k]) === 'gh') {
      const rest = seg.slice(k + 1);
      const i = rest.indexOf('pr');
      if (i >= 0 && rest[i + 1] === 'merge' && rest.some((t) => t === '--admin' || t.startsWith('--admin='))) return MAIN_PUSH_MSG;
    }
    const sb = supabaseCheck(seg, p);
    if (sb) return sb;
  }
  return null;
}
