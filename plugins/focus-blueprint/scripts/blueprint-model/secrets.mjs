// Secret detection helpers. Node builtins only, no imports: this folder is copied into a student's repo.
// Each pattern: { name, regex, source, documented, check? }. documented:true means the vendor docs page
// at `source` states the prefix; false means the shape is widely observed but the docs page does not state it
// (source then points at the vendor page that describes the key).

const b64urlJson = (part) => {
  try { return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
};

// Token-shape check for patterns whose format the vendor does not document: after the prefix the token must
// hold a digit and a letter (and both cases when mixed is set). Keeps snake_case identifiers from matching.
const shape = (prefix, { mixed = false } = {}) => (m) => {
  const t = m.replace(prefix, '');
  return /\d/.test(t) && /[A-Za-z]/.test(t) && (!mixed || (/[a-z]/.test(t) && /[A-Z]/.test(t)));
};
const decodeJwt = (m) => b64urlJson(m.split('.')[1]);
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const PLACEHOLDER_PW = /^(?:\[.*\]|<.*>|password|postgres|pass|changeme)$/i;
const SECRET_NAME = `(?:${['secret', 'token', 'api_?key', 'apikey', 'password', 'passwd', 'private_?key'].join('|')})`;
const FAKE_VALUE = /your|example|changeme|xxx|\*\*\*|\$\{|\{\{/i;


const hasUpperLower = (t) => /[a-z]/.test(t) && /[A-Z]/.test(t);
const URI_PW = (scheme) => (m) => { const pw = new RegExp(`^${scheme}://[^:@/]+:([^@]*)@`).exec(m); return !!pw && !!pw[1] && !PLACEHOLDER_PW.test(pw[1]) && !/\$\{|\{\{/.test(pw[1]); };
const LOOSE_FAKE = /your_|your-|xxx|<.*>|changeme|example|\$\{|\{\{|\*\*\*|process\.env/i;
const LOOSE_NAME = /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^\s"'`#<>]{20,})[ \t]*$/gm;
const looseCheck = (m) => {
  const x = /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*(\S+)[ \t]*$/.exec(m);
  if (!x) return false;
  const [, name, val] = x;
  if (!/(?:^|_)(?:SECRET|TOKEN|KEY)$/.test(name) && name !== 'API_SECRET') return false;
  if (/(?:^|_)(?:PUBLIC|PUBLISHABLE|ANON)(?:_|$)/.test(name)) return false;
  if (LOOSE_FAKE.test(val) || /^[/.~$]/.test(val) || val.includes('://')) return false;
  if (!/\d/.test(val) || !/[A-Za-z]/.test(val) || /^(.)\1*$/.test(val)) return false;
  return !/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(val);
};

export const SECRET_PATTERNS = [
  { name: 'Supabase secret key', regex: /\bsb_secret_[A-Za-z0-9_-]{16,}/g, source: 'https://supabase.com/docs/guides/api/api-keys', documented: true },
  {
    name: 'Supabase service_role key (JWT)', regex: JWT_RE,
    source: 'https://supabase.com/docs/guides/api/api-keys', documented: true,
    check: (m) => { const p = b64urlJson(m.split('.')[1]); return !!p && p.role === 'service_role'; },
  },
  { name: 'OpenAI API key', regex: /\bsk-(?:proj-|svcacct-|admin-)[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{40,}\b/g, source: 'https://platform.openai.com/docs/api-reference/authentication', documented: false, check: shape(/^sk-(?:proj-|svcacct-|admin-)?/, { mixed: true }) },
  { name: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, source: 'https://docs.anthropic.com/en/api/getting-started', documented: false, check: shape(/^sk-ant-/, { mixed: true }) },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, source: 'https://cloud.google.com/docs/authentication/api-keys', documented: false, check: shape(/^AIza/, { mixed: true }) },
  { name: 'Stripe live secret key', regex: /\b[sr]k_live_[A-Za-z0-9]{16,}/g, source: 'https://docs.stripe.com/keys', documented: true },
  { name: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, source: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github', documented: true },
  { name: 'Slack token', regex: /\bxox[abprse]-[A-Za-z0-9-]{10,}|\bxapp-\d-[A-Za-z0-9-]{10,}/g, source: 'https://docs.slack.dev/authentication/tokens', documented: false, check: shape(/^(?:xox[abprse]|xapp)-/) },
  { name: 'Slack webhook URL', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/g, source: 'https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks', documented: false, check: shape(/^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\//) },
  { name: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[A-Z2-7]{16}\b/g, source: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html', documented: true },
  { name: 'Resend API key', regex: /\bre_[A-Za-z0-9_]{20,}/g, source: 'https://resend.com/docs/dashboard/api-keys/introduction', documented: false, check: shape(/^re_/, { mixed: true }) },
  { name: 'Twilio API key', regex: /\bSK[0-9a-f]{32}\b/g, source: 'https://www.twilio.com/docs/iam/api-keys', documented: false, check: shape(/^SK/) },
  { name: 'Private key block', regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/g, source: 'https://datatracker.ietf.org/doc/html/rfc7468', documented: true },
  { name: 'Webhook URL with a secret token', regex: /https?:\/\/[^\s'"`<>]*\/webhook(?:-test)?\/[^\s'"`<>?]*\?[^\s'"`<>]*\b(?:secret|token|key|apikey|api_key)=[A-Za-z0-9_.~%-]{8,}/gi, source: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/', documented: false, check: (m) => shape(/^/)(m.split('=').pop()) },
  { name: 'Postgres connection URI with a password', regex: /\bpostgres(?:ql)?:\/\/[^\s:@\/'"`<>]+:[^\s@\/'"`]+@[^\s'"`]+/g, source: 'https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS', documented: true,
    check: (m) => { const pw = /^postgres(?:ql)?:\/\/[^:@\/]+:([^@]*)@/.exec(m); return !!pw && !!pw[1] && !PLACEHOLDER_PW.test(pw[1]) && !/\$\{/.test(pw[1]); } },
  { name: 'Cloudinary URL', regex: /\bcloudinary:\/\/[A-Za-z0-9_-]+:[A-Za-z0-9_-]+@[A-Za-z0-9_-]+/g, source: 'https://cloudinary.com/documentation/node_integration', documented: true },
  { name: 'Telegram bot token', regex: /\b\d{8,10}:[A-Za-z0-9_-]{34,36}\b/g, source: 'https://core.telegram.org/bots/api#authorizing-your-bot', documented: true, check: (m) => /[A-Za-z]/.test(m.split(':')[1]) && /\d/.test(m.split(':')[1]) },
  { name: 'n8n API key (JWT)', regex: JWT_RE, source: 'https://docs.n8n.io/api/authentication/', documented: false, check: (m) => { const p = decodeJwt(m); return !!p && (p.iss === 'n8n' || p.aud === 'public-api'); } },
  { name: 'Supabase personal access token', regex: /\bsbp_[A-Za-z0-9]{20,}\b/g, source: 'https://supabase.com/docs/guides/platform/personal-access-tokens', documented: false, check: shape(/^sbp_/) },
  { name: 'OpenRouter API key', regex: /\bsk-or-v1-[a-f0-9]{64}\b/g, source: 'https://openrouter.ai/docs/api-reference/authentication', documented: true },
  { name: 'Stripe test, restricted or organization key', regex: /\b(?:sk_test|rk_test|sk_org)_[A-Za-z0-9]{16,}/g, source: 'https://docs.stripe.com/keys', documented: true },
  { name: 'Stripe webhook signing secret', regex: /\bwhsec_[A-Za-z0-9]{16,}/g, source: 'https://docs.stripe.com/webhooks', documented: true },
  { name: 'SendGrid API key', regex: /\bSG\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, source: 'https://www.twilio.com/docs/sendgrid/api-reference/api-keys/create-api-keys', documented: true, check: (m) => m.length === 69 },
  { name: 'Hugging Face token', regex: /\bhf_[A-Za-z0-9]{34,}\b/g, source: 'https://huggingface.co/docs/hub/security-tokens', documented: false, check: (m) => hasUpperLower(m.slice(3)) },
  { name: 'npm token', regex: /\bnpm_[A-Za-z0-9]{30,}\b/g, source: 'https://github.blog/changelog/2021-09-23-npm-security-update-new-token-format/', documented: true, check: (m) => hasUpperLower(m.slice(4)) },
  { name: 'Replicate API token', regex: /\br8_[A-Za-z0-9]{37}\b/g, source: 'https://replicate.com/docs/topics/security/api-tokens', documented: true, check: (m) => hasUpperLower(m.slice(3)) },
  { name: 'MySQL connection URI with a password', regex: /\bmysql:\/\/[^\s:@\/'"`<>]+:[^\s@\/'"`]+@[^\s'"`]+/g, source: 'https://dev.mysql.com/doc/refman/8.0/en/connecting-using-uri-or-key-value-pairs.html', documented: true, check: URI_PW('mysql') },
  { name: 'MongoDB connection URI with a password', regex: /\bmongodb(?:\+srv)?:\/\/[^\s:@\/'"`<>]+:[^\s@\/'"`]+@[^\s'"`]+/g, source: 'https://www.mongodb.com/docs/manual/reference/connection-string/', documented: true, check: URI_PW('mongodb(?:\\+srv)?') },
  {
    name: 'Authorization Bearer token', regex: /\bAuthorization["']?[ \t]*[:=][ \t]*["']?Bearer[ \t]+[A-Za-z0-9._~+\/=-]{24,}/gi,
    source: 'https://datatracker.ietf.org/doc/html/rfc6750#section-2.1', documented: false,
    check: (m) => { const t = m.split(/Bearer[ \t]+/i).pop(); return /\d/.test(t) && /[A-Za-z]/.test(t) && !LOOSE_FAKE.test(t) && !/^(.)\1*$/.test(t); },
  },
  {
    name: 'Unquoted secret assignment', regex: LOOSE_NAME, skipInEnvFiles: true,
    source: 'https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password', documented: false, check: looseCheck,
  },
  {
    name: 'Hardcoded secret value',
    regex: new RegExp(`(["']?)[A-Za-z0-9_.-]*${SECRET_NAME}[A-Za-z0-9_.-]*\\1\\s*[:=]\\s*(["'\`])([^"'\`\\n]{16,})\\2`, 'gi'),
    source: 'https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password', documented: false,
    check: (m) => {
      const v = /[:=]\s*(["'`])([^"'`\n]{16,})\1\s*$/.exec(m); const val = v && v[2];
      return !!val && !/\s/.test(val) && !/^<.*>$/.test(val) && !/^(.)\1*$/.test(val) && !FAKE_VALUE.test(val) && !/^(?:process\.env|import\.meta|\$)/.test(val);
    },
  },
];

export const PUBLIC_ENV_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'EXPO_PUBLIC_', 'PUBLIC_'];
/** True for env var names a framework ships to the browser. */
export function isPublicEnvName(name) {
  return PUBLIC_ENV_PREFIXES.some((p) => String(name).startsWith(p));
}
/** A public env name that says it holds a secret (so even an empty-looking assignment is a mistake). */
export function isSecretishName(name) {
  return /(secret|service[_-]?role|private[_-]?key|password)/i.test(String(name));
}

const CODE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?)$/i;
const SERVER_EXT_NAME = /^(?:route|middleware)\.[cm]?[jt]sx?$/i;

/**
 * Is this file shipped to the browser? rel is a project-relative path. text (optional) lets a
 * 'use server' file count as server code. Next.js and static sites: files under public/, static/,
 * assets/, app/, components/ or src/ that are not route handlers, server actions, middleware or
 * files under lib/server or server/; plus html files in the project root.
 */
export function isClientPath(rel, text) {
  const p = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = p.split('/');
  const base = parts[parts.length - 1];
  const top = parts[0];
  if (parts.length === 1) return /\.html?$/i.test(base);
  if (!['public', 'static', 'assets', 'app', 'components', 'src'].includes(top)) return false;
  if (top !== 'public' && top !== 'static' && top !== 'assets' && !CODE_EXT.test(base)) return false;
  if (SERVER_EXT_NAME.test(base)) return false;
  const dirs = parts.slice(0, -1);
  if (dirs.includes('server')) return false;
  if (dirs.includes('api') && dirs.includes('pages')) return false;
  if (/(?:^|\/)lib\/server(?:\/|$)/.test(p)) return false;
  if (typeof text === 'string' && /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use server['"]/.test(text)) return false;
  return true;
}

/** Finds secrets in text: [{ name, line, source, preview }]. The preview is redacted. file (optional) is the path; the loose unquoted-assignment pattern is skipped for .env* files. */
export function scanText(text, { file } = {}) {
  const inEnvFile = /(?:^|[\/\\])\.env(?:\.|$)/.test(String(file || ''));
  const s = String(text ?? '');
  const out = [];
  const allowed = new Set();
  s.split('\n').forEach((l, i) => { if (l.includes('blueprint-allow-secret')) allowed.add(i + 1); });
  for (const pat of SECRET_PATTERNS) {
    if (pat.skipInEnvFiles && inEnvFile) continue;
    const re = new RegExp(pat.regex.source, pat.regex.flags.includes('g') ? pat.regex.flags : pat.regex.flags + 'g');
    let m;
    while ((m = re.exec(s))) {
      if (pat.check && !pat.check(m[0])) continue;
      const line = s.slice(0, m.index).split('\n').length;
      if (allowed.has(line)) continue;
      out.push({ name: pat.name, line, source: pat.source, preview: `${m[0].slice(0, 6)}...` });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}
