// D10: entering an existing project. The skill text, its references, and the end state they promise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { PLUGIN, ROOT, bp, tmpProject } from './helpers.mjs';

const SKILL_DIR = path.join(PLUGIN, 'skills', 'adopt');
const REFS = ['connections.md', 'review.md', 'migrations.md', 'map-and-matrix.md', 'documents.md'];
const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const ref = Object.fromEntries(REFS.map((r) => [r, fs.readFileSync(path.join(SKILL_DIR, 'references', r), 'utf8')]));
const at = (s, h) => { const i = s.indexOf(h); assert.ok(i >= 0, `missing: ${h}`); return i; };
const section = (s, from, to) => s.slice(at(s, from), to ? at(s, to) : undefined);

test('adopt: two entry paths, and every connection is checked before the review', () => {
  for (const s of ['gh repo clone', '/focus-blueprint:adopt', 'git switch -c adopt']) assert.ok(skill.includes(s), s);
  assert.ok(at(skill, '## שתי דרכים להתחיל') < at(skill, '## לפני הכל: החיבורים'));
  assert.ok(at(skill, '## לפני הכל: החיבורים') < at(skill, '### 1. סקירה בקריאה בלבד'));
  for (const c of ['gh auth status', 'supabase projects list', 'supabase migration list --remote', 'vercel whoami', 'claude mcp list', 'project_ref', 'n8n']) {
    assert.ok(skill.includes(c), `skill: ${c}`);
    assert.ok(ref['connections.md'].includes(c), `connections.md: ${c}`);
  }
  for (const u of ['https://cli.github.com/manual/gh_auth_status', 'https://supabase.com/docs/reference/cli/supabase-migration-list', 'https://vercel.com/docs/cli/whoami', 'https://code.claude.com/docs/en/mcp', 'https://supabase.com/docs/guides/getting-started/mcp']) {
    assert.ok(ref['connections.md'].includes(u), u);
  }
  assert.ok(ref['connections.md'].includes('claude mcp get'), 'each Supabase server is checked for its scope');
});

test('adopt: the order of the security doc, with a stop after the review and after the matrix', () => {
  const order = ['### 1. סקירה בקריאה בלבד', '### 2. הכלי, המפה ומטריצת ההרשאות', '### 3. תיקונים במיגרציות חדשות', '### 4. בדיקות', '### 5. המסמכים לפי התבניות', '### 6. אכיפה'];
  order.reduce((prev, h) => { const i = at(skill, h); assert.ok(i > prev, `order: ${h}`); return i; }, -1);
  assert.match(section(skill, order[0], order[1]), /עוצרים בפעם הראשונה/);
  assert.match(section(skill, order[1], order[2]), /עוצרים בפעם השנייה/);
  assert.match(section(skill, order[1], order[2]), /bp init/, 'the tool is written into the project only after the first stop');
  assert.ok(!section(skill, '## שתי דרכים להתחיל', order[1]).includes('bp init'), 'nothing is written before the first stop');
  assert.match(ref['map-and-matrix.md'], /ברירת המחדל היא שהכל חסום/);
  assert.match(ref['review.md'], /\| מותר \| אסור \|/, 'the review lists what may and may not run');
});

test("adopt: changes to the project's CLAUDE.md, hooks and skills are a diff the student approves, never an overwrite", () => {
  for (const s of ['spec/adopt-setup.md', 'diff', 'CLAUDE.md', 'hooks', 'skills', 'לא דורסים']) assert.ok(skill.includes(s), s);
  const r = ref['review.md'];
  for (const s of ['@AGENTS.md', '.claude/settings.json', 'https://code.claude.com/docs/en/memory', 'שיפור, שינוי או הסרה', 'git diff']) assert.ok(r.includes(s), s);
  assert.match(ref['documents.md'], /מסמך קיים לא דורסים/);
});

test('adopt: migrations follow C9, one flow in supabase/migrations, the legacy folder moves only after the history check', () => {
  for (const s of ['supabase migration new', 'supabase/migrations', 'מיגרציה שכבר רצה לא עורכים']) assert.ok(skill.includes(s), s);
  const m = ref['migrations.md'];
  for (const s of ['db/migrations', 'supabase migration list --remote', 'supabase db pull --remote', 'supabase migration repair', 'SUPABASE_YES', 'https://supabase.com/docs/reference/cli/supabase-db-pull', 'https://supabase.com/docs/guides/deployment/branching/github-integration']) {
    assert.ok(m.includes(s), s);
  }
  const legacy = section(m, '## המיגרציות בתיקייה db/migrations', '## אין קובץ מיגרציה בכלל');
  assert.ok(legacy.indexOf('לפני שמעבירים') >= 0 && legacy.indexOf('supabase migration list --remote') < legacy.indexOf('מעבירים אותו בשם'), 'the history is checked before the move');
});

test('adopt: enforcement installs the git gate and runs the gate proof of stage 11', () => {
  const enf = section(skill, '### 6. אכיפה');
  for (const s of ['bp githook install', '.github/workflows/blueprint-check.yml', 'skills/stage-11-skeleton/references/gate-proof.md', 'docs/evidence/gates.txt']) assert.ok(enf.includes(s), s);
});

test('adopt: every plugin path and reference it points at exists', () => {
  const texts = [skill, ...Object.values(ref)];
  for (const t of texts) {
    for (const m of t.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^`"\s)]+)/g)) {
      const rel = m[1].replace(/[.,]$/, '');
      assert.ok(fs.existsSync(path.join(PLUGIN, rel)), rel);
    }
  }
  for (const r of REFS) assert.ok(skill.includes(r), `the skill points at ${r}`);
});

test('adopt: following the map and documents steps, the check passes at stage 12', () => {
  const dir = tmpProject({ git: true });
  assert.equal(bp(dir, ['init', '--name', 'existing']).code, 0);
  assert.equal(bp(dir, ['map', 'add', 'capability', '{"id":"upload","name":"העלאת מסמכים"}']).code, 0);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'upload', 'status=real', '--baseline']).code, 0);
  assert.equal(bp(dir, ['eval', 'new', 'upload']).code, 0);
  fs.writeFileSync(path.join(dir, 'spec', 'idea.md'), [
    '# הרעיון', '', '<!-- idea:words -->',
    'מערכת שקיימת כבר שנה, שבה לקוחות של משרד רואי חשבון מעלים את המסמכים החודשיים שלהם, והעובדים רואים במקום אחד מה הגיע, מה חסר ומה כבר נבדק, בלי לרדוף אחרי כל לקוח בטלפון.',
    '', '<!-- idea:summary -->', '- הבעיה: רודפים אחרי מסמכים בכל חודש <!-- src:student -->', '- מה קיים היום: מערכת עם העלאה ורשימה <!-- src:claude -->', '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'spec', 'builder-check.md'), '# בדיקה בעיני הבונה\n\n<!-- bc:answered -->\n- אין\n\n<!-- bc:ruled -->\n- אין\n\n<!-- bc:asked-student -->\n- אין\n');
  assert.equal(bp(dir, ['state', 'set', 'stage=12']).code, 0);
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'blueprint-check.mjs'), dir], { encoding: 'utf8' });
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  for (const s of ['bp eval new <id>', '--baseline']) assert.ok(ref['map-and-matrix.md'].includes(s), s);
  for (const s of ['idea:words', 'idea:summary', 'bc:answered', 'bc:ruled', 'bc:asked-student', 'bp state set stage=12']) assert.ok(ref['documents.md'].includes(s), s);
});

