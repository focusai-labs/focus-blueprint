// The notes on the wired prototype: module, bp commands, local server routes, board state.
// Run: node --test test/prototype-notes.test.mjs
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const { startUi } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'server.mjs')).href);
const { addNote, doneNote, listNotes } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'prototype-notes.mjs')).href);
const strings = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'ui', 'pages', 'strings.he.json'), 'utf8'));

const SCREENS = ['mockup/home.html', 'mockup/report.html', 'mockup/later.html'];
function project({ withPrototype = true } = {}) {
  const map = { schema: 1, capabilities: [], tables: [], automations: [], later: [], screens: SCREENS.map((file, i) => ({ file, name: `מסך ${i + 1}`, persona: 'owner' })) };
  const dir = tmpProject({ state: { schema: 2, project: 'בדיקה', stage: 7, status: 'in_progress', stages: {}, pending: [], connections: {}, where: {} }, map });
  fs.mkdirSync(path.join(dir, 'mockup'));
  for (const f of SCREENS.slice(0, 2)) fs.writeFileSync(path.join(dir, f), `<p>${f}</p>`);
  if (withPrototype) fs.writeFileSync(path.join(dir, 'mockup', 'prototype.html'), '<p>proto</p>');
  return dir;
}
const file = (dir) => path.join(dir, '.blueprint', 'prototype-notes.json');

test('addNote: appends, validates screen, text and source, skips a duplicate ref', () => {
  const dir = project();
  assert.deepEqual(listNotes(dir), []);
  const a = addNote(dir, { screen: SCREENS[0], text: ' להגדיל את הכפתור ', source: 'artifact', ref: 'c1' });
  assert.equal(a.status, 200);
  const n = a.body.note;
  assert.deepEqual(Object.keys(n), ['id', 'screen', 'text', 'source', 'ref', 'at', 'status', 'how', 'doneAt']);
  assert.equal(n.text, 'להגדיל את הכפתור'); assert.equal(n.status, 'open'); assert.equal(n.ref, 'c1');
  const dup = addNote(dir, { screen: SCREENS[1], text: 'אחר', source: 'artifact', ref: 'c1' });
  assert.equal(dup.body.duplicate, true);
  assert.equal(listNotes(dir).length, 1);
  assert.equal(addNote(dir, { screen: SCREENS[1], text: 'x' }).body.note.source, 'local');
  for (const bad of [{ screen: 'mockup/nope.html', text: 'x' }, { screen: '../x', text: 'x' }, { screen: SCREENS[0], text: '' }, { screen: SCREENS[0], text: '   ' }, { screen: SCREENS[0], text: 'x'.repeat(2001) }, { screen: SCREENS[0], text: 5 }, { screen: SCREENS[0], text: 'x', source: 'web' }]) {
    assert.equal(addNote(dir, bad).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(addNote(dir, { screen: SCREENS[0], text: 'x'.repeat(2000) }).status, 200);
  assert.deepEqual(fs.readdirSync(path.dirname(file(dir))).filter((f) => f.endsWith('.tmp')), []);
});

test('doneNote closes a note and keeps the rest; unknown id is 404', () => {
  const dir = project();
  const id = addNote(dir, { screen: SCREENS[0], text: 'a' }).body.note.id;
  addNote(dir, { screen: SCREENS[0], text: 'b' });
  assert.equal(doneNote(dir, 'nope').status, 404);
  const d = doneNote(dir, id, 'הוגדל');
  assert.equal(d.body.note.status, 'done'); assert.equal(d.body.note.how, 'הוגדל'); assert.ok(d.body.note.doneAt);
  assert.equal(listNotes(dir).length, 2);
  assert.deepEqual(listNotes(dir, { openOnly: true }).map((x) => x.text), ['b']);
});

test('bp prototype notes: list, add, duplicate ref, done, --open, errors', () => {
  const dir = project();
  assert.deepEqual(bp(dir, ['prototype', 'notes']).json, { notes: [] });
  const add = bp(dir, ['prototype', 'notes', 'add', '--screen', SCREENS[0], '--text', 'לשנות כותרת', '--source', 'artifact', '--ref', 'cm-1']);
  assert.equal(add.code, 0, add.err);
  const id = add.json.note.id;
  assert.equal(bp(dir, ['prototype', 'notes', 'add', '--screen', SCREENS[0], '--text', 'שוב', '--ref', 'cm-1']).json.duplicate, true);
  assert.equal(bp(dir, ['prototype', 'notes']).json.notes.length, 1);
  assert.notEqual(bp(dir, ['prototype', 'notes', 'add', '--screen', 'mockup/zzz.html', '--text', 'x']).code, 0);
  assert.notEqual(bp(dir, ['prototype', 'notes', 'add', '--screen', SCREENS[0]]).code, 0);
  const done = bp(dir, ['prototype', 'notes', 'done', id, '--how', 'שונה']);
  assert.equal(done.code, 0, done.err);
  assert.equal(bp(dir, ['prototype', 'notes', '--open']).json.notes.length, 0);
  assert.equal(bp(dir, ['prototype', 'notes']).json.notes[0].how, 'שונה');
  assert.notEqual(bp(dir, ['prototype', 'notes', 'done', 'nope']).code, 0);
});

async function withUi(dir, fn) {
  const ui = await startUi({ projectDir: dir });
  const get = async (route) => { const r = await fetch(ui.url + route); const t = await r.text(); return { status: r.status, headers: r.headers, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }; };
  const post = async (route, body, type = 'text/plain') => { const r = await fetch(ui.url + route, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, headers: r.headers, json: await r.json() }; };
  try { await fn({ get, post }); } finally { ui.close(); await ui.closed; }
}

test('routes api/prototype-notes: GET by screen, POST validation, cors, old routes are gone', async () => {
  const dir = project();
  await withUi(dir, async ({ get, post }) => {
    assert.deepEqual((await get('api/prototype-notes')).json, { notes: [] });
    const ok = await post('api/prototype-notes', { screen: SCREENS[0], text: 'שינוי' });
    assert.equal(ok.status, 200); assert.equal(ok.json.note.source, 'local');
    assert.equal(ok.headers.get('access-control-allow-origin'), '*');
    assert.equal((await post('api/prototype-notes', { screen: SCREENS[1], text: 'אחר' }, 'application/json')).status, 200);
    const one = await get(`api/prototype-notes?screen=${encodeURIComponent(SCREENS[0])}`);
    assert.deepEqual(one.json.notes.map((n) => n.text), ['שינוי']);
    assert.equal((await get('api/prototype-notes')).json.notes.length, 2);
    assert.equal((await get('api/prototype-notes?screen=mockup/nope.html')).status, 400);
    for (const body of [{ screen: 'mockup/nope.html', text: 'x' }, { screen: SCREENS[0], text: '' }, { screen: SCREENS[0], text: 'x'.repeat(2001) }, [1], 'not json']) {
      assert.equal((await post('api/prototype-notes', body)).status, 400);
    }
    assert.equal((await post('api/prototype-notes', { screen: SCREENS[0], text: 'x' }, 'application/x-www-form-urlencoded')).status, 415);
    for (const r of ['api/prototype', 'prototype']) assert.equal((await get(r)).status, 404, r);
    assert.equal((await post('api/prototype-note', { file: SCREENS[0], note: 'x' }, 'application/json')).status, 404);
  });
});

test('api/state: the prototype facts and every note; stale when a built screen is newer', async () => {
  const dir = project();
  addNote(dir, { screen: SCREENS[0], text: 'a', source: 'artifact', ref: 'r' });
  const proto = path.join(dir, 'mockup', 'prototype.html');
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(proto, past, past);
  await withUi(dir, async ({ get }) => {
    let s = (await get('api/state')).json;
    assert.equal(s.prototype, true);
    assert.deepEqual({ built: s.prototypeInfo.built, total: s.prototypeInfo.total, stale: s.prototypeInfo.stale }, { built: 2, total: 3, stale: true });
    assert.equal(s.prototypeInfo.names[SCREENS[0]], 'מסך 1');
    assert.ok(Math.abs(new Date(s.prototypeInfo.builtAt).getTime() - past.getTime()) < 1000);
    assert.equal(s.prototypeNotes.length, 1); assert.equal(s.prototypeNotes[0].source, 'artifact');
    const now = new Date();
    fs.utimesSync(proto, now, now);
    s = (await get('api/state')).json;
    assert.equal(s.prototypeInfo.stale, false);
  });
  const none = project({ withPrototype: false });
  await withUi(none, async ({ get }) => {
    const s = (await get('api/state')).json;
    assert.equal(s.prototype, false); assert.equal(s.prototypeInfo, null); assert.deepEqual(s.prototypeNotes, []);
  });
});

test('board strings: the prototype block is exactly the contract', () => {
  assert.deepEqual(strings.prototype, { title: 'אב הטיפוס', ready: 'מוכן, נבנה ב-{time}', stale: 'המסכים השתנו מאז הבנייה האחרונה', counter: '{built} מתוך {total} מסכים בנויים', openArtifact: 'פתיחת אב הטיפוס', openLocal: 'פתיחה במחשב', notes: 'הערות', open: 'פתוחה', done: 'טופלה', fromArtifact: 'מה-artifact', fromLocal: 'מהמחשב', none: 'אין עדיין הערות' });
  const stages = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'stages.json'), 'utf8'));
  assert.match(stages.find((s) => s.n === 7).proof, /every note in \.blueprint\/prototype-notes\.json is done/);
});
