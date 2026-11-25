// C3: Claude cannot switch the check off through its file tools or the shell.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hook, tmpProject } from './helpers.mjs';

const state = { schema: 2, project: 'p', stage: 3, status: 'in_progress', track: 'supabase-app', live: false, stages: {}, lastDriftCheck: null };
const MSG = 'את הקבצים של הבדיקה משנים רק דרך הכלי, בפקודה bp update, כדי שהבדיקה לא תיכבה בלי שאף אחד ירגיש.';
const tool = (dir, tool_name, tool_input) => hook('guard-checker', { cwd: dir, tool_name, tool_input });
const sh = (dir, command) => hook('guard-shell', { cwd: dir, tool_name: 'Bash', tool_input: { command } });

const PROTECTED = ['.githooks/pre-commit', 'scripts/blueprint-check.mjs', 'scripts/blueprint-model/rules.mjs', '.github/workflows/blueprint-check.yml'];

test('file tools: the check files are blocked for Write, Edit, MultiEdit and NotebookEdit', () => {
  const dir = tmpProject({ state });
  for (const f of PROTECTED) {
    for (const name of ['Write', 'Edit', 'MultiEdit']) {
      const r = tool(dir, name, { file_path: `${dir}/${f}`, content: 'x' });
      assert.equal(r.code, 2, `${name} ${f}`);
      assert.equal(r.err, MSG);
    }
    assert.equal(tool(dir, 'Edit', { file_path: f, old_string: 'a', new_string: 'b' }).code, 2, `relative ${f}`);
  }
  assert.equal(tool(dir, 'NotebookEdit', { notebook_path: `${dir}/scripts/blueprint-model/n.ipynb`, new_source: 'x' }).code, 2);
});

test('file tools: other files and projects without .blueprint stay free', () => {
  const dir = tmpProject({ state });
  for (const f of ['src/app.ts', 'scripts/seed.mjs', '.github/workflows/ci.yml', '.githooks/other', 'README.md']) {
    assert.equal(tool(dir, 'Write', { file_path: `${dir}/${f}`, content: 'x' }).code, 0, f);
  }
  const plain = tmpProject({});
  assert.equal(tool(plain, 'Write', { file_path: `${plain}/scripts/blueprint-check.mjs`, content: 'x' }).code, 0);
});

test('shell: writes onto the check files are blocked', () => {
  const dir = tmpProject({ state });
  const bad = [
    'rm .githooks/pre-commit',
    'rm -f scripts/blueprint-check.mjs',
    'rm -rf scripts/blueprint-model',
    'rm -rf scripts',
    'mv .github/workflows/blueprint-check.yml /tmp/x',
    'cp /tmp/x .githooks/pre-commit',
    'cp -f /tmp/x scripts/blueprint-model/rules.mjs',
    "sed -i '' 's/a/b/' scripts/blueprint-check.mjs",
    "sed -i.bak 's/a/b/' scripts/blueprint-check.mjs",
    'echo x | tee scripts/blueprint-check.mjs',
    'echo x > scripts/blueprint-check.mjs',
    'echo x >> .github/workflows/blueprint-check.yml',
    'echo x >scripts/blueprint-model/a.mjs',
    'chmod -x .githooks/pre-commit',
    'truncate -s 0 scripts/blueprint-check.mjs',
    'git config core.hooksPath /dev/null',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git update-index --assume-unchanged scripts/blueprint-check.mjs',
    'git update-index --skip-worktree .githooks/pre-commit',
    'git update-index --assume-unchanged scripts/blueprint-model/rules.mjs',
  ];
  for (const c of bad) {
    const r = sh(dir, c);
    assert.equal(r.code, 2, c);
    assert.match(r.err, /את הקבצים של הבדיקה/, c);
  }
  assert.equal(sh(dir, 'git config core.hooksPath x').err, MSG);
});

test('shell: reading, running and normal work stay free', () => {
  const dir = tmpProject({ state });
  const ok = [
    'cat scripts/blueprint-check.mjs',
    'node scripts/blueprint-check.mjs',
    'node scripts/blueprint-check.mjs > out.txt',
    'cp .githooks/pre-commit /tmp/backup',
    'grep -n x .github/workflows/blueprint-check.yml',
    'rm -rf node_modules',
    'rm scripts/seed.mjs',
    'sed -i s/a/b/ src/app.ts',
    'echo x > notes.txt',
    'chmod +x scripts/seed.mjs',
    'git update-index --assume-unchanged .env.local',
    'git commit -m "scripts/blueprint-check.mjs docs"',
    'node ~/.claude/plugins/focus-blueprint/scripts/bp.mjs update',
    'node ~/.claude/plugins/focus-blueprint/scripts/bp.mjs githook install',
    'git switch -c feat && git push -u origin feat',
  ];
  for (const c of ok) assert.equal(sh(dir, c).code, 0, c);
});

test('C15: only the blocking guards fail closed (onFailure block, Claude Code v2.1.295 or later)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { PLUGIN } = await import('./helpers.mjs');
  const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
  const seen = {};
  for (const groups of Object.values(cfg.hooks)) for (const g of groups) for (const h of g.hooks) seen[path.basename(h.args[0])] = h.onFailure;
  for (const n of ['guard-shell.mjs', 'guard-migration.mjs', 'guard-secrets.mjs', 'guard-checker.mjs']) assert.equal(seen[n], 'block', n);
  for (const n of ['session-start.mjs', 'prompt-context.mjs', 'post-edit.mjs', 'stop-summary.mjs', 'stop-gate.mjs']) assert.equal(seen[n], undefined, n);
});
