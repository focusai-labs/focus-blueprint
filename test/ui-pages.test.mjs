// The local pages after the redesign: strings, the app bar, the page registry and the board data.
// Run: node --test test/ui-pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN, tmpProject } from './helpers.mjs';

const pages = path.join(PLUGIN, 'ui', 'pages');
const js = fs.readFileSync(path.join(pages, 'ui.js'), 'utf8');
const strings = JSON.parse(fs.readFileSync(path.join(pages, 'strings.he.json'), 'utf8'));
const html = (name) => fs.readFileSync(path.join(pages, `${name}.html`), 'utf8');
const lookup = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), strings);
const GROUPS = Object.keys(strings).join('|');
const { startUi } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'server.mjs')).href);

test('every string key the scripts and pages use exists in strings.he.json', () => {
  const missing = [];
  // plain keys anywhere in the script, also inside a ternary
  for (const m of js.matchAll(new RegExp(`'((?:${GROUPS})\\.[A-Za-z0-9_.]+)'`, 'g'))) if (typeof lookup(m[1]) !== 'string') missing.push(m[1]);
  // template keys: the fixed part names a group of strings
  for (const m of js.matchAll(/\b(?:t|has)\(`([^`]+)`/g)) {
    const key = m[1];
    if (!key.includes('${')) { if (typeof lookup(key) !== 'string') missing.push(key); continue; }
    const group = key.slice(0, key.indexOf('${')).replace(/\.$/, '');
    const node = lookup(group);
    if (!node || typeof node !== 'object') missing.push(`${group}.*`);
  }
  for (const name of ['board', 'process', 'questionnaire', 'brain-dump']) {
    for (const m of html(name).matchAll(/data-(?:t|t-ph|title)="([^"]+)"/g)) if (typeof lookup(m[1]) !== 'string') missing.push(`${name}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('the owner\'s strings for the bar, the tabs and the drawers', () => {
  assert.deepEqual(strings.nav, { board: 'לוח המצב', process: 'מפת התהליכים', menu: 'תפריט', night: 'מצב לילה', day: 'מצב יום', stage: 'שלב {n} · {name}' });
  assert.deepEqual(Object.values(strings.tabs), ['סקירה', 'הכרעות', 'שינויים', 'יכולות ובדיקות', 'סגירת שלבים', 'פרטים טכניים']);
  assert.equal(strings.drawer.prev, 'הצעד הקודם');
  assert.equal(strings.drawer.next, 'הצעד הבא');
  assert.equal(strings.questionnaire.status.decided, 'Claude יחליט');
  assert.equal(strings.board.waitingHalted, '{name} נעצרה אחרי שלושה סבבי תיקון');
  assert.equal(strings.board.limits, undefined, 'the limits card is gone');
  assert.equal(strings.board.limitsNote, undefined);
  assert.ok(!js.includes('board.limits'));
});

test('every page carries the app bar; task pages keep their save status in it', () => {
  for (const name of ['board', 'process', 'questionnaire', 'brain-dump']) {
    const page = html(name);
    assert.match(page, /<header class="appbar" id="appbar">/, name);
    assert.match(page, /family=Heebo/, `${name} loads Heebo`);
    assert.match(page, /<script src="ui\.js" defer><\/script>/, name);
    assert.match(page, /localStorage\.getItem\('bp-theme'\)/, `${name} applies night mode before paint`);
    assert.ok(page.indexOf('id="appbar"') < page.indexOf('<main'), `${name}: the bar comes first`);
  }
  for (const name of ['questionnaire', 'brain-dump']) {
    assert.match(html(name), /<header class="appbar" id="appbar"><span id="save" class="save" role="status" aria-live="polite"><\/span><\/header>/, name);
  }
  // a page without the bar in its markup still gets one
  assert.match(js, /if \(!el\) \{ el = h\('header', \{ id: 'appbar' \}\); document\.body\.prepend\(el\); \}/);
  assert.match(js, /href: 'board', 'aria-current': page === 'board' \? 'page' : null/);
  assert.match(js, /href: 'process', 'aria-current': page === 'process' \? 'page' : null/);
});

test('pages register through BP and start on DOMContentLoaded', () => {
  assert.match(js, /window\.BP = \{ h, t, api, register, drawer, popover,/);
  for (const name of ['brain-dump', 'questionnaire', 'catalog', 'board', 'process']) assert.match(js, new RegExp(`register\\('${name}', `), name);
  assert.match(js, /document\.addEventListener\('DOMContentLoaded', start, \{ once: true \}\)/);
});

test('raw text never goes through innerHTML; storage is always guarded', () => {
  const sinks = [...js.matchAll(/\.innerHTML = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(sinks.length >= 1);
  for (const rhs of sinks) assert.match(rhs, /^(ICONS\[name\] \|\| ''|svg|svgMod\.processSvg\(.*\))$/, rhs);
  for (const line of js.split('\n').filter((l) => l.includes('localStorage'))) assert.match(line, /try \{/, line.trim());
  // every animation sits behind the reduced-motion guard
  const css = fs.readFileSync(path.join(pages, 'ui.css'), 'utf8');
  const guarded = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  const outside = css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.doesNotMatch(outside, /\b(transition|animation)\s*:/, 'no motion outside the guard');
  assert.match(guarded, /--dur-3|var\(--dur-/);
  assert.match(css, /--dur-1: 120ms; --dur-2: 180ms; --dur-3: 220ms; --ease: cubic-bezier\(\.2, \.8, \.2, 1\);/);
});

test('board state carries the pending question texts, the personas and which screens exist', async () => {
  const map = {
    schema: 2, capabilities: [], tables: [], automations: [], later: [], roles: [{ id: 'owner', name: 'בעלים', kind: 'user' }],
    screens: [{ file: 'mockup/home.html', name: 'הבית', persona: 'owner-away', journeyStage: 'בבוקר', nav: 'fixed' }, { file: 'mockup/later.html', name: 'אחר כך', persona: 'owner-away', journeyStage: 'בערב', nav: 'free' }],
  };
  const dir = tmpProject({ state: { schema: 2, project: 'בדיקה', stage: 7, status: 'in_progress', stages: {}, pending: ['a-03', 'c-click-mockup-home', 'zz-99'], connections: {}, where: {} }, map });
  fs.mkdirSync(path.join(dir, 'mockup'));
  fs.writeFileSync(path.join(dir, 'mockup', 'home.html'), '<p>בית</p>');
  fs.mkdirSync(path.join(dir, 'spec'));
  fs.writeFileSync(path.join(dir, 'spec', 'users.md'), '# המשתמשים\n\n## בעלים\n\n### הבעלים שיוצאת לעבודה (`owner-away`)\n\n- מי היא\n');
  const bankA = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'questions', 'round-a.json'), 'utf8')).questions;
  const ui = await startUi({ projectDir: dir });
  try {
    const st = await (await fetch(`${ui.url}api/state`)).json();
    const [a03, click, unknown] = st.pendingQuestions;
    assert.equal(a03.id, 'a-03');
    assert.equal(a03.text, bankA.find((q) => q.id === 'a-03').text);
    assert.equal(a03.block, bankA.find((q) => q.id === 'a-03').block);
    assert.equal(a03.round, 'a');
    assert.equal(click.text, 'במסך הבית, מה קורה כשלוחצים על הפעולה הראשית?', 'a round C id gets its screen name');
    assert.deepEqual(unknown, { id: 'zz-99', text: null, block: null, why: null, round: null });
    assert.deepEqual(st.personas, { 'owner-away': 'הבעלים שיוצאת לעבודה' });
    assert.deepEqual(st.screenFiles, { 'mockup/home.html': true, 'mockup/later.html': false });
  } finally { ui.close(); await ui.closed; }
});

test('a project with nothing pending gets an empty list', async () => {
  const dir = tmpProject({ state: { schema: 2, project: 'בדיקה', stage: 1, status: 'in_progress', stages: {}, pending: [], connections: {}, where: {} } });
  const ui = await startUi({ projectDir: dir });
  try {
    const st = await (await fetch(`${ui.url}api/state`)).json();
    assert.deepEqual(st.pendingQuestions, []);
    assert.deepEqual(st.personas, {});
  } finally { ui.close(); await ui.closed; }
});
