import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const DIR = path.join(PLUGIN, 'templates', 'docs');
const KINDS = ['pre-build', 'change', 'report', 'handover'];
const CONTEXTS = ['client', 'org', 'self'];
const DISCLAIMER = 'אינו ייעוץ משפטי, עסקי, חשבונאי או מקצועי אחר';

const DOCS = [...KINDS.flatMap((k) => CONTEXTS.map((c) => `${k}-${c}`)), 'handover-client-developer', 'handover-client-accounts'];

test('fourteen document templates, each a draft with placeholders', () => {
  for (const d of DOCS) {
    const f = path.join(DIR, `${d}.md`);
    assert.ok(fs.existsSync(f), `${d}.md`);
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(s.includes(DISCLAIMER), `${d}.md carries the draft line`);
    assert.match(s, /\{\{[a-z_]+\}\}/, `${d}.md has placeholders`);
  }
});

test('the quote carries what Israeli law and practice require', () => {
  const s = fs.readFileSync(path.join(DIR, 'pre-build-client.md'), 'utf8');
  for (const h of ['## מי מציע', '## מה לא כלול', '## תנאי תשלום', '## זכויות יוצרים ובעלות', '## תוקף ההצעה', '## אישור ההצעה', '## זכות ביטול']) {
    assert.ok(s.includes(h), h);
  }
});

test('handover documents never ask for secrets', () => {
  for (const d of ['handover-client', 'handover-client-developer', 'handover-client-accounts', 'handover-org', 'handover-self']) {
    const s = fs.readFileSync(path.join(DIR, `${d}.md`), 'utf8');
    assert.match(s, /לא מכיל[הא]? אף סיסמה/, `${d}.md says it holds no secrets`);
  }
});

test('the PRD skeleton has each marker exactly once', () => {
  const s = fs.readFileSync(path.join(DIR, 'prd.md'), 'utf8');
  for (const m of ['problem', 'intent', 'users', 'goals', 'non-goals', 'anti-goals', 'success', 'capabilities', 'edge-cases', 'data', 'permissions', 'autonomy', 'track', 'decisions', 'builder', 'assumptions', 'open-questions', 'done', 'later']) {
    const n = s.split(`<!-- prd:${m} -->`).length - 1;
    assert.equal(n, 1, `prd:${m}`);
    const i = s.indexOf(`<!-- prd:${m} -->`);
    const prev = s.slice(0, i).trimEnd().split('\n').pop();
    assert.match(prev, /^## /, `prd:${m} sits right under its heading`);
  }
});
