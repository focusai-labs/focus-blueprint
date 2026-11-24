import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const M = path.join(PLUGIN, 'scripts', 'blueprint-model');
const { canonicalHash, migrateMap, nodesOf, impact, filesHash } = await import(path.join(M, 'map-model.mjs'));
const { renderBlock, replaceBlocks, stampDocument, stampOf, extractBlocks, GEN_KINDS } = await import(path.join(M, 'render-blocks.mjs'));

const map = () => ({
  schema: 2,
  capabilities: [{ id: 'upload-docs', name: 'העלאה', screens: ['mockup/upload.html'], data: ['documents'], permissions: ['client:insert:documents:own'], automations: ['n8n:reminder'], files: [], reviewedFilesHash: null }],
  screens: [{ file: 'mockup/upload.html', name: 'העלאת מסמך', persona: 'client', journeyStage: 'upload', nav: 'linear' }],
  tables: [{ name: 'documents', migration: 'db/migrations/0001.sql' }, { name: 'other', migration: 'db/migrations/0002.sql' }],
  automations: [{ id: 'n8n:reminder', where: 'n8n', copy: 'n8n/r.json' }], later: [],
  roles: [{ id: 'client', name: 'לקוח', kind: 'user' }, { id: 'staff', name: 'צוות', kind: 'staff' }],
  access: [{ object: 'documents', kind: 'table', exposed: true, serviceOnly: false, owner: 'client_id', sensitive: ['internal_note'], rules: [{ role: 'client', ops: ['select', 'insert'], scope: 'own', rowRule: 'רק את המסמכים שלו | ו', columns: null }] }],
  services: [{ id: 'supabase', name: 'Supabase', purpose: 'מסד נתונים', owner: 'client', payer: 'client', plan: 'pro', planReason: 'גיבוי יומי', docs: 'https://supabase.com/docs', secrets: ['SUPABASE_SECRET_KEY'], publicVars: [], webhooksIn: ['n8n:monthly'], webhooksOut: [], capabilities: ['upload-docs'], renewal: null }],
  processes: [{ id: 'collect', name: 'איסוף', stages: [{ id: 'remind', name: 'תזכורת' }, { id: 'upload', name: 'העלאה' }], actors: [],
    steps: [
      { id: 's2', stage: 'upload', actor: 'role:client', kind: 'human', text: 'מעלים קובץ', screen: 'mockup/upload.html', capability: 'upload-docs', tables: ['documents'], permission: null, test: null, onFailure: null, next: [], src: 'client', source: '' },
      { id: 's1', stage: 'remind', actor: 'automation', kind: 'system', text: 'שולחים תזכורת', screen: null, capability: null, tables: [], permission: null, test: null, onFailure: 'התראה למנהלת', next: ['s2'], src: 'ours', source: '' },
      { id: 's3', stage: 'upload', actor: 'ai', kind: 'ai', text: 'מסכמים', screen: null, capability: null, tables: [], permission: null, test: null, onFailure: 'ידני', next: [], src: 'assumed', source: '' }],
    timers: [{ id: 't1', text: 'תקף 90 יום', duration: 'P90D', onExpire: 'התראה', test: null }],
    cases: [{ id: 'c1', kind: 'happy', text: 'הכל תקין', eval: null }, { id: 'c2', kind: 'problem', text: 'קובץ ריק', eval: 'evals/x.md' }] }],
});

test('canonicalHash ignores key order and changes with content', () => {
  const a = { x: 1, y: { b: 2, a: [3, { d: 1, c: 2 }] } };
  const b = { y: { a: [3, { c: 2, d: 1 }], b: 2 }, x: 1 };
  assert.equal(canonicalHash(a), canonicalHash(b));
  assert.match(canonicalHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(canonicalHash(a), canonicalHash({ ...a, x: 2 }));
  assert.notEqual(canonicalHash({ a: [1, 2] }), canonicalHash({ a: [2, 1] }));
});

test('migrateMap: schema 1 to 2, keeps fields, idempotent, does not touch the input', () => {
  const old = { schema: 1, capabilities: [{ id: 'a', name: 'x' }], screens: [], tables: [], automations: [], later: [{ id: 'later-1' }] };
  const keep = JSON.stringify(old);
  const m = migrateMap(old);
  assert.equal(JSON.stringify(old), keep);
  assert.equal(m.schema, 2);
  for (const k of ['roles', 'access', 'services', 'processes']) assert.deepEqual(m[k], []);
  assert.deepEqual(m.capabilities[0], { id: 'a', name: 'x', files: [], reviewedFilesHash: null });
  assert.equal(m.later[0].id, 'later-1');
  assert.deepEqual(migrateMap(m), m);
  const keepFiles = migrateMap({ schema: 1, capabilities: [{ id: 'a', files: ['f.js'], reviewedFilesHash: 'h' }] });
  assert.deepEqual(keepFiles.capabilities[0].files, ['f.js']); assert.equal(keepFiles.capabilities[0].reviewedFilesHash, 'h');
});

test('nodesOf lists every declared node with its type', () => {
  const refs = nodesOf(map()).map((n) => n.ref);
  for (const r of ['capability:upload-docs', 'screen:mockup/upload.html', 'table:documents', 'role:client', 'access:documents', 'field:documents.client_id', 'field:documents.internal_note',
    'service:supabase', 'secret:SUPABASE_SECRET_KEY', 'webhook:n8n:monthly', 'plan:supabase', 'process:collect', 'step:collect.s1', 'timer:collect.t1', 'case:collect.c2', 'ai:collect.s3',
    'automation:n8n:reminder', 'permission:client:insert:documents:own']) assert.ok(refs.includes(r), r);
  const n = nodesOf(map()).find((x) => x.ref === 'step:collect.s1');
  assert.deepEqual(n, { ref: 'step:collect.s1', type: 'step', id: 'collect.s1' });
  assert.deepEqual(refs, [...refs].sort());
});

test('impact of a table reaches capability, screen, access, permission, steps and the process pieces', () => {
  const r = impact(map(), 'table:documents');
  assert.equal(r.nodes[0], 'table:documents');
  for (const x of ['capability:upload-docs', 'screen:mockup/upload.html', 'access:documents', 'field:documents.internal_note', 'step:collect.s2', 'process:collect', 'role:client', 'automation:n8n:reminder', 'timer:collect.t1']) assert.ok(r.nodes.includes(x), x);
  assert.ok(!r.nodes.includes('table:other'));
  for (const t of ['capability', 'screen', 'access', 'permission', 'role', 'step', 'process', 'timer', 'field', 'table']) assert.ok(r.opens.includes(t), t);
  assert.deepEqual(r.opens, [...r.opens].sort());
});

test('impact does not walk through a role', () => {
  const m = map();
  m.access.push({ object: 'invoices', kind: 'table', exposed: true, serviceOnly: false, owner: null, sensitive: [], rules: [{ role: 'client', ops: ['select'], scope: 'own', rowRule: '', columns: null }] });
  const r = impact(m, 'table:documents');
  assert.ok(r.nodes.includes('role:client'));
  assert.ok(!r.nodes.includes('access:invoices'));
});

test('impact of a service, a step, an unknown ref and a bad ref', () => {
  const s = impact(map(), 'service:supabase');
  for (const x of ['secret:SUPABASE_SECRET_KEY', 'webhook:n8n:monthly', 'plan:supabase', 'capability:upload-docs']) assert.ok(s.nodes.includes(x), x);
  assert.ok(s.opens.includes('secret') && s.opens.includes('webhook') && s.opens.includes('plan'));
  const st = impact(map(), 'step:collect.s3');
  assert.ok(st.nodes.includes('ai:collect.s3') && st.opens.includes('ai'));
  assert.deepEqual(impact(map(), 'table:nothing'), { nodes: ['table:nothing'], opens: ['table'] });
  assert.throws(() => impact(map(), 'nothing'));
  assert.deepEqual(impact({ schema: 1, capabilities: [] }, 'table:x').nodes, ['table:x']);
});

test('filesHash: sorted, content based, missing file counted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'A'); fs.writeFileSync(path.join(dir, 'b.txt'), 'B');
  const h = filesHash(dir, ['b.txt', 'a.txt']);
  assert.equal(h, filesHash(dir, ['a.txt', 'b.txt', 'a.txt']));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'A2');
  assert.notEqual(h, filesHash(dir, ['a.txt', 'b.txt']));
  assert.notEqual(filesHash(dir, ['a.txt', 'nope.txt']), filesHash(dir, ['a.txt']));
  assert.match(filesHash(dir, []), /^[0-9a-f]{64}$/);
});

test('renderBlock: every kind is a Hebrew table, and empty maps give a Hebrew line', () => {
  for (const k of GEN_KINDS) {
    const t = renderBlock(map(), k);
    assert.ok(t.startsWith('| '), k);
    assert.ok(t.split('\n')[1].startsWith('| ---'), k);
    assert.ok(!/[—–]/.test(t), k);
    const e = renderBlock({ schema: 2 }, k);
    assert.match(e, /^אין עדיין /, k);
  }
  assert.throws(() => renderBlock(map(), 'nope'));
});

test('renderBlock content: names, escaping, durations, order', () => {
  assert.ok(renderBlock(map(), 'roles').includes('| `client` | לקוח | משתמש |'));
  const p = renderBlock(map(), 'permissions');
  assert.ok(p.includes('קריאה, הוספה') && p.includes('רק שלו'));
  assert.ok(p.includes('רק את המסמכים שלו \\| ו'));
  assert.ok(renderBlock(map(), 'timers').includes('90 ימים'));
  const pr = renderBlock(map(), 'processes').split('\n');
  assert.ok(pr[2].includes('| `s1` |') && pr[3].includes('| `s2` |'));   // stage order, not array order
  assert.ok(renderBlock(map(), 'autonomy').includes('אוטומטי (ירוק)'));
  assert.ok(renderBlock(map(), 'autonomy').includes('בינה מלאכותית (סגול)'));
  assert.ok(renderBlock(map(), 'cases').includes('| איסוף | תקלה | קובץ ריק | evals/x.md |'));
  assert.ok(renderBlock(map(), 'services').includes('| Supabase | מסד נתונים | הלקוח | הלקוח | pro | גיבוי יומי |'));
  assert.ok(renderBlock(map(), 'screens').includes('mockup/upload.html'));
  assert.equal(renderBlock(map(), 'roles'), renderBlock(map(), 'roles'));
});

test('replaceBlocks replaces only known gen blocks, idempotent, keeps the rest', () => {
  const md = 'כותרת\n\n<!-- gen:roles -->\nידני\n<!-- /gen:roles -->\n\nטקסט חופשי\n\n<!-- gen:timers -->\n<!-- /gen:timers -->\n\n<!-- gen:zzz -->\nשלי\n<!-- /gen:zzz -->\n';
  const out = replaceBlocks(md, map());
  assert.ok(out.includes(`<!-- gen:roles -->\n${renderBlock(map(), 'roles')}\n<!-- /gen:roles -->`));
  assert.ok(out.includes('טקסט חופשי') && out.includes('<!-- gen:zzz -->\nשלי\n'));
  assert.ok(!out.includes('ידני'));
  assert.equal(replaceBlocks(out, map()), out);
  assert.deepEqual(extractBlocks(out).map((b) => b.kind), ['roles', 'timers', 'zzz']);
  assert.equal(extractBlocks(out)[0].content, renderBlock(map(), 'roles'));
});

test('stampDocument puts the map stamp first and replaces an older one', () => {
  const m = map();
  const s = stampDocument('כותרת\n', m);
  assert.equal(s.split('\n')[0], `<!-- blueprint-map: ${canonicalHash(m)} -->`);
  assert.equal(stampOf(s), canonicalHash(m));
  const m2 = { ...m, later: [{ id: 'later-1' }] };
  const s2 = stampDocument(s, m2);
  assert.equal(s2.split('\n').filter((l) => l.startsWith('<!-- blueprint-map')).length, 1);
  assert.equal(stampOf(s2), canonicalHash(m2));
  assert.equal(stampDocument(s2, m2), s2);
  assert.equal(stampOf('כלום'), null);
});

test('the model folder imports nothing from outside itself', () => {
  for (const f of fs.readdirSync(M).filter((x) => x.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(M, f), 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) assert.ok(m[1].startsWith('node:') || m[1].startsWith('./'), `${f}: ${m[1]}`);
  }
});
