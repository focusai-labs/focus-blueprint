// Bugs from the first full demo run (T9).
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const { renderBlock } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'blueprint-model', 'render-blocks.mjs')).href);
const { renderDoc } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'render-doc.mjs')).href);

const base = () => ({
  roles: [{ id: 'client', name: 'לקוח', kind: 'user' }],
  tables: [{ name: 'orders', label: 'הזמנות' }, { name: 'logs' }],
  access: [
    { object: 'orders', kind: 'table', exposed: true, serviceOnly: false, rules: [{ role: 'client', ops: ['select'], scope: 'own', rowRule: '' }] },
    { object: 'logs', kind: 'table', exposed: false, serviceOnly: false, rules: [] },
    { object: 'invoices', label: 'חשבוניות', kind: 'table', exposed: true, serviceOnly: false, rules: [] },
  ],
});

test('permissions block: label then the id in code, id alone in code, and the API wording', () => {
  const p = renderBlock(base(), 'permissions');
  assert.ok(p.includes('| הזמנות `orders` |'), 'label from the tables list');
  assert.ok(p.includes('| חשבוניות `invoices` |'), 'label on the access object');
  assert.ok(p.includes('| `logs` |'), 'no label: id in code');
  assert.ok(p.includes('פתוח ל-API') && p.includes('סגור ל-API'));
  assert.ok(!p.includes('חשוף') && !p.includes('פנימי'));
});

test('access set takes an optional label, by flag or in the JSON', () => {
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  assert.equal(bp(dir, ['access', 'set', 'orders', '--json', '{"kind":"table"}', '--label', 'הזמנות']).code, 0);
  assert.equal(bp(dir, ['access', 'set', 'logs', '--json', '{"kind":"table","label":"יומן"}']).code, 0);
  const m = JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'map.json'), 'utf8'));
  assert.equal(m.access.find((a) => a.object === 'orders').label, 'הזמנות');
  assert.equal(m.access.find((a) => a.object === 'logs').label, 'יומן');
  assert.equal(bp(dir, ['map', 'add', 'table', '{"name":"t1","label":"טבלה"}']).code, 0);
  assert.equal(bp(dir, ['access', 'set', 'bad', '--json', '{}', '--label', ' ']).code, 1);
});

test('render-doc: backtick code inside table cells is LTR', () => {
  const html = renderDoc('| א | ב |\n| --- | --- |\n| הזמנות `orders` | `client` |', {}, '');
  assert.match(html, /<td>הזמנות <code dir="ltr">orders<\/code><\/td>/);
  assert.match(html, /<td><code dir="ltr">client<\/code><\/td>/);
});

test('templates: no two consecutive plain lines, so bp doc html never merges them', () => {
  const dir = path.join(PLUGIN, 'templates');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
  const plain = (t) => t.trim() && !/^\s*(#|[-*+] |\d+[.)] |\||>|```|<!--|---)/.test(t);
  for (const f of walk(dir)) {
    const L = fs.readFileSync(f, 'utf8').split('\n');
    let fence = false;
    L.forEach((l, i) => {
      if (l.trim().startsWith('```')) fence = !fence;
      if (!fence && i + 1 < L.length) assert.ok(!(plain(l) && plain(L[i + 1])), `${path.basename(f)}:${i + 1} merges with the next line`);
    });
  }
  const html = renderDoc(fs.readFileSync(path.join(dir, 'docs', 'prd.md'), 'utf8'), {}, '');
  assert.match(html, /<p[^>]*>גרסה:.*<\/p>\n<p[^>]*>עודכן:/);
});

test('stage branch is the two-digit form in the state and in the shell hook text', () => {
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  bp(dir, ['stage', 'start', '2']);
  let s = JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'state.json'), 'utf8'));
  assert.equal(s.stages[2].branch, 'stage-02');
  bp(dir, ['stage', 'start', '12']);
  s = JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'state.json'), 'utf8'));
  assert.equal(s.stages[12].branch, 'stage-12');
  const guard = fs.readFileSync(path.join(PLUGIN, 'hooks', 'guard-shell.mjs'), 'utf8');
  assert.ok(guard.includes("String(project.state.stage).padStart(2, '0')"));
  assert.ok(!guard.includes('stage-${project.state.stage ||'));
});

test('every track has a stage 7 mockup step, and the stage 7 skill falls back to its own text', () => {
  for (const id of ['static', 'supabase-app', 'n8n-engine']) {
    const t = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'tracks', `${id}.json`), 'utf8'));
    const s = t.steps.find((x) => x.stage === 7);
    assert.ok(s, `${id} has a stage 7 step`);
    if (id !== 'static') assert.match(s.intent, /mock-data\.js/);
  }
  const skill = fs.readFileSync(path.join(PLUGIN, 'skills', 'stage-07-mockup', 'SKILL.md'), 'utf8');
  assert.match(skill, /כשבמסלול אין צעד כזה/);
});

test('the Vercel Hobby limit cites the terms of service, section 4', () => {
  const j = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'junctions', 'track.json'), 'utf8'));
  const st = j.options.find((o) => o.id === 'static');
  assert.equal(st.cost.source, 'https://vercel.com/legal/terms');
  assert.match(st.cost.text, /סעיף 4/);
});
