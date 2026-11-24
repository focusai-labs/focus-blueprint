// Migration lint for Postgres / Supabase SQL. Node builtins only, no imports.
// lintMigration(sql, access, roles?) returns [{ rule, line, message }] (Hebrew messages).
// access: the map's access rows (used for the anon-grant rule); pass null to skip that rule.
// migrationFiles(root) lists the migration files of a project (supabase/migrations first, then the legacy db/migrations).
// opts.live === true adds the non-additive finding (drop, truncate, delete without where, rename, column type change);
// a `-- blueprint-approved: <reason>` comment on the line above a statement exempts it.
// roles: optional [{ id, kind }] so a role of kind "anon" with another id counts as anon.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Migration files of a project, as project-relative posix paths sorted by name.
 * { supabase: supabase/migrations/*.sql, legacy: db/migrations/*.sql (older plugin version), all: supabase first then legacy }
 */
export function migrationFiles(root) {
  const list = (dir) => {
    try {
      return fs.readdirSync(path.join(root, ...dir.split('/')), { withFileTypes: true })
        .filter((e) => e.isFile() && /\.sql$/i.test(e.name)).map((e) => `${dir}/${e.name}`).sort();
    } catch { return []; }
  };
  const supabase = list('supabase/migrations');
  const legacy = list('db/migrations');
  return { supabase, legacy, all: [...supabase, ...legacy] };
}

/**
 * Two same-length views of the SQL: `plain` (comments, string literals and dollar-quoted bodies blanked
 * with spaces, newlines kept) and `keep` (only comments blanked). Same length, so offsets line up.
 * Logic copied from sanitizeSql in hooks/lib.mjs (not imported on purpose).
 */
function sanitize(sql) {
  const s = String(sql || '');
  let plain = ''; let keep = '';
  const blank = (t) => t.replace(/[^\n]/g, ' ');
  let i = 0;
  while (i < s.length) {
    const c = s[i]; const two = s.slice(i, i + 2);
    if (two === '--') {
      let j = i; while (j < s.length && s[j] !== '\n') j++;
      const seg = s.slice(i, j); plain += blank(seg); keep += blank(seg); i = j;
    } else if (two === '/*') {
      let depth = 1; let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s.slice(j, j + 2) === '/*') { depth++; j += 2; } else if (s.slice(j, j + 2) === '*/') { depth--; j += 2; } else j++;
      }
      const seg = s.slice(i, j); plain += blank(seg); keep += blank(seg); i = j;
    } else if (c === "'" || ((c === 'E' || c === 'e') && s[i + 1] === "'" && !/[\w$]/.test(s[i - 1] || ''))) {
      const escaped = c !== "'"; let j = i + (escaped ? 2 : 1);
      while (j < s.length) {
        if (escaped && s[j] === '\\') { j += 2; continue; }
        if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } j++; break; }
        j++;
      }
      const seg = s.slice(i, j); keep += seg; plain += `'${blank(seg.slice(1, -1))}'`.padEnd(seg.length, ' ').slice(0, seg.length); i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue; } j++; break; } j++; }
      const seg = s.slice(i, j); plain += seg; keep += seg; i = j;
    } else if (c === '$' && !/[\w$]/.test(s[i - 1] || '')) {
      const tag = s.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (tag) {
        const end = s.indexOf(tag[0], i + tag[0].length);
        const j = end === -1 ? s.length : end + tag[0].length;
        const seg = s.slice(i, j); keep += seg; plain += blank(seg); i = j;
      } else { plain += c; keep += c; i++; }
    } else { plain += c; keep += c; i++; }
  }
  return { plain, keep };
}

const unq = (x) => String(x).trim().replace(/^"|"$/g, '').toLowerCase();
const NAME = '((?:"[^"]+"|[A-Za-z0-9_]+)(?:\\s*\\.\\s*(?:"[^"]+"|[A-Za-z0-9_]+))?)';
function tableRef(raw) {
  const parts = String(raw).split('.').map(unq);
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: 'public', name: parts[0] };
}
function parenAfter(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < text.length && text[i] !== '(') i++;
  let depth = 0; const start = i;
  for (; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(start + 1, i); }
  }
  return null;
}
const isTrue = (e) => e !== null && /^\(*\s*true\s*\)*$/i.test(e.trim());

export function lintMigration(sql, access, roles, opts = {}) {
  const findings = [];
  const { plain, keep } = sanitize(sql);
  const raw = String(sql || '');
  const rawLines = raw.split('\n');
  const add = (rule, line, message, level = 'error') => findings.push({ rule, line, message, level });
  const lineAt = (idx) => plain.slice(0, idx).split('\n').length;

  const statements = [];
  let start = 0;
  for (let i = 0; i <= plain.length; i++) {
    if (i === plain.length || plain[i] === ';') {
      const text = plain.slice(start, i);
      const lead = text.length - text.trimStart().length;
      if (text.trim()) statements.push({ text: text.trim().replace(/\s+/g, ' '), keep: keep.slice(start, i), line: lineAt(start + lead), endLine: lineAt(i) });
      start = i + 1;
    }
  }

  const anonIds = new Set(['anon', ...(Array.isArray(roles) ? roles.filter((r) => r && r.kind === 'anon').map((r) => r.id) : [])]);
  const accessRows = Array.isArray(access) ? access : null;
  const svcOnlyAccess = new Set((accessRows || []).filter((a) => a && a.serviceOnly).map((a) => String(a.object).toLowerCase()));
  const anonGets = (object) => (accessRows || []).some((a) => String(a.object).toLowerCase() === object
    && (a.rules || []).some((r) => anonIds.has(r.role) && (r.ops || []).length && r.scope !== 'none'));

  // grants[role] = { tables: Map(name -> Set(privs)), all: Set(privs) }; roles are normalized to anon / authenticated
  const roleKind = new Map((Array.isArray(roles) ? roles : []).filter((r) => r && r.id).map((r) => [r.id, r.kind]));
  const norm = (r) => { const k = roleKind.get(r); return k === 'anon' ? 'anon' : ['user', 'staff', 'admin'].includes(k) ? 'authenticated' : r; };
  const grants = new Map();
  const grantBook = (role) => { if (!grants.has(role)) grants.set(role, { tables: new Map(), all: new Set() }); return grants.get(role); };
  const privList = (x) => x.split(',').map((p) => p.trim().toLowerCase().replace(/\s+privileges$/, '').replace(/\(.*\)/, '').trim()).filter(Boolean);
  const tables = new Map(); // name -> { line, serviceOnly, rls, policies: [] }
  const get = (name, line) => { if (!tables.has(name)) tables.set(name, { line, serviceOnly: false, rls: false, rlsLine: line, policies: [], created: false }); return tables.get(name); };
  const markerNear = (st) => {
    for (let l = Math.max(1, st.line - 1); l <= st.endLine; l++) if (/--\s*service[_-]only\b/i.test(rawLines[l - 1] || '')) return true;
    return false;
  };

  for (const st of statements) {
    const t = st.text; const lower = t.toLowerCase();
    if (opts && opts.live === true) {
      const bad = /\bdrop\b|\btruncate\b/i.test(t) || (/\bdelete\s+from\b/i.test(t) && !/\bwhere\b/i.test(t))
        || (/\balter\b/i.test(t) && /\brename\b/i.test(t)) || /\balter\s+(?:column\s+)?\S+\s+(?:set\s+data\s+)?type\b/i.test(t);
      if (bad && !/^\s*--\s*blueprint-approved:\s*\S/.test(rawLines[st.line - 2] || '')) add('non-additive', st.line, 'אחרי ההשקה משנים את מסד הנתונים רק בהוספה. מחיקה, שינוי שם או שינוי סוג של עמודה נעשים בשני שלבים. קודם מוסיפים את החדש ומעבירים אליו את הנתונים, ורק אחר כך מוחקים את הישן. כשיש אישור מפורש למחיקה, כותבים מעל הפקודה את השורה -- blueprint-approved: ואחריה את הסיבה.');
    }
    let m;
    if ((m = /^grant\s+(.+?)\s+on\s+(.+?)\s+to\s+(.+)$/i.exec(t)) && !/^schema\b/i.test(m[2].trim())) {
      const privs = privList(m[1]); const target = m[2].trim();
      for (const r of m[3].split(',').map((x) => norm(unq(x.replace(/\s+with\s+grant\s+option$/i, ''))))) {
        const b = grantBook(r);
        if (/^all\s+(tables|routines)\s+in\s+schema/i.test(target)) privs.forEach((p) => b.all.add(p));
        else for (const n of target.replace(/^table\s+/i, '').split(',')) { const name = tableRef(n.replace(/\(.*\)/, '').trim()).name; if (!b.tables.has(name)) b.tables.set(name, new Set()); privs.forEach((p) => b.tables.get(name).add(p)); }
      }
    }
    if ((m = /^alter\s+default\s+privileges\b.*?\bgrant\s+(.+?)\s+on\s+tables\s+to\s+(.+)$/i.exec(t))) {
      for (const r of m[2].split(',').map((x) => norm(unq(x)))) privList(m[1]).forEach((p) => grantBook(r).all.add(p));
    }
    if ((m = new RegExp(`^create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${NAME}`, 'i').exec(t))) {
      const ref = tableRef(m[1]);
      if (ref.schema === 'public') { const e = get(ref.name, st.line); e.created = true; e.line = st.line; e.serviceOnly = e.serviceOnly || markerNear(st) || svcOnlyAccess.has(ref.name); }
      continue;
    }
    if ((m = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${NAME}\\s+(enable|disable)\\s+row\\s+level\\s+security`, 'i').exec(t))) {
      const ref = tableRef(m[1]);
      if (ref.schema !== 'public') continue;
      const e = get(ref.name, st.line);
      if (m[2].toLowerCase() === 'enable') { e.rls = true; e.rlsLine = st.line; } else { e.rls = false; e.disabled = true; add('rls-disabled', st.line, `בטבלה ${ref.name} מכבים את ה-RLS. בלי RLS, כל מי שיש לו גישה לטבלה דרך ה-API רואה ומשנה את כל השורות. משאירים אותו פעיל וכותבים מדיניות.`); }
      continue;
    }
    if ((m = new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?${NAME}`, 'i').exec(t))) { const ref = tableRef(m[1]); tables.delete(ref.name); continue; }
    if ((m = new RegExp(`^drop\\s+policy\\s+(?:if\\s+exists\\s+)?(?:"[^"]+"|[A-Za-z0-9_]+)\\s+on\\s+${NAME}`, 'i').exec(t))) {
      const nm = /^drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[A-Za-z0-9_]+)/i.exec(t)[1];
      const ref = tableRef(m[1]); const e = tables.get(ref.name);
      if (e) e.policies = e.policies.filter((p) => p.name !== unq(nm));
      continue;
    }
    if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?policy\\s+("[^"]+"|[A-Za-z0-9_]+)\\s+on\\s+${NAME}`, 'i').exec(t))) {
      const ref = tableRef(m[2]);
      if (ref.schema !== 'public') continue;
      const cmd = (/\sfor\s+(all|select|insert|update|delete)\b/i.exec(t) || [null, 'all'])[1].toLowerCase();
      const to = /\sto\s+(.+?)(?:\s+using\b|\s+with\s+check\b|$)/i.exec(t);
      const rl = to ? to[1].split(',').map((x) => unq(x)) : ['public'];
      const body = st.keep;
      const using = parenAfter(body, /\susing\s*(?=\()/i);
      const check = parenAfter(body, /\swith\s+check\s*(?=\()/i);
      const e = get(ref.name, st.line);
      e.policies.push({ name: unq(m[1]), cmd, roles: rl.map(norm), line: st.line });
      const serviceRoleOnly = rl.length === 1 && rl[0] === 'service_role';
      if (!serviceRoleOnly) {
        const writes = ['insert', 'update', 'delete', 'all'].includes(cmd);
        if (writes && ((cmd !== 'insert' && isTrue(using)) || isTrue(check))) {
          add('permissive-true', st.line, `במדיניות על ${ref.name} כתוב true, כלומר כל מי שמקבל אותה יכול לשנות כל שורה. כותבים במקומו תנאי שבודק של מי השורה.`);
        }
      }
      if (/user_metadata|raw_user_meta_data/i.test(body)) add('user-metadata', st.line, `המדיניות על ${ref.name} בודקת את user_metadata, והמשתמש יכול לשנות את השדה הזה בעצמו. בודקים במקומו את app_metadata או טבלת תפקידים במסד.`);
      continue;
    }
    if (/^create\s+(?:or\s+replace\s+)?function\b/i.test(t) && /\bsecurity\s+definer\b/i.test(t) && !/\bset\s+search_path\b/i.test(t)) {
      add('definer-no-search-path', st.line, 'פונקציה עם security definer צריכה גם set search_path = \'\'. בלי זה, מישהו יכול ליצור אובייקט באותו שם בסכמה אחרת, והפונקציה תריץ אותו עם ההרשאות הגבוהות שלה.');
      continue;
    }
    if (accessRows && /^grant\b/i.test(t)) {
      const g = /^grant\s+(.+?)\s+on\s+(.+?)\s+to\s+(.+)$/i.exec(t);
      if (g && g[3].split(',').some((r) => /^anon\b/i.test(r.trim()))) {
        const target = g[2].trim();
        if (/^schema\b/i.test(target)) continue;
        if (/^all\s+(tables|functions|sequences|routines)\s+in\s+schema/i.test(target)) { add('anon-grant', st.line, 'המיגרציה נותנת ל-anon הרשאה על כל האובייקטים בסכמה. נותנים לו הרשאה רק על מה שמטריצת ההרשאות פותחת לאורח אנונימי.'); continue; }
        const names = target.replace(/^(table|sequence|function)\s+/i, '').split(/,(?![^(]*\))/).map((x) => tableRef(x.replace(/\(.*\)/, '').trim()).name);
        for (const n of names) if (!anonGets(n)) add('anon-grant', st.line, `המיגרציה נותנת ל-anon הרשאה על ${n}, אבל מטריצת ההרשאות לא פותחת את ${n} לאורח אנונימי.`);
      }
      continue;
    }
    if (accessRows && /^alter\s+default\s+privileges\b/i.test(t) && /\bgrant\b[\s\S]*\bto\s+[^;]*\banon\b/i.test(t)) {
      add('anon-grant', st.line, 'המיגרציה נותנת ל-anon הרשאה מראש על כל מה שייווצר בעתיד. נותנים הרשאה לכל טבלה בנפרד, רק על מה שמטריצת ההרשאות פותחת לאורח אנונימי.');
    }
  }

  const granted = (role, name, cmd) => {
    const b = grants.get(role); if (!b) return false;
    const have = new Set([...b.all, ...(b.tables.get(name) || [])]);
    return cmd === 'all' ? have.size > 0 : have.has(cmd) || have.has('all');
  };
  for (const [name, e] of tables) {
    const svc = e.serviceOnly || svcOnlyAccess.has(name);
    if (e.created && !e.rls && !e.disabled) add('rls-missing', e.line, `הטבלה ${name} נוצרת בלי RLS. מוסיפים אחריה alter table ${name} enable row level security, גם כשרק השרת ניגש אליה.`);
    const warned = new Set();
    for (const p of e.policies) for (const r of p.roles) {
      const k = `${r}:${p.cmd}`;
      if ((r === 'anon' || r === 'authenticated') && !warned.has(k) && !granted(r, name, p.cmd)) {
        warned.add(k);
        add('policy-without-grant', p.line, `על ${name} יש מדיניות ל-${r} לפעולה ${p.cmd}, אבל אף grant לא נותן לו את הפעולה הזאת. בפרויקטים חדשים של Supabase טבלה לא נפתחת ל-API בלי grant, ולכן הבקשה שלו תיכשל.`, 'warn');
      }
    }
    if (svc) continue;
    if (e.rls && !e.policies.length) add('no-policy', e.rlsLine, `על הטבלה ${name} יש RLS בלי אף מדיניות, ולכן משתמשי האפליקציה לא יראו בה כלום. אם רק השרת ניגש אליה, כותבים מעל יצירת הטבלה -- service_only.`);
    for (const p of e.policies) {
      if (p.cmd !== 'update') continue;
      const covered = p.roles.every((r) => e.policies.some((q) => (q.cmd === 'select' || q.cmd === 'all') && (q.roles.includes(r) || q.roles.includes('public'))));
      if (!covered) add('update-without-select', p.line, `על ${name} יש מדיניות עדכון בלי מדיניות קריאה לאותו תפקיד. בלי קריאה, העדכון לא מוצא את השורה ומחזיר אפס שורות בלי שגיאה.`);
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
