// Screens in the local pages: links open through files/, and round C knows which screen it asks about.
// Run: node --test test/ui-screens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN, tmpProject } from './helpers.mjs';

const { startUi } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'server.mjs')).href);
const { screensFor } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'lib.mjs')).href);
const js = fs.readFileSync(path.join(PLUGIN, 'ui', 'pages', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(PLUGIN, 'ui', 'pages', 'ui.css'), 'utf8');

// the pure helpers of ui.js, between their two markers
const block = js.slice(js.indexOf('// ---------------------------------------------------------------- screens (pure helpers'), js.indexOf('// ---------------------------------------------------------------- end of the screen helpers'));
const { screenSlug, matchScreen, defaultDevice, fileHref } = new Function(`${block}\nreturn { screenSlug, matchScreen, defaultDevice, fileHref };`)();

const SCREENS = [
  { file: 'mockup/walker-today.html', name: 'הטיולים של היום', persona: 'walker-regular', journeyStage: 'בבוקר', nav: 'fixed' },
  { file: 'mockup/owner-report.html', name: 'הדוח של היום', persona: 'owner-away', journeyStage: 'אחרי המייל', nav: 'free' },
  { file: 'mockup/manager-week.html', name: 'השבוע', persona: 'manager-desk', journeyStage: 'יום ראשון', nav: 'free' },
  { file: 'mockup/manager-today.html', name: 'הבוקר', persona: 'manager-morning', journeyStage: 'בבוקר', nav: 'free' },
];
const MAP = { schema: 2, capabilities: [], tables: [], automations: [], later: [], roles: [], screens: SCREENS };

test('a screen link opens through files/, any other file through api/file', () => {
  assert.equal(fileHref('mockup/walker-today.html'), 'files/mockup/walker-today.html');
  assert.equal(fileHref('mockup/דף בית.html'), `files/mockup/${encodeURIComponent('דף בית.html')}`);
  assert.equal(fileHref('docs/rendered/prd.htm'), 'files/docs/rendered/prd.htm');
  assert.equal(fileHref('evals/c1-happy.md'), 'api/file?path=evals%2Fc1-happy.md');
  assert.equal(fileHref('evals/run.txt'), 'api/file?path=evals%2Frun.txt');
  // every place that opens a screen goes through the helper
  assert.match(js, /h\('a', \{ class: 'link ext', href: fileHref\(sc\.file\), target: '_blank'/, 'the screens drawer');
  assert.match(js, /const fileLink = \(rel\) => \(rel \? h\('a', \{ class: 'link', href: fileHref\(rel\)/, 'the step drawer');
  assert.match(js, /iframe\.src = fileHref\(sc\.file\)/, 'the round C frame');
  assert.doesNotMatch(js, /api\/file\?path=\$\{encodeURIComponent\((sc\.file|rel)\)\}`, target/, 'no screen link left on api/file');
});

test('a screen page and the styles it links to come back through files/', async () => {
  const dir = tmpProject({ state: { schema: 2, project: 'בדיקה', stage: 7, status: 'in_progress', stages: {}, pending: [], connections: {}, where: {} }, map: MAP });
  fs.mkdirSync(path.join(dir, 'mockup'));
  fs.mkdirSync(path.join(dir, 'design'));
  fs.writeFileSync(path.join(dir, 'mockup', 'walker-today.html'), '<link rel="stylesheet" href="../design/components.css"><link rel="stylesheet" href="mock.css"><p>היום</p>');
  fs.writeFileSync(path.join(dir, 'mockup', 'mock.css'), 'p{color:red}');
  fs.writeFileSync(path.join(dir, 'design', 'components.css'), 'body{margin:0}');
  const ui = await startUi({ projectDir: dir });
  try {
    const page = await fetch(new URL(fileHref('mockup/walker-today.html'), ui.url));
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    // the relative links of the page resolve under files/ too
    for (const rel of ['../design/components.css', 'mock.css']) {
      const r = await fetch(new URL(rel, page.url));
      assert.equal(r.status, 200, rel);
      assert.match(r.headers.get('content-type'), /text\/css/, rel);
    }
    // the board marks which screens exist by the same route
    const st = await (await fetch(`${ui.url}api/state`)).json();
    assert.equal(st.screenFiles['mockup/walker-today.html'], true);
    assert.equal(st.screenFiles['mockup/owner-report.html'], false);
  } finally { ui.close(); await ui.closed; }
});

test('screensFor matches --screens values to the map and keeps its ids and names', () => {
  const got = screensFor(MAP, 'walker-today, mockup/owner-report.html,mockup-manager-week,הבוקר,nope,walker-today');
  assert.deepEqual(got, [
    { id: 'mockup-walker-today', label: 'הטיולים של היום' },
    { id: 'mockup-owner-report', label: 'הדוח של היום' },
    { id: 'mockup-manager-week', label: 'השבוע' },
    { id: 'mockup-manager-today', label: 'הבוקר' },
  ], 'by file name, full path, slug and Hebrew name; unknown values and repeats left out');
  assert.deepEqual(screensFor(MAP, 'nope'), []);
});

test('screensFor without a query takes the built screens, or all while none is built', () => {
  const dir = tmpProject({});
  assert.equal(screensFor(MAP, null, dir).length, 4, 'nothing built yet: every screen');
  fs.mkdirSync(path.join(dir, 'mockup'));
  fs.writeFileSync(path.join(dir, 'mockup', 'owner-report.html'), '<p>x</p>');
  fs.writeFileSync(path.join(dir, 'mockup', 'manager-week.html'), '<p>x</p>');
  assert.deepEqual(screensFor(MAP, null, dir).map((s) => s.id), ['mockup-owner-report', 'mockup-manager-week']);
  assert.equal(screensFor(MAP).length, 4, 'without a folder every screen counts');
});

test('round C questions carry the slug of their file and the screen name', async () => {
  const dir = tmpProject({ state: { schema: 2, project: 'בדיקה', stage: 7, status: 'in_progress', stages: {}, pending: [], connections: {}, where: {} }, map: MAP });
  fs.mkdirSync(path.join(dir, 'mockup'));
  fs.writeFileSync(path.join(dir, 'mockup', 'walker-today.html'), '<p>x</p>');
  const ui = await startUi({ projectDir: dir });
  try {
    const withQuery = (await (await fetch(`${ui.url}api/questions?round=c&screens=walker-today,manager-week,nope`)).json()).questions;
    assert.deepEqual([...new Set(withQuery.map((q) => q.screen))], ['mockup-walker-today', 'mockup-manager-week']);
    assert.ok(withQuery.some((q) => q.text.includes('הטיולים של היום')), 'the text names the screen in Hebrew');
    assert.ok(!withQuery.some((q) => /walker-today/.test(q.text)));
    const built = (await (await fetch(`${ui.url}api/questions?round=c`)).json()).questions;
    assert.deepEqual([...new Set(built.map((q) => q.screen))], ['mockup-walker-today'], 'only the built screen without a query');
    // the page finds each question's screen in the map
    for (const q of withQuery) assert.ok(matchScreen(q.screen, SCREENS), q.id);
  } finally { ui.close(); await ui.closed; }
});

test('the page helpers: one slug with lib.mjs, matching, the default device', () => {
  for (const s of SCREENS.concat([{ file: 'mockup/דף הבית.HTML' }, { file: 'app/Screens/Big One.htm' }])) {
    assert.equal(screenSlug(s.file), screensFor({ screens: [s] })[0].id, s.file);
  }
  assert.equal(matchScreen('mockup-walker-today', SCREENS).file, 'mockup/walker-today.html');
  assert.equal(matchScreen('walker-today', SCREENS).file, 'mockup/walker-today.html', 'an old id by file name');
  assert.equal(matchScreen('nope', SCREENS), null);
  assert.equal(defaultDevice(SCREENS[0]), 'phone');
  assert.equal(defaultDevice(SCREENS[1]), 'phone');
  assert.equal(defaultDevice(SCREENS[2]), 'desktop', 'a desk persona');
  assert.equal(defaultDevice(SCREENS[3]), 'desktop', 'a manager screen');
});

test('the questionnaire shows the screen beside the question on a wide window and in the sheet otherwise', () => {
  assert.match(js, /h\('iframe', \{ sandbox: 'allow-scripts' \}\)/);
  assert.match(js, /window\.matchMedia\('\(min-width: 1100px\)'\)/);
  assert.match(js, /const SIZES = \{ phone: \[390, 844\], desktop: \[1280, 800\] \};/);
  assert.match(js, /t\(`directions\.\$\{k\}`\)/, 'the device names come from the directions strings');
  assert.match(js, /if \(view\.sc && view\.sc\.file === sc\.file\) return;/, 'the frame loads again only for a new screen');
  assert.match(css, /@media \(min-width: 1100px\) \{\s*main\.has-screen \{[^}]*grid-template-columns: minmax\(0, 560px\) minmax\(0, 1fr\)/);
  const s = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'ui', 'pages', 'strings.he.json'), 'utf8'));
  assert.equal(s.questionnaire.screenShow, 'הצגת המסך');
  assert.equal(s.questionnaire.screenOpen, 'פתיחה בחלון חדש');
  assert.equal(s.directions.phone, 'טלפון');
  assert.equal(s.directions.desktop, 'מחשב');
});
