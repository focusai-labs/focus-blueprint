import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const dir = path.join(PLUGIN, 'data', 'junctions');
const ids = 'track files images email automations model login channel knowledge analytics domain'.split(' ');
const load = (id) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));

test('eleven junction files exist and follow the schema', () => {
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), ids.map((i) => `${i}.json`).sort());
  for (const id of ids) {
    const j = load(id);
    assert.equal(j.id, id);
    assert.ok(typeof j.need === 'string' && j.need.trim(), `${id}.need`);
    assert.ok(Array.isArray(j.opens_at) && j.opens_at.length > 0, `${id}.opens_at`);
    assert.ok(Array.isArray(j.options) && j.options.length >= 2, `${id}.options`);
    for (const o of j.options) {
      for (const f of ['id', 'name', 'fits', 'less', 'connection', 'switch']) assert.ok(typeof o[f] === 'string' && o[f].trim(), `${id}/${o.id}.${f}`);
      assert.equal(typeof o.taught, 'boolean', `${id}/${o.id}.taught`);
      assert.ok(o.cost && o.cost.text, `${id}/${o.id}.cost.text`);
      assert.match(o.cost.source, /^https:\/\//, `${id}/${o.id}.cost.source`);
      assert.match(o.cost.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${id}/${o.id}.cost.checkedAt`);
    }
    assert.ok(j.options.some((o) => o.id === j.recommend.option), `${id}.recommend.option exists`);
    assert.ok(j.recommend.why && j.recommend.unless, `${id}.recommend text`);
  }
});

test('track junction', () => {
  const j = load('track');
  assert.deepEqual(j.options.map((o) => o.id), ['static', 'supabase-app', 'n8n-engine']);
  for (const o of j.options) {
    assert.ok(o.tradeoff && o.tradeoff.trim(), `${o.id}.tradeoff`);
    assert.match(o.cost.source, /^https:\/\//);
    assert.ok(o.cost.checkedAt);
  }
  const qs = ['a-16', 'a-17', 'a-18', 'a-19'];
  for (let m = 0; m < 16; m++) {
    const ans = Object.fromEntries(qs.map((q, i) => [q, (m >> i) & 1 ? 'yes' : 'no']));
    const eligible = j.options.filter((o) => !Object.entries(o.ruledOutWhen || {}).some(([q, vals]) => vals.includes(ans[q])));
    assert.ok(eligible.length >= 2 && eligible.length <= 3, `${JSON.stringify(ans)} -> ${eligible.length}`);
    assert.ok(eligible.some((o) => o.id === j.recommend.option), `recommend inside for ${JSON.stringify(ans)}`);
  }
});
