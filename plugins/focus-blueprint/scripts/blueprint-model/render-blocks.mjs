// Renders the generated blocks of the PRD from .blueprint/map.json. Node builtins only,
// no imports from outside this folder. A block is the text between
// "<!-- gen:KIND -->\n" and "\n<!-- /gen:KIND -->"; renderBlock gives exactly that text.
import { canonicalHash } from './map-model.mjs';

export const GEN_KINDS = ['roles', 'permissions', 'autonomy', 'screens', 'services', 'processes', 'timers', 'cases'];
const STAMP_RE = /^<!-- blueprint-map: [0-9a-f]{64} -->[ \t]*(\r?\n|$)/;

const arr = (x) => (Array.isArray(x) ? x : []);
const cell = (v) => {
  const s = v === null || v === undefined || v === '' ? '-' : Array.isArray(v) ? (v.length ? v.join(', ') : '-') : String(v);
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
};
function table(headers, rows) {
  const line = (r) => `| ${r.map(cell).join(' | ')} |`;
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

const ROLE_KIND = { anon: 'אנונימי', user: 'משתמש', staff: 'צוות', admin: 'מנהל', service: 'שירות' };
const OP = { select: 'קריאה', insert: 'הוספה', update: 'עדכון', delete: 'מחיקה', execute: 'הרצה' };
const SCOPE = { own: 'רק שלו', all: 'הכל', none: 'כלום' };
const ACCESS_KIND = { table: 'טבלה', view: 'תצוגה', function: 'פונקציה', bucket: 'אחסון קבצים', realtime: 'זמן אמת' };
const STEP_KIND = { system: 'אוטומטי (ירוק)', human: 'אדם (כתום)', ai: 'בינה מלאכותית (סגול)', external: 'גורם חיצוני (כחול)', rejection: 'דחייה (אדום)' };
const CASE_KIND = { happy: 'תקין', problem: 'תקלה', rejection: 'דחייה' };
const SRC = { client: 'הלקוח', ours: 'אנחנו', assumed: 'הנחה' };
const OWNER = { client: 'הלקוח', me: 'אני', org: 'הארגון' };

function duration(iso) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(iso || ''));
  if (!m || !iso) return iso;
  const unit = [['שנים', 'שנה'], ['חודשים', 'חודש'], ['שבועות', 'שבוע'], ['ימים', 'יום'], ['שעות', 'שעה'], ['דקות', 'דקה']];
  const out = [];
  m.slice(1).forEach((v, i) => { if (v) out.push(Number(v) === 1 ? unit[i][1] : `${Number(v)} ${unit[i][0]}`); });
  return out.length ? out.join(' ו-') : iso;
}

function actorName(map, a) {
  if (typeof a !== 'string') return a;
  if (a.startsWith('role:')) { const r = arr(map.roles).find((x) => x.id === a.slice(5)); return r ? r.name : a.slice(5); }
  if (a.startsWith('external:')) return `חיצוני: ${a.slice(9)}`;
  return { screen: 'מסך', server: 'שרת', automation: 'אוטומציה', ai: 'בינה מלאכותית' }[a] || a;
}

const none = (what) => `אין עדיין ${what}.`;
const procRows = (map, fn) => arr(map.processes).flatMap((p) => fn(p));

const RENDER = {
  roles(map) {
    const rows = arr(map.roles).map((r) => [r.id, r.name, ROLE_KIND[r.kind] || r.kind]);
    return rows.length ? table(['מזהה', 'תפקיד', 'סוג'], rows) : none('תפקידים');
  },
  permissions(map) {
    const rows = arr(map.access).flatMap((a) => {
      const exp = a.serviceOnly ? 'שירות בלבד' : a.exposed ? 'חשוף' : 'פנימי';
      const base = [a.object, ACCESS_KIND[a.kind] || a.kind, exp];
      if (!arr(a.rules).length) return [[...base, '-', '-', '-', '-']];
      return a.rules.map((r) => [...base, roleName(map, r.role), arr(r.ops).map((o) => OP[o] || o), SCOPE[r.scope] || r.scope, r.rowRule]);
    });
    return rows.length ? table(['אובייקט', 'סוג', 'חשיפה', 'תפקיד', 'פעולות', 'היקף', 'כלל'], rows) : none('הרשאות');
  },
  autonomy(map) {
    const rows = procRows(map, (p) => arr(p.steps).map((s) => [p.name || p.id, s.id, actorName(map, s.actor), STEP_KIND[s.kind] || s.kind, s.text, s.kind === 'human' ? '-' : s.onFailure]));
    return rows.length ? table(['תהליך', 'צעד', 'מי', 'רמה', 'מה קורה', 'אם נכשל'], rows) : none('צעדים');
  },
  screens(map) {
    const rows = arr(map.screens).map((s) => [s.file, s.name, s.persona, s.journeyStage, s.nav]);
    return rows.length ? table(['קובץ', 'מסך', 'מי', 'שלב במסע', 'ניווט'], rows) : none('מסכים');
  },
  services(map) {
    const rows = arr(map.services).map((s) => [s.name || s.id, s.purpose, OWNER[s.owner] || s.owner, OWNER[s.payer] || s.payer, s.plan, s.planReason]);
    return rows.length ? table(['שירות', 'בשביל מה', 'בעלים', 'משלם', 'תוכנית', 'למה'], rows) : none('שירותים');
  },
  processes(map) {
    const rows = procRows(map, (p) => {
      const order = arr(p.stages).map((x) => x.id);
      const stageName = (id) => (arr(p.stages).find((x) => x.id === id) || {}).name || id;
      return [...arr(p.steps)].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
        .map((s) => [p.name || p.id, stageName(s.stage), s.id, actorName(map, s.actor), s.text, s.onFailure, SRC[s.src] || s.src]);
    });
    return rows.length ? table(['תהליך', 'שלב', 'צעד', 'מי', 'מה קורה', 'אם נכשל', 'מקור'], rows) : none('תהליכים');
  },
  timers(map) {
    const rows = procRows(map, (p) => arr(p.timers).map((t) => [p.name || p.id, t.text, duration(t.duration), t.onExpire, t.test]));
    return rows.length ? table(['תהליך', 'שעון', 'משך', 'כשהזמן נגמר', 'בדיקה'], rows) : none('שעונים');
  },
  cases(map) {
    const rows = procRows(map, (p) => arr(p.cases).map((c) => [p.name || p.id, CASE_KIND[c.kind] || c.kind, c.text, c.eval]));
    return rows.length ? table(['תהליך', 'סוג', 'מקרה', 'בדיקה'], rows) : none('מקרים');
  },
};
function roleName(map, id) { const r = arr(map.roles).find((x) => x.id === id); return r ? r.name : id; }

/** The Markdown (no markers) for one block kind. */
export function renderBlock(map, kind) {
  if (!RENDER[kind]) throw new Error(`unknown block kind: ${kind}`);
  return RENDER[kind](map || {});
}

/** Every gen block in the document: [{ kind, content }] (content is the text between the markers). */
export function extractBlocks(markdown) {
  const out = [];
  const re = /<!-- gen:([a-z]+) -->(?:\r?\n([\s\S]*?))?\r?\n<!-- \/gen:\1 -->/g;
  let m;
  while ((m = re.exec(markdown))) out.push({ kind: m[1], content: m[2] || '' });
  return out;
}

/** Replaces the content of every known gen block with renderBlock. Unknown kinds stay as they are. */
export function replaceBlocks(markdown, map) {
  return markdown.replace(/(<!-- gen:([a-z]+) -->)(?:\r?\n[\s\S]*?)?(\r?\n<!-- \/gen:\2 -->)/g,
    (all, open, kind, close) => (RENDER[kind] ? `${open}\n${renderBlock(map, kind)}${close}` : all));
}

/** Makes the first line the map stamp (replacing an older one). */
export function stampDocument(markdown, map) {
  const stamp = `<!-- blueprint-map: ${canonicalHash(map)} -->`;
  const body = markdown.replace(STAMP_RE, '');
  return `${stamp}\n${body}`;
}
export function stampOf(markdown) {
  const m = /^<!-- blueprint-map: ([0-9a-f]{64}) -->/.exec(markdown);
  return m ? m[1] : null;
}
