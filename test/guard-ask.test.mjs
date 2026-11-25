// C6: outward actions ask the student first; ordinary work does not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hook, tmpProject } from './helpers.mjs';

const state = { schema: 2, project: 'p', stage: 3, status: 'in_progress', track: 'supabase-app', live: false, stages: {}, lastDriftCheck: null };
const MSG = 'הפקודה הזו מעלה משהו לאוויר, משנה הרשאות או מוחקת מידע, ולכן היא מחכה לאישור שלכם.';
const sh = (dir, command, name = 'Bash') => hook('guard-shell', { cwd: dir, tool_name: name, tool_input: { command } });
const asks = (r) => r.code === 0 && r.json && r.json.hookSpecificOutput.permissionDecision === 'ask' && r.json.hookSpecificOutput.permissionDecisionReason === MSG && r.json.hookSpecificOutput.hookEventName === 'PreToolUse';

test('outward commands ask', () => {
  const dir = tmpProject({ state });
  const ask = [
    'gh repo create my-app --private', 'gh repo edit --visibility public --accept-visibility-change-consequences',
    'gh repo edit o/r --visibility=private', 'gh repo delete o/r --yes', 'gh secret set KEY --body x', 'gh release create v1',
    'vercel --prod', 'vercel deploy --prod', 'vercel deploy --prebuilt --prod', 'vercel promote dpl_1', 'vercel alias set a.vercel.app b.com', 'vercel domains add b.com',
    'netlify deploy --prod', 'npm publish', 'cd x && npm publish --access public',
    'psql -h db.abc.supabase.co -U postgres -c "DELETE FROM users"',
    'psql postgresql://u:p@db.abc.supabase.co:5432/postgres -c "drop table t"',
    'psql "$DATABASE_URL" -c "truncate t"',
    'psql --host=db.abc.supabase.co -c "ALTER TABLE t ADD c int"',
    'supabase db query --linked "delete from t"',
  ];
  for (const c of ask) assert.ok(asks(sh(dir, c)), c);
  assert.ok(asks(sh(dir, 'vercel --prod', 'PowerShell')));
});

test('ordinary work does not ask', () => {
  const dir = tmpProject({ state });
  const quiet = [
    'git push', 'git push -u origin feat', 'gh pr create --fill', 'gh pr merge 3 --squash', 'gh repo view', 'gh repo edit --description x', 'gh secret list',
    'vercel', 'vercel deploy', 'vercel pull', 'vercel env ls', 'netlify deploy', 'npm install', 'npm run build', 'npm publish --help'.replace('publish --help', 'test'),
    'psql -h localhost -c "drop table t"', 'psql -h 127.0.0.1 -c "delete from t"', 'psql -c "delete from t"',
    'psql -h db.abc.supabase.co -c "select 1"', 'supabase db query "delete from t"', 'supabase db query --linked "select 1"',
    'echo "do not drop table"',
  ];
  for (const c of quiet) {
    const r = sh(dir, c);
    assert.equal(r.code, 0, c);
    assert.equal(r.out, '', c);
  }
});

test('a blocked command is blocked, not asked; outside a project it stays silent', () => {
  const dir = tmpProject({ state });
  assert.equal(sh(dir, 'git commit --no-verify -m x && vercel --prod').code, 2);
  const plain = tmpProject({});
  const r = sh(plain, 'vercel --prod');
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});
