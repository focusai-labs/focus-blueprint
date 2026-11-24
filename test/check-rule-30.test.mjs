// T6: check rule 30. When a service connects to a system that existed before ours (existing: true),
// the PRD must fill both C4 sections, from stage 4.
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const { checkMap } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'check-map.mjs')).href);

const SERVICE = { id: 'crm', name: 'Fireberry', purpose: 'ה-CRM שהעסק עובד איתו', existing: true, secrets: [], publicVars: [] };
const mapWith = (services) => ({ schema: 2, capabilities: [], screens: [], tables: [], automations: [], later: [], roles: [], access: [], services, processes: [] });

const SOT = (rows) => `## איזו מערכת היא הבעלים של כל סוג מידע
<!-- prd:source-of-truth -->

<!-- הערת תבנית -->
<!-- voices -->
| סוג המידע | המערכת שהיא הבעלים שלו | מי מעדכן אותו | איך המערכת שלנו מקבלת אותו |
|---|---|---|---|
${rows}
<!-- /voices -->
`;
const OLD = (body) => `## מידע שקיים עוד לפני המערכת
<!-- prd:existing-data -->

<!-- voices -->
${body}
<!-- /voices -->
`;
const FULL_SOT = SOT('| לקוחות | Fireberry | המזכירה | קוראים דרך ה-API פעם בשעה | <!-- src:client -->');
const FULL_OLD = OLD('- כרטיסי הלקוחות הקיימים עוברים פעם אחת, והמזכירה בודקת עשרה מהם. <!-- src:ours -->');

function run({ services = [SERVICE], stage = 5, prd = null, list = 'errors' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r30-'));
  fs.mkdirSync(path.join(dir, '.blueprint'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.blueprint', 'map.json'), JSON.stringify(mapWith(services)));
  fs.writeFileSync(path.join(dir, '.blueprint', 'state.json'), JSON.stringify({ schema: 2, stage, track: 'supabase-app' }));
  if (prd !== null) { fs.mkdirSync(path.join(dir, 'spec')); fs.writeFileSync(path.join(dir, 'spec', 'prd.md'), prd); }
  return checkMap(dir)[list].filter((e) => e.rule === '30');
}

test('rule 30: an existing system with both sections filled passes', () => {
  assert.deepEqual(run({ prd: `# PRD\n\n${FULL_SOT}\n${FULL_OLD}` }), []);
});

test('rule 30: each missing or empty section is one error from stage 5, and a warning in stage 4', () => {
  const none = run({ prd: '# PRD\n' });
  assert.equal(none.length, 2);
  assert.ok(none.every((e) => e.item === 'spec/prd.md'));
  assert.match(none[0].message, /Fireberry/); assert.match(none[0].message, /איזו מערכת היא הבעלים של כל סוג מידע/);
  assert.match(none[1].message, /מידע שקיים עוד לפני המערכת/);
  assert.equal(run({ prd: null }).length, 2, 'no PRD at all');
  assert.equal(run({ prd: `# PRD\n\n${FULL_SOT}` }).length, 1);
  assert.deepEqual(run({ stage: 4, prd: '# PRD\n' }), [], 'stage 4 writes the PRD, so its own close passes');
  assert.equal(run({ stage: 4, prd: '# PRD\n', list: 'warnings' }).length, 2, 'but it warns while stage 4 works');
  assert.deepEqual(run({ stage: 3, prd: '# PRD\n', list: 'warnings' }), [], 'nothing before stage 4');
});

test('rule 30: a table with only its header, or a fill marker, is not filled', () => {
  assert.equal(run({ prd: `# PRD\n\n${SOT('')}\n${FULL_OLD}` }).length, 1, 'header and separator only');
  assert.equal(run({ prd: `# PRD\n\n${SOT('| <<fill>> | <<fill>> | <<fill>> | <<fill>> |')}\n${FULL_OLD}` }).length, 1);
  assert.equal(run({ prd: `# PRD\n\n${FULL_SOT}\n${OLD('<!-- רק הערה -->')}` }).length, 1, 'a comment is not content');
});

test('rule 30: no service, or a new service, asks for nothing', () => {
  assert.deepEqual(run({ services: [], prd: '# PRD\n' }), []);
  assert.deepEqual(run({ services: [{ ...SERVICE, existing: false }], prd: '# PRD\n' }), []);
  assert.deepEqual(run({ services: [{ id: 'supabase', name: 'Supabase' }], prd: '# PRD\n' }), []);
});
