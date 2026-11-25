// T6 content: the PRD template (gen blocks, voices, the C4 sections), the brief gate,
// the two Goldfish agents, and the commands and terms the skills now rely on.
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN, tmpProject, bp } from './helpers.mjs';

const M = path.join(PLUGIN, 'scripts', 'blueprint-model');
const { GEN_KINDS } = await import(pathToFileURL(path.join(M, 'render-blocks.mjs')).href);
const { parseVoices, assumptionsOf } = await import(pathToFileURL(path.join(M, 'voices.mjs')).href);
const { checkMap } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'check-map.mjs')).href);

const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');
const PRD = read('templates', 'docs', 'prd.md');
const skill = (name) => read('skills', name, 'SKILL.md');
const J = (o) => JSON.stringify(o);
const frontmatter = (text) => Object.fromEntries((/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || ['', ''])[1].split(/\r?\n/).map((l) => /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]));

test('the PRD template has one empty gen block for every kind bp render fills', () => {
  for (const k of GEN_KINDS) {
    assert.equal(PRD.split(`<!-- gen:${k} -->`).length - 1, 1, `gen:${k} once`);
    assert.ok(PRD.includes(`<!-- gen:${k} -->\n<!-- /gen:${k} -->`), `gen:${k} is empty in the template`);
  }
});

test('voices sections are balanced and never hold a gen block or the assumptions list', () => {
  let inside = false; let sections = 0;
  for (const [i, line] of PRD.split('\n').entries()) {
    if (/<!--\s*voices\s*-->/.test(line)) { assert.ok(!inside, `line ${i + 1}: voices opened twice`); inside = true; sections++; continue; }
    if (/<!--\s*\/voices\s*-->/.test(line)) { assert.ok(inside, `line ${i + 1}: voices closed without opening`); inside = false; continue; }
    if (inside) {
      assert.ok(!/<!--\s*\/?gen:/.test(line), `line ${i + 1}: a gen block inside voices`);
      assert.ok(!/prd:[a-z-]+/.test(line), `line ${i + 1}: a section marker inside voices`);
      assert.ok(!/^\s*<!--(?![\s\S]*-->)/.test(line), `line ${i + 1}: a comment inside voices must fit on one line`);
    }
  }
  assert.ok(!inside, 'the last voices section is closed');
  assert.ok(sections >= 15, `client-facing sections carry voices (${sections})`);
});

test('the new PRD sections sit right under their headings, once each', () => {
  for (const m of ['processes', 'timers', 'cases', 'screens', 'source-of-truth', 'existing-data']) {
    assert.equal(PRD.split(`<!-- prd:${m} -->`).length - 1, 1, `prd:${m}`);
    const prev = PRD.slice(0, PRD.indexOf(`<!-- prd:${m} -->`)).trimEnd().split('\n').pop();
    assert.match(prev, /^## /, `prd:${m} sits right under its heading`);
  }
});

test('a project that copies the template and runs bp render passes rule 15, and only its fill lines lack a voice', () => {
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  bp(dir, ['role', 'add', 'client', '--name', 'לקוח', '--kind', 'user']);
  bp(dir, ['service', 'add', 'crm', '--json', J({ name: 'Fireberry', existing: true })]);
  bp(dir, ['process', 'add', 'collect', '--name', 'איסוף']);
  bp(dir, ['process', 'stage', 'add', 'collect', '--json', J({ id: 'remind', name: 'תזכורת' })]);
  bp(dir, ['process', 'step', 'add', 'collect', '--json', J({ id: 's1', stage: 'remind', actor: 'automation', kind: 'system', text: 'שולחים תזכורת', onFailure: 'התראה', src: 'client' })]);
  bp(dir, ['process', 'timer', 'add', 'collect', '--json', J({ id: 't1', text: 'תקף 90 יום', duration: 'P90D', onExpire: 'התראה', stage: 'remind' })]);
  bp(dir, ['process', 'case', 'add', 'collect', '--json', J({ id: 'c1', kind: 'happy', text: 'הכל תקין' })]);
  fs.copyFileSync(path.join(PLUGIN, 'templates', 'docs', 'prd.md'), path.join(dir, 'spec', 'prd.md'));
  const r = bp(dir, ['render']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([...r.json.blocks].sort(), [...GEN_KINDS].sort());
  bp(dir, ['state', 'set', 'stage=5']);
  const report = checkMap(dir);
  assert.ok(!report.errors.some((e) => e.rule === '15'), 'generated blocks match the map');
  const doc = fs.readFileSync(path.join(dir, 'spec', 'prd.md'), 'utf8');
  assert.ok(doc.includes('| `client` | לקוח | משתמש |') && doc.includes('שולחים תזכורת'));
  for (const v of parseVoices(doc)) assert.ok(v.text.includes('<<fill>>'), `only template placeholders lack a voice, got: ${v.text}`);
  assert.equal(report.errors.filter((e) => e.rule === '30').length, 2, 'an existing system asks for both C4 sections while they hold fill markers');
});

test('rule 23 and the template agree: an assumed line copied word for word into the assumptions passes', () => {
  const line = 'הלקוחות מעדיפים וואטסאפ על פני מייל';
  const doc = PRD.replace('## למה עכשיו\n<!-- prd:intent -->\n\n<!-- voices -->\n<<fill>>', `## למה עכשיו\n<!-- prd:intent -->\n\n<!-- voices -->\n${line}. <!-- src:assumed -->`)
    .replace(/(<!-- prd:assumptions -->\n\n<!--[^\n]*-->\n)<<fill>>/, `$1- ${line}.`);
  assert.ok(assumptionsOf(doc).includes(`${line}.`));
  const assumed = parseVoices(doc).find((v) => v.src === 'assumed');
  assert.ok(assumed && assumptionsOf(doc).some((a) => a === assumed.text || assumed.text.includes(a)));
});

test('the brief template carries the Zero-Decision gate, and bp brief leaves it for Claude to fill', () => {
  const t = read('templates', 'project', 'brief-template.md');
  assert.match(t, /<!-- brief:decided -->\n<!--[^\n]*Zero-Decision Rule[^\n]*-->\n<<fill>>/);
  const dir = tmpProject();
  bp(dir, ['init', '--name', 'x']);
  bp(dir, ['map', 'add', 'capability', J({ id: 'up', name: 'העלאה' })]);
  assert.equal(bp(dir, ['brief', 'up']).code, 0);
  const b = fs.readFileSync(path.join(dir, 'evals', 'briefs', 'up.md'), 'utf8');
  assert.match(b, /<!-- brief:decided -->\n<!--[^\n]*-->\n<<fill>>/);
});

test('both Goldfish agents start without CLAUDE.md and say when they could not finish', () => {
  for (const a of ['builder-check', 'capability-reviewer']) {
    const text = read('agents', `${a}.md`);
    assert.equal(frontmatter(text).omitClaudeMd, 'true', `${a} omitClaudeMd`);
    assert.match(text, /^לא הושלם: /m, `${a} has the not-finished line`);
  }
  const bc = read('agents', 'builder-check.md');
  const order = ['## מה המערכת מציעה', '## איך החלקים מתחברים, לפי המסמכים', '## השאלות'].map((h) => bc.indexOf(h));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'the paraphrase comes before the questions');
  assert.match(bc, /A wrong or incomplete paraphrase is itself a finding/);
});

test('the review skill and stage 5 use the four answers and record a reviewer that did not finish', () => {
  for (const name of ['review', 'stage-05-screens-map']) {
    const t = skill(name);
    for (const w of ['PROPOSE FIX', 'CONTEST', 'ESCALATE', 'DECLINE', 'not_run']) assert.ok(t.includes(w), `${name}: ${w}`);
  }
  assert.ok(skill('review').includes('--spec not_run --quality not_run'));
  assert.ok(skill('stage-05-screens-map').includes('<!-- bc:paraphrase -->'));
});

test('the change skill runs the new flow and takes the dimensions only from the command output', () => {
  const t = skill('change');
  for (const c of ['bp change open', 'bp map impact', 'bp change dimension', '--status na --reason', 'docs/evidence/<index>/<id>.txt', 'bp log done']) assert.ok(t.includes(c), c);
  assert.ok(t.indexOf('4. הבדיקה') < t.indexOf('5. הקוד'), 'the test comes before the code');
  const dimFile = path.join(PLUGIN, 'data', 'dimensions.json');
  if (fs.existsSync(dimFile)) {
    for (const d of JSON.parse(fs.readFileSync(dimFile, 'utf8'))) {
      assert.ok(!t.includes(`\`${d.id}\``), `the skill names the dimension ${d.id}`);
      if (d.name) assert.ok(!t.includes(d.name), `the skill names the dimension ${d.name}`);
    }
  }
});

test('the process map fills along the chapters through bp only', () => {
  assert.ok(skill('stage-03-questionnaire').includes('bp process step add'));
  assert.ok(skill('stage-04-prd').includes('bp process case add') && skill('stage-04-prd').includes('bp process timer add'));
  assert.ok(skill('stage-05-screens-map').includes('bp process step set'));
  assert.match(skill('stage-07-mockup'), /bp process step set[^\n]*"screen"/);
  assert.match(read('skills', 'stage-12-capability', 'references', 'commands.md'), /bp process step set[^\n]*"tables"[^\n]*"permission"[^\n]*"test"/);
  assert.ok(skill('stage-12-capability').includes('bp process case set'));
});

test('the C3 and C5 hooks name the templates at their agreed paths', () => {
  assert.ok(skill('stage-03-questionnaire').includes('${CLAUDE_PLUGIN_ROOT}/templates/docs/reflect-<client|org>.md'));
  assert.ok(skill('stage-12-capability').includes('${CLAUDE_PLUGIN_ROOT}/templates/docs/milestone-<client|org|self>.md'));
});

test('the Elephant-Goldfish terms sit where the research places them', () => {
  const where = {
    'stage-02-brain-dump': ['Weeds Syndrome'],
    'stage-04-prd': ['Artifact-First Delivery'],
    'stage-05-screens-map': ['Goldfish', 'Comprehension Test', 'Paraphrase First'],
    'stage-12-capability': ['Zero-Decision Rule', 'Implementation Readiness Test'],
    'drift-check': ['Documentation Drift', 'Two-Way Reconciliation', 'Living Specifications'],
    review: ['Goldfish'],
  };
  for (const [name, terms] of Object.entries(where)) for (const t of terms) assert.ok(skill(name).includes(t), `${name}: ${t}`);
});
