import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpProject, bp, PLUGIN } from './helpers.mjs';

const read = (dir, ...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const readJson = (dir, ...p) => JSON.parse(read(dir, ...p));
const setup = () => { const dir = tmpProject(); bp(dir, ['init', '--name', 'x']); return dir; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const J = (o) => JSON.stringify(o);

function withProcess(dir) {
  bp(dir, ['role', 'add', 'client', '--name', 'לקוח', '--kind', 'user']);
  bp(dir, ['process', 'add', 'collect', '--name', 'איסוף']);
  bp(dir, ['process', 'stage', 'add', 'collect', '--json', J({ id: 'remind', name: 'תזכורת' })]);
}

test('init writes a schema 2 map and copies the whole blueprint-model folder', () => {
  const dir = setup();
  const m = readJson(dir, '.blueprint', 'map.json');
  assert.equal(m.schema, 2);
  for (const k of ['roles', 'access', 'services', 'processes', 'capabilities', 'screens', 'tables', 'automations', 'later']) assert.deepEqual(m[k], [], k);
  for (const f of fs.readdirSync(path.join(PLUGIN, 'scripts', 'blueprint-model'))) assert.equal(read(dir, 'scripts', 'blueprint-model', f), fs.readFileSync(path.join(PLUGIN, 'scripts', 'blueprint-model', f), 'utf8'), f);
});

test('a schema 1 map is migrated on the first write, and not on a read', () => {
  const dir = tmpProject({ state: { schema: 2, stage: 1, status: 'not_started' }, map: { schema: 1, capabilities: [{ id: 'a', name: 'A' }], screens: [], tables: [], automations: [], later: [] } });
  assert.deepEqual(bp(dir, ['role', 'list']).json, []);
  assert.equal(readJson(dir, '.blueprint', 'map.json').schema, 1);
  bp(dir, ['role', 'add', 'client', '--name', 'לקוח', '--kind', 'user']);
  const m = readJson(dir, '.blueprint', 'map.json');
  assert.equal(m.schema, 2); assert.deepEqual(m.capabilities[0].files, []); assert.equal(m.capabilities[0].reviewedFilesHash, null);
  assert.deepEqual(m.processes, []);
});

test('map add capability gets files and reviewedFilesHash; map set refuses reviewedFilesHash', () => {
  const dir = setup();
  const r = bp(dir, ['map', 'add', 'capability', J({ id: 'up', name: 'העלאה', files: ['app/a.ts'] })]);
  assert.deepEqual(r.json.files, ['app/a.ts']); assert.equal(r.json.reviewedFilesHash, null);
  assert.equal(bp(dir, ['map', 'add', 'capability', J({ id: 'two', name: 'ב' })]).json.files.length, 0);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'reviewedFilesHash=abc']).code, 1);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'files=["app/b.ts"]']).code, 0);
});

test('role add and list', () => {
  const dir = setup();
  assert.deepEqual(bp(dir, ['role', 'add', 'client', '--name', 'לקוח', '--kind', 'user']).json, { id: 'client', name: 'לקוח', kind: 'user' });
  bp(dir, ['role', 'add', 'staff', '--name', 'צוות', '--kind', 'staff']);
  assert.deepEqual(bp(dir, ['role', 'list']).json.map((r) => r.id), ['client', 'staff']);
  assert.equal(bp(dir, ['role', 'add', 'client', '--name', 'x', '--kind', 'user']).code, 1);
  assert.equal(bp(dir, ['role', 'add', 'z', '--name', 'x', '--kind', 'king']).code, 1);
  assert.equal(bp(dir, ['role', 'add', 'z', '--kind', 'user']).code, 1);
  assert.equal(bp(dir, ['role', 'add']).code, 1);
});

test('access set creates then replaces, fills defaults, validates rules', () => {
  const dir = setup();
  const rule = { role: 'client', ops: ['select'], scope: 'own', rowRule: 'רק שלו', columns: null };
  const a = bp(dir, ['access', 'set', 'documents', '--json', J({ owner: 'client_id', sensitive: ['note'], rules: [rule] })]);
  assert.equal(a.code, 0);
  assert.equal(a.json.kind, 'table'); assert.equal(a.json.exposed, true); assert.equal(a.json.serviceOnly, false);
  bp(dir, ['access', 'set', 'documents', '--json', J({ serviceOnly: true, exposed: false })]);
  const list = readJson(dir, '.blueprint', 'map.json').access;
  assert.equal(list.length, 1); assert.equal(list[0].serviceOnly, true); assert.deepEqual(list[0].rules, []);
  assert.equal(bp(dir, ['access', 'set', 'x', '--json', J({ kind: 'weird' })]).code, 1);
  assert.equal(bp(dir, ['access', 'set', 'x', '--json', J({ rules: [{ role: 'c', ops: ['select'], scope: 'maybe' }] })]).code, 1);
  assert.equal(bp(dir, ['access', 'set', 'x', '--json', '{bad']).code, 1);
  assert.equal(bp(dir, ['access', 'set', 'x']).code, 1);
  assert.equal(bp(dir, ['access', 'set', 'documents', '--json', J({ object: 'other' })]).json.object, 'documents');
});

test('service add and set', () => {
  const dir = setup();
  const s = bp(dir, ['service', 'add', 'supabase', '--json', J({ name: 'Supabase', owner: 'client', payer: 'client', secrets: ['K'] })]);
  assert.equal(s.code, 0); assert.equal(s.json.id, 'supabase'); assert.deepEqual(s.json.publicVars, []); assert.equal(s.json.renewal, null);
  assert.equal(bp(dir, ['service', 'add', 'supabase', '--json', J({ name: 'again' })]).code, 1);
  assert.equal(bp(dir, ['service', 'add', 'v', '--json', J({ owner: 'client' })]).code, 1);
  assert.equal(bp(dir, ['service', 'add', 'v', '--json', J({ name: 'V', payer: 'boss' })]).code, 1);
  const t = bp(dir, ['service', 'set', 'supabase', '--json', J({ plan: 'pro', planReason: 'גיבוי' })]);
  assert.equal(t.json.plan, 'pro'); assert.equal(t.json.name, 'Supabase'); assert.deepEqual(t.json.secrets, ['K']);
  assert.equal(bp(dir, ['service', 'set', 'nope', '--json', '{}']).code, 1);
});

test('process add, stage, step, timer and case', () => {
  const dir = setup(); withProcess(dir);
  assert.equal(bp(dir, ['process', 'add', 'collect', '--name', 'שוב']).code, 1);
  assert.equal(bp(dir, ['process', 'add', 'p2']).code, 1);
  assert.equal(bp(dir, ['process', 'stage', 'add', 'collect', '--json', J({ id: 'remind', name: 'כפול' })]).code, 1);
  const s = bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's1', stage: 'remind', actor: 'automation', kind: 'system', text: 'שולחים תזכורת', onFailure: 'התראה' })]);
  assert.equal(s.code, 0); assert.deepEqual(s.json.next, []); assert.deepEqual(s.json.tables, []); assert.equal(s.json.screen, null);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's1', stage: 'remind', actor: 'ai', kind: 'ai', text: 'כפול' })]).code, 1);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's9', stage: 'nope', actor: 'ai', kind: 'ai', text: 'x' })]).code, 1);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's9', stage: 'remind', actor: 'wizard', kind: 'ai', text: 'x' })]).code, 1);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's9', stage: 'remind', actor: 'ai', kind: 'magic', text: 'x' })]).code, 1);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's9', stage: 'remind', actor: 'ai', kind: 'ai', text: 'x', src: 'who' })]).code, 1);
  assert.equal(bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's2', stage: 'remind', actor: 'role:client', kind: 'human', text: 'מעלה', src: 'client' })]).code, 0);
  assert.equal(bp(dir, ['process', 'timer', 'add', 'collect', '--json', J({ id: 't1', text: 'תקף 90 יום', duration: 'P90D', onExpire: 'התראה' })]).code, 0);
  assert.equal(bp(dir, ['process', 'timer', 'add', 'collect', '--json', J({ id: 't2' })]).code, 1);
  assert.equal(bp(dir, ['process', 'case', 'add', 'collect', '--json', J({ id: 'c1', kind: 'happy', text: 'הכל תקין' })]).code, 0);
  assert.equal(bp(dir, ['process', 'case', 'add', 'collect', '--json', J({ id: 'c2', kind: 'odd', text: 'x' })]).code, 1);
  assert.equal(bp(dir, ['process', 'case', 'add', 'nope', '--json', J({ id: 'c3', kind: 'happy', text: 'x' })]).code, 1);
  const p = readJson(dir, '.blueprint', 'map.json').processes[0];
  assert.equal(p.steps.length, 2); assert.equal(p.timers.length, 1); assert.equal(p.cases[0].eval, null);
  assert.deepEqual(p.actors.sort(), ['automation', 'role:client']);
});

test('map impact returns nodes and the types it opens', () => {
  const dir = setup(); withProcess(dir);
  bp(dir, ['map', 'add', 'table', J({ name: 'documents', migration: 'db/migrations/1.sql' })]);
  bp(dir, ['map', 'add', 'capability', J({ id: 'up', name: 'ה', data: ['documents'], permissions: ['client:insert:documents:own'] })]);
  const r = bp(dir, ['map', 'impact', 'table:documents']);
  assert.equal(r.code, 0);
  assert.equal(r.json.nodes[0], 'table:documents'); assert.ok(r.json.nodes.includes('capability:up'));
  assert.ok(r.json.opens.includes('permission') && r.json.opens.includes('role'));
  assert.equal(bp(dir, ['map', 'impact', 'bad']).code, 1);
  assert.equal(bp(dir, ['map', 'impact']).code, 1);
});

test('render replaces gen blocks, stamps the document, is idempotent, and migrates an old map first', () => {
  const dir = tmpProject({ state: { schema: 2, stage: 1, status: 'not_started' }, map: { schema: 1, capabilities: [], screens: [], tables: [], automations: [], later: [] } });
  fs.mkdirSync(path.join(dir, 'spec'));
  fs.writeFileSync(path.join(dir, 'spec', 'prd.md'), 'כותרת\n\n<!-- gen:roles -->\nידני\n<!-- /gen:roles -->\n');
  bp(dir, ['role', 'add', 'client', '--name', 'לקוח', '--kind', 'user']);
  const r = bp(dir, ['render']);
  assert.equal(r.code, 0); assert.deepEqual(r.json.blocks, ['roles']); assert.equal(r.json.changed, true);
  const doc = read(dir, 'spec', 'prd.md');
  assert.ok(doc.includes('| client | לקוח | משתמש |')); assert.ok(!doc.includes('ידני'));
  const mapFile = path.join(dir, '.blueprint', 'map.json');
  const hash = doc.split('\n')[0].match(/blueprint-map: ([0-9a-f]{64})/)[1];
  assert.equal(hash, r.json.stamp.match(/([0-9a-f]{64})/)[1]);
  // the stamp is the canonical hash of the map as it is on disk
  const onDisk = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  assert.equal(hash, sha(JSON.stringify(sorted(onDisk))));
  assert.equal(bp(dir, ['render']).json.changed, false);
  assert.equal(read(dir, 'spec', 'prd.md'), doc);
});

test('render on a schema 1 map writes the migration before stamping', () => {
  const dir = tmpProject({ state: { schema: 2, stage: 1, status: 'not_started' }, map: { schema: 1, capabilities: [], screens: [], tables: [], automations: [], later: [] } });
  fs.mkdirSync(path.join(dir, 'spec')); fs.writeFileSync(path.join(dir, 'spec', 'prd.md'), 'x\n');
  bp(dir, ['render']);
  assert.equal(readJson(dir, '.blueprint', 'map.json').schema, 2);
});

test('render --file, a missing file and a path outside the project', () => {
  const dir = setup();
  fs.writeFileSync(path.join(dir, 'spec', 'other.md'), '<!-- gen:timers -->\n<!-- /gen:timers -->\n');
  const r = bp(dir, ['render', '--file', 'spec/other.md']);
  assert.equal(r.code, 0); assert.ok(read(dir, 'spec', 'other.md').includes('אין עדיין שעונים.'));
  assert.equal(bp(dir, ['render']).code, 1);   // no spec/prd.md
  assert.equal(bp(dir, ['render', '--file', '../x.md']).code, 1);
});

const dimsData = (items) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dims-'));
  fs.writeFileSync(path.join(d, 'dimensions.json'), JSON.stringify(items));
  return { FOCUS_BLUEPRINT_DATA: d };
};
const DIMS = [{ id: 'data', opensOn: ['table', 'field', 'migration'] }, { id: 'security', opensOn: ['permission', 'access'] }, { id: 'copy', opensOn: ['content'] }];

test('change open computes nodes and opens dimensions by node type', () => {
  const dir = setup();
  bp(dir, ['map', 'add', 'table', J({ name: 'documents', migration: 'm.sql' })]);
  bp(dir, ['map', 'add', 'capability', J({ id: 'up', name: 'ה', data: ['documents'], permissions: ['client:insert:documents:own'] })]);
  const r = bp(dir, ['change', 'open', 'עמודה חדשה', '--kind', 'field', '--ref', 'table:documents'], dimsData(DIMS));
  assert.equal(r.code, 0); assert.equal(r.json.index, 0);
  // dimensions open on the kind and the refs' own types; the walk still lists the nodes to update
  assert.deepEqual(r.json.dimensions.map((d) => d.id), ['data']);
  assert.deepEqual(r.json.dimensions[0], { id: 'data', status: 'open', proof: null, reason: '', at: '' });
  assert.ok(r.json.nodes.includes('capability:up')); assert.equal(r.json.decision, 'now');
  assert.equal(r.json.impact.tables, 1);
  const saved = readJson(dir, '.blueprint', 'changes.json');
  assert.equal(saved.length, 1); assert.deepEqual(saved[0].nodes, r.json.nodes);
  const p = bp(dir, ['change', 'open', 'הרשאה חדשה', '--kind', 'permission', '--ref', 'table:documents'], dimsData(DIMS));
  assert.deepEqual(p.json.dimensions.map((d) => d.id), ['data', 'security']);
  assert.ok(p.json.nodes.includes('capability:up'));
  // no ref: the kind itself opens its type; wording opens content
  assert.deepEqual(bp(dir, ['change', 'open', 'ניסוח', '--kind', 'wording'], dimsData(DIMS)).json.dimensions.map((d) => d.id), ['copy']);
  assert.deepEqual(bp(dir, ['change', 'open', 'מסלול', '--kind', 'track'], dimsData(DIMS)).json.dimensions, []);
  assert.equal(bp(dir, ['change', 'open', 'x', '--kind', 'nonsense']).code, 1);
  assert.equal(bp(dir, ['change', 'open', 'x', '--kind', 'field', '--ref', 'bad']).code, 1);
  assert.equal(bp(dir, ['change', 'open']).code, 1);
});

test('change open with no dimensions file opens none and says so in Hebrew', () => {
  const dir = setup();
  // FOCUS_BLUEPRINT_DATA falls back to the plugin's own data/dimensions.json, so the missing file
  // is tested on a copy of the plugin without it
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'nodims-'));
  fs.cpSync(PLUGIN, copy, { recursive: true, filter: (src) => src !== path.join(PLUGIN, 'data', 'dimensions.json') });
  const run = spawnSync(process.execPath, [path.join(copy, 'scripts', 'bp.mjs'), 'change', 'open', 'שדה', '--kind', 'field', '--project', dir], { encoding: 'utf8', env: { ...process.env, FOCUS_BLUEPRINT_HOME: path.join(dir, '.home') } });
  const r = JSON.parse(run.stdout);
  assert.equal(run.status, 0); assert.deepEqual(r.dimensions, []); assert.match(r.note, /^הקובץ data\/dimensions.json חסר/);
  // with the plugin's own file the note disappears and the field change opens dimensions
  const real = bp(dir, ['change', 'open', 'שדה', '--kind', 'field']).json;
  assert.equal(real.note, undefined); assert.ok(real.dimensions.length > 0);
});

test('change dimension closes with proof or na with a reason, and log done refuses while open', () => {
  const dir = setup();
  const env = dimsData(DIMS);
  bp(dir, ['change', 'open', 'עמודה', '--kind', 'field'], env);   // opens data only
  assert.deepEqual(readJson(dir, '.blueprint', 'changes.json')[0].dimensions.map((d) => d.id), ['data']);
  const done = bp(dir, ['log', 'done', '0']);
  assert.equal(done.code, 1); assert.match(done.err, /עוד פתוחים: data/);
  assert.equal(bp(dir, ['change', 'dimension', '0', 'data', '--status', 'closed']).code, 1);
  assert.equal(bp(dir, ['change', 'dimension', '0', 'data', '--status', 'closed', '--proof', 'evals/none.txt']).code, 1);
  assert.equal(bp(dir, ['change', 'dimension', '0', 'data', '--status', 'closed', '--proof', '../outside.txt']).code, 1);
  assert.equal(bp(dir, ['change', 'dimension', '0', 'data', '--status', 'na']).code, 1);
  assert.equal(bp(dir, ['change', 'dimension', '0', 'nope', '--status', 'na', '--reason', 'x']).code, 1);
  assert.equal(bp(dir, ['change', 'dimension', '5', 'data', '--status', 'na', '--reason', 'x']).code, 1);
  fs.mkdirSync(path.join(dir, 'evals', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evals', 'evidence', 'x.txt'), 'ok');
  const c = bp(dir, ['change', 'dimension', '0', 'data', '--status', 'closed', '--proof', 'evals/evidence/x.txt']);
  assert.equal(c.code, 0); assert.equal(c.json.dimensions[0].status, 'closed'); assert.equal(c.json.dimensions[0].proof, 'evals/evidence/x.txt'); assert.ok(c.json.dimensions[0].at);
  assert.equal(bp(dir, ['log', 'done', '0']).code, 0);
  const e = readJson(dir, '.blueprint', 'changes.json')[0];
  assert.equal(e.done, true); assert.ok(e.doneAt);
  // na path
  bp(dir, ['change', 'open', 'עוד', '--kind', 'field'], env);
  const na = bp(dir, ['change', 'dimension', '1', 'data', '--status', 'na', '--reason', 'לא נוגע בנתונים']);
  assert.equal(na.json.dimensions[0].status, 'na'); assert.equal(na.json.dimensions[0].reason, 'לא נוגע בנתונים');
  assert.equal(bp(dir, ['log', 'done', '1']).code, 0);
});

test('log done: bad index, a later change, and old entries without dimensions', () => {
  const dir = setup();
  assert.equal(bp(dir, ['log', 'done', '0']).code, 1);
  assert.equal(bp(dir, ['log', 'done']).code, 1);
  bp(dir, ['log', 'add', 'kind=wording', 'text=ניסוח', 'decision=later']);
  assert.equal(bp(dir, ['log', 'done', '0']).code, 1);
  bp(dir, ['log', 'add', 'kind=wording', 'text=ניסוח', 'decision=now']);
  assert.equal(bp(dir, ['log', 'done', '1']).code, 0);
});

test('review record stores reviewedFilesHash over the capability files', () => {
  const dir = setup();
  fs.mkdirSync(path.join(dir, 'app')); fs.writeFileSync(path.join(dir, 'app', 'a.ts'), 'A'); fs.writeFileSync(path.join(dir, 'app', 'b.ts'), 'B');
  bp(dir, ['map', 'add', 'capability', J({ id: 'up', name: 'ה', files: ['app/b.ts', 'app/a.ts'] })]);
  // give it green evidence directly, the review command only checks that it exists
  const map = readJson(dir, '.blueprint', 'map.json');
  map.capabilities[0].evidence.green = { path: 'x', exit: 0, at: 'x', sha256: 'x' };
  fs.writeFileSync(path.join(dir, '.blueprint', 'map.json'), J(map));
  fs.writeFileSync(path.join(dir, 'review.md'), 'ok');
  const r = bp(dir, ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', 'review.md']);
  assert.equal(r.code, 0);
  const expected = sha(['app/a.ts:' + sha('A'), 'app/b.ts:' + sha('B')].join('\n'));
  assert.equal(readJson(dir, '.blueprint', 'map.json').capabilities[0].reviewedFilesHash, expected);
  fs.writeFileSync(path.join(dir, 'app', 'a.ts'), 'A2');
  bp(dir, ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', 'review.md']);
  assert.notEqual(readJson(dir, '.blueprint', 'map.json').capabilities[0].reviewedFilesHash, expected);
});

test('the copied model folder works on its own in the project', async () => {
  const dir = setup();
  const m = await import(path.join(dir, 'scripts', 'blueprint-model', 'map-model.mjs'));
  assert.equal(typeof m.canonicalHash, 'function');
  assert.match(m.canonicalHash(readJson(dir, '.blueprint', 'map.json')), /^[0-9a-f]{64}$/);
});
