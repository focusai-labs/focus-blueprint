import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpProject, bp, PLUGIN } from './helpers.mjs';

const read = (dir, ...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const readJson = (dir, ...p) => JSON.parse(read(dir, ...p));
const setup = () => { const dir = tmpProject(); bp(dir, ['init', '--name', 'x']); return dir; };
const addCap = (dir, id = 'up', extra = {}) => bp(dir, ['map', 'add', 'capability', JSON.stringify({ id, name: 'העלאה', screens: ['mockup/a.html'], data: ['documents'], permissions: ['client:create:documents:own'], automations: ['n8n:x'], ...extra })]);
const ok = 'node -e "process.exit(0)"';
const bad = 'node -e "process.exit(1)"';
const capOf = (dir, id = 'up') => readJson(dir, '.blueprint', 'map.json').capabilities.find((c) => c.id === id);
function fillCatches(dir, id = 'up') {
  const f = path.join(dir, 'evals', `${id}.md`);
  fs.writeFileSync(f, read(dir, 'evals', `${id}.md`).replace('הבדיקה הזאת תופסת: <<fill>>', 'הבדיקה הזאת תופסת: לקוח שרואה קבצים של לקוח אחר'));
}

test('init creates state, map and folders, refuses a second init', () => {
  const dir = tmpProject();
  const r = bp(dir, ['init', '--name', 'בדיקה']);
  assert.equal(r.code, 0);
  const state = readJson(dir, '.blueprint', 'state.json');
  assert.equal(state.schema, 2); assert.equal(state.stage, 1); assert.equal(state.project, 'בדיקה');
  for (const f of ['spec', 'mockup', 'db', 'evals', 'n8n', 'docs', '.github/workflows', 'scripts']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(fs.existsSync(path.join(dir, '.blueprint', 'dimensions.json')), 'dimensions travel with the project');
  assert.ok(read(dir, 'AGENTS.md').includes('Focus Blueprint'));
  assert.ok(read(dir, '.gitignore').includes('.blueprint/ui/'));
  assert.ok(read(dir, '.gitignore').includes('.env'));
  assert.ok(fs.existsSync(path.join(dir, '.github', 'workflows', 'blueprint-check.yml')));
  assert.ok(fs.existsSync(path.join(dir, 'spec', 'README.md')));
  assert.deepEqual(readJson(dir, '.blueprint', 'rulings.json'), []);
  assert.equal(bp(dir, ['init', '--name', 'שוב']).code, 1);
});

test('init keeps an existing AGENTS.md and .gitignore and does not duplicate the block', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# mine\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n.env\n');
  bp(dir, ['init', '--name', 'x']);
  const a = read(dir, 'AGENTS.md');
  assert.ok(a.startsWith('# mine')); assert.equal(a.split('<!-- focus-blueprint -->').length, 2);
  const g = read(dir, '.gitignore');
  assert.ok(g.includes('dist/')); assert.equal(g.split('\n').filter((l) => l === '.env').length, 1);
});

test('agents rules block: four stops and the rulings line', () => {
  const dir = setup();
  const a = read(dir, 'AGENTS.md');
  for (const m of ['stop:delete', 'stop:permissions', 'stop:money-or-live', 'stop:all-guess', '<!-- rulings -->']) assert.ok(a.includes(m), m);
});

test('stage start and done move the pointer', () => {
  const dir = setup();
  assert.equal(bp(dir, ['stage', 'start', '1']).json.status, 'in_progress');
  const after = bp(dir, ['stage', 'done', '1', '--status', 'done', '--proof', 'node: ok']).json;
  assert.equal(after.stage, 2); assert.equal(after.status, 'not_started'); assert.equal(after.stages['1'].status, 'done');
  assert.equal(after.stages['1'].close.status, 'done'); assert.equal(after.stages['1'].close.proof, 'node: ok');
});

test('stage done statuses: four-status close', () => {
  const dir = setup(); bp(dir, ['stage', 'start', '1']);
  assert.equal(bp(dir, ['stage', 'done', '1']).code, 1);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'done']).code, 1);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'blocked']).code, 1);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'needs_context']).code, 1);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'done_with_concerns', '--proof', 'ok']).code, 1);
  const b = bp(dir, ['stage', 'done', '1', '--status', 'blocked', '--note', 'need the Supabase account']).json;
  assert.equal(b.stage, 1); assert.equal(b.status, 'blocked'); assert.equal(b.stages['1'].status, 'blocked'); assert.equal(b.stages['1'].close.note, 'need the Supabase account');
  const c = bp(dir, ['stage', 'done', '1', '--status', 'done_with_concerns', '--note', 'no second user yet', '--proof', 'ok']).json;
  assert.equal(c.stage, 2); assert.equal(c.stages['1'].close.status, 'done_with_concerns');
  const long = bp(dir, ['stage', 'done', '2', '--status', 'done', '--proof', 'x'.repeat(900)]).json.stages['2'].close.proof;
  assert.equal(long.length, 603); assert.ok(long.endsWith('...'));
  bp(dir, ['state', 'set', 'stage=15']);
  const last = bp(dir, ['stage', 'done', '15', '--status', 'done', '--proof', 'p']).json;
  assert.equal(last.stage, 15);
});

test('stage done refuses while rulings of the stage are unreported', () => {
  const dir = setup(); bp(dir, ['stage', 'start', '1']);
  bp(dir, ['ruling', 'add', 'decision=chose Resend', 'why=cheapest', 'price=one afternoon', 'stage=1']);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'done', '--proof', 'ok']).code, 1);
  assert.equal(bp(dir, ['ruling', 'report', '--stage', '1']).code, 0);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'done', '--proof', 'ok']).code, 0);
});

test('state set parses JSON values and dotted keys; state get reads a path', () => {
  const dir = setup();
  bp(dir, ['state', 'set', 'track=supabase-app', 'context={"payer":"client","approver":"client","users":"business-customers","owner":"client"}', 'where.repo=org/repo']);
  const s = bp(dir, ['state', 'get']).json;
  assert.equal(s.track, 'supabase-app'); assert.equal(s.context.payer, 'client'); assert.equal(s.where.repo, 'org/repo');
  assert.equal(bp(dir, ['state', 'get', 'where.repo']).json, 'org/repo');
  assert.ok(s.updatedAt);
});

test('map add rejects a duplicate id and later add appends', () => {
  const dir = setup();
  assert.equal(bp(dir, ['map', 'add', 'screen', '{"file":"mockup/a.html","name":"א"}']).code, 0);
  assert.equal(bp(dir, ['map', 'add', 'screen', '{"file":"mockup/a.html","name":"ב"}']).code, 1);
  assert.equal(addCap(dir).code, 0); assert.equal(addCap(dir).code, 1);
  assert.equal(bp(dir, ['map', 'add', 'table', '{"name":"documents","migration":"db/migrations/0001.sql"}']).code, 0);
  assert.equal(bp(dir, ['map', 'add', 'automation', '{"id":"n8n:x","where":"n8n"}']).code, 0);
  bp(dir, ['map', 'later', 'add', 'ייצוא', '--stage', '4']);
  const m = readJson(dir, '.blueprint', 'map.json');
  assert.equal(m.later.length, 1); assert.equal(m.later[0].stage, 4); assert.equal(m.later[0].id, 'later-1');
  assert.equal(capOf(dir).status, 'mock'); assert.equal(capOf(dir).halted, false);
});

test('log add appends to changes.json and pending add/clear edits the list', () => {
  const dir = setup();
  assert.equal(bp(dir, ['log', 'add', 'kind=track', 'text=chose supabase', 'decision=now', 'stage=4']).code, 0);
  assert.equal(bp(dir, ['log', 'add', 'kind=nope', 'text=x', 'decision=now']).code, 1);
  const ch = readJson(dir, '.blueprint', 'changes.json');
  assert.equal(ch.length, 1); assert.equal(ch[0].stage, 4); assert.equal(ch[0].impact.tables, 0);
  assert.deepEqual(bp(dir, ['pending', 'add', 'a-14']).json.pending, ['a-14']);
  assert.deepEqual(bp(dir, ['pending', 'add', 'a-14']).json.pending, ['a-14']);
  assert.deepEqual(bp(dir, ['pending', 'clear', 'a-14']).json.pending, []);
});

test('accept-terms writes the profile with the current version', () => {
  const dir = setup();
  bp(dir, ['accept-terms']);
  assert.equal(readJson(dir, '.home', 'profile.json').terms.version, '2026-11-16');
});

test('profile set and get use the personal file', () => {
  const dir = setup();
  bp(dir, ['profile', 'set', 'defaults.lang=he']);
  assert.equal(bp(dir, ['profile', 'get', 'defaults.lang']).json, 'he');
});

test('connections set records the check', () => {
  const dir = setup();
  const r = bp(dir, ['connections', 'set', 'github', 'ok=true', 'note=gh auth']);
  assert.equal(r.json.ok, true);
  const s = readJson(dir, '.blueprint', 'state.json');
  assert.equal(s.connections.github.note, 'gh auth'); assert.ok(s.connections.github.checkedAt);
  assert.equal(bp(dir, ['connections', 'set', 'github', 'ok=maybe']).code, 1);
});

test('verified get reports fresh and stale', () => {
  const dir = setup();
  bp(dir, ['verified', 'set', 'topic=vercel-domain', 'url=https://vercel.com/docs/domains', 'summary=ok', 'ttlDays=0']);
  assert.equal(bp(dir, ['verified', 'get', 'vercel-domain']).json.fresh, false);
  bp(dir, ['verified', 'set', 'topic=t2', 'url=https://example.com', 'summary=ok']);
  assert.equal(bp(dir, ['verified', 'get', 't2']).json.fresh, true);
});

test('ruling: add needs price, appends r-001, lists unreported, report flips', () => {
  const dir = setup(); addCap(dir);
  assert.deepEqual(readJson(dir, '.blueprint', 'rulings.json'), []);
  assert.equal(bp(dir, ['ruling', 'add', 'decision=d', 'why=w']).code, 1);
  const a = bp(dir, ['ruling', 'add', 'decision=d', 'why=w', 'price=p', 'stage=12', 'capability=up']);
  assert.equal(a.code, 0); assert.equal(a.json.id, 'r-001'); assert.equal(a.json.reported, false);
  assert.equal(a.json.priceIfWrong, 'p'); assert.equal(a.json.by, 'claude'); assert.equal(a.json.capability, 'up');
  assert.equal(bp(dir, ['ruling', 'add', 'decision=d2', 'why=w', 'price=p', 'stage=3']).json.id, 'r-002');
  assert.equal(bp(dir, ['ruling', 'list', '--unreported']).json.length, 2);
  assert.equal(bp(dir, ['ruling', 'list', '--unreported', '--stage', '3']).json.length, 1);
  assert.equal(bp(dir, ['ruling', 'report', '--stage', '12']).json.length, 1);
  assert.equal(bp(dir, ['ruling', 'list', '--unreported']).json.length, 1);
  assert.equal(bp(dir, ['ruling', 'list']).json.length, 2);
});

test('round cap: capability halts at three, clear resets; same for stage', () => {
  const dir = setup(); addCap(dir);
  let r = bp(dir, ['round', 'add', 'capability', 'up', '--note', 'a']).json;
  assert.equal(r.stop, false); assert.equal(r.rounds, 1);
  r = bp(dir, ['round', 'add', 'capability', 'up', '--note', 'b']).json;
  assert.equal(r.stop, false); assert.equal(r.rounds, 2);
  r = bp(dir, ['round', 'add', 'capability', 'up', '--note', 'c']).json;
  assert.equal(r.stop, true); assert.equal(r.rounds, 3); assert.equal(r.cap, 3);
  assert.equal(capOf(dir).halted, true); assert.deepEqual(capOf(dir).openFindings, ['a', 'b', 'c']);
  bp(dir, ['round', 'clear', 'capability', 'up']);
  assert.equal(capOf(dir).rounds, 0); assert.equal(capOf(dir).halted, false); assert.deepEqual(capOf(dir).openFindings, []);
  assert.equal(bp(dir, ['round', 'add', 'capability', 'nope', '--note', 'a']).code, 1);

  bp(dir, ['stage', 'start', '3']);
  bp(dir, ['round', 'add', 'stage', '3', '--note', 'a']); bp(dir, ['round', 'add', 'stage', '3', '--note', 'b']);
  assert.equal(bp(dir, ['round', 'add', 'stage', '3', '--note', 'c']).json.stop, true);
  assert.equal(readJson(dir, '.blueprint', 'state.json').stages['3'].halted, true);
  bp(dir, ['round', 'clear', 'stage', '3']);
  const s3 = readJson(dir, '.blueprint', 'state.json').stages['3'];
  assert.equal(s3.rounds, 0); assert.equal(s3.halted, false); assert.deepEqual(s3.openFindings, []);
});

test('eval new: creates the file with the six markers, sets test, refuses to overwrite', () => {
  const dir = setup(); addCap(dir);
  assert.equal(bp(dir, ['eval', 'new', 'up']).code, 0);
  const t = read(dir, 'evals', 'up.md');
  for (const m of ['<!-- catches -->', '<!-- fm:empty -->', '<!-- fm:wrong-input -->', '<!-- fm:no-permission -->', '<!-- fm:network -->', '<!-- fm:double-submit -->']) assert.ok(t.includes(m), m);
  assert.equal(capOf(dir).test, 'evals/up.md');
  assert.equal(bp(dir, ['eval', 'new', 'up']).code, 1);
  assert.equal(bp(dir, ['eval', 'new', 'ghost']).code, 1);
});

test('brief: pre-fills from the map, leaves a fill marker, sets brief, refuses unknown', () => {
  const dir = setup(); addCap(dir, 'up', { test: 'evals/up.md' });
  assert.equal(bp(dir, ['brief', 'ghost']).code, 1);
  assert.equal(bp(dir, ['brief', 'up']).code, 0);
  const b = read(dir, 'evals', 'briefs', 'up.md');
  for (const x of ['mockup/a.html', 'documents', 'client:create:documents:own', 'n8n:x', 'evals/up.md', 'העלאה']) assert.ok(b.includes(x), x);
  assert.ok(b.includes('<<fill>>'));
  assert.equal(capOf(dir).brief, 'evals/briefs/up.md');
});

test('evidence red must fail, green must pass', () => {
  const dir = setup(); addCap(dir); bp(dir, ['eval', 'new', 'up']);
  // no catches sentence yet: marker line holds a fill, but the sentence exists; first make it missing
  const f = path.join(dir, 'evals', 'up.md');
  const full = read(dir, 'evals', 'up.md');
  fs.writeFileSync(f, full.replace('<!-- catches -->', ''));
  assert.equal(bp(dir, ['evidence', 'red', 'up', '--cmd', bad]).code, 1);
  assert.equal(bp(dir, ['evidence', 'green', 'up', '--cmd', ok]).code, 1);
  fs.writeFileSync(f, full); fillCatches(dir);

  assert.equal(bp(dir, ['evidence', 'green', 'up', '--cmd', ok]).code, 1);           // no red yet
  assert.equal(bp(dir, ['evidence', 'red', 'up', '--cmd', ok]).code, 1);             // catches nothing
  assert.ok(bp(dir, ['evidence', 'red', 'up', '--cmd', ok]).err.includes('catches nothing'));
  const red = bp(dir, ['evidence', 'red', 'up', '--cmd', bad]);
  assert.equal(red.code, 0);
  assert.ok(fs.existsSync(path.join(dir, 'evals', 'evidence', 'up.red.txt')));
  const e = capOf(dir).evidence.red;
  assert.equal(e.exit, 1); assert.match(e.sha256, /^[0-9a-f]{64}$/); assert.equal(e.mode, 'cmd'); assert.equal(e.path, 'evals/evidence/up.red.txt');
  assert.equal(capOf(dir).catches, 'הבדיקה הזאת תופסת: לקוח שרואה קבצים של לקוח אחר');
  assert.equal(bp(dir, ['evidence', 'green', 'up', '--cmd', bad]).code, 1);
  assert.equal(bp(dir, ['evidence', 'green', 'up', '--cmd', ok]).code, 0);
  const g = capOf(dir).evidence.green;
  assert.equal(g.exit, 0); assert.ok(g.at > capOf(dir).evidence.red.at);
});

test('evidence report mode takes the result from --result', () => {
  const dir = setup(); addCap(dir); bp(dir, ['eval', 'new', 'up']); fillCatches(dir);
  fs.writeFileSync(path.join(dir, 'run.txt'), 'playwright report');
  assert.equal(bp(dir, ['evidence', 'red', 'up', '--report', 'run.txt', '--result', 'pass']).code, 1);
  assert.equal(bp(dir, ['evidence', 'red', 'up', '--report', 'run.txt']).code, 1);
  assert.equal(bp(dir, ['evidence', 'red', 'up', '--report', 'run.txt', '--result', 'fail']).code, 0);
  assert.equal(capOf(dir).evidence.red.mode, 'report');
  assert.equal(read(dir, 'evals', 'evidence', 'up.red.txt'), 'playwright report');
  assert.equal(bp(dir, ['evidence', 'green', 'up', '--report', 'run.txt', '--result', 'pass']).code, 0);
});

function fullyBuilt(dir) {
  addCap(dir); bp(dir, ['eval', 'new', 'up']); fillCatches(dir); bp(dir, ['brief', 'up']);
  bp(dir, ['evidence', 'red', 'up', '--cmd', bad]); bp(dir, ['evidence', 'green', 'up', '--cmd', ok]);
  fs.mkdirSync(path.join(dir, 'evals', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evals', 'reviews', 'up.md'), 'review');
}

test('review record: refuses a missing file and refuses before green evidence', () => {
  const dir = setup(); addCap(dir); bp(dir, ['eval', 'new', 'up']); fillCatches(dir);
  fs.mkdirSync(path.join(dir, 'evals', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evals', 'reviews', 'up.md'), 'r');
  const rec = ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', 'evals/reviews/up.md'];
  assert.equal(bp(dir, rec).code, 1);                                                 // no green
  bp(dir, ['evidence', 'red', 'up', '--cmd', bad]); bp(dir, ['evidence', 'green', 'up', '--cmd', ok]);
  assert.equal(bp(dir, ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', 'evals/reviews/none.md']).code, 1);
  assert.equal(bp(dir, ['review', 'record', 'up', '--spec', 'maybe', '--quality', 'pass', '--path', 'evals/reviews/up.md']).code, 1);
  const r = bp(dir, rec);
  assert.equal(r.code, 0); assert.equal(capOf(dir).review.spec, 'pass'); assert.equal(capOf(dir).review.path, 'evals/reviews/up.md');
});

test('map set real needs evidence', () => {
  const dir = setup(); addCap(dir);
  const first = bp(dir, ['map', 'set', 'capability', 'up', 'status=real']);
  assert.equal(first.code, 1);
  for (const w of ['brief', 'red', 'green', 'review']) assert.ok(first.err.includes(w), w);
  fullyBuilt(dir);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'status=real']).code, 1);   // review not recorded
  bp(dir, ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', 'evals/reviews/up.md']);
  // tampered evidence file is refused
  fs.appendFileSync(path.join(dir, 'evals', 'evidence', 'up.red.txt'), 'tamper');
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'status=real']).code, 1);
  bp(dir, ['evidence', 'red', 'up', '--cmd', bad]); bp(dir, ['evidence', 'green', 'up', '--cmd', ok]);
  bp(dir, ['round', 'add', 'capability', 'up', '--note', 'open']);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'status=real']).code, 1);   // open findings
  bp(dir, ['round', 'clear', 'capability', 'up']);
  const r = bp(dir, ['map', 'set', 'capability', 'up', 'status=real']);
  assert.equal(r.code, 0); assert.equal(capOf(dir).status, 'real');
  // halted blocks
  bp(dir, ['map', 'set', 'capability', 'up', 'status=mock']);
  for (const n of ['a', 'b', 'c']) bp(dir, ['round', 'add', 'capability', 'up', '--note', n]);
  bp(dir, ['map', 'set', 'capability', 'up', 'openFindings=[]']);
  assert.equal(capOf(dir).halted, true);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'status=real']).code, 1);
});

test('map set real --baseline adopts, and status=mock removes the adoption', () => {
  const dir = setup(); addCap(dir);
  assert.equal(bp(dir, ['map', 'set', 'capability', 'up', 'status=real', '--baseline']).code, 0);
  assert.equal(capOf(dir).status, 'real'); assert.equal(capOf(dir).evidence.adopted, true);
  bp(dir, ['map', 'set', 'capability', 'up', 'status=mock']);
  assert.equal(capOf(dir).status, 'mock'); assert.ok(!capOf(dir).evidence.adopted);
});

const bank = [
  { id: 'a-01', round: 'a', text: 'q', type: 'open', prefillable: true },
  { id: 'a-02', round: 'a', text: 'q', type: 'scale', prefillable: false },
];
function stubData(extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-data-'));
  fs.mkdirSync(path.join(d, 'questions')); fs.mkdirSync(path.join(d, 'junctions'));
  fs.writeFileSync(path.join(d, 'questions', 'round-a.json'), JSON.stringify(bank));
  for (const [rel, v] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), JSON.stringify(v)); }
  return d;
}

test('prefill: writes an unconfirmed answer, refuses non-prefillable and foreign quotes', () => {
  const dir = setup(); const env = { FOCUS_BLUEPRINT_DATA: stubData() };
  fs.writeFileSync(path.join(dir, 'spec', 'idea.md'), 'אני רוצה לאסוף מסמכים מלקוחות');
  const r = bp(dir, ['prefill', 'round-a', 'a-01', 'value="client"', 'quote=לאסוף מסמכים'], env);
  assert.equal(r.code, 0);
  const a = readJson(dir, '.blueprint', 'ui', 'answers', 'round-a.json').answers['a-01'];
  assert.equal(a.from, 'idea'); assert.equal(a.confirmed, false); assert.equal(a.decidedBy, null); assert.equal(a.value, 'client'); assert.equal(a.quote, 'לאסוף מסמכים');
  assert.equal(bp(dir, ['prefill', 'round-a', 'a-02', 'value=3', 'quote=לאסוף מסמכים'], env).code, 1);
  assert.equal(bp(dir, ['prefill', 'round-a', 'a-01', 'value="x"', 'quote=משפט שלא נאמר'], env).code, 1);
  assert.equal(bp(dir, ['prefill', 'round-a', 'a-99', 'value="x"', 'quote=לאסוף'], env).code, 1);
});

test('junction eligible: options ruled out by saved answers are absent', () => {
  const dir = setup();
  const junction = { id: 'track', options: [
    { id: 'static', ruledOutWhen: { 'a-20': ['yes'], 'a-21': ['yes'] } },
    { id: 'supabase-app', ruledOutWhen: { 'a-23': ['yes'] } },
    { id: 'n8n-engine' }], recommend: { option: 'supabase-app', why: 'w', unless: 'u' } };
  const env = { FOCUS_BLUEPRINT_DATA: stubData({ 'junctions/track.json': junction }) };
  assert.equal(bp(dir, ['junction', 'eligible', 'track'], env).json.options.length, 3);
  fs.mkdirSync(path.join(dir, '.blueprint', 'ui', 'answers'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.blueprint', 'ui', 'answers', 'round-a.json'), JSON.stringify({ name: 'round-a', answers: { 'a-20': { value: 'yes' }, 'a-23': { value: 'no' } } }));
  const r = bp(dir, ['junction', 'eligible', 'track'], env);
  assert.deepEqual(r.json.options.map((o) => o.id), ['supabase-app', 'n8n-engine']);
  assert.equal(r.json.recommend.option, 'supabase-app');
  assert.equal(bp(dir, ['junction', 'eligible', 'nope'], env).code, 1);
});

test('route: superpowers only when installed and inside the tested range', () => {
  const dir = setup();
  const slots = ['test-first', 'debugging', 'verification', 'review'];
  for (const s of slots) { const r = bp(dir, ['route', s]).json; assert.equal(r.source, 'ours'); assert.equal(r.reason, 'not installed'); assert.equal(r.slot, s); }
  bp(dir, ['state', 'set', 'superpowers={"installed":true,"version":"7.0.2"}']);
  const d = bp(dir, ['route', 'debugging']).json;
  assert.equal(d.use, 'superpowers:systematic-debugging'); assert.equal(d.source, 'superpowers');
  bp(dir, ['state', 'set', 'superpowers={"installed":true,"version":"7.2.0"}']);
  const o = bp(dir, ['route', 'debugging']).json;
  assert.equal(o.source, 'ours'); assert.equal(o.use, 'focus-blueprint:debug');
  assert.ok(o.reason.includes('7.2.0') && o.reason.includes('7.0.2'));
  bp(dir, ['state', 'set', 'superpowers={"installed":true,"version":null}']);
  assert.equal(bp(dir, ['route', 'review']).json.source, 'ours');
  assert.equal(bp(dir, ['route', 'nonsense']).code, 1);
});

test('stages.json: 15 entries with skill, model, outputs and proof', () => {
  const stages = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data', 'stages.json'), 'utf8'));
  assert.equal(stages.length, 15);
  const models = ['1:sonnet', '2:inherit', '3:inherit', '4:inherit', '5:inherit', '6:opus', '7:opus', '8:inherit', '9:sonnet', '10:opus', '11:sonnet', '12:opus', '13:opus', '14:opus', '15:opus'];
  stages.forEach((s, i) => {
    assert.equal(s.n, i + 1); assert.ok(s.chapter && s.name);
    assert.match(s.skill, new RegExp(`^stage-${String(s.n).padStart(2, '0')}-`));
    assert.equal(`${s.n}:${s.model}`, models[i]);
    assert.ok(Array.isArray(s.outputs) && s.outputs.length > 0);
    assert.ok(typeof s.proof === 'string' && s.proof.length > 20);
  });
});

test('errors: unknown command and outside a project exit 1 with one stderr line', () => {
  const dir = setup();
  assert.equal(bp(dir, ['nope']).code, 1);
  const empty = tmpProject({ git: false });
  const r = bp(empty, ['state', 'get']);
  assert.equal(r.code, 1); assert.ok(!r.err.includes('\n'));
});

// ---------- review round 1 ----------
const mapPath = (dir) => path.join(dir, '.blueprint', 'map.json');
const tamper = (dir, fn) => { const m = readJson(dir, '.blueprint', 'map.json'); fn(m.capabilities.find((c) => c.id === 'up')); fs.writeFileSync(mapPath(dir), JSON.stringify(m)); };
const recordPass = (dir) => bp(dir, ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', 'evals/reviews/up.md']);

test('corrupt json is never overwritten', () => {
  const dir = setup(); bp(dir, ['stage', 'start', '1']);
  const f = path.join(dir, '.blueprint', 'rulings.json');
  fs.writeFileSync(f, '{bad');
  const r = bp(dir, ['ruling', 'add', 'decision=d', 'why=w', 'price=p', 'stage=1']);
  assert.equal(r.code, 1); assert.ok(r.err.includes('rulings.json'));
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'done', '--proof', 'p']).code, 1);
  assert.equal(fs.readFileSync(f, 'utf8'), '{bad');
  for (const n of ['changes.json', 'verified.json']) fs.writeFileSync(path.join(dir, '.blueprint', n), '{bad');
  assert.equal(bp(dir, ['log', 'add', 'kind=track', 'text=x', 'decision=now']).code, 1);
  assert.equal(bp(dir, ['verified', 'set', 'topic=t', 'url=u', 'summary=s']).code, 1);
  fs.mkdirSync(path.join(dir, '.home'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.home', 'profile.json'), '{bad');
  assert.equal(bp(dir, ['accept-terms']).code, 1);
  assert.equal(fs.readFileSync(path.join(dir, '.home', 'profile.json'), 'utf8'), '{bad');
});

test('catches left as the template prefix or a fill counts as missing', () => {
  const dir = setup(); addCap(dir); bp(dir, ['eval', 'new', 'up']);
  assert.equal(bp(dir, ['evidence', 'red', 'up', '--cmd', bad]).code, 1);
  const f = path.join(dir, 'evals', 'up.md');
  fs.writeFileSync(f, read(dir, 'evals', 'up.md').replace('הבדיקה הזאת תופסת: <<fill>>', 'הבדיקה הזאת תופסת:'));
  assert.equal(bp(dir, ['evidence', 'red', 'up', '--cmd', bad]).code, 1);
});

test('evidence red refuses a command that did not run', () => {
  const dir = setup(); addCap(dir); bp(dir, ['eval', 'new', 'up']); fillCatches(dir);
  const r = bp(dir, ['evidence', 'red', 'up', '--cmd', 'definitely-not-a-command-xyz']);
  assert.equal(r.code, 1); assert.ok(r.err.includes('did not run'));
  assert.equal(capOf(dir).evidence.red, null);
});

test('stage done refuses a stage that is not the current one', () => {
  const dir = setup(); bp(dir, ['state', 'set', 'stage=5']);
  const before = read(dir, '.blueprint', 'state.json');
  assert.equal(bp(dir, ['stage', 'done', '2', '--status', 'done', '--proof', 'p']).code, 1);
  assert.equal(read(dir, '.blueprint', 'state.json'), before);
});

test('stage done: rulings of another stage do not block; stage open findings block done', () => {
  const dir = setup(); bp(dir, ['stage', 'start', '1']);
  bp(dir, ['ruling', 'add', 'decision=d', 'why=w', 'price=p', 'stage=3']);
  bp(dir, ['round', 'add', 'stage', '1', '--note', 'open']);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'done', '--proof', 'p']).code, 1);
  bp(dir, ['round', 'clear', 'stage', '1']);
  assert.equal(bp(dir, ['stage', 'done', '1', '--status', 'done', '--proof', 'p']).code, 0);
});

test('every write refreshes state.updatedAt', () => {
  const dir = setup();
  const s = readJson(dir, '.blueprint', 'state.json'); s.updatedAt = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(dir, '.blueprint', 'state.json'), JSON.stringify(s));
  bp(dir, ['map', 'later', 'add', 'x']);
  assert.ok(readJson(dir, '.blueprint', 'state.json').updatedAt > '2001');
});

test('map set refuses fields that have their own command', () => {
  const dir = setup(); addCap(dir);
  for (const kvp of ['evidence.adopted=true', 'evidence={}', 'review={}', 'halted=false', 'rounds=0', 'openFindings=[]', 'builtAt=x']) {
    const r = bp(dir, ['map', 'set', 'capability', 'up', kvp]);
    assert.equal(r.code, 1, kvp);
  }
  assert.equal(capOf(dir).status, 'mock'); assert.equal(capOf(dir).evidence.adopted, false);
});

test('real needs pass verdicts and valid evidence (tampered map)', () => {
  const dir = setup(); fullyBuilt(dir); recordPass(dir);
  const real = () => bp(dir, ['map', 'set', 'capability', 'up', 'status=real']);
  const orig = fs.readFileSync(mapPath(dir), 'utf8');
  const cases = [
    (c) => { c.evidence.red.at = '2999-01-01T00:00:00.000Z'; },
    (c) => { c.evidence.red.exit = 0; },
    (c) => { c.evidence.green.exit = 1; },
    (c) => { c.catches = ''; },
    (c) => { c.review.spec = 'findings'; },
    (c) => { c.review.quality = 'findings'; },
  ];
  for (const fn of cases) { fs.writeFileSync(mapPath(dir), orig); tamper(dir, fn); assert.equal(real().code, 1, fn.toString()); }
  fs.writeFileSync(mapPath(dir), orig);
  assert.equal(real().code, 0);
});

test('junction eligible ignores unconfirmed answers and nulls a ruled-out recommendation', () => {
  const dir = setup();
  const junction = { id: 'track', options: [{ id: 'static', ruledOutWhen: { 'a-20': ['yes'] } }, { id: 'n8n-engine' }], recommend: { option: 'static', why: 'w', unless: 'u' } };
  const env = { FOCUS_BLUEPRINT_DATA: stubData({ 'junctions/track.json': junction }) };
  fs.mkdirSync(path.join(dir, '.blueprint', 'ui', 'answers'), { recursive: true });
  const put = (confirmed) => fs.writeFileSync(path.join(dir, '.blueprint', 'ui', 'answers', 'round-a.json'), JSON.stringify({ answers: { 'a-20': { value: 'yes', confirmed } } }));
  put(false);
  assert.equal(bp(dir, ['junction', 'eligible', 'track'], env).json.options.length, 2);
  put(true);
  const r = bp(dir, ['junction', 'eligible', 'track'], env).json;
  assert.deepEqual(r.options.map((o) => o.id), ['n8n-engine']);
  assert.equal(r.recommend, null); assert.equal(r.recommendRuledOut, 'static');
});

test('prefill never overwrites a student answer, refuses scale/pairs by type, and bad round names', () => {
  const dir = setup();
  const env = { FOCUS_BLUEPRINT_DATA: stubData({ 'questions/x.json': [{ id: 'b-01', type: 'scale' }, { id: 'b-02', type: 'pairs' }] }) };
  fs.writeFileSync(path.join(dir, 'spec', 'idea.md'), 'לאסוף מסמכים');
  const pf = (round, q) => bp(dir, ['prefill', round, q, 'value="x"', 'quote=לאסוף'], env);
  assert.equal(pf('round-a', 'b-01').code, 1); assert.equal(pf('round-a', 'b-02').code, 1);
  assert.equal(pf('../evil', 'a-01').code, 1);
  assert.equal(pf('round-a', 'a-01').code, 0);
  assert.equal(pf('round-a', 'a-01').code, 0);                        // unconfirmed prefill may be redone
  const f = path.join(dir, '.blueprint', 'ui', 'answers', 'round-a.json');
  const d = JSON.parse(fs.readFileSync(f, 'utf8')); d.answers['a-01'].confirmed = true; fs.writeFileSync(f, JSON.stringify(d));
  assert.equal(pf('round-a', 'a-01').code, 1);
});

test('init writes state.json last', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'AGENTS.md'));                        // makes the AGENTS step crash
  assert.equal(bp(dir, ['init', '--name', 'x']).code, 1);
  assert.ok(!fs.existsSync(path.join(dir, '.blueprint', 'state.json')));
  fs.rmSync(path.join(dir, 'AGENTS.md'), { recursive: true });
  assert.equal(bp(dir, ['init', '--name', 'x']).code, 0);
});

test('brief and eval keep $& literally and normalise line endings', () => {
  const dir = setup(); addCap(dir, 'up', { name: 'a$&b' });
  bp(dir, ['brief', 'up']); bp(dir, ['eval', 'new', 'up']);
  assert.ok(read(dir, 'evals', 'briefs', 'up.md').includes('a$&b'));
  assert.ok(read(dir, 'evals', 'up.md').includes('a$&b'));
  assert.ok(!read(dir, 'evals', 'up.md').includes('\r'));
  assert.ok(fs.readFileSync(path.join(PLUGIN, '..', '..', '.gitattributes'), 'utf8').includes('eol=lf'));
});

test('stage start again clears the close but keeps the round counters', () => {
  const dir = setup(); bp(dir, ['stage', 'start', '1']);
  bp(dir, ['round', 'add', 'stage', '1', '--note', 'a']);
  bp(dir, ['stage', 'done', '1', '--status', 'blocked', '--note', 'n']);
  const s = bp(dir, ['stage', 'start', '1']).json.stages['1'];
  assert.equal(s.close, undefined); assert.equal(s.doneAt, undefined); assert.equal(s.rounds, 1); assert.deepEqual(s.openFindings, ['a']);
});

test('state set refuses prototype keys', () => {
  const dir = setup();
  assert.equal(bp(dir, ['state', 'set', '__proto__.x=1']).code, 1);
  assert.equal(bp(dir, ['state', 'set', 'a.constructor.b=1']).code, 1);
});

test('no tmp files are left behind when a rename fails', () => {
  const dir = setup();
  fs.rmSync(path.join(dir, '.blueprint', 'changes.json'));
  fs.mkdirSync(path.join(dir, '.blueprint', 'changes.json'));        // a directory where the file should be
  assert.equal(bp(dir, ['log', 'add', 'kind=track', 'text=x', 'decision=now']).code, 1);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.blueprint')).filter((n) => n.endsWith('.tmp')), []);
});

test('route: a pre-release version is outside the tested range', () => {
  const dir = setup();
  bp(dir, ['state', 'set', 'superpowers={"installed":true,"version":"7.0.2-beta"}']);
  const r = bp(dir, ['route', 'debugging']).json;
  assert.equal(r.source, 'ours'); assert.ok(r.reason.includes('7.0.2-beta') && r.reason.includes('pre-release'));
});

test('round add stage refuses a stage that was never started', () => {
  const dir = setup();
  assert.equal(bp(dir, ['round', 'add', 'stage', '4', '--note', 'a']).code, 1);
  assert.equal(readJson(dir, '.blueprint', 'state.json').stages['4'], undefined);
});

test('review record path must stay inside the project', () => {
  const dir = setup(); addCap(dir); bp(dir, ['eval', 'new', 'up']); fillCatches(dir);
  bp(dir, ['evidence', 'red', 'up', '--cmd', bad]); bp(dir, ['evidence', 'green', 'up', '--cmd', ok]);
  const outside = path.join(os.tmpdir(), 'bp-outside.md'); fs.writeFileSync(outside, 'x');
  assert.equal(bp(dir, ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', outside]).code, 1);
  assert.equal(bp(dir, ['review', 'record', 'up', '--spec', 'pass', '--quality', 'pass', '--path', '../bp-outside.md']).code, 1);
});

test('ruling capability must exist; verified ttlDays must be a non-negative integer', () => {
  const dir = setup();
  assert.equal(bp(dir, ['ruling', 'add', 'decision=d', 'why=w', 'price=p', 'capability=ghost']).code, 1);
  for (const t of ['-1', '1.5', 'abc']) assert.equal(bp(dir, ['verified', 'set', 'topic=t', 'url=u', 'summary=s', `ttlDays=${t}`]).code, 1, t);
});

test('--project must contain or be inside the project', () => {
  const dir = setup(); const outside = tmpProject({ git: false });
  assert.equal(bp(outside, ['state', 'get'], { CLAUDE_PROJECT_DIR: '' }).code, 1);
  fs.mkdirSync(path.join(dir, 'spec', 'deep'), { recursive: true });
  assert.equal(bp(path.join(dir, 'spec', 'deep'), ['state', 'get', 'schema']).json, 2);
});

test('init creates CLAUDE.md importing AGENTS.md, and leaves an existing CLAUDE.md alone', () => {
  const fresh = setup();
  assert.equal(read(fresh, 'CLAUDE.md'), '@AGENTS.md\n');
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# mine\n');
  bp(dir, ['init', '--name', 'x']);
  assert.equal(read(dir, 'CLAUDE.md'), '# mine\n');
});
