import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const dir = path.join(PLUGIN, 'data', 'tracks');
const IDS = ['static', 'supabase-app', 'n8n-engine'];
const HOSTS = [
  ['vercel.com', '/docs'], ['supabase.com', '/docs'], ['docs.n8n.io', '/'], ['docs.github.com', '/'],
  ['code.claude.com', '/docs'], ['developers.cloudflare.com', '/'], ['nextjs.org', '/docs'],
];
const load = (id) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
const allDocs = () => IDS.flatMap((id) => load(id).steps.flatMap((s) => s.docs));

test('track files follow the schema', () => {
  const stages = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'stages.json'), 'utf8')).map((s) => s.n);
  for (const id of IDS) {
    const t = load(id);
    assert.equal(t.id, id);
    for (const f of ['name', 'when']) assert.ok(typeof t[f] === 'string' && t[f].trim(), `${id}.${f}`);
    assert.ok(Array.isArray(t.needs) && t.needs.length > 0);
    assert.ok(t.steps.length > 0);
    const ids = t.steps.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${id} step ids are unique`);
    for (const s of t.steps) {
      assert.match(s.id, /^[a-z0-9-]+$/);
      assert.ok(stages.includes(s.stage), `${s.id} stage`);
      for (const f of ['intent', 'safety', 'proof']) assert.ok(typeof s[f] === 'string' && s[f].trim(), `${s.id}.${f}`);
      assert.ok(Array.isArray(s.docs) && s.docs.length > 0, `${s.id}.docs`);
    }
  }
});

test('docs URLs are https and on the allowed hosts', () => {
  for (const u of allDocs()) {
    const url = new URL(u);
    assert.equal(url.protocol, 'https:', u);
    assert.ok(HOSTS.some(([h, p]) => url.hostname === h && url.pathname.startsWith(p)), u);
  }
});

test('docs URLs answer 200 (online)', { skip: process.env.BP_ONLINE !== '1' }, async () => {
  for (const u of new Set(allDocs())) {
    const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    assert.equal(r.status, 200, u);
  }
});
