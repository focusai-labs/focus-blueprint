// The three directions: parsing, the files/ route guard, answer validation, the page.
// Run: node --test test/directions.test.mjs
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN, tmpProject } from './helpers.mjs';

const { startUi, safeAssetFile } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'server.mjs')).href);
const lib = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'lib.mjs')).href);
const JSON_H = { 'Content-Type': 'application/json' };

const HEAD = (title) => `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<style id="fonts">@font-face { font-family: 'X'; src: url(../design/assets/fonts/x.woff2) format('woff2'); }</style>
<style id="frame">body { margin: 0; }</style><style id="direction">.d1 .screen { color: red; }</style></head>`;
const SYMBOLS = '<svg id="symbols" width="0" height="0"><defs><symbol id="mark" viewBox="0 0 1 1"></symbol></defs></svg>';
const withMarkers = (name, move, cls) => `<!doctype html><html lang="he" dir="rtl">${HEAD('t')}<body>${SYMBOLS}<div class="page"><header><h1 class="dir-name">${name}</h1><p class="dir-move">${move}</p></header>
<div class="phones ${cls}">
<!-- screen:walker -->
<figure class="phone"><figcaption>x</figcaption><div class="viewport"><main class="screen walker" data-caption="הטיולים &amp; עוד"><h1>שלום</h1><img src="../design/assets/photos/p.jpg"></main></div></figure>
<!-- /screen:walker -->
<!-- screen:owner -->
<main class="screen owner"><h1>בעלים</h1></main>
<!-- /screen:owner -->
</div></div></body></html>`;
const noMarkers = `<!doctype html><html lang="he" dir="rtl">${HEAD('כיוון בלי סימונים')}<body>${SYMBOLS}<main class="screen"><h1>מסך יחיד</h1></main></body></html>`;

function project() {
  const dir = tmpProject({});
  const w = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), txt); };
  w('mockup/_direction-1.html', withMarkers('המסלול', 'רעיון ראשון', 'd1'));
  w('mockup/_direction-2.html', withMarkers('גדול וברור', 'רעיון שני', 'd2'));
  w('mockup/_direction-3.html', noMarkers);
  w('mockup/page.html', '<p>hi</p>');
  w('design/assets/fonts/x.woff2', 'FONT');
  w('design/assets/fonts/y.ttf', 'FONT');
  w('design/assets/photos/p.jpg', 'JPG');
  w('design/assets/photos/p.JPG', 'JPG');
  w('design/assets/brand/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  w('design/notes.md', 'no');
  w('design/data.json', '{}');
  w('mockup/mock.css', 'body{}');
  w('mockup/mock.js', '1');
  w('mockup/תמונה.png', 'PNG');
  w('.env', 'SECRET=1');
  w('.git/config.html', 'x');
  w('.blueprint/map.json', '{}');
  w('.hidden/inner.png', 'x');
  w('mockup/.dot.png', 'x');
  w('node_modules/pkg/index.js', 'x');
  w('secret.html', '<p>top secret</p>');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-out-'));
  fs.writeFileSync(path.join(outside, 'out.png'), 'x');
  try { fs.symlinkSync(path.join(outside, 'out.png'), path.join(dir, 'mockup', 'link.png')); fs.symlinkSync(outside, path.join(dir, 'mockup', 'dirlink')); } catch { /* no symlinks here */ }
  return dir;
}

async function withUi(dir, fn) {
  const ui = await startUi({ projectDir: dir });
  const get = async (route) => {
    const r = await fetch(ui.url + route);
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, type: r.headers.get('content-type'), text: buf.toString('utf8'), json: (() => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } })() };
  };
  const post = async (route, body) => {
    const r = await fetch(ui.url + route, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  // A raw request, so the path reaches the server exactly as written.
  const raw = (rawPath, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: ui.port, path: new URL(ui.url).pathname + rawPath, headers }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  const answers = () => JSON.parse(fs.readFileSync(path.join(dir, '.blueprint', 'ui', 'answers', 'directions.json'), 'utf8'));
  try { await fn({ ui, get, post, raw, answers }); } finally { ui.close(); await ui.closed; }
}

test('parsing: directions, names, captions, with and without markers', () => {
  const dir = project();
  const sum = lib.directionsSummary(dir);
  assert.deepEqual(sum.directions.map((d) => d.n), [1, 2, 3]);
  assert.equal(sum.directions[0].name, 'המסלול');
  assert.equal(sum.directions[0].move, 'רעיון ראשון');
  assert.deepEqual(sum.directions[0].screens, [{ key: 'walker', caption: 'הטיולים & עוד' }, { key: 'owner', caption: 'owner' }], 'a missing data-caption falls back to the key');
  assert.deepEqual(sum.directions[2].screens, [{ key: 'main', caption: 'המסך המרכזי' }], 'no markers: the whole body is one screen');
  assert.equal(sum.directions[2].name, 'כיוון בלי סימונים', 'the title names a direction without a heading');
  assert.deepEqual(sum.screens.map((s) => s.key), ['walker', 'owner', 'main']);
  // A missing direction file is skipped, not an error.
  fs.rmSync(path.join(dir, 'mockup', '_direction-2.html'));
  assert.deepEqual(lib.directionsSummary(dir).directions.map((d) => d.n), [1, 3]);
  assert.deepEqual(lib.directionsSummary(tmpProject({})), { directions: [], screens: [] });
});

test('api/directions and api/direction-screen', async () => {
  const dir = project();
  await withUi(dir, async ({ ui, get }) => {
    const r = await get('api/directions');
    assert.equal(r.status, 200);
    assert.equal(r.json.directions.length, 3);
    const s = await get('api/direction-screen?n=1&screen=walker');
    assert.equal(s.status, 200);
    assert.match(s.type, /text\/html/);
    assert.match(s.text, /^<!doctype html><html lang="he" dir="rtl">/);
    const token = new URL(ui.url).pathname;
    assert.ok(s.text.includes(`<base href="${token}files/mockup/">`), 'base points at the mockup folder on this server');
    assert.ok(s.text.includes('id="fonts"') && s.text.includes('id="direction"'), 'the original styles stay');
    assert.ok(s.text.indexOf('id="symbols"') > s.text.indexOf('</head>') && s.text.indexOf('id="symbols"') < s.text.indexOf('class="screen walker"'), 'symbols before the screen');
    assert.ok(s.text.includes('<div class="d1">'), 'the direction class that scopes its rules is kept');
    assert.ok(s.text.includes('<h1>שלום</h1>'));
    assert.ok(!s.text.includes('<h1>בעלים</h1>') && !s.text.includes('figcaption'), 'only that screen');
    assert.equal((s.text.match(/<title>/g) || []).length, 1);
    const whole = await get('api/direction-screen?n=3&screen=main');
    assert.equal(whole.status, 200);
    assert.ok(whole.text.includes('מסך יחיד'));
    for (const bad of ['n=9&screen=walker', 'n=1&screen=nope', 'n=1', 'screen=walker', 'n=x&screen=walker', 'n=1&screen=../x']) {
      assert.equal((await get(`api/direction-screen?${bad}`)).status, 404, bad);
    }
  });
});

test('files/ serves assets with the right types and refuses everything else', async () => {
  const dir = project();
  await withUi(dir, async ({ get, raw }) => {
    const font = await get('files/design/assets/fonts/x.woff2');
    assert.equal(font.status, 200); assert.equal(font.type, 'font/woff2'); assert.equal(font.headers.get('access-control-allow-origin'), '*'); assert.equal(font.text, 'FONT');
    assert.equal((await get('files/design/assets/fonts/y.ttf')).type, 'font/ttf');
    const photo = await get('files/design/assets/photos/p.jpg');
    assert.equal(photo.type, 'image/jpeg'); assert.equal(photo.headers.get('access-control-allow-origin'), null, 'only fonts get the CORS header');
    assert.equal((await get('files/design/assets/photos/p.JPG')).type, 'image/jpeg', 'extensions are case-insensitive');
    assert.equal((await get('files/design/assets/brand/logo.svg')).type, 'image/svg+xml');
    assert.match((await get('files/mockup/mock.css')).type, /^text\/css/);
    assert.match((await get('files/mockup/mock.js')).type, /^text\/javascript/);
    assert.match((await get('files/mockup/page.html')).type, /^text\/html/);
    assert.equal((await get(`files/mockup/${encodeURIComponent('תמונה.png')}`)).type, 'image/png', 'encoded Hebrew names work');
    assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');

    for (const bad of [
      'files/.env', 'files/.git/config.html', 'files/.blueprint/map.json', 'files/.hidden/inner.png', 'files/mockup/.dot.png', 'files/node_modules/pkg/index.js',
      'files/design/notes.md', 'files/design/data.json', 'files/mockup', 'files/mockup/', 'files/nothing.png', 'files/design/assets/fonts/x.woff2.bak',
      'files/%2e%2e/secret.html', 'files/mockup/..%2fsecret.html', 'files/mockup/%2e%2e%2fsecret.html', 'files/mockup%2f..%2fsecret.html',
      'files/mockup/link.png', 'files/mockup/dirlink/out.png', 'files/mockup/%00.png', 'files/mockup/%ZZ.png', 'files/C:/x.png', 'files/mockup/a%5Cb.png',
    ]) {
      const st = await raw(bad);
      assert.ok(st === 404, `${bad} gave ${st}`);
    }
    // traversal written raw, with and without normalization by the client
    assert.equal(await raw('files/mockup/../../secret.html'), 404);
    assert.equal(await raw('files/../secret.html'), 404);
    assert.equal(await raw('files/'), 404);
    assert.equal(await raw('files'), 404);
    // a dot segment the client normalizes stays inside the project, so it is the same as files/secret.html
    assert.equal(await raw('files/mockup/%2e%2e/secret.html'), 200);
    assert.equal(await raw('files/mockup/%2e%2e/%2e%2e/secret.html'), 404);
  });
  const dir2 = project();
  const ui = await startUi({ projectDir: dir2 });
  try {
    assert.equal((await fetch(`${ui.url}files/mockup/page.html`, { method: 'POST' })).status, 404, 'GET only');
    assert.equal((await fetch(`${ui.url}files/mockup/page.html`, { method: 'PUT', body: 'x' })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${ui.port}/wrong/files/mockup/page.html`)).status, 404, 'the token is needed');
  } finally { ui.close(); await ui.closed; }
});

test('safeAssetFile resolves inside the project only', () => {
  const dir = project();
  assert.ok(safeAssetFile(dir, ['mockup', 'page.html']));
  assert.equal(safeAssetFile(dir, ['mockup', '..', 'secret.html']), null);
  assert.equal(safeAssetFile(dir, ['secret.html']).type.startsWith('text/html'), true);
  assert.equal(safeAssetFile(dir, []), null);
  assert.equal(safeAssetFile(dir, ['mockup', '.dot.png']), null);
  assert.equal(safeAssetFile(dir, ['.env']), null);
  assert.equal(safeAssetFile(dir, ['..', path.basename(dir), 'secret.html']), null);
  assert.equal(safeAssetFile(dir, [path.join(dir, 'secret.html')]), null);
});

test('answers for directions: exactly screen:<key> and note, validated against the files', async () => {
  const dir = project();
  await withUi(dir, async ({ post, answers }) => {
    assert.equal((await post('api/answer', { name: 'directions', id: 'screen:walker', value: 2 })).status, 200);
    assert.equal((await post('api/answer', { name: 'directions', id: 'screen:main', value: 3 })).status, 200);
    assert.equal((await post('api/answer', { name: 'directions', id: 'note', value: 'הכפתור גדול יותר' })).status, 200);
    const doc = answers();
    assert.equal(doc.answers['screen:walker'].value, 2);
    assert.equal(doc.answers.note.value, 'הכפתור גדול יותר');
    // a later choice replaces the earlier one
    await post('api/answer', { name: 'directions', id: 'screen:walker', value: 1 });
    assert.equal(answers().answers['screen:walker'].value, 1);
    for (const bad of [
      { id: 'screen:nope', value: 1 }, { id: 'screen:walker', value: 3 } /* direction 3 has no walker */, { id: 'screen:walker', value: 4 },
      { id: 'screen:walker', value: '1' }, { id: 'screen:walker', value: 1.5 }, { id: 'screen:walker', value: null }, { id: 'screen:walker' },
      { id: 'screen:', value: 1 }, { id: 'screen:__proto__', value: 1 }, { id: 'other', value: 1 }, { id: 'note', value: 5 }, { id: 'note', value: 'x'.repeat(5001) },
      { id: 'note', pending: true }, { id: 'screen:walker', confirm: true }, { answer: 'free' },
    ]) {
      const r = await post('api/answer', { name: 'directions', ...bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(answers().answers['screen:walker'].value, 1, 'refused writes change nothing');

    // done needs a choice for every screen (walker, owner, main)
    const early = await post('api/done', { name: 'directions' });
    assert.equal(early.status, 409);
    assert.deepEqual(early.json.screens, ['owner']);
    await post('api/answer', { name: 'directions', id: 'screen:owner', value: 2 });
    assert.equal((await post('api/done', { name: 'directions' })).status, 200);
    assert.equal(answers().done, true);
    const { progress } = lib;
    assert.deepEqual(progress(dir, 'directions'), { answered: 4, total: null, done: true });
  });
});

test('wait.mjs --name directions --until done returns once the page is done', async () => {
  const { spawn } = await import('node:child_process');
  const dir = project();
  const ui = await startUi({ projectDir: dir });
  try {
    const child = spawn(process.execPath, [path.join(PLUGIN, 'ui', 'wait.mjs'), '--project', dir, '--name', 'directions', '--until', 'done', '--timeout', '20'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    const exit = new Promise((resolve) => child.on('exit', resolve));
    const post = (body, route = 'api/answer') => fetch(ui.url + route, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });
    for (const [k, n] of [['walker', 1], ['owner', 2], ['main', 3]]) await post({ name: 'directions', id: `screen:${k}`, value: n });
    assert.equal((await post({ name: 'directions' }, 'api/done')).status, 200);
    assert.equal(await exit, 0);
    assert.equal(JSON.parse(out).done, true);
  } finally { ui.close(); await ui.closed; }
});

test('the page files exist, use the strings block and avoid the files another branch owns', () => {
  const pages = path.join(PLUGIN, 'ui', 'pages');
  const html = fs.readFileSync(path.join(pages, 'directions.html'), 'utf8');
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /href="ui\.css"/);
  assert.match(html, /src="directions\.js"/);
  const strings = JSON.parse(fs.readFileSync(path.join(pages, 'strings.he.json'), 'utf8'));
  const js = fs.readFileSync(path.join(pages, 'directions.js'), 'utf8');
  for (const [, key] of js.matchAll(/\bt\('([\w.]+)'/g)) {
    const found = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), strings);
    assert.equal(typeof found, 'string', `string ${key} exists`);
  }
  for (const key of Object.keys(strings.directions)) assert.equal(typeof strings.directions[key], 'string');
  assert.doesNotMatch(js, /https?:\/\//, 'no external script or address');
  assert.match(js, /window\.BP\.register\('directions'/);
});

test('the catalog is gone and nothing refers to it', () => {
  const root = path.resolve(PLUGIN, '..', '..');
  for (const rel of ['plugins/focus-blueprint/data/catalog', 'plugins/focus-blueprint/ui/pages/catalog.html', 'test/catalog.test.mjs', 'test/fixtures/catalog']) {
    assert.ok(!fs.existsSync(path.join(root, ...rel.split('/'))), rel);
  }
  assert.equal(lib.loadCatalog, undefined);
  assert.equal(lib.CATALOG_DIMENSIONS, undefined);
  for (const f of ['server.mjs', 'serve.mjs', 'lib.mjs']) assert.doesNotMatch(fs.readFileSync(path.join(PLUGIN, 'ui', f), 'utf8'), /catalog/i, f);
  const b = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'questions', 'round-b.json'), 'utf8')).questions;
  assert.ok(!b.some((q) => q.id === 'b-03' || q.writes === 'spec.style.visual'), 'the visual-language question is gone');
  for (const id of ['b-04', 'b-05', 'b-06', 'b-07']) {
    const q = b.find((x) => x.id === id);
    for (const o of q.options) assert.match(o.hint, /^מתאים \S/, `${id}/${o.v} has a hint`);
  }
});
