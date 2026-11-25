import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpProject, bp, PLUGIN } from './helpers.mjs';
import { buildPrototype, rewriteNav, scanPrototype, personalCandidates, validIsraeliId, scanJs } from '../plugins/focus-blueprint/scripts/prototype.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SCREENS = [
  { file: 'mockup/index.html', name: 'כניסה', persona: 'owner', journeyStage: 'x', nav: 'fixed' },
  { file: 'mockup/list.html', name: 'רשימה', persona: 'owner', journeyStage: 'x', nav: 'free' },
  { file: 'mockup/admin.html', name: 'ניהול', persona: 'boss', journeyStage: 'x', nav: 'free' },
  { file: 'mockup/later.html', name: 'אחר כך', persona: 'boss', journeyStage: 'x', nav: 'free' },
];
function fixture({ external = true } = {}) {
  const dir = tmpProject({ state: { schema: 2, project: 'פרויקט בדיקה', stage: 7 }, map: { schema: 1, capabilities: [], screens: SCREENS } });
  const w = (rel, c) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  w('spec/users.md', '## תפקידים\n\n### בעלת העסק (`owner`)\n\n### המנהל (`boss`)\n');
  w('design/img/dot.png', PNG);
  w('design/img/font.woff2', Buffer.from('wOF2fake'));
  w('design/img/other.png', PNG);
  w('design/photos/p1.png', PNG);
  w('design/tokens.css', `:root { --accent: #123456; --bg: url(img/dot.png); }\n@font-face { font-family: F; src: url(img/font.woff2) format('woff2'); }`);
  w('mockup/mock.css', `@import url("../design/tokens.css");\nbody { background: url('../design/img/dot.png'); }`);
  w('mockup/data.js', `window.D = { photos: '../design/photos/', one: '../design/img/other.png' };\nvar q = location.search;\nvar n = location.pathname.split('/').pop();`);
  w('mockup/app.js', `document.addEventListener('click', function (e) { if (e.target.id === 'go') { location.href = 'list.html?state=empty' } });\nfunction f() { window.location = "admin.html"; }\nlocation.assign('x.html'); location.replace('y.html'); var h = location.hash; location.reload();`);
  w('mockup/index.html', `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="mock.css">\n${external ? '<link rel="stylesheet" href="https://cdn.example.net/x.css"><script src="https://cdn.example.net/x.js"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo">' : ''}</head><body>\n<script src="data.js"></script>\n<img src="../design/img/dot.png" alt="">${external ? '<img src="https://img.example.net/a.jpg" alt="">' : ''}<div style="background:url(../design/img/other.png)"></div>\n<script src="app.js"></script><a href="list.html">list</a><a href="#top">top</a><a href="mailto:a@b.co">m</a>\n<script>var img = "../design/photos/p1.png"; var t = \`x\`; location.href = btn.dataset.next;</script></body></html>`);
  w('mockup/list.html', '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>list</h1><button data-demo>d</button></body></html>');
  w('mockup/admin.html', '<!doctype html><html><head></head><body>admin <script>1</script></body></html>');
  return dir;
}
const bundle = (r) => {
  const data = JSON.parse(/id="bp-data">([\s\S]*?)<\/script>/.exec(r.html)[1]);
  data.docs = JSON.parse(/id="bp-screens">([\s\S]*?)<\/script>/.exec(r.html)[1]);
  return data;
};
const expand = (d, s) => s.replace(/bp-asset:\/\/(\d+)/g, (m, n) => d.assets[+n]);

test('the page map data: screens grouped by persona name in map order, built and missing, counter numbers', () => {
  const r = buildPrototype(fixture());
  const d = bundle(r);
  assert.deepEqual(d.screens.map((s) => [s.file, s.built, s.personaName]), [
    ['mockup/index.html', true, 'בעלת העסק'], ['mockup/list.html', true, 'בעלת העסק'], ['mockup/admin.html', true, 'המנהל'], ['mockup/later.html', false, 'המנהל'],
  ]);
  assert.equal(r.report.total, 4); assert.equal(r.report.built, 3);
  assert.deepEqual(r.report.missing, ['mockup/later.html']);
  assert.equal(d.project, 'פרויקט בדיקה');
  assert.equal(d.defaultFile, 'mockup/index.html');
  assert.match(d.strings.counter, /\{built\} מתוך \{total\} מסכים בנויים/);
});

test('the project name falls back to the folder name', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, '.blueprint', 'state.json'), '{}');
  assert.equal(bundle(buildPrototype(dir)).project, path.basename(dir));
});

test('inlining: css @import chain, script position, data uris from html, css and js strings', () => {
  const r = buildPrototype(fixture());
  const d = bundle(r);
  const doc = d.docs['mockup/index.html'];
  const cssId = /<!--bp:css:(\w+)-->/.exec(doc)[1];
  const css = expand(d, d.css[cssId]);
  assert.match(css, /--accent: #123456/, 'the imported tokens file is inlined');
  assert.match(css, /@font-face/);
  assert.match(css, /url\("data:font\/woff2;base64,/, 'font url in the imported file');
  assert.match(css, /body \{ background: url\("data:image\/png;base64,/);
  assert.ok(!/@import/.test(css));
  // position: marker for data.js comes before the img, app.js after
  const order = ['<!--bp:js:', '<img', '<!--bp:js:'].map((s, i) => doc.indexOf(s, i === 2 ? doc.indexOf('<img') : 0));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'script markers keep their place');
  assert.match(expand(d, doc), /<img src="data:image\/png;base64,/);
  assert.match(expand(d, doc), /style="background:url\(&quot;data:image\/png/);
  const jsAll = Object.values(d.js).map((t) => expand(d, t)).join('\n');
  assert.ok(!/<link rel="stylesheet" href="mock\.css"/.test(doc));
  assert.match(expand(d, doc), /var img = "data:image\/png;base64,/, 'a js string in an inline script');
  assert.match(jsAll, /one: 'data:image\/png;base64,/, 'a js string in a shared script');
});

test('a folder name in a js string brings its files into the dictionary for the run-time swap', () => {
  const d = bundle(buildPrototype(fixture()));
  assert.ok('design/photos/p1.png' in d.assetIndex);
  assert.ok(Object.values(d.js).some((t) => t.includes("photos: '../design/photos/'")), 'the folder string itself stays');
});

test('shared assets are stored once, not per screen', () => {
  const dir = fixture();
  const w = (rel, c) => fs.writeFileSync(path.join(dir, rel), c);
  w('mockup/list.html', '<!doctype html><html><head><link rel="stylesheet" href="mock.css"></head><body><img src="../design/img/dot.png"></body></html>');
  const d = bundle(buildPrototype(dir));
  assert.equal(Object.keys(d.assetIndex).filter((p) => p === 'design/img/dot.png').length, 1);
  assert.equal(d.assets.filter((u) => u === `data:image/png;base64,${PNG.toString('base64')}`).length, 3, 'dot, other and p1 are the same bytes but stored per path once');
  assert.equal(Object.keys(d.css).length, 1, 'mock.css is one entry used by two screens');
});

test('navigation rewrites', () => {
  const d = bundle(buildPrototype(fixture()));
  const js = Object.values(d.js).join('\n');
  assert.match(js, /__bpGo\('list\.html\?state=empty'\)/);
  assert.match(js, /__bpGo\("admin\.html"\)/);
  assert.match(js, /__bpGo\('x\.html'\)/);
  assert.match(js, /__bpGo\('y\.html'\)/);
  assert.match(js, /\(window\.__bpSearch\|\|''\)/);
  assert.match(js, /\(window\.__bpPath\|\|location\.pathname\)\.split/);
  assert.match(js, /location\.hash/);
  assert.match(js, /location\.reload\(\)/);
  assert.match(d.docs['mockup/index.html'], /__bpGo\(btn\.dataset\.next\);/);
});

test('rewriteNav: statement ends, strings and comments are left alone, no double wrap', () => {
  const t = (s) => rewriteNav(s).text;
  assert.equal(t("sivuv.busy(btn).then(function () { location.href = btn.dataset.next; });"), "sivuv.busy(btn).then(function () { __bpGo(btn.dataset.next); });");
  assert.equal(t("a.then(() => location.href = '/x')"), "a.then(() => __bpGo('/x'))");
  assert.equal(t("location.href = base +\n  'a.html'\nnext()"), "__bpGo(base +\n  'a.html')\nnext()");
  assert.equal(t("var s = 'location.href = x'; // location.href = y"), "var s = 'location.href = x'; // location.href = y");
  assert.equal(t("if (location.href === 'a') go()"), "if (location.href === 'a') go()");
  assert.equal(t("var p = new URLSearchParams(window.location.search)"), "var p = new URLSearchParams((window.__bpSearch||''))");
  assert.equal(t("x.location.search"), "x.location.search");
  assert.equal(t("location.href = 'a?' + location.search"), "__bpGo('a?' + (window.__bpSearch||''))");
});

test('scanJs finds strings and skips regex literals and comments', () => {
  const s = "var r = /'/g; var a = 'x'; /* 'no' */ var b = `t`;";
  const { strings } = scanJs(s);
  assert.deepEqual(strings.map((x) => s.slice(x.start, x.end)), ["'x'", '`t`']);
});

test('the placeholders and the toasts are in the shell text, with the contract strings', () => {
  const d = bundle(buildPrototype(fixture()));
  const S = d.strings;
  assert.equal(S.missingTitle, 'המסך הזה עוד לא נבנה');
  assert.equal(S.missingText, 'המסך ״{name}״ רשום במפה, אבל עוד לא נבנה.');
  assert.equal(S.unknownTitle, 'הקישור לא מוביל למסך שבמפה');
  assert.equal(S.unknownText, 'הלחיצה מובילה לקובץ {file}, ואין מסך כזה במפה.');
  assert.equal(S.back, 'חזרה למסך הקודם');
  assert.equal(S.demo, 'הכפתור הזה מסומן כדמה, ובאב הטיפוס הוא לא עושה כלום.');
  assert.equal(S.external, 'באב הטיפוס לא נפתחים קישורים לאתרים אחרים.');
  for (const [k, v] of Object.entries({ label: 'אב טיפוס', note: 'הערה', notesTitle: 'הערות על הדף הזה', noteLabel: 'מה לשנות כאן', save: 'שמירה', saved: 'ההערה נשמרה', earlierNotes: 'הערות קודמות על הדף', copyAll: 'העתקת כל ההערות', copied: 'ההערות הועתקו', pageMap: 'מפת הדפים', fullscreen: 'מסך מלא' })) assert.equal(S[k], v, k);
  const shell = fs.readFileSync(path.join(PLUGIN, 'scripts/prototype/shell.js'), 'utf8');
  for (const k of ['missingTitle', 'unknownTitle', 'missingText', 'unknownText', 'S.demo', 'S.external']) assert.ok(shell.includes(k), k);
  assert.ok(!/[֐-׿]/.test(shell), 'no Hebrew text hard-coded in the shell js');
  assert.ok(!/[֐-׿]/.test(fs.readFileSync(path.join(PLUGIN, 'scripts/prototype/shell.html'), 'utf8')));
  assert.equal(bundle(buildPrototype(fixture(), { strings: { label: 'X' } })).strings.label, 'X');
});

test('external assets are dropped and reported, Google Fonts stays', () => {
  const r = buildPrototype(fixture());
  const d = bundle(r);
  const doc = d.docs['mockup/index.html'];
  assert.ok(!doc.includes('cdn.example.net'));
  assert.ok(!doc.includes('img.example.net'));
  assert.ok(doc.includes('fonts.googleapis.com'));
  assert.deepEqual(r.report.external.map((e) => e.kind).sort(), ['image', 'script', 'stylesheet']);
});

test('the size report: bytes, and tooLarge with the five largest assets', () => {
  const dir = fixture();
  const r = buildPrototype(dir);
  assert.equal(r.report.bytes, Buffer.byteLength(r.html));
  assert.equal(r.report.tooLarge, undefined);
  fs.writeFileSync(path.join(dir, 'design/img/big.png'), Buffer.alloc(13 * 1024 * 1024, 1));
  fs.writeFileSync(path.join(dir, 'mockup/list.html'), '<img src="../design/img/big.png"><link rel="stylesheet" href="x.css">');
  const big = buildPrototype(dir);
  assert.equal(big.report.tooLarge, true);
  assert.equal(big.report.largest[0].path, 'design/img/big.png');
  assert.ok(big.report.largest.length <= 5);
  assert.ok(big.html.length > 16 * 1024 * 1024, 'still built');
});

test('the guard: dot segments, parent paths and symlinks are not inlined or built', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, '..', 'bp-outside.png'), PNG);
  fs.symlinkSync(path.join(dir, 'design/img/dot.png'), path.join(dir, 'design/img/link.png'));
  fs.writeFileSync(path.join(dir, 'mockup/list.html'), '<img src="../../bp-outside.png"><img src="../design/img/link.png"><img src="../design/img/dot.png">');
  const d = bundle(buildPrototype(dir));
  const doc = d.docs['mockup/list.html'];
  assert.ok(doc.includes('../../bp-outside.png') && doc.includes('link.png'));
  assert.equal((doc.match(/bp-asset:\/\//g) || []).length, 1);
  fs.symlinkSync(path.join(dir, 'mockup/admin.html'), path.join(dir, 'mockup/linked.html'));
  const m = JSON.parse(fs.readFileSync(path.join(dir, '.blueprint/map.json'), 'utf8'));
  m.screens.push({ file: 'mockup/linked.html', name: 'ק', persona: 'boss' });
  fs.writeFileSync(path.join(dir, '.blueprint/map.json'), JSON.stringify(m));
  assert.equal(buildPrototype(dir).report.built, 3);
});

test('bp-screens: one json block keyed by the map file path, a key per built screen, stable text', () => {
  const dir = fixture();
  const r = buildPrototype(dir);
  assert.equal((r.html.match(/id="bp-screens"/g) || []).length, 1);
  const raw = /<script type="application\/json" id="bp-screens">([\s\S]*?)<\/script>/.exec(r.html)[1];
  const screens = JSON.parse(raw);
  assert.deepEqual(Object.keys(screens).sort(), ['mockup/admin.html', 'mockup/index.html', 'mockup/list.html']);
  assert.ok(!raw.includes('</script'));
  assert.equal(JSON.stringify(buildPrototype(dir).html === r.html), 'true', 'same input, same file');
  fs.appendFileSync(path.join(dir, 'mockup/admin.html'), '<p>changed</p>');
  const again = JSON.parse(/id="bp-screens">([\s\S]*?)<\/script>/.exec(buildPrototype(dir).html)[1]);
  assert.equal(again['mockup/index.html'], screens['mockup/index.html']);
  assert.notEqual(again['mockup/admin.html'], screens['mockup/admin.html']);
});

test('test mode: baked in with { test: true }, and ?test=1 is read by the shell', () => {
  const dir = fixture();
  assert.equal(bundle(buildPrototype(dir)).test, false);
  const t = buildPrototype(dir, { test: true });
  assert.equal(bundle(t).test, true);
  const shell = fs.readFileSync(path.join(PLUGIN, 'scripts/prototype/shell.js'), 'utf8');
  assert.match(shell, /\[\?&\]test=1/);
  assert.match(shell, /if \(TEST\) \{ \$\('bp-map-btn'\)\.hidden = true; \$\('bp-note-btn'\)\.hidden = true; \$\('bp-device'\)\.hidden = true; \}/);
  assert.ok(!/TEST[^;]*bp-label/.test(shell), 'the label stays');
});

test('the pill: no top bar, a fixed pill at the bottom left with label, badge, map, note, device and full screen in order', () => {
  const html = buildPrototype(fixture()).html;
  assert.ok(!html.includes('bp-bar') && !html.includes('<header'));
  const pill = /<div class="bp-pill"[\s\S]*?<\/div>\s*<section/.exec(html)[0];
  const order = ['bp-label', 'bp-badge', 'bp-map-btn', 'bp-note-btn', 'bp-device', 'bp-fs-btn'].map((id) => pill.indexOf(`id="${id}"`));
  assert.ok(order.every((n, i) => n > -1 && (i === 0 || n > order[i - 1])), order.join());
  const css = fs.readFileSync(path.join(PLUGIN, 'scripts/prototype/shell.css'), 'utf8');
  assert.match(css, /\.bp-pill \{[^}]*position: fixed; left: 14px; bottom: 14px;[^}]*background: #1d1631; color: #fff; border-radius: 999px|\.bp-pill \{[^}]*position: fixed; left: 14px; bottom: 14px;[^}]*border-radius: 999px[^}]*background: #1d1631/);
  assert.match(css, /@media \(max-width: 600px\) \{ #bp-device, #bp-fs-btn \{ display: none; \} \}/);
  const shell = fs.readFileSync(path.join(PLUGIN, 'scripts/prototype/shell.js'), 'utf8');
  assert.match(shell, /window\.claude\.use\('comments'\)/);
  assert.match(shell, /customAnchors/);
  assert.match(shell, /\/files\/mockup\//);
});

test('bp prototype build writes the file atomically and prints the summary; --test writes the other file', () => {
  const dir = fixture();
  const r = bp(dir, ['prototype', 'build']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.file, 'mockup/prototype.html');
  assert.equal(r.json.total, 4); assert.equal(r.json.built, 3);
  assert.deepEqual(r.json.missing, ['mockup/later.html']);
  assert.equal(r.json.bytes, fs.statSync(path.join(dir, 'mockup/prototype.html')).size);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'mockup')).filter((f) => f.endsWith('.tmp')), []);
  const t = bp(dir, ['prototype', 'build', '--test']);
  assert.equal(t.json.file, 'mockup/prototype-test.html');
  assert.ok(fs.existsSync(path.join(dir, 'mockup/prototype-test.html')));
  assert.equal(bundle({ html: fs.readFileSync(path.join(dir, 'mockup/prototype-test.html'), 'utf8') }).test, true);
  assert.equal(bundle({ html: fs.readFileSync(path.join(dir, 'mockup/prototype.html'), 'utf8') }).test, false);
});

test('validIsraeliId: the check digit', () => {
  assert.equal(validIsraeliId('123456782'), true);
  assert.equal(validIsraeliId('123456789'), false);
  assert.equal(validIsraeliId('12345678'), false);
  assert.equal(validIsraeliId('000000000'), false);
});

test('personalCandidates: emails (example flagged), phones, ids with the check digit', () => {
  const c = personalCandidates('mail dana@gmail.com and a@example.com, b@x.test; logo@2x.png; phone 052-123-4567, 0521234567, 03-123-4567, +972-52-123-4567, 031234567; id 123456782 and 123456789; time 1700000000000');
  const by = (k) => c.filter((x) => x.kind === k);
  assert.deepEqual(by('email').map((x) => [x.preview, x.example]), [['dana@gmail.com', false], ['a@example.com', true], ['b@x.test', true]]);
  assert.deepEqual(by('phone').map((x) => x.preview), ['052-123-4567', '0521234567', '03-123-4567', '+972-52-123-4567', '031234567']);
  assert.deepEqual(by('id').map((x) => x.preview), ['123456782']);
});

test('bp prototype scan: secrets and personal data per screen, base64 is not scanned', () => {
  const dir = fixture();
  const key = 'sk-ant-' + 'abc123DEF456ghi789JKL012mno';
  fs.writeFileSync(path.join(dir, 'mockup/list.html'), `<!doctype html><body><p>רינה 054-111-2222, dana@gmail.com, ת"ז 123456782</p><script>var k = "${key}";</script><img src="../design/img/dot.png"></body>`);
  assert.equal(bp(dir, ['prototype', 'scan']).code, 1, 'no built file yet');
  bp(dir, ['prototype', 'build']);
  const r = bp(dir, ['prototype', 'scan']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.secrets.length, 1);
  assert.equal(r.json.secrets[0].screen, 'mockup/list.html');
  assert.equal(r.json.secrets[0].name, 'Anthropic API key');
  assert.deepEqual(r.json.personal.map((x) => [x.screen, x.kind]).sort(), [['mockup/index.html', 'email'], ['mockup/list.html', 'email'], ['mockup/list.html', 'id'], ['mockup/list.html', 'phone']].sort());
  assert.throws(() => scanPrototype('<html></html>'), /not a prototype file/);
});

test('the map check leaves the built prototype files alone', () => {
  const src = fs.readFileSync(path.join(PLUGIN, 'scripts', 'check-map.mjs'), 'utf8');
  assert.match(src, /prototype\(-test\)\?\\\.html/);
});
