// The read-only file route of the process panel, the clickable map and the new Hebrew strings.
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN, tmpProject } from './helpers.mjs';

const { startUi } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'server.mjs')).href);
const { processSvg } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'process-svg.mjs')).href);
const here = path.dirname(new URL(import.meta.url).pathname);
const map = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'map', 'accountant.json'), 'utf8'));
const ID = 'monthly-collection';

function project() {
  const dir = tmpProject({});
  const w = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), txt); };
  w('mockup/home.html', '<p>שלום</p>');
  w('evals/a.md', '# בדיקה');
  w('docs/rendered/doc.html', '<p>doc</p>');
  w('docs/other.md', 'no');
  w('mockup/data.json', '{}');
  w('mockup/pic.png', 'x');
  w('.blueprint/map.json', '{}');
  w('secret.md', 'top secret');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-out-'));
  fs.writeFileSync(path.join(outside, 'out.html'), '<p>outside</p>');
  fs.symlinkSync(path.join(outside, 'out.html'), path.join(dir, 'mockup', 'link.html'));
  fs.symlinkSync(outside, path.join(dir, 'evals', 'dirlink'));
  return dir;
}

async function get(ui, rel) {
  const r = await fetch(`${ui.url}api/file?path=${encodeURIComponent(rel)}`);
  return { status: r.status, type: r.headers.get('content-type'), body: await r.text() };
}

test('api/file serves text and html only from mockup, evals and docs/rendered', async () => {
  const ui = await startUi({ projectDir: project() });
  try {
    const a = await get(ui, 'mockup/home.html');
    assert.equal(a.status, 200); assert.match(a.type, /text\/html/); assert.match(a.body, /שלום/);
    const b = await get(ui, 'evals/a.md');
    assert.equal(b.status, 200); assert.match(b.type, /text\/plain/);
    assert.equal((await get(ui, 'docs/rendered/doc.html')).status, 200);
    for (const bad of ['docs/other.md', 'secret.md', '.blueprint/map.json', 'mockup/data.json', 'mockup/pic.png', 'mockup', 'mockup/', '', 'nothing/x.html']) {
      assert.equal((await get(ui, bad)).status, 404, bad);
    }
  } finally { ui.close(); }
});

test('api/file refuses traversal, absolute paths and symlinks out', async () => {
  const dir = project();
  const ui = await startUi({ projectDir: dir });
  try {
    for (const bad of ['mockup/../secret.md', '../secret.md', 'mockup/../../etc/passwd', 'evals/..%2fsecret.md', '/etc/passwd', path.join(dir, 'secret.md'), 'mockup\\..\\secret.md', 'mockup//home.html', 'mockup/./home.html', 'mockup/home.html\0.md', 'mockup/link.html', 'evals/dirlink/out.html']) {
      assert.equal((await get(ui, bad)).status, 404, bad);
    }
    // the token and the host are still required
    const r = await fetch(ui.url.replace(/[0-9a-f]{32}/, 'x'.repeat(32)) + 'api/file?path=mockup/home.html');
    assert.equal(r.status, 404);
  } finally { ui.close(); }
});

test('api/file answers GET only', async () => {
  const ui = await startUi({ projectDir: project() });
  try {
    const r = await fetch(`${ui.url}api/file?path=mockup/home.html`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 404);
  } finally { ui.close(); }
});

test('interactive svg: steps and timers are buttons, the static one is not', () => {
  const live = processSvg(map, ID, { interactive: true });
  assert.equal((live.match(/class="bp-card"[^>]*role="button" tabindex="0"/g) || []).length, 6);
  assert.match(live, /class="bp-timer"[^>]*role="button" tabindex="0"/);
  const stat = processSvg(map, ID);
  assert.doesNotMatch(stat, /role="button"/);
  assert.doesNotMatch(stat, /tabindex="0"[^>]*>(?:<title>[^<]*<\/title>)?<rect/);
});

test('hebrew text sits in foreignObject divs with rtl, a clamp and escaped content', () => {
  const evil = JSON.parse(JSON.stringify(map));
  evil.processes[0].steps[0].text = '<img src=x onerror=alert(1)> "quote" & more words here to wrap';
  const svg = processSvg(evil, ID, { interactive: true });
  assert.match(svg, /<foreignObject[^>]*><div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(svg, /dir="rtl" lang="he"/);
  assert.match(svg, /-webkit-line-clamp:3/);
  assert.doesNotMatch(svg, /<img/);
  assert.match(svg, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(svg, /<tspan/); // no hand-wrapped lines left
});

test('the Hebrew strings the owner asked for', () => {
  const s = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'ui', 'pages', 'strings.he.json'), 'utf8'));
  assert.equal(s.board.evidence, 'תוצאות הבדיקות');
  assert.equal(s.board.noEvidence, 'עוד אין תוצאות בדיקה.');
  assert.equal(s.board.reviewSpec, 'תואם לאפיון');
  assert.equal(s.board.reviewQuality, 'איכות הקוד');
  assert.equal(s.board.rulingsCols.price, 'מה ייפגע אם טעינו');
  assert.equal(s.questionnaire.dontKnow, 'עוד לא יודעים');
  const d = s.process.detail;
  assert.deepEqual(Object.values(d), ['פרטי הצעד', 'מה קורה', 'מי עושה', 'רמה', 'שלב', 'מקור', 'אם נכשל', 'מסך', 'יכולת', 'טבלאות', 'הרשאה', 'בדיקה', 'סגירה', 'אין']);
});
