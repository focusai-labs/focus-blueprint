// data/dimensions.json (T8): the impact dimensions that bp change open opens and the checker enforces.
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const FILE = path.join(PLUGIN, 'data', 'dimensions.json');
const { NODE_TYPES } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'blueprint-model', 'map-model.mjs')).href);
const { checkMap } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'check-map.mjs')).href);

// bp change open matches opensOn against node types, plus the one change kind that is not a node type
const TOKENS = new Set([...NODE_TYPES, 'migration']);
const TRACKS = ['static', 'supabase-app', 'n8n-engine'];
const BASIS = ['law', 'std', 'vendor', 'inf'];
const EVIDENCE = ['file', 'command', 'evidence-file', 'advisors'];
const VENDORS = ['supabase', 'vercel', 'github', 'n8n', 'cardcom'];
const KEYS = ['id', 'name', 'intent', 'opensOn', 'tracks', 'modifier', 'evidence', 'must', 'conditional', 'proof', 'paid', 'docs'];
// the 31 dimensions of docs/ai-dev-lesson-17/research/dimensions-research.md, section 1
const RESEARCH_IDS = [
  'quality-tests', 'data-model', 'backup-restore', 'data-lifecycle', 'audit-trail',
  'access-control', 'identity-auth', 'secrets', 'abuse-protection', 'app-hardening', 'supply-chain',
  'ux-design-system', 'accessibility', 'content', 'seo-sharing', 'analytics',
  'integrations', 'ai-components', 'email-messaging', 'payments',
  'privacy', 'legal-documents',
  'environments', 'release-rollback', 'observability', 'performance', 'reliability', 'cost-plan-limits', 'domain-dns-tls', 'vendor-lifecycle', 'ownership-operations',
];

const dims = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(dims.map((d) => [d.id, d]));
const HEB_FIRST = /^["'(]?[א-ת]/;
const texts = (d) => [d.name, d.intent, ...d.must.map((x) => x.text), ...d.conditional.flatMap((x) => [x.when, x.do]), d.proof.text, ...(d.paid || []).map((p) => p.capability)];
const urls = (d) => [...d.docs, ...d.must.map((x) => x.docs), ...d.conditional.map((x) => x.docs), ...(d.paid || []).map((p) => p.docs)].filter((u) => u !== undefined);
const isHttps = (u) => { try { return new URL(u).protocol === 'https:' && !/\s/.test(u); } catch { return false; } };
const opensFor = (types) => dims.filter((d) => d.opensOn.some((t) => types.includes(t))).map((d) => d.id).sort();

test('the file holds the 31 research dimensions, each id once', () => {
  assert.ok(Array.isArray(dims));
  const ids = dims.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.deepEqual([...ids].sort(), [...RESEARCH_IDS].sort());
});

test('every dimension follows the schema', () => {
  for (const d of dims) {
    const at = d.id;
    for (const k of Object.keys(d)) assert.ok(KEYS.includes(k), `${at}: unknown key ${k}`);
    assert.match(d.id, /^[a-z]+(?:-[a-z]+)*$/, at);
    // the name sits inside checker messages ("בממד <name> של השינוי"), and rule 22 joins names with commas
    assert.ok(typeof d.name === 'string' && HEB_FIRST.test(d.name) && !d.name.includes(','), `${at}.name`);
    const words = d.name.split(' ').length;
    assert.ok(words >= 2 && words <= 3, `${at}.name has ${words} words`);
    assert.ok(typeof d.intent === 'string' && HEB_FIRST.test(d.intent) && d.intent.endsWith('.'), `${at}.intent`);
    assert.ok(!d.intent.slice(0, -1).includes('. '), `${at}.intent is one sentence`);
    for (const [f, allowed] of [['opensOn', TOKENS], ['tracks', new Set(TRACKS)]]) {
      assert.ok(Array.isArray(d[f]) && d[f].length > 0, `${at}.${f}`);
      assert.equal(new Set(d[f]).size, d[f].length, `${at}.${f} has duplicates`);
      for (const t of d[f]) assert.ok(allowed.has(t), `${at}.${f}: ${t} is not valid`);
    }
    assert.ok(Array.isArray(d.must) && d.must.length > 0, `${at}.must`);
    for (const x of d.must) {
      assert.deepEqual(Object.keys(x).filter((k) => !['text', 'basis', 'docs'].includes(k)), [], `${at}.must keys`);
      assert.ok(typeof x.text === 'string' && HEB_FIRST.test(x.text) && x.text.endsWith('.'), `${at}.must: ${x.text}`);
      assert.ok(BASIS.includes(x.basis), `${at}.must basis ${x.basis}`);
    }
    assert.ok(Array.isArray(d.conditional), `${at}.conditional`);
    for (const x of d.conditional) {
      assert.deepEqual(Object.keys(x).filter((k) => !['when', 'do', 'basis', 'docs'].includes(k)), [], `${at}.conditional keys`);
      assert.ok(typeof x.when === 'string' && HEB_FIRST.test(x.when) && !x.when.endsWith('.'), `${at}.when: ${x.when}`);
      assert.ok(typeof x.do === 'string' && HEB_FIRST.test(x.do) && x.do.endsWith('.'), `${at}.do: ${x.do}`);
      assert.ok(BASIS.includes(x.basis), `${at}.conditional basis ${x.basis}`);
    }
    assert.deepEqual(Object.keys(d.proof).sort(), ['evidence', 'file', 'text'], `${at}.proof keys`);
    assert.ok(HEB_FIRST.test(d.proof.text) && d.proof.text.endsWith('.'), `${at}.proof.text`);
    assert.ok(EVIDENCE.includes(d.proof.evidence), `${at}.proof.evidence`);
    assert.equal(d.proof.file, `docs/evidence/<change-index>/${d.id}.txt`, `${at}.proof.file`);
    if (d.paid !== undefined) {
      assert.ok(Array.isArray(d.paid) && d.paid.length > 0, `${at}.paid`);
      for (const p of d.paid) {
        assert.deepEqual(Object.keys(p).sort(), ['capability', 'docs', 'tier', 'vendor'], `${at}.paid keys`);
        assert.ok(VENDORS.includes(p.vendor), `${at}.paid vendor ${p.vendor}`);
        assert.match(p.tier, /^[a-z]+(?:-[a-z]+)*$/, `${at}.paid tier`);
        assert.ok(HEB_FIRST.test(p.capability), `${at}.paid capability`);
      }
    }
    assert.ok(Array.isArray(d.docs) && d.docs.length > 0, `${at}.docs`);
    assert.equal(new Set(d.docs).size, d.docs.length, `${at}.docs has duplicates`);
    if (d.modifier !== undefined) assert.ok(['ai', 'payments'].includes(d.modifier), `${at}.modifier`);
    if (d.evidence !== undefined) assert.equal(d.evidence, 'advisors', `${at}.evidence`);
  }
});

test('advisors evidence sits on the data and access dimensions, where rule 27 reads it', () => {
  assert.deepEqual(dims.filter((d) => d.evidence === 'advisors').map((d) => d.id).sort(), ['access-control', 'data-model']);
  for (const d of dims) assert.equal(d.evidence === 'advisors', d.proof.evidence === 'advisors', `${d.id}: evidence and proof.evidence agree`);
  for (const id of ['access-control', 'data-model']) {
    assert.ok(byId.get(id).tracks.includes('supabase-app'));
    assert.ok(byId.get(id).proof.text.includes('# supabase advisors'), `${id} tells the header line`);
  }
});

test('the AI and payments dimensions open only on their own node type, and audit-trail skips static sites', () => {
  assert.deepEqual(byId.get('ai-components').opensOn, ['ai']); assert.equal(byId.get('ai-components').modifier, 'ai');
  assert.deepEqual(byId.get('payments').opensOn, ['plan']); assert.equal(byId.get('payments').modifier, 'payments');
  assert.deepEqual(dims.filter((d) => d.modifier).map((d) => d.id).sort(), ['ai-components', 'payments']);
  for (const d of dims) assert.deepEqual([...d.tracks].sort(), d.id === 'audit-trail' ? ['n8n-engine', 'supabase-app'] : [...TRACKS].sort(), d.id);
});

test('a single change opens only a few dimensions', () => {
  // the kinds a student uses most stay small; the biggest set is a release, the go-live checklist
  for (const t of ['content', 'field', 'screen', 'permission', 'secret', 'dependency', 'domain', 'email', 'case', 'process', 'step']) assert.ok(opensFor([t]).length <= 5, `${t}: ${opensFor([t])}`);
  for (const t of TOKENS) assert.ok(opensFor([t]).length <= 9, `${t}: ${opensFor([t])}`);
  for (const d of dims) assert.ok(d.opensOn.length <= 15, d.id);
});

test('every dimension can open in each track it lists', () => {
  // a static site has no user accounts, so roles, access rows and permissions never appear there
  const never = { static: ['role', 'access', 'permission'], 'supabase-app': [], 'n8n-engine': [] };
  for (const d of dims) for (const tr of d.tracks) assert.ok(d.opensOn.some((t) => !never[tr].includes(t)), `${d.id} cannot open in ${tr}`);
});

test('Hebrew text follows the voice rules', () => {
  const names = dims.map((d) => d.name);
  for (const d of dims) {
    for (const t of texts(d)) {
      assert.ok(!/[—–]/.test(t), `${d.id}: dash in ${t}`);
      assert.ok(!/[→←⇒⇐]/.test(t), `${d.id}: arrow in ${t}`);
      assert.ok(!/[א-ת][A-Za-z]|[A-Za-z][א-ת]/.test(t), `${d.id}: Latin glued to Hebrew in ${t}`);
      assert.ok(!/https?:\/\//.test(t), `${d.id}: links go in docs, not in ${t}`);
      assert.ok(!/(?:^|[.!?]\s)ו[א-ת]/.test(t), `${d.id}: a sentence opens with the letter vav in ${t}`);
      // a reference to another dimension uses its exact name
      for (const m of t.matchAll(/ממד /g)) assert.ok(names.some((n) => t.slice(m.index + 4).startsWith(n)), `${d.id}: unknown dimension in ${t}`);
    }
  }
});

test('every docs link is https', () => {
  for (const d of dims) for (const u of urls(d)) assert.ok(isHttps(u), `${d.id}: ${u}`);
});

test('docs links answer (online)', { skip: process.env.BP_ONLINE !== '1' }, async () => {
  // some official hosts refuse scripts (iso.org, gov.il), so only a 404 or a 410 counts as broken
  const all = [...new Set(dims.flatMap(urls))];
  const bad = [];
  for (const u of all) {
    try {
      const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
      if (r.status === 404 || r.status === 410) bad.push(`${r.status} ${u}`);
    } catch (e) { bad.push(`${e.message} ${u}`); }
  }
  assert.deepEqual(bad, []);
});

// ---------- bp change open and the checker on a small project ----------

function project(track = 'supabase-app') {
  const dir = tmpProject();
  assert.equal(bp(dir, ['init', '--name', 'x']).code, 0);
  assert.equal(bp(dir, ['state', 'set', `track=${track}`]).code, 0);
  assert.equal(bp(dir, ['map', 'add', 'table', JSON.stringify({ name: 'documents', migration: 'supabase/migrations/1_documents.sql' })]).code, 0);
  return dir;
}
const open = (dir, kind, ...ref) => {
  const r = bp(dir, ['change', 'open', 'שינוי לבדיקה', '--kind', kind, ...(ref.length ? ['--ref', ref.join(',')] : [])]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.note, undefined);
  return r.json.dimensions.map((d) => d.id).sort();
};

test('bp change open: a new field on a table opens the data and access dimensions', () => {
  const ids = open(project(), 'field', 'table:documents');
  assert.ok(ids.includes('data-model') && ids.includes('access-control'));
  assert.deepEqual(ids, ['access-control', 'data-lifecycle', 'data-model', 'performance', 'privacy', 'quality-tests']);
});

test('bp change open: typical kinds open their own short list', () => {
  const dir = project();
  assert.deepEqual(open(dir, 'wording'), ['accessibility', 'content', 'ux-design-system']);
  assert.deepEqual(open(dir, 'track'), []);
  assert.deepEqual(open(dir, 'migration'), ['backup-restore', 'data-model', 'quality-tests', 'release-rollback']);
  assert.deepEqual(open(dir, 'screen'), ['accessibility', 'privacy', 'quality-tests', 'seo-sharing', 'ux-design-system']);
  assert.deepEqual(open(dir, 'permission'), ['access-control', 'audit-trail', 'quality-tests']);
  assert.deepEqual(open(dir, 'secret'), ['environments', 'secrets']);
  assert.deepEqual(open(dir, 'dependency'), ['quality-tests', 'supply-chain']);
  assert.deepEqual(open(dir, 'domain'), ['domain-dns-tls', 'seo-sharing']);
  assert.deepEqual(open(dir, 'email'), ['email-messaging']);
  assert.deepEqual(open(dir, 'ai'), ['ai-components', 'audit-trail', 'cost-plan-limits', 'reliability']);
  assert.deepEqual(open(dir, 'plan'), ['backup-restore', 'cost-plan-limits', 'legal-documents', 'payments']);
  // an auth change is access plus the identity provider's service (no node type of its own)
  assert.deepEqual(open(dir, 'access', 'service:supabase'), ['abuse-protection', 'access-control', 'audit-trail', 'cost-plan-limits', 'identity-auth', 'integrations', 'ownership-operations', 'privacy', 'quality-tests', 'secrets', 'vendor-lifecycle']);
});

test('bp change open: the track filter drops audit-trail on a static site', () => {
  assert.deepEqual(open(project('static'), 'permission'), ['access-control', 'quality-tests']);
});

test('rule 27 uses the advisors evidence and the Hebrew name from this file', () => {
  const dir = project();
  open(dir, 'field', 'table:documents');
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  w('docs/evidence/0/data-model.txt', `# supabase advisors ${new Date(Date.now() + 60000).toISOString()}\nno issues\n`);
  w('docs/evidence/0/access-control.txt', '# supabase advisors 2020-01-01\nno issues\n');
  assert.equal(bp(dir, ['change', 'dimension', '0', 'data-model', '--status', 'closed', '--proof', 'docs/evidence/0/data-model.txt']).code, 0);
  assert.equal(bp(dir, ['change', 'dimension', '0', 'access-control', '--status', 'closed', '--proof', 'docs/evidence/0/access-control.txt']).code, 0);
  const r27 = checkMap(dir).errors.filter((e) => e.rule === '27');
  assert.deepEqual(r27.map((e) => e.item), ['change:0:access-control']);
  assert.ok(r27[0].message.includes(`בממד ${byId.get('access-control').name} `), r27[0].message);
});
