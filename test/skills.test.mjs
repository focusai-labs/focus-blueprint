import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN } from './helpers.mjs';

const skillsDir = path.join(PLUGIN, 'skills');
const agentsDir = path.join(PLUGIN, 'agents');
const read = (p) => fs.readFileSync(p, 'utf8');

export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  assert.ok(m, 'frontmatter block missing');
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (k) fm[k[1]] = k[2].trim();
  }
  return { fm, body: m[2] };
}

const skills = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, 'SKILL.md'))).sort()
  : [];
const isStage = (n) => /^stage-\d\d-/.test(n);
const stageNo = (n) => Number(n.match(/^stage-(\d\d)-/)[1]);
const TECHNIQUE = ['debug', 'verify', 'review', 'ux-review', 'docs-verify'];
const HEADINGS = ['למה השלב הזה קיים', 'מה קוראים לפני שמתחילים', 'מה עושים', 'מה חייב להיות נכון בסוף (ההוכחה)', 'מה נשאר בתיקייה', 'סגירה'];

// A marker followed by a markdown table with at least `min` data rows.
function tableRowsAfter(text, from, min = 3) {
  const rest = text.slice(from).split(/\r?\n/);
  let i = 0;
  while (i < rest.length && !rest[i].trim().startsWith('|')) {
    assert.ok(!/^<!--/.test(rest[i].trim()) || i === 0, 'a table must follow the marker');
    i++;
  }
  const rows = [];
  for (; i < rest.length && rest[i].trim().startsWith('|'); i++) rows.push(rest[i]);
  const data = rows.filter((r) => !/^\|[\s:|-]+\|?$/.test(r.trim())).slice(1);
  return data.length;
}
function markerPositions(text, marker) {
  const out = [];
  let i = -1;
  while ((i = text.indexOf(marker, i + 1)) !== -1) out.push(i + marker.length);
  return out;
}

test('the plugin has skills', () => assert.ok(skills.includes('blueprint')));

for (const name of skills) {
  const text = read(path.join(skillsDir, name, 'SKILL.md'));
  test(`skill ${name}: frontmatter`, () => {
    const { fm } = splitFrontmatter(text);
    assert.equal(fm.name, name);
    assert.ok(fm.description && fm.description.length > 0, 'description');
    assert.ok(['opus', 'sonnet', 'haiku', 'inherit'].includes(fm.model), `model ${fm.model}`);
    assert.ok(!/[—–]/.test(text), 'no em or en dash');
  });

  if (name === 'blueprint') {
    test('skill blueprint: entry skill is model-invocable', () => {
      const { fm } = splitFrontmatter(text);
      assert.equal(fm['disable-model-invocation'], undefined);
    });
    continue;
  }

  if (TECHNIQUE.includes(name)) {
    test(`skill ${name}: technique skill is model-invocable`, () => {
      assert.equal(splitFrontmatter(text).fm['disable-model-invocation'], undefined);
    });
  }

  if (isStage(name)) {
    const n = stageNo(name);
    test(`skill ${name}: stage template`, () => {
      const { fm, body } = splitFrontmatter(text);
      assert.equal(fm['disable-model-invocation'], 'true');
      let last = -1;
      for (const h of HEADINGS) {
        const idx = body.indexOf(`## ${h}`);
        assert.ok(idx !== -1, `heading ${h}`);
        assert.ok(idx > last, `heading order ${h}`);
        last = idx;
      }
    });
    if (n >= 9 && n <= 12) {
      test(`skill ${name}: four stops and closing red flags`, () => {
        assert.ok(text.includes('<!-- four-stops -->'));
        const marks = markerPositions(text, '<!-- red-flags -->');
        assert.ok(marks.length >= 2, 'a red-flags table inside the close');
        const close = text.indexOf('## סגירה');
        const last = marks[marks.length - 1];
        assert.ok(last > close, 'last red-flags marker is inside סגירה');
        assert.ok(tableRowsAfter(text, last) >= 3, 'closing table needs 3 rows');
      });
    }
  }

  if (name === 'debug') {
    test('skill debug: layers marker', () => assert.ok(text.includes('<!-- layers -->')));
  }
  if (['change', 'stage-10-data', 'stage-12-capability'].includes(name)) {
    test(`skill ${name}: red-flags table`, () => {
      const marks = markerPositions(text, '<!-- red-flags -->');
      assert.ok(marks.length >= 1);
      assert.ok(tableRowsAfter(text, marks[0]) >= 3, 'at least 3 rows');
    });
  }
}

test('the one-name-per-skill rule: no skill folder without SKILL.md', () => {
  if (!fs.existsSync(skillsDir)) return;
  for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (d.isDirectory()) assert.ok(fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md')), d.name);
  }
});

// Agents
const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort() : [];
for (const file of agents) {
  const base = file.replace(/\.md$/, '');
  test(`agent ${base}`, () => {
    const { fm } = splitFrontmatter(read(path.join(agentsDir, file)));
    assert.ok(!fm.name.includes(':'), 'name has no colon');
    assert.equal(fm.name, base);
    assert.ok(fm.description && fm.description.length > 0);
    assert.equal(fm.model, 'opus');
    for (const k of ['hooks', 'mcpServers', 'permissionMode']) assert.equal(fm[k], undefined, `${k} is ignored in plugin agents`);
    const tools = (fm.tools || '').replace(/[\[\]]/g, '').split(',').map((t) => t.trim()).filter(Boolean);
    const banned = { 'builder-check': ['Write', 'Edit', 'Bash'], 'capability-reviewer': ['Write', 'Edit'] }[base];
    if (banned) {
      assert.ok(tools.length > 0, 'tools must be listed explicitly');
      for (const b of banned) assert.ok(!tools.includes(b), `${base} must not have ${b}`);
    }
  });
}

// Hebrew lint on bodies only (frontmatter keys are Latin).
const lint = path.join(os.homedir(), '.claude', 'voice', 'hebrew-lint.py');
const havePython = spawnSync('python3', ['--version']).status === 0;
const lintSkip = !havePython || !fs.existsSync(lint) ? 'python3 or hebrew-lint.py missing' : false;
const lintFiles = [
  ...skills.map((s) => path.join(skillsDir, s, 'SKILL.md')),
  ...agents.map((a) => path.join(agentsDir, a)),
  path.join(PLUGIN, 'TERMS.md'),
].filter((f) => fs.existsSync(f));
test('Hebrew lint passes on every skill, agent and TERMS body', { skip: lintSkip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-lint-'));
  const failures = [];
  lintFiles.forEach((f, i) => {
    const text = read(f);
    const body = /^---\r?\n/.test(text) ? splitFrontmatter(text).body : text;
    const tf = path.join(tmp, `${i}-${path.basename(path.dirname(f))}.md`);
    fs.writeFileSync(tf, body);
    const r = spawnSync('python3', [lint, tf], { encoding: 'utf8' });
    if (r.status !== 0) failures.push(`${path.relative(PLUGIN, f)}\n${r.stdout}${r.stderr}`);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(failures.length, 0, failures.join('\n'));
});
