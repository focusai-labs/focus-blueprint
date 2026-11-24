import test from 'node:test';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const M = path.join(PLUGIN, 'scripts', 'blueprint-model');
const { SECRET_PATTERNS, isClientPath, isPublicEnvName, scanText } = await import(pathToFileURL(path.join(M, 'secrets.mjs')).href);
const { parseVoices, assumptionsOf } = await import(pathToFileURL(path.join(M, 'voices.mjs')).href);

const jwt = (role) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iss: 'supabase', role })}.${'A'.repeat(43)}`;
};
const jwt2 = (payload) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); return `${b({ alg: 'HS256' })}.${b(payload)}.${'B'.repeat(43)}`; };
const A = (n, c = 'a') => c.repeat(n);
const MX = (n) => 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY'.repeat(4).slice(0, n);
const HIT = [
  ['Supabase secret key', `const k = "sb_secret_${A(30)}"`],
  ['Supabase service_role key (JWT)', `key=${jwt('service_role')}`],
  ['OpenAI API key', `sk-proj-${MX(40)}`],
  ['Anthropic API key', `sk-ant-api03-${MX(40)}`],
  ['Google API key', `AIza${MX(35)}`],
  ['Stripe live secret key', `sk_live_${A(24, 'c')}`],
  ['Stripe live secret key', `rk_live_${A(24, 'c')}`],
  ['GitHub token', `ghp_${A(36, 'D')}`],
  ['GitHub token', `github_pat_${A(40, 'E')}`],
  ['Slack token', `xoxb-1234567890-${MX(20)}`],
  ['Slack webhook URL', `https://hooks.slack.com/services/T0123ABCD/B0123ABCD/${MX(24)}`],
  ['AWS access key id', 'AKIAABCDEFGHIJKLMNOP'],
  ['Resend API key', `re_${MX(28)}`],
  ['Twilio API key', `SK${'a1'.repeat(16)}`],
  ['Private key block', '-----BEGIN RSA PRIVATE KEY-----'],
  ['Private key block', '-----BEGIN PRIVATE KEY-----'],
  ['Webhook URL with a secret token', 'https://x.app.n8n.cloud/webhook/monthly?secret=abcd1234efgh'],
  ['Postgres connection URI with a password', 'DATABASE_URL=postgresql://postgres.abc:Xk29fLq81zPw@aws-0.pooler.supabase.com:6543/postgres'],
  ['Postgres connection URI with a password', 'postgres://app:s3cretValue@db.internal/app'],
  ['Cloudinary URL', 'cloudinary://123456789012345:aBcDeFgHiJkLmNoPqRsTuVwXyZ1@my-cloud'],
  ['Telegram bot token', `123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`],
  ['n8n API key (JWT)', `k=${jwt2({ iss: 'n8n', aud: 'public-api' })}`],
  ['n8n API key (JWT)', `k=${jwt2({ aud: 'public-api' })}`],
  ['Hardcoded secret value', 'const apiKey = "Zk29fLq81zPwXy77aB";'],
  ['Hardcoded secret value', '{"client_secret": "Zk29fLq81zPwXy77aB"}'],
  ['Hardcoded secret value', "password: 'Zk29fLq81zPwXy77aB'"],
  ['Hardcoded secret value', 'DB_PASSWORD = "Zk29fLq81zPwXy77aB"'],
];
for (const [name, text] of HIT) test(`secrets: finds ${name}`, () => {
  const hits = scanText(`line one\n${text}\n`);
  assert.ok(hits.some((h) => h.name === name), JSON.stringify(hits));
  assert.equal(hits.find((h) => h.name === name).line, 2);
  assert.ok(!hits[0].preview.includes(A(10)), 'preview is redacted');
});
const MISS = [
  're_authenticate_user_session_now', `re_${A(28, 'g')}`, `sk-proj-${A(40)}`, `sk-ant-api03-${A(40)}`, `AIza${A(35, 'B')}`, `SK${A(32, 'a')}`,
  'https://x.app.n8n.cloud/webhook/m?token=aaaaaaaaaa',
  'postgresql://postgres:[YOUR-PASSWORD]@db.x.supabase.co:5432/postgres', 'postgresql://u:<password>@h/db', 'postgres://postgres:postgres@localhost/db',
  'postgres://u:password@localhost/db', 'postgres://u:${DB_PASS}@localhost/db', 'postgresql://user@localhost', 'postgresql://localhost/db',
  'cloudinary://<your_api_key>:<your_api_secret>@my-cloud', '12345:short', jwt2({ iss: 'supabase', role: 'authenticated' }),
  'const apiKey = process.env.API_KEY;', 'const password = "<password>";', 'const token = "xxxxxxxxxxxxxxxxxxxx";', 'const secret = "your-secret-goes-here-1234";',
  'const apiKey = "example-api-key-value-1";', 'const secret = "changeme-changeme-12";', 'const token = "${TOKEN}${TOKEN}";', 'const t = "Zk29fLq81zPwXy77aB"',
  'const passwordLabel = "Choose a strong password please";', 'const secret = "short";', 'const apiKey = "***************";',
  `sb_publishable_${A(30)}`, jwt('anon'), `sk_test_${A(24, 'c')}`, `pk_live_${A(24, 'c')}`, 'AKIA_SHORT', 'https://x.app.n8n.cloud/webhook/monthly',
  'const sk = skills.length', 'hello world', '-----BEGIN CERTIFICATE-----',
];

for (const text of MISS) test(`secrets: ignores ${text.slice(0, 24)}`, () => assert.deepEqual(scanText(text), []));

test('secrets: every pattern has a name, regex and an https source', () => {
  for (const p of SECRET_PATTERNS) { assert.ok(p.name && p.regex instanceof RegExp && /^https:\/\//.test(p.source), p.name); assert.equal(typeof p.documented, 'boolean'); }
  assert.ok(SECRET_PATTERNS.length >= 14);
});
test('secrets: scanText can be called twice (no sticky regex state)', () => {
  const t = `sb_secret_${A(30)}`;
  assert.equal(scanText(t).length, 1); assert.equal(scanText(t).length, 1);
});

const CLIENT = [
  ['public/app.js', true], ['public/data.json', true], ['app/page.tsx', true], ['app/upload/page.tsx', true], ['components/Form.tsx', true],
  ['src/App.jsx', true], ['src/lib/util.ts', true], ['index.html', true], ['static/site.js', true],
  ['app/api/send/route.ts', false], ['app/api/send/route.js', false], ['middleware.ts', false], ['src/middleware.ts', false],
  ['src/lib/server/db.ts', false], ['lib/server/db.ts', false], ['server/index.js', false], ['src/server/x.ts', false],
  ['src/pages/api/hello.ts', false], ['scripts/build.mjs', false], ['db/migrations/1.sql', false], ['n8n/flow.json', false], ['server.js', false],
  ['app\\page.tsx', true],
];
for (const [rel, want] of CLIENT) test(`isClientPath ${rel}`, () => assert.equal(isClientPath(rel), want));
test('isClientPath: a use server file is not client', () => {
  assert.equal(isClientPath('app/actions.ts', "'use server'\nexport async function f() {}"), false);
  assert.equal(isClientPath('app/actions.ts', '"use server";\nexport async function f() {}'), false);
  assert.equal(isClientPath('app/actions.ts', "export const x = 'use server'"), true);
});
for (const [n, want] of [['NEXT_PUBLIC_X', true], ['VITE_X', true], ['EXPO_PUBLIC_X', true], ['PUBLIC_X', true], ['SUPABASE_SECRET_KEY', false], ['MY_NEXT_PUBLIC_X', false]]) {
  test(`isPublicEnvName ${n}`, () => assert.equal(isPublicEnvName(n), want));
}

test('voices: parseVoices reads only voices sections', () => {
  const md = 'ignored line\n<!-- voices -->\n# heading\n\nהלקוח רוצה דוח <!-- src:client -->\nשורה בלי סימון\n- הנחה כלשהי <!-- src:assumed -->\n| a | b |\n|---|---|\n| 1 | 2 | <!-- src:ours -->\n<!-- /voices -->\nafter';
  const v = parseVoices(md);
  assert.deepEqual(v.map((x) => [x.line, x.src]), [[5, 'client'], [6, null], [7, 'assumed'], [10, 'ours']]);
  assert.equal(v[0].text, 'הלקוח רוצה דוח');
});
test('voices: assumptionsOf', () => {
  const prd = '# x\n<!-- prd:assumptions -->\n- הנחה כלשהי\n* עוד הנחה\n\n## next\n- לא';
  assert.deepEqual(assumptionsOf(prd), ['הנחה כלשהי', 'עוד הנחה']);
  assert.deepEqual(assumptionsOf('אין'), []);
});

test('secrets: blueprint-allow-secret skips only that line', () => {
  const fake = `sk_live_${A(24, 'c')}`;
  assert.deepEqual(scanText(`const k = "${fake}"; // blueprint-allow-secret`), []);
  const h = scanText(`// blueprint-allow-secret\nconst k = "${fake}";`);
  assert.equal(h.length, 1); assert.equal(h[0].line, 2);
  assert.equal(scanText(`ok // blueprint-allow-secret\nconst k = "${fake}";`).length, 1);
});
test('secrets: new patterns carry a source and the documented flag', () => {
  const by = Object.fromEntries(SECRET_PATTERNS.map((p) => [p.name, p]));
  assert.equal(by['Postgres connection URI with a password'].documented, true);
  assert.equal(by['Telegram bot token'].documented, true);
  assert.match(by['Telegram bot token'].source, /core\.telegram\.org/);
  assert.equal(by['n8n API key (JWT)'].documented, false);
  for (const p of SECRET_PATTERNS.filter((x) => !x.documented)) assert.equal(typeof p.check, 'function', `${p.name} needs a check`);
});
