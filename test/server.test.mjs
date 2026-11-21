// The local UI: routes, answers API, why-first, prefill, rulings. Run: node --test test/server.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PLUGIN, tmpProject } from './helpers.mjs';

const { startUi } = await import(path.join(PLUGIN, 'ui', 'server.mjs'));
const JSON_H = { 'Content-Type': 'application/json' };

const STATE = {
  schema: 2, project: 'בדיקה', createdAt: '2026-11-21', updatedAt: '2026-11-21T10:00:00.000Z', stage: 12, status: 'in_progress',
  mode: 'default', context: { payer: 'client', approver: 'client', users: 'org-staff', owner: 'client' }, track: 'supabase-app', live: false,
  connections: {}, where: {}, stages: { 3: { status: 'done', close: { status: 'done_with_concerns', note: 'ספק אחד', proof: 'ok', at: '2026-11-21' } }, 12: { status: 'blocked', close: { status: 'blocked', note: 'חסר מפתח', proof: '', at: '2026-11-21' } } },
  pending: [], superpowers: { installed: false, version: null }, lastDriftCheck: null,
};

function project() {
  const dir = tmpProject({ state: STATE });
  const bp = path.join(dir, '.blueprint');
  fs.writeFileSync(path.join(bp, 'changes.json'), '[]');
  fs.writeFileSync(path.join(bp, 'rulings.json'), JSON.stringify([{ id: 'r-001', at: '2026-11-21T10:00:00.000Z', stage: 12, capability: null, decision: 'בחרתי כפתור אחד', why: 'פשוט יותר', priceIfWrong: 'שעה של עבודה', by: 'claude', reported: false }]));
  return dir;
}
function stubCatalog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cat-'));
  fs.mkdirSync(path.join(dir, 'catalog', 'examples'), { recursive: true });
  const dims = { visual: ['minimal', 'glass'], nav: ['top-bar'], structure: ['single-page'], login: ['centered-card'], density: ['compact'] };
  for (const [dim, ids] of Object.entries(dims)) {
    fs.writeFileSync(path.join(dir, 'catalog', `${dim}.json`), JSON.stringify(ids.map((id) => ({ id, name_he: id, term_en: id, example: `${id}.html`, fits: 'x', less: 'y', default_for: [] }))));
    for (const id of ids) fs.writeFileSync(path.join(dir, 'catalog', 'examples', `${id}.html`), `<p>${id} example</p>`);
  }
  return dir;
}

async function withUi(dir, fn) {
  const ui = await startUi({ projectDir: dir });
  const get = async (route) => {
    const r = await fetch(ui.url + route);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, type: r.headers.get('content-type'), text, json };
  };
  const post = async (route, body) => {
    const r = await fetch(ui.url + route, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  const answers = (name) => JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'ui', 'answers', `${name}.json`), 'utf8'));
  try { await fn({ ui, get, post, answers }); } finally { ui.close(); await ui.closed; }
}

test('pages and read routes', async () => {
  process.env.FOCUS_BLUEPRINT_DATA = stubCatalog();
  const dir = project();
  try {
    await withUi(dir, async ({ get }) => {
      for (const route of ['brain-dump', 'questionnaire?round=a', 'catalog', 'board']) {
        const r = await get(route);
        assert.equal(r.status, 200, route);
        assert.match(r.type, /text\/html/);
        assert.match(r.text, /<html lang="he" dir="rtl">/);
      }
      for (const f of ['ui.css', 'ui.js', 'strings.he.json']) assert.equal((await get(f)).status, 200, f);
      assert.match((await get('ui.js')).text, /^\/\/ Focus Blueprint local pages/, 'static files are served as text');
      assert.ok((await get('strings.he.json')).json.common.saved);
      assert.equal((await get('nothing')).status, 404);

      const q = await get('api/questions?round=a');
      const ids = q.json.questions.map((x) => x.id);
      assert.ok(ids.includes('a-01'));
      assert.ok(!ids.includes('a-04'), 'a-04 only follows "nobody solves it today"');
      assert.ok(!ids.includes('a-20'), 'a-20 only follows a-18=yes');
      const ctx = await get('api/questions?round=context');
      assert.equal(ctx.json.questions.length, 4);
      assert.equal((await get('api/questions?round=zz')).status, 400);

      const st = await get('api/state');
      assert.equal(st.json.state.project, 'בדיקה');
      assert.ok(Array.isArray(st.json.evals) && Array.isArray(st.json.changes));
      assert.equal(st.json.map.schema, 1);

      const cat = await get('api/catalog');
      assert.deepEqual(Object.keys(cat.json), ['visual', 'nav', 'structure', 'login', 'density']);
      assert.equal(cat.json.visual[0].html, '<p>minimal example</p>');
    });
  } finally { delete process.env.FOCUS_BLUEPRINT_DATA; }
});

test('answers: merge, done, both forms, strangers refused', async () => {
  const dir = project();
  await withUi(dir, async ({ ui, get, post, answers }) => {
    assert.equal((await post('api/answer', { name: 'round-a', id: 'a-01', value: 'בעיה', decidedBy: 'user' })).status, 200);
    assert.equal((await post('api/answer', { name: 'round-a', id: 'a-02', value: ['none'] })).status, 200);
    const doc = answers('round-a');
    assert.equal(doc.answers['a-01'].value, 'בעיה');
    assert.equal(doc.answers['a-01'].decidedBy, 'user');
    assert.deepEqual(doc.answers['a-02'].value, ['none']);
    assert.equal(doc.done, false);
    // a-04 appears once a-02 says "none".
    assert.ok((await get('api/questions?round=a')).json.questions.some((x) => x.id === 'a-04'));

    await post('api/answer', { name: 'round-a', id: 'a-05', value: null, pending: true });
    assert.equal(answers('round-a').answers['a-05'].pending, true);
    await post('api/answer', { name: 'round-a', id: 'a-06', decidedBy: 'claude' });
    assert.equal(answers('round-a').answers['a-06'].decidedBy, 'claude');

    assert.equal((await post('api/done', { name: 'round-a' })).status, 200);
    assert.equal(answers('round-a').done, true);

    // The old form still works and keeps the rest of the file.
    assert.equal((await post('api/answer', { name: 'round-a', answer: 'free' })).status, 200);
    assert.equal(answers('round-a').answer, 'free');
    assert.equal(answers('round-a').answers['a-01'].value, 'בעיה');

    assert.equal((await post('api/answer', { name: '../x', id: 'a', value: 1 })).status, 400);
    assert.equal((await post('api/answer', { name: 'round-a', id: '__proto__', value: 1 })).status, 400);
    const bad = await fetch(`http://127.0.0.1:${ui.port}/wrong/api/answer`, { method: 'POST', headers: JSON_H, body: '{}' });
    assert.equal(bad.status, 404);
    const evil = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: ui.port, path: new URL(ui.url).pathname + 'api/state', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(evil, 403);
    const plain = await fetch(`${ui.url}api/answer`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(plain.status, 415);
  });
});

test('a damaged answers file is never overwritten', async () => {
  const dir = project();
  const file = path.join(dir, '.blueprint', 'ui', 'answers', 'round-a.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ broken');
  await withUi(dir, async ({ post }) => {
    assert.equal((await post('api/answer', { name: 'round-a', id: 'a-01', value: 'x' })).status, 500);
  });
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('(a) why first: done is refused until the why answer is saved; the page locks the textarea', async () => {
  const dir = project();
  await withUi(dir, async ({ get, post }) => {
    const refused = await post('api/done', { name: 'brain-dump' });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.json, { error: 'why missing' });
    await post('api/answer', { name: 'brain-dump', answer: 'הרבה טקסט' });
    assert.equal((await post('api/done', { name: 'brain-dump' })).status, 400);
    assert.equal((await post('api/answer', { name: 'brain-dump', id: 'why', value: 'כי זה כואב' })).status, 200);
    assert.equal((await post('api/done', { name: 'brain-dump' })).status, 200);

    const html = (await get('brain-dump')).text;
    const why = html.indexOf('data-why-first');
    const dump = html.search(/<textarea[^>]*id="dump"/);
    assert.ok(why > -1 && dump > why, 'data-why-first comes before the big textarea');
    assert.match(html.match(/<textarea[^>]*id="dump"[^>]*>/)[0], /\bdisabled\b/);
  });
});

test('(b) prefill: shown as from idea, confirm, replace, done blocked, progress counts confirmed only', async () => {
  const dir = project();
  const file = path.join(dir, '.blueprint', 'ui', 'answers', 'round-a.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ name: 'round-a', answers: {
    'a-03': { value: 'אוהבים את הגיליון', decidedBy: null, from: 'idea', quote: 'הגיליון נוח', confirmed: false },
    'a-01': { value: 'בעיה', decidedBy: 'user', from: 'idea', quote: 'q', confirmed: false },
  }, done: false }));
  await withUi(dir, async ({ get, post, answers }) => {
    const q = (await get('api/questions?round=a')).json.questions.find((x) => x.id === 'a-03');
    assert.equal(q.answer.from, 'idea');
    assert.equal(q.answer.confirmed, false);

    const done = await post('api/done', { name: 'round-a' });
    assert.equal(done.status, 409);
    assert.equal(done.json.error, 'unconfirmed prefill');
    assert.deepEqual(done.json.ids.sort(), ['a-01', 'a-03']);

    const progress = () => spawnSync(process.execPath, [path.join(PLUGIN, 'ui', 'wait.mjs'), '--project', dir, '--name', 'round-a', '--until', 'done', '--timeout', '1'], { encoding: 'utf8' });
    assert.match(progress().stderr, /answered: 0\//);

    await post('api/answer', { name: 'round-a', id: 'a-03', confirm: true });
    const a3 = answers('round-a').answers['a-03'];
    assert.equal(a3.confirmed, true);
    assert.equal(a3.decidedBy, 'user');
    assert.equal(a3.from, 'idea');

    await post('api/answer', { name: 'round-a', id: 'a-01', value: 'חדש' });
    const a1 = answers('round-a').answers['a-01'];
    assert.equal(a1.value, 'חדש');
    assert.equal(a1.from, undefined);
    assert.equal(a1.decidedBy, 'user');
    assert.match(progress().stderr, /answered: 2\//);

    assert.equal((await post('api/done', { name: 'round-a' })).status, 200);
  });
});

test('(c) state carries rulings and the close of each stage', async () => {
  const dir = project();
  await withUi(dir, async ({ get }) => {
    const st = (await get('api/state')).json;
    assert.equal(st.rulings.length, 1);
    assert.equal(st.rulings[0].id, 'r-001');
    assert.equal(st.closes['3'].status, 'done_with_concerns');
    assert.equal(st.closes['12'].status, 'blocked');
    assert.equal(st.git.available, true);
    assert.equal(st.git.branch, 'main');
  });
});

test('wait.mjs --until done exits 0 only on done and prints progress', async () => {
  const dir = project();
  await withUi(dir, async ({ post }) => {
    await post('api/answer', { name: 'round-a', id: 'a-01', value: 'x' });
    const child = spawn(process.execPath, [path.join(PLUGIN, 'ui', 'wait.mjs'), '--project', dir, '--name', 'round-a', '--until', 'done', '--timeout', '20'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const exit = new Promise((r) => child.on('close', r));
    await new Promise((r) => setTimeout(r, 1500));
    assert.match(err, /answered: 1\/\d+/);
    assert.equal(out, '', 'nothing on stdout before done');
    await post('api/done', { name: 'round-a' });
    assert.equal(await exit, 0);
    assert.equal(JSON.parse(out).done, true);
  });
});

test('serve.mjs --page prints the page address', async () => {
  const dir = project();
  const child = spawn(process.execPath, [path.join(PLUGIN, 'ui', 'serve.mjs'), '--project', dir, '--page', 'questionnaire', '--round', 'a', '--no-open'], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const line = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(String(d).trim())));
    assert.match(line, /^URL http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/questionnaire\?round=a$/);
    const r = await fetch(line.slice(4));
    assert.equal(r.status, 200);
  } finally { child.kill(); }
});
