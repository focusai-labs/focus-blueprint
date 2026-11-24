// Tests of the walking skeleton: every hook script, fed the JSON that Claude
// Code sends on stdin, and the local page server. Run: node --test test/skeleton.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeSampleProject } from './make-sample-project.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const plugin = path.join(root, 'plugins', 'focus-blueprint');
const hook = (name) => path.join(plugin, 'hooks', name);

const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const emptyHome = tmp('bp-home-');

function run(script, input, { env = {}, args = [] } = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', FOCUS_BLUEPRINT_HOME: emptyHome, FOCUS_BLUEPRINT_PROBE: '', ...env },
  });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    // Not JSON: the test looks at stdout itself.
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

const project = () => makeSampleProject(tmp('bp-project-'));
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

test('every hook is silent outside a Blueprint project', () => {
  const dir = tmp('bp-plain-');
  for (const name of ['session-start.mjs', 'prompt-context.mjs', 'post-edit.mjs', 'guard-shell.mjs', 'guard-migration.mjs']) {
    const res = run(hook(name), {
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m x', file_path: path.join(dir, 'mockup', 'a.html'), query: 'create table t ()' },
    });
    assert.equal(res.status, 0, name);
    assert.equal(res.stdout, '', name);
  }
});

test('session start: terms notice until the terms are accepted', () => {
  const dir = project();
  const res = run(hook('session-start.mjs'), { cwd: dir, source: 'startup' });
  assert.equal(res.status, 0);
  assert.match(res.json.systemMessage, /^הכלי Focus Blueprint ניתן לשימוש כמו שהוא/);
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(res.json.hookSpecificOutput.additionalContext, /Current stage: 3 of 15, "שאלון"/);
  assert.match(res.json.hookSpecificOutput.additionalContext, /terms of use have not been accepted/);
});

test('session start: stage line once the terms are accepted', () => {
  const dir = project();
  const home = tmp('bp-home-ok-');
  fs.writeFileSync(path.join(home, 'profile.json'), JSON.stringify({ terms: { version: '2026-11-16', acceptedAt: '2026-11-16' } }));
  const res = run(hook('session-start.mjs'), { cwd: dir, source: 'startup' }, { env: { FOCUS_BLUEPRINT_HOME: home } });
  assert.match(res.json.systemMessage, /בשלב 3 מתוך 15, שאלון/);
  assert.doesNotMatch(res.json.hookSpecificOutput.additionalContext, /terms of use/);
});

test('session start: found from a subfolder, and quiet to the user after a compaction', () => {
  const dir = project();
  const res = run(hook('session-start.mjs'), { cwd: path.join(dir, 'mockup'), source: 'compact' }, { env: { HOME: tmp('bp-home-quiet-'), USERPROFILE: tmp('bp-home-quiet-') } });
  assert.equal(res.json.systemMessage, undefined);
  assert.match(res.json.hookSpecificOutput.additionalContext, /Current stage: 3/);
});

test('prompt context carries the stage and the change route', () => {
  const res = run(hook('prompt-context.mjs'), { cwd: project(), prompt: 'add an export button' });
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(res.json.hookSpecificOutput.additionalContext, /^הכלי Focus Blueprint: שלב 3, שאלון\. כל שינוי בהיקף עובר דרך \/blueprint\./);
});

test('post edit: a screen the map does not list gets a note, a listed one does not', () => {
  const dir = project();
  const edit = (rel) => run(hook('post-edit.mjs'), { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, rel) } });
  assert.equal(edit('mockup/index.html').stdout, '');
  assert.equal(edit('spec/prd.md').stdout, '');
  const res = edit('mockup/reports.html');
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(res.json.hookSpecificOutput.additionalContext, /mockup\/reports\.html is a screen that the project map/);
  const outside = run(hook('post-edit.mjs'), { cwd: dir, tool_input: { file_path: path.join(os.tmpdir(), 'mockup', 'x.html') } });
  assert.equal(outside.stdout, '');
});

test('shell guard: a commit on main is blocked with exit code 2', () => {
  const dir = project();
  const shell = (command, tool = 'Bash') => run(hook('guard-shell.mjs'), { cwd: dir, tool_name: tool, tool_input: { command } });
  for (const command of ['git commit -m "x"', 'npm test && git commit -m x', `git -C ${dir} commit -m x`, 'git --no-pager commit -am x']) {
    const res = shell(command);
    assert.equal(res.status, 2, command);
    assert.match(res.stderr, /Blocked by Focus Blueprint: this project does not take commits directly on "main"/);
  }
  assert.equal(shell('git commit -m x', 'PowerShell').status, 2);
  for (const command of ['git status', 'git log --grep commit', 'git commit-tree abc', 'echo done']) {
    assert.equal(shell(command).status, 0, command);
  }
});

test('shell guard: a commit on a branch passes, and so does the first commit of a new repository', () => {
  const dir = project();
  git(dir, 'switch', '-c', 'stage-3');
  const onBranch = run(hook('guard-shell.mjs'), { cwd: dir, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } });
  assert.equal(onBranch.status, 0);

  const fresh = makeSampleProject(tmp('bp-fresh-'), { commit: false });
  const first = run(hook('guard-shell.mjs'), { cwd: fresh, tool_name: 'Bash', tool_input: { command: 'git commit -m first' } });
  assert.equal(first.status, 0);
});

test('migration guard: apply_migration is denied with the Git path, even with a matching file', () => {
  const dir = project();
  const query = 'create table documents (\n  id uuid primary key\n);';
  const apply = () =>
    run(hook('guard-migration.mjs'), { cwd: dir, tool_name: 'mcp__supabase__apply_migration', tool_input: { name: 'add documents', query } });

  const blocked = apply();
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /supabase migration new/);

  fs.writeFileSync(path.join(dir, 'db', 'migrations', '20261116_add_documents.sql'), query);
  assert.equal(apply().status, 2);
});

test('probe run: each context hook carries its marker', () => {
  const dir = project();
  const env = { FOCUS_BLUEPRINT_PROBE: '1' };
  assert.match(run(hook('session-start.mjs'), { cwd: dir }, { env }).json.hookSpecificOutput.additionalContext, /\[blueprint-probe:SessionStart\]/);
  assert.match(run(hook('prompt-context.mjs'), { cwd: dir }, { env }).json.hookSpecificOutput.additionalContext, /\[blueprint-probe:UserPromptSubmit\]/);
  const edit = run(hook('post-edit.mjs'), { cwd: dir, tool_input: { file_path: path.join(dir, 'mockup', 'index.html') } }, { env });
  assert.match(edit.json.hookSpecificOutput.additionalContext, /\[blueprint-probe:PostToolUse\]/);
});

test('hooks.json points at scripts that exist, in exec form', () => {
  const config = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8'));
  for (const groups of Object.values(config.hooks)) {
    for (const group of groups) {
      for (const h of group.hooks) {
        assert.equal(h.command, 'node');
        const script = h.args[0].replace('${CLAUDE_PLUGIN_ROOT}', plugin);
        assert.ok(fs.existsSync(script), script);
      }
    }
  }
});

test('the entry skill reads the stage data, which lists the 15 stages', () => {
  const skill = fs.readFileSync(path.join(plugin, 'skills', 'blueprint', 'SKILL.md'), 'utf8');
  const stages = JSON.parse(fs.readFileSync(path.join(plugin, 'data', 'stages.json'), 'utf8'));
  assert.equal(stages.length, 15);
  assert.ok(skill.includes('stages.json'));
});

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('local page: serves the page, saves the answer into the project, refuses strangers', async () => {
  const { startUi } = await import(pathToFileURL(path.join(plugin, 'ui', 'server.mjs')).href);
  const dir = project();

  // An answer left over from an earlier run must not count.
  const stale = path.join(dir, '.blueprint', 'ui', 'answers', 'probe.json');
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, '{"answer":"old"}');
  fs.utimesSync(stale, new Date(Date.now() - 60000), new Date(Date.now() - 60000));

  const ui = await startUi({ projectDir: dir });
  try {
    assert.match(ui.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);

    const page = await request(ui.url);
    assert.equal(page.status, 200);
    assert.match(page.body, /הממשק המקומי עובד/);

    const wait = (timeout) => run(path.join(plugin, 'ui', 'wait.mjs'), {}, { args: ['--project', dir, '--name', 'probe', '--timeout', timeout] });
    const early = wait('1');
    assert.equal(early.status, 3);
    assert.equal(early.stdout, 'TIMEOUT');

    const json = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ name: 'probe', answer: 'שלום מהדף המקומי' });
    assert.equal((await request(`http://127.0.0.1:${ui.port}/wrong-token/api/answer`, { method: 'POST', headers: json, body })).status, 404);
    assert.equal((await request(`${ui.url}api/answer`, { method: 'POST', headers: { ...json, Host: 'evil.example' }, body })).status, 403);
    assert.equal((await request(`${ui.url}api/answer`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })).status, 415);
    assert.equal((await request(`${ui.url}api/answer`, { method: 'POST', headers: json, body: JSON.stringify({ name: '../x', answer: 'a' }) })).status, 400);

    assert.equal((await request(`${ui.url}api/answer`, { method: 'POST', headers: json, body })).status, 200);
    const saved = wait('5');
    assert.equal(saved.status, 0);
    assert.equal(saved.json.answer, 'שלום מהדף המקומי');
    assert.ok(fs.existsSync(path.join(dir, '.blueprint', 'ui', 'server.json')));
  } finally {
    ui.close();
    await ui.closed;
  }
  assert.ok(!fs.existsSync(path.join(dir, '.blueprint', 'ui', 'server.json')));
});
