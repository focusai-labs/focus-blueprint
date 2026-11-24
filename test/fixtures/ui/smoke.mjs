// Dev script, not a test: opens the four local pages from a temp project at 1280x800 and 390x844,
// saves screenshots next to this file and fails on any page error or horizontal overflow.
//   node test/fixtures/ui/smoke.mjs     (PLAYWRIGHT_PATH overrides the Playwright location)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const PLUGIN = path.join(root, 'plugins', 'focus-blueprint');
const pwPath = process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.claude', 'skills', 'focus-slides', 'node_modules', 'playwright');
const { chromium } = createRequire(import.meta.url)(pwPath);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-smoke-'));
spawnSync('git', ['init', '-q', '-b', 'stage-12'], { cwd: dir });
const bp = path.join(dir, '.blueprint');
fs.mkdirSync(path.join(bp, 'ui', 'answers'), { recursive: true });
fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
fs.writeFileSync(path.join(dir, 'evals', 'upload-docs.md'), '# upload');
const w = (f, o) => fs.writeFileSync(path.join(bp, f), typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const close = (status, note) => ({ status, note, proof: 'ok', at: '2026-11-21' });
w('state.json', {
  schema: 2, project: 'איסוף מסמכים לרואה חשבון', createdAt: '2026-11-21', updatedAt: '2026-11-21T10:00:00.000Z', stage: 12, status: 'blocked', mode: 'default',
  context: { payer: 'client', approver: 'client', users: 'org-staff', owner: 'client' }, track: 'supabase-app', live: false,
  connections: { github: { ok: true }, supabase: { ok: false } }, where: { repo: 'github.com/acme/docs', supabaseRef: 'abcd1234' },
  stages: { 1: { status: 'done', close: close('done', '') }, 2: { status: 'done', close: close('done', '') }, 7: { status: 'done', close: close('done_with_concerns', 'מסך אחד בלי מצב טעינה') }, 12: { status: 'blocked', close: close('blocked', 'חסר מפתח לשירות המיילים'), rounds: 3, halted: true, openFindings: ['הבדיקה נכשלת על קובץ ריק'] } },
  pending: ['a-14'], superpowers: { installed: false, version: null }, lastDriftCheck: '2026-11-19',
});
w('map.json', {
  schema: 1,
  capabilities: [
    { id: 'upload-docs', name: 'העלאת מסמכים', status: 'real', evidence: { red: { path: 'e/r.txt', exit: 1 }, green: { path: 'e/g.txt', exit: 0 }, adopted: false }, review: { spec: 'pass', quality: 'findings' }, openFindings: ['שם הקובץ לא מנוקה'], halted: false },
    { id: 'monthly', name: 'תזכורת חודשית', status: 'mock', evidence: { red: null, green: null, adopted: false }, review: null, openFindings: ['הבדיקה נכשלת על קובץ ריק'], halted: true },
    { id: 'old', name: 'ייצוא קיים', status: 'real', evidence: { red: null, green: null, adopted: true }, review: null, openFindings: [], halted: false },
  ],
  screens: [{ file: 'mockup/upload.html', name: 'העלאת מסמך', persona: 'client' }, { file: 'mockup/index.html', name: 'דף הבית', persona: 'client' }],
  tables: [{ name: 'documents' }], automations: [{ id: 'n8n:monthly' }], later: [{ id: 'later-1', text: 'ייצוא לאקסל' }],
});
w('changes.json', [{ at: '2026-11-20', kind: 'wording', text: 'שינוי ניסוח בכפתור', decision: 'now', stage: 7 }]);
w('rulings.json', [
  { id: 'r-001', at: '2026-11-20T10:00:00Z', stage: 12, capability: null, decision: 'בחרתי טבלה אחת למסמכים', why: 'פחות חיבורים', priceIfWrong: 'מיגרציה אחת נוספת', by: 'claude', reported: true },
  { id: 'r-002', at: '2026-11-21T10:00:00Z', stage: 12, capability: 'upload-docs', decision: 'הגבלתי גודל קובץ ל-10 מגה', why: 'כדי שההעלאה לא תיתקע', priceIfWrong: 'שורה אחת בהגדרות', by: 'claude', reported: false },
]);
w('last-session.md', 'עשינו את שלב 7.\nנשארו שני מסכים.\nהצעד הבא: תשתית נתונים.');
const ans = (name, answers, extra = {}) => fs.writeFileSync(path.join(bp, 'ui', 'answers', `${name}.json`), JSON.stringify({ name, answers, done: false, ...extra }));
ans('round-a', {
  'a-01': { value: 'אנחנו מרדפים אחרי לקוחות בשביל מסמכים', decidedBy: 'user', confirmed: true },
  'a-02': { value: ['manual', 'general'], decidedBy: 'user', confirmed: true },
  'a-03': { value: 'אוהבים את הגיליון, שונאים את המרדף', decidedBy: null, from: 'idea', quote: 'הגיליון נוח אבל המרדף אחרי הלקוחות הורג אותי', confirmed: false },
});
ans('brain-dump', { why: { value: 'כי כל חודש מאבדים ימים', decidedBy: 'user' } }, { answer: 'אני רואה חשבון ורודף אחרי לקוחות בוואטסאפ כל חודש' });
ans('round-b', { 'b-03': { value: 'glass', decidedBy: 'user', confirmed: true } });

// A stub catalog, until the real one lands.
const cat = path.join(dir, '.data');
fs.mkdirSync(path.join(cat, 'catalog', 'examples'), { recursive: true });
const dims = {
  visual: [['minimal', 'מינימלית', 'Minimal'], ['glass', 'זכוכית', 'Glass'], ['bento', 'בנטו', 'Bento']],
  nav: [['top-bar', 'סרגל עליון', 'Top bar'], ['side-bar', 'תפריט צד', 'Side bar']],
  structure: [['single-page', 'דף אחד', 'Single page'], ['multi-page', 'כמה דפים', 'Multi page']],
  login: [['centered-card', 'כרטיס במרכז', 'Centered card']],
  density: [['comfortable', 'מרווח', 'Comfortable'], ['compact', 'צפוף', 'Compact']],
};
for (const [dim, items] of Object.entries(dims)) {
  fs.writeFileSync(path.join(cat, 'catalog', `${dim}.json`), JSON.stringify(items.map(([id, he, en]) => ({ id, name_he: he, term_en: en, example: `${id}.html`, fits: 'יש הרבה תוכן לקרוא', less: 'צריך הרבה פעולות מהירות', default_for: [] }))));
  for (const [id, he] of items) fs.writeFileSync(path.join(cat, 'catalog', 'examples', `${id}.html`), `<!doctype html><html lang="he" dir="rtl"><body style="font-family:sans-serif;margin:0;padding:16px;background:#f4f1ff"><h3>${he}</h3><div style="background:#fff;padding:12px;border-radius:12px">דוגמה חיה</div></body></html>`);
}
process.env.FOCUS_BLUEPRINT_DATA = cat;

const { startUi } = await import(pathToFileURL(path.join(PLUGIN, 'ui', 'server.mjs')).href);
const ui = await startUi({ projectDir: dir });
const pages = {
  'brain-dump': 'brain-dump', 'brain-dump-why': 'brain-dump', 'questionnaire-a': 'questionnaire?round=a', 'questionnaire-b': 'questionnaire?round=b',
  'questionnaire-c': 'questionnaire?round=c', catalog: 'catalog', board: 'board',
};
const problems = [];
const browser = await chromium.launch();
try {
  for (const [w_, h_, tag] of [[1280, 800, '1280'], [390, 844, '390']]) {
    for (const [name, route] of Object.entries(pages)) {
      const ctx = await browser.newContext({ viewport: { width: w_, height: h_ } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${name}@${tag} pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION|BLOCKED)/.test(m.text() + (m.location().url || ''))) problems.push(`${name}@${tag} console: ${m.text()}`); });
      if (name === 'brain-dump-why') {
        // Fresh state for the first step: use a project route with no saved why by clearing the file first.
        fs.rmSync(path.join(bp, 'ui', 'answers', 'brain-dump.json'), { force: true });
      }
      await page.goto(ui.url + route, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('[data-t]') && !document.title.startsWith('common') , null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      if (name === 'questionnaire-a') { await page.getByRole('button', { name: 'הבא' }).click(); await page.waitForTimeout(200); await page.getByRole('button', { name: 'הבא' }).click(); await page.waitForTimeout(300); }
      if (name === 'questionnaire-b') { await page.getByRole('button', { name: 'הבא' }).click(); await page.waitForTimeout(300); }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`${name}@${tag}: horizontal overflow ${overflow}px`);
      const dir_ = await page.evaluate(() => `${document.documentElement.dir}/${document.documentElement.lang}`);
      if (dir_ !== 'rtl/he') problems.push(`${name}@${tag}: dir/lang ${dir_}`);
      const small = await page.evaluate(() => [...document.querySelectorAll('button, input:not([type=hidden]), textarea')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).length);
      if (small) problems.push(`${name}@${tag}: ${small} controls under 24x24`);
      const raw = await page.evaluate(() => /\b(brainDump|questionnaire|common|board|catalog)\.[a-zA-Z]+/.test(document.body.innerText));
      if (raw) problems.push(`${name}@${tag}: an untranslated key is visible`);
      if (name === 'catalog') {
        const empty = await page.evaluate(() => [...document.querySelectorAll('iframe')].filter((f) => !f.srcdoc).length);
        if (empty) problems.push(`catalog@${tag}: ${empty} empty example frames`);
        await page.locator('iframe').last().scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        const inner = await page.locator('iframe').last().contentFrame().locator('body').innerText();
        if (!inner.trim()) problems.push(`catalog@${tag}: last example frame renders empty`);
      }
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(here, `${name}-${tag}.png`), fullPage: true });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  ui.close();
  await ui.closed;
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('smoke ok');
