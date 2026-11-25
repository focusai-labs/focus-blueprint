// The prototype review page: routes, rounds, wait.mjs, registration and strings.
// Run: node --test test/prototype-review.test.mjs
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PLUGIN, ROOT, tmpProject } from './helpers.mjs';

const { startUi } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'server.mjs')).href);
const { extractScreenDocs } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'prototype.mjs')).href);
const pages = path.join(PLUGIN, 'ui', 'pages');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'prototype-fake.html');
const strings = JSON.parse(fs.readFileSync(path.join(pages, 'strings.he.json'), 'utf8'));
const JSON_H = { 'Content-Type': 'application/json' };

const SCREENS = ['mockup/home.html', 'mockup/report.html', 'mockup/settings.html', 'mockup/later.html'];
function project({ withPrototype = true } = {}) {
  const map = { schema: 1, capabilities: [], tables: [], automations: [], later: [], screens: SCREENS.map((file) => ({ file, name: file, persona: 'owner' })) };
  const dir = tmpProject({ state: { schema: 2, project: 'בדיקה', stage: 7, status: 'in_progress', stages: {}, pending: [], connections: {}, where: {} }, map });
  fs.mkdirSync(path.join(dir, 'mockup'));
  for (const f of SCREENS.slice(0, 3)) fs.writeFileSync(path.join(dir, f), `<p>${f}</p>`);
  if (withPrototype) fs.copyFileSync(FAKE, path.join(dir, 'mockup', 'prototype.html'));
  return dir;
}
const proto = (dir) => path.join(dir, 'mockup', 'prototype.html');
const saved = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'ui', 'answers', 'prototype.json'), 'utf8'));

async function withUi(dir, fn, opts = {}) {
  const ui = await startUi({ projectDir: dir, ...opts });
  const get = async (route) => {
    const r = await fetch(ui.url + route);
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const post = async (route, body, headers = JSON_H) => {
    const r = await fetch(ui.url + route, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  try { await fn({ ui, get, post }); } finally { ui.close(); await ui.closed; }
}

test('GET api/prototype: no prototype yet, then round 1 with nothing saved', async () => {
  await withUi(project({ withPrototype: false }), async ({ get }) => {
    assert.deepEqual((await get('api/prototype')).json, { exists: false, round: 1, done: false, screens: {}, previousRound: null });
  });
  await withUi(project(), async ({ get }) => {
    assert.deepEqual((await get('api/prototype')).json, { exists: true, round: 1, done: false, screens: {}, previousRound: null });
  });
});

test('POST api/prototype-note: validation and errors', async () => {
  const dir = project();
  await withUi(dir, async ({ post, ui }) => {
    const bad = async (body, status, error) => { const r = await post('api/prototype-note', body); assert.equal(r.status, status, JSON.stringify(body)); assert.equal(r.json.error, error); };
    await bad({ file: 'mockup/nope.html', note: 'x' }, 400, 'unknown screen');
    await bad({ file: '../etc/passwd', note: 'x' }, 400, 'unknown screen');
    await bad({ note: 'x' }, 400, 'unknown screen');
    await bad({ file: SCREENS[0], note: 5 }, 400, 'bad note');
    await bad({ file: SCREENS[0], note: 'x'.repeat(5001) }, 400, 'bad note');
    await bad({ file: SCREENS[0], approved: 'yes' }, 400, 'bad approved');
    await bad({ file: SCREENS[0] }, 400, 'nothing to save');
    assert.ok(!fs.existsSync(path.join(dir, '.blueprint', 'ui', 'answers', 'prototype.json')), 'nothing was written');
    const text = await fetch(ui.url + 'api/prototype-note', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(text.status, 415);
    assert.equal((await post('api/prototype-note', '{oops')).status, 400);
    assert.equal((await post('api/prototype-note', [1])).status, 400);
  });
  await withUi(project({ withPrototype: false }), async ({ post }) => {
    const r = await post('api/prototype-note', { file: SCREENS[0], note: 'x' });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'no prototype');
    assert.equal((await post('api/prototype-done', {})).status, 404);
  });
});

test('a note and an approval are saved, merged and give the status', async () => {
  const dir = project();
  await withUi(dir, async ({ post, get }) => {
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], note: 'הכפתור קטן' })).json.status, 'note');
    assert.deepEqual(saved(dir).screens[SCREENS[0]], { status: 'note', note: 'הכפתור קטן' });
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], approved: true })).json.status, 'approved');
    assert.deepEqual(saved(dir).screens[SCREENS[0]], { status: 'approved', note: 'הכפתור קטן' }, 'the note stays');
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], approved: false })).json.status, 'note');
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], note: '   ' })).json.status, 'open');
    await post('api/prototype-note', { file: SCREENS[1], approved: true });
    const st = (await get('api/prototype')).json;
    assert.equal(st.screens[SCREENS[1]].status, 'approved');
    assert.ok(saved(dir).updatedAt);
    assert.equal(saved(dir).round, 1);
  });
});

test('done: snapshot, history, and a second done changes nothing', async () => {
  const dir = project();
  await withUi(dir, async ({ post, get }) => {
    await post('api/prototype-note', { file: SCREENS[0], note: 'אחת' });
    const r = await post('api/prototype-done', {});
    assert.deepEqual(r.json, { ok: true, round: 1 });
    const snap = path.join(dir, '.blueprint', 'ui', 'prototype', 'round-1.html');
    assert.equal(fs.readFileSync(snap, 'utf8'), fs.readFileSync(proto(dir), 'utf8'));
    const doc = saved(dir);
    assert.equal(doc.done, true);
    assert.deepEqual(doc.history, [{ round: 1, screens: { [SCREENS[0]]: { status: 'note', note: 'אחת' } } }]);
    // the round is closed: no more notes until the next one starts
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], note: 'עוד' })).status, 409);
    assert.deepEqual((await post('api/prototype-done', {})).json, { ok: true, round: 1 });
    assert.equal(saved(dir).history.length, 1);
    // the snapshot is served like files/
    const s = await get('api/prototype-round?n=1');
    assert.equal(s.status, 200);
    assert.match(s.headers.get('content-type'), /text\/html/);
    assert.match(s.headers.get('content-security-policy'), /^sandbox allow-scripts/);
    assert.equal(s.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(s.text, fs.readFileSync(proto(dir), 'utf8'));
  });
});

test('GET api/prototype-round: bad and missing rounds', async () => {
  await withUi(project(), async ({ get }) => {
    for (const q of ['', '?n=', '?n=0', '?n=-1', '?n=abc', '?n=1.5', '?n=99999', '?n=../x']) assert.equal((await get(`api/prototype-round${q}`)).status, 400, q);
    assert.equal((await get('api/prototype-round?n=1')).status, 404);
  });
});

test('the next round resets every status except an approved screen that did not change', async () => {
  const dir = project();
  await withUi(dir, async ({ post, get }) => {
    await post('api/prototype-note', { file: SCREENS[0], note: 'לשנות' });
    await post('api/prototype-note', { file: SCREENS[1], approved: true });
    await post('api/prototype-note', { file: SCREENS[2], approved: true, note: 'אושר אבל' });
    await post('api/prototype-done', {});
    // the student fixes screen 3 only (the documents are the bundler's, one per screen)
    fs.writeFileSync(proto(dir), fs.readFileSync(proto(dir), 'utf8').replace('settings v1', 'settings v2'));
    const st = (await get('api/prototype')).json;
    assert.equal(st.round, 2);
    assert.equal(st.done, false);
    assert.deepEqual(st.screens, { [SCREENS[1]]: { status: 'approved', note: '' } }, 'the changed and the noted screens are open again');
    assert.deepEqual(st.previousRound.n, 1);
    assert.equal(st.previousRound.snapshot, true);
    assert.equal(st.previousRound.screens[SCREENS[0]].note, 'לשנות');
    assert.equal(st.previousRound.screens[SCREENS[2]].note, 'אושר אבל');
    // reading again does not start another round
    assert.equal((await get('api/prototype')).json.round, 2);
    assert.equal(saved(dir).round, 2);
    // a note works again, and finishing round 2 keeps both rounds
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], note: 'שוב' })).status, 200);
    await post('api/prototype-done', {});
    const doc = saved(dir);
    assert.deepEqual(doc.history.map((x) => x.round), [1, 2]);
    assert.ok(fs.existsSync(path.join(dir, '.blueprint', 'ui', 'prototype', 'round-2.html')));
  });
});

test('a prototype without per-screen documents compares the whole file', async () => {
  const dir = project();
  const plain = '<!doctype html><title>x</title><p>no documents here</p>';
  fs.writeFileSync(proto(dir), plain);
  await withUi(dir, async ({ post, get }) => {
    await post('api/prototype-note', { file: SCREENS[1], approved: true });
    await post('api/prototype-done', {});
    assert.deepEqual((await get('api/prototype')).json.screens, { [SCREENS[1]]: { status: 'approved', note: '' } }, 'identical file, approval stays');
    await post('api/prototype-note', { file: SCREENS[1], approved: true });
    await post('api/prototype-done', {});
    fs.writeFileSync(proto(dir), `${plain}<p>changed</p>`);
    assert.deepEqual((await get('api/prototype')).json.screens, {}, 'a changed file resets everything');
  });
});

test('extractScreenDocs reads the bundler\'s JSON blocks and ignores the rest', () => {
  const html = fs.readFileSync(FAKE, 'utf8');
  assert.deepEqual(Object.keys(extractScreenDocs(html, SCREENS)).sort(), SCREENS.slice(0, 3).sort());
  assert.equal(extractScreenDocs('<script type="application/json">{not json</script>', SCREENS), null);
  const short = '<script type="application/json">{"screens":{"home":{"doc":"<p>a</p>"},"report.html":"<p>b</p>"}}</script>';
  assert.deepEqual(extractScreenDocs(short, SCREENS), { 'mockup/home.html': '<p>a</p>', 'mockup/report.html': '<p>b</p>' });
});

test('the page, its files and the board link are served; the board state says whether the prototype exists', async () => {
  const dir = project();
  await withUi(dir, async ({ get }) => {
    const page = await get('prototype');
    assert.equal(page.status, 200);
    assert.match(page.text, /data-page="prototype"/);
    for (const f of ['prototype.js', 'prototype.css']) assert.equal((await get(f)).status, 200, f);
    assert.equal((await get('files/mockup/prototype.html')).status, 200);
    assert.equal((await get('api/state')).json.prototype, true);
  });
  await withUi(project({ withPrototype: false }), async ({ get }) => {
    assert.equal((await get('api/state')).json.prototype, false);
  });
  const ui = fs.readFileSync(path.join(pages, 'ui.js'), 'utf8');
  assert.match(ui, /s\.prototype \? h\('a', \{ class: 'link', href: 'prototype'.*t\('prototype\.boardLink'\)/);
});

test('with --once the server stays for the notes and stops after the round is finished', async () => {
  const dir = project();
  await withUi(dir, async ({ ui, post }) => {
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], note: 'a' })).status, 200);
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], note: 'b' })).status, 200, 'still running after a note');
    await post('api/prototype-done', {});
    await Promise.race([ui.closed, new Promise((_, rej) => setTimeout(() => rej(new Error('did not stop')), 3000))]);
  }, { once: true });
});

test('wait.mjs --name prototype --until done returns when the round is finished', async () => {
  const dir = project();
  await withUi(dir, async ({ post }) => {
    const child = spawn(process.execPath, [path.join(PLUGIN, 'ui', 'wait.mjs'), '--project', dir, '--name', 'prototype', '--until', 'done', '--timeout', '20'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const exit = new Promise((resolve) => child.once('exit', resolve));
    await post('api/prototype-note', { file: SCREENS[0], note: 'הערה' });
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(child.exitCode, null, 'still waiting after a note');
    await post('api/prototype-done', {});
    assert.equal(await exit, 0);
    const doc = JSON.parse(out);
    assert.equal(doc.done, true);
    assert.equal(doc.history[0].screens[SCREENS[0]].note, 'הערה');
    assert.match(err, /answered: 1/);
  });
});

test('registration: PAGES, STATIC, serve.mjs and the page files', () => {
  const server = fs.readFileSync(path.join(PLUGIN, 'ui', 'server.mjs'), 'utf8');
  assert.match(server, /const PAGES = new Set\(\[[^\]]*'prototype'\]\)/);
  assert.match(server, /'prototype\.js': 'text\/javascript; charset=utf-8'/);
  assert.match(server, /'prototype\.css': 'text\/css; charset=utf-8'/);
  assert.match(fs.readFileSync(path.join(PLUGIN, 'ui', 'serve.mjs'), 'utf8'), /'prototype'\]\.includes\(page\)/);
  const html = fs.readFileSync(path.join(pages, 'prototype.html'), 'utf8');
  assert.match(html, /<header class="appbar" id="appbar"><span id="save" class="save" role="status" aria-live="polite"><\/span><\/header>/);
  assert.match(html, /<script src="ui\.js" defer><\/script>\s*<script src="prototype\.js" defer><\/script>/);
  assert.match(html, /localStorage\.getItem\('bp-theme'\)/);
  assert.match(html, /<link rel="stylesheet" href="prototype\.css">/);
  assert.match(fs.readFileSync(path.join(pages, 'prototype.js'), 'utf8'), /register\('prototype', prototypePage\)/);
});

test('strings: the prototype block is the contract\'s, and every key the page uses exists', () => {
  assert.deepEqual(strings.prototype, {
    title: 'סקירת המסכים',
    intro: 'עוברים על המסכים כמו משתמש, ומשאירים לכל מסך הערה או אישור.',
    screens: 'המסכים',
    approved: 'מאושר',
    hasNote: 'יש הערה',
    open: 'עוד לא נבדק',
    noteLabel: 'מה לשנות במסך הזה',
    approve: 'מאשר את המסך',
    previousNote: 'ההערה מהסבב הקודם',
    showPrevious: 'הגרסה הקודמת',
    hidePrevious: 'להסתיר את הגרסה הקודמת',
    before: 'לפני התיקון',
    after: 'אחרי התיקון',
    round: 'סבב {n}',
    done: 'סיימתי את הסבב',
    doneNote: 'ההערות נשמרו. אפשר לחזור לשיחה עם Claude.',
    missing: 'עוד אין אב טיפוס. Claude בונה אותו בשלב 7.',
    boardLink: 'פתיחת אב הטיפוס',
  });
  const lookup = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), strings);
  const js = fs.readFileSync(path.join(pages, 'prototype.js'), 'utf8');
  const html = fs.readFileSync(path.join(pages, 'prototype.html'), 'utf8');
  const keys = new Set([...js.matchAll(/'((?:prototype|directions|common)\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-(?:t|t-ph|title)="([^"]+)"/g)) keys.add(m[1]);
  assert.ok(keys.size >= 15);
  for (const k of keys) assert.equal(typeof lookup(k), 'string', k);
  // every prototype string is used by the page, except the board's link (ui.js)
  const used = new Set([...keys].filter((k) => k.startsWith('prototype.')).map((k) => k.slice(10)));
  assert.deepEqual(Object.keys(strings.prototype).filter((k) => !used.has(k)), ['boardLink']);
  assert.doesNotMatch(js + html, /[֐-׿]/, 'no Hebrew text outside strings.he.json');
});

test('the stylesheet keeps motion behind the reduced-motion guard and has no hard-coded text', () => {
  const css = fs.readFileSync(path.join(pages, 'prototype.css'), 'utf8');
  const at = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(at > 0);
  assert.doesNotMatch(css.slice(0, at), /\b(transition|animation)\s*:/);
  assert.doesNotMatch(css, /content:\s*["'][^"']/);
});
