import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const DIR = path.join(PLUGIN, 'templates', 'docs');
const KINDS = ['pre-build', 'change', 'report', 'handover'];
const CONTEXTS = ['client', 'org', 'self'];
const DISCLAIMER = 'אינו ייעוץ משפטי, עסקי, חשבונאי או מקצועי אחר';

test('twelve document templates, each a draft with placeholders', () => {
  for (const k of KINDS) for (const c of CONTEXTS) {
    const f = path.join(DIR, `${k}-${c}.md`);
    assert.ok(fs.existsSync(f), `${k}-${c}.md`);
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(s.includes(DISCLAIMER), `${k}-${c}.md carries the draft line`);
    assert.match(s, /\{\{[a-z_]+\}\}/, `${k}-${c}.md has placeholders`);
  }
});

test('account lists never ask for secrets', () => {
  for (const c of CONTEXTS) {
    const s = fs.readFileSync(path.join(DIR, `handover-${c}.md`), 'utf8');
    assert.ok(s.includes('לא מכילה אף סיסמה'), `handover-${c}.md says the list holds no secrets`);
  }
});

test('the PRD skeleton has each marker exactly once', () => {
  const s = fs.readFileSync(path.join(DIR, 'prd.md'), 'utf8');
  for (const m of ['problem', 'intent', 'goals', 'anti-goals', 'capabilities', 'permissions', 'autonomy', 'track', 'constraints', 'cost', 'approaches', 'decisions', 'builder', 'later', 'lenses']) {
    const n = s.split(`<!-- prd:${m} -->`).length - 1;
    assert.equal(n, 1, `prd:${m}`);
  }
});
