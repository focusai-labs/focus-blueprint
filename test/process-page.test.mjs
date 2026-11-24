// The process page and its read-only routes. Run: node --test test/process-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN, tmpProject } from './helpers.mjs';

const { startUi } = await import(path.join(PLUGIN, 'ui', 'server.mjs'));
const here = path.dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'map', 'accountant.json'), 'utf8'));
const STATE = { schema: 2, project: 'בדיקה', stage: 3, status: 'in_progress', stages: {}, pending: [], connections: {}, where: {} };

async function withUi(dir, fn) {
  const ui = await startUi({ projectDir: dir });
  const get = async (route) => { const r = await fetch(ui.url + route); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, type: r.headers.get('content-type'), text, json }; };
  try { await fn(get); } finally { ui.close(); await ui.closed; }
}

test('process page, svg module and strings are served', async () => {
  const dir = tmpProject({ state: STATE, map });
  await withUi(dir, async (get) => {
    const page = await get('process');
    assert.equal(page.status, 200);
    assert.match(page.text, /<html lang="he" dir="rtl">/);
    assert.match(page.text, /data-page="process"/);
    assert.doesNotMatch(page.text, /fonts\.googleapis|https?:\/\/(?!www\.w3)/);
    const mod = await get('process-svg.mjs');
    assert.equal(mod.status, 200);
    assert.match(mod.type, /javascript/);
    assert.ok((await get('strings.he.json')).json.process.empty.includes('להבין'));
    assert.match((await get('ui.js')).text, /processPage/);
    assert.match((await get('ui.js')).text, /href: 'process'/, 'the board links to the page');
  });
});

test('api/map returns the migrated map and never writes', async () => {
  const dir = tmpProject({ state: STATE, map: { schema: 1, capabilities: [], screens: [], tables: [], automations: [], later: [] } });
  const file = path.join(dir, '.blueprint', 'map.json');
  const before = fs.readFileSync(file, 'utf8');
  await withUi(dir, async (get) => {
    const r = await get('api/map');
    assert.equal(r.status, 200);
    assert.equal(r.json.schema, 2);
    assert.deepEqual(r.json.processes, []);
  });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const dir2 = tmpProject({ state: STATE, map });
  await withUi(dir2, async (get) => assert.equal((await get('api/map')).json.processes.length, 2));
});

test('api/eval serves only evals/*.md inside the project', async () => {
  const dir = tmpProject({ state: STATE, map });
  fs.mkdirSync(path.join(dir, 'evals'));
  fs.writeFileSync(path.join(dir, 'evals', 'c1-happy.md'), '# בדיקה');
  fs.writeFileSync(path.join(dir, 'secret.md'), 'no');
  await withUi(dir, async (get) => {
    const ok = await get('api/eval?path=evals/c1-happy.md');
    assert.equal(ok.status, 200);
    assert.match(ok.type, /text\/plain/);
    for (const bad of ['secret.md', 'evals/../secret.md', '../x.md', 'evals/none.md', '/etc/passwd', 'evals/c1-happy.txt']) assert.equal((await get(`api/eval?path=${encodeURIComponent(bad)}`)).status, 404, bad);
  });
});
