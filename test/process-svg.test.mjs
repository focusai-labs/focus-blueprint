// The process SVG builder on a fixture map. Run: node --test test/process-svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLUGIN } from './helpers.mjs';

const { processSvg, processStats, wrap, durationHe } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'process-svg.mjs')).href);
const here = path.dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'map', 'accountant.json'), 'utf8'));
const ID = 'monthly-collection';

test('one card per step, with its autonomy kind', () => {
  const svg = processSvg(map, ID);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal((svg.match(/class="bp-card"/g) || []).length, 6);
  for (const kind of ['system', 'human', 'ai', 'rejection']) assert.match(svg, new RegExp(`data-kind="${kind}"`));
  assert.match(svg, /direction="rtl"/);
});

test('arrows follow next, a red side path follows onFailure, humans have none', () => {
  const svg = processSvg(map, ID);
  // s1>s2, s2>s3, s3>s4, s3>s5, s4>s6, s5>s2
  assert.equal((svg.match(/class="bp-edge/g) || []).length, 6);
  assert.equal((svg.match(/class="bp-fail"/g) || []).length, 4); // s1, s3, s5, s6
  assert.match(svg, /התראה לרואת החשבון/);
});

test('the first stage is on the right', () => {
  const svg = processSvg(map, ID);
  const x = (id) => Number(new RegExp(`data-step="${id}"[^>]*>(?:<title>[^<]*</title>)?<rect x="([\\d.]+)"`).exec(svg)[1]);
  assert.ok(x('s1') > x('s2') && x('s2') > x('s3') && x('s3') > x('s6'));
});

test('source bubbles carry the source text; sources:false removes them', () => {
  const svg = processSvg(map, ID);
  assert.equal((svg.match(/class="bp-bub"/g) || []).length, 6); // s6 has src but no text, still a bubble: 6 steps with src
  assert.match(svg, /data-tip="הלקוח אמר: שיחת האפיון, 06\.08"/);
  const bare = processSvg(map, ID, { sources: false });
  assert.doesNotMatch(bare, /bp-bub"/);
  assert.doesNotMatch(bare, /שיחת האפיון/);
});

test('timers: a chip on their stage, the others in a strip', () => {
  const svg = processSvg(map, ID);
  assert.equal((svg.match(/class="bp-timer"/g) || []).length, 2);
  assert.match(svg, /90 ימים/);
  assert.match(svg, /3 ימים/);
});

test('text from the map is escaped', () => {
  const evil = JSON.parse(JSON.stringify(map));
  evil.processes[0].steps[0].text = '<script>alert(1)</script> "x" & y';
  const svg = processSvg(evil, ID);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test('mini version has no text, an unknown id gives an empty svg, a stage-less process still draws', () => {
  const mini = processSvg(map, ID, { mini: true });
  assert.doesNotMatch(mini, /<text/);
  assert.equal((mini.match(/class="bp-card"/g) || []).length, 6);
  assert.match(processSvg(map, 'nope'), /<svg/);
  const bare = { processes: [{ id: 'p', steps: [{ id: 'a', actor: 'server', kind: 'system', text: 'x', next: [] }] }] };
  assert.equal((processSvg(bare, 'p').match(/class="bp-card"/g) || []).length, 1);
});

test('wide maps get wide svgs (no clipping), helpers', () => {
  const wide = { processes: [{ id: 'w', stages: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `שלב ${i}` })), actors: ['screen', 'server', 'automation', 'ai', 'external:x', 'role:a'],
    steps: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, stage: `s${i}`, actor: ['screen', 'server', 'automation', 'ai', 'external:x', 'role:a'][i % 6], kind: 'system', text: 'צעד', onFailure: 'x', next: i < 7 ? [`t${i + 1}`] : [] })) }] };
  const svg = processSvg(wide, 'w');
  assert.ok(Number(/ width="([\d.]+)"/.exec(svg)[1]) > 2000);
  assert.deepEqual(processStats(map, ID), { steps: 6, stages: 4, timers: 2, cases: 3 });
  assert.equal(processStats(map, 'nope'), null);
  assert.ok(wrap('מילה '.repeat(40), 150, 13, 2).length === 2 && wrap('מילה '.repeat(40), 150, 13, 2)[1].endsWith('…'));
  assert.equal(durationHe('P90D'), '90 ימים');
});
