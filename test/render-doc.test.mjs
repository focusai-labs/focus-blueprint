// The document renderer. Run: node --test test/render-doc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const { renderDoc } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'render-doc.mjs')).href);
const here = path.dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'map', 'accountant.json'), 'utf8'));
const prd = fs.readFileSync(path.join(here, 'fixtures', 'map', 'sample-prd.md'), 'utf8');

test('page shell: rtl, hebrew, self-contained', () => {
  const html = renderDoc('# כותרת\n\nפסקה.', map, '');
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /<title>כותרת<\/title>/);
  assert.doesNotMatch(html, /<link |<script|@import|https?:\/\/fonts/);
});

test('headings, paragraphs, bold, italic, lists', () => {
  const html = renderDoc('## ראש\n\nטקסט **חזק** ו-*נטוי* ו-__עוד__.\n\n- א\n- ב\n  - ב1\n\n1. ראשון\n2. שני', map, '');
  assert.match(html, /<h2>ראש<\/h2>/);
  assert.match(html, /<strong>חזק<\/strong>/);
  assert.match(html, /<em>נטוי<\/em>/);
  assert.match(html, /<strong>עוד<\/strong>/);
  assert.match(html, /<ul><li>א<\/li><li>ב<ul><li>ב1<\/li><\/ul><\/li><\/ul>/);
  assert.match(html, /<ol><li>ראשון<\/li><li>שני<\/li><\/ol>/);
});

test('tables, blockquotes, code and fences stay LTR', () => {
  const html = renderDoc('| א | ב |\n|---|:-:|\n| 1 | `x\\|y` |\n\n> ציטוט\n\n```js\nconst a = "<b>";\n```', map, '');
  assert.match(html, /<table><thead><tr><th>א<\/th><th style="text-align:center">ב<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>1<\/td>/);
  assert.match(html, /<blockquote><p>ציטוט<\/p><\/blockquote>/);
  assert.match(html, /<code dir="ltr">x\|y<\/code>/);
  assert.match(html, /<pre dir="ltr"><code>const a = &quot;&lt;b&gt;&quot;;<\/code><\/pre>/);
});

test('links and bare urls are LTR; unsafe schemes are dropped', () => {
  const html = renderDoc('ראו [Docs](https://a.com/x?a=1&b=2) וגם https://b.com/y. [רע](javascript:alert(1))', map, '');
  assert.match(html, /<a href="https:\/\/a\.com\/x\?a=1&amp;b=2" rel="noopener"><bdi dir="ltr">Docs<\/bdi><\/a>/);
  assert.match(html, /<bdi dir="ltr"><a href="https:\/\/b\.com\/y"/);
  assert.doesNotMatch(html, /javascript:/);
});

test('everything from the markdown is escaped, no raw html passes through', () => {
  const html = renderDoc('# <img src=x onerror=1>\n\n<script>alert(1)</script> <b>x</b>\n\n| <i>h</i> |\n|---|\n| "q" |', map, '');
  assert.doesNotMatch(html, /<script>alert|<img|<b>x|<i>h/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;q&quot;/);
});

test('review keeps voice bubbles, highlights assumptions, labels gen blocks, shows the stamp', () => {
  const html = renderDoc(prd, map, '');
  assert.match(html, /class="src src-client"/);
  assert.match(html, /class="src src-ours"/);
  assert.match(html, /class="src src-assumed"/);
  assert.match(html, /<li class="assumed">הלקוחות מעדיפים וואטסאפ על פני מייל\./);
  assert.match(html, /<tr class="assumed">/);
  assert.match(html, /<p class="from-map">מהמפה<\/p>/);
  assert.match(html, /<footer class="stamp">נבנה מהמפה, חותמת [0-9a-f]{8}, המסמך מעודכן\./);
  assert.doesNotMatch(html, /<!--|src:client|gen:/);
});

test('a stamp that no longer matches the map is said in the footer', () => {
  const other = JSON.parse(JSON.stringify(map)); other.roles.push({ id: 'z', name: 'ז', kind: 'user' });
  assert.match(renderDoc(prd, other, ''), /המפה השתנתה מאז/);
});

test('client version has no markers at all', () => {
  const html = renderDoc(prd, map, '', { client: true }).replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, (m) => m.replace(/<style>[\s\S]*?<\/style>/, ''));
  assert.doesNotMatch(html, /class="src|assumed|from-map|review-bar|footer class="stamp"|bp-bub|<!--|שיחת האפיון/);
  assert.match(html, /<svg[^>]*class="bp-svg"/, 'the process picture is content and stays');
  assert.match(html, /רואת חשבון מבלה שלושה ימים/);
});

test('processes block gets the svg above its table', () => {
  const html = renderDoc(prd, map, '');
  const sec = /<section class="gen" data-gen="processes">([\s\S]*?)<\/section>/.exec(html)[1];
  assert.ok(sec.indexOf('<svg') > -1 && sec.indexOf('<svg') < sec.indexOf('<table>'));
  assert.equal((sec.match(/<figure class="proc">/g) || []).length, 2);
  assert.doesNotMatch(renderDoc(prd, map, '').replace(sec, ''), /<figure/);
});

test('tokens are inlined, imports are stripped, style cannot be closed early', () => {
  const html = renderDoc('# x', map, '@import url("https://x.com/a.css");\n:root{--color-primary:#0a7;}</style><script>1</script>');
  assert.match(html, /--color-primary:#0a7/);
  assert.doesNotMatch(html, /@import|<\/style><script>/);
  assert.match(renderDoc('# x', map, ''), /#5b3fd6/, 'neutral default without tokens');
});

test('bp doc html writes the review and client files, overwriting, and never touches the map', () => {
  const dir = tmpProject({ state: { schema: 2, project: 'x', stage: 1, status: 'in_progress' }, map });
  fs.mkdirSync(path.join(dir, 'spec')); fs.mkdirSync(path.join(dir, 'design'));
  fs.writeFileSync(path.join(dir, 'spec', 'prd.md'), prd);
  fs.writeFileSync(path.join(dir, 'design', 'tokens.css'), ':root{--color-primary:#0a7;}');
  const mapBefore = fs.readFileSync(path.join(dir, '.blueprint', 'map.json'), 'utf8');
  const a = bp(dir, ['doc', 'html', 'spec/prd.md']);
  assert.equal(a.code, 0, a.err);
  assert.equal(a.json.file, 'docs/rendered/prd.html');
  assert.match(fs.readFileSync(path.join(dir, 'docs', 'rendered', 'prd.html'), 'utf8'), /--color-primary:#0a7/);
  const b = bp(dir, ['doc', 'html', 'spec/prd.md', '--client']);
  assert.equal(b.json.file, 'docs/rendered/prd.client.html');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'docs', 'rendered', 'prd.client.html'), 'utf8'), /class="src/);
  assert.equal(bp(dir, ['doc', 'html', 'spec/prd.md', '--client']).code, 0);
  assert.equal(fs.readFileSync(path.join(dir, '.blueprint', 'map.json'), 'utf8'), mapBefore);
  assert.notEqual(bp(dir, ['doc', 'html', '../outside.md']).code, 0);
});
