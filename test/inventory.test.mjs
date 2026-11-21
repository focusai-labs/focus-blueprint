import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const text = read('../plugins/focus-blueprint/scripts/inventory.browser.js');
const r = JSON.parse(read('./fixtures/inventory/result.json'));

test('the file is one arrow function with the version comment', () => {
  const fn = new Function('return ' + text)();
  assert.equal(typeof fn, 'function');
  assert.match(text.trimStart(), /^\(\)\s*=>/);
  assert.match(text.trimEnd(), /\/\* inventory: v1 \*\/$/);
});

test('screen, persona and links', () => {
  assert.equal(r.screen, 'client-documents');
  assert.equal(r.persona, 'office-manager');
  assert.deepEqual(r.links, ['index.html', 'clients.html']);
});

test('actions', () => {
  assert.equal(r.actions.length, 3);
  assert.deepEqual(r.actions.map((a) => a.type), ['submit', 'button', 'button']);
  const primary = r.actions.filter((a) => a.primary);
  assert.equal(primary.length, 1);
  assert.equal(primary[0].text, 'העלה מסמכים');
  const destructive = r.actions.filter((a) => a.destructive);
  assert.equal(destructive.length, 1);
  assert.equal(destructive[0].text, 'מחק מסמך');
  assert.equal(destructive[0].confirm, 'המסמך ייעלם מהתיק של הלקוח');
  assert.equal(r.actions.filter((a) => a.confirm).length, 1);
});

test('forms', () => {
  assert.equal(r.forms.length, 1);
  assert.equal(r.forms[0].id, 'request-form');
  assert.deepEqual(r.forms[0].fields, [
    { name: 'full_name', label: 'שם מלא', type: 'text', required: true },
    { name: 'email', label: 'אימייל', type: 'email', required: false },
    { name: 'note', label: 'הערה למשרד', type: 'textarea', required: false },
  ]);
});

test('data items and lists', () => {
  assert.deepEqual(r.dataItems, [
    { entity: 'client', field: 'name', sample: 'דנה לוי' },
    { entity: 'client', field: 'phone', sample: '050-1234567' },
    { entity: 'client', field: 'company', sample: 'לוי חשבונאות' },
  ]);
  assert.deepEqual(r.lists, [{ entity: 'document', rows: 3 }]);
});

test('externals', () => {
  assert.deepEqual(r.externals.map((e) => e.kind), ['upload', 'iframe', 'payment']);
  assert.equal(r.externals.find((e) => e.kind === 'iframe').detail, 'מדריך סריקת מסמכים');
  assert.equal(r.externals.find((e) => e.kind === 'upload').detail, 'scan');
  assert.match(r.externals.find((e) => e.kind === 'payment').detail, /^תשלום מקדמה/);
});
