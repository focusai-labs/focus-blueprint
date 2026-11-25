async (opts) => {
  // ---- pure parts (tested in node with opts.__pure) ----
  const CLASSES = ['navigates', 'dead-missing', 'dead-unknown', 'external', 'demo', 'changes', 'nothing'];
  /** What one click did: input { event, demoAttr, changed, dialogOpened, focusMoved } -> one of CLASSES. */
  const classify = ({ event = null, demoAttr = false, changed = false, dialogOpened = false, focusMoved = false } = {}) => {
    if (event && event.t === 'go') return event.kind === 'built' ? 'navigates' : event.kind === 'missing' ? 'dead-missing' : 'dead-unknown';
    if (event && event.t === 'external') return 'external';
    if (demoAttr || (event && event.t === 'demo')) return 'demo';
    if (changed || dialogOpened || focusMoved) return 'changes';
    return 'nothing';
  };
  /** items: [{ screen, selector, name, kind, target? }]. The check passes when nothing is dead and nothing does nothing. */
  const summarize = (items, visits = []) => {
    const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
    for (const it of items) if (it.kind in counts) counts[it.kind]++;
    const dead = counts['dead-missing'] + counts['dead-unknown'];
    return { screens: visits.length, controls: items.length, ...counts, dead, pass: dead === 0 && counts.nothing === 0 };
  };
  /** The ?state=... part of a link or data-next value, or ''. */
  const stateOf = (ref) => {
    const m = /\?([^#]*)/.exec(String(ref || ''));
    if (!m) return '';
    const p = new URLSearchParams(m[1]);
    return p.has('state') ? `?state=${p.get('state')}` : '';
  };
  const shortName = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.querySelector('img[alt]')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (opts && opts.__pure) return { classify, summarize, stateOf, CLASSES };

  // ---- in the page ----
  const bp = window.__bp;
  if (!bp) throw new Error('open mockup/prototype.html first: window.__bp is missing');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const SEL = 'a[href], button, [role=button], [data-next], input[type=submit]';
  const frame = bp.frame;
  const win = () => frame.contentWindow;
  const doc = () => frame.contentDocument;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = win().getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const collect = () => [...doc().querySelectorAll(SEL)].filter(visible);
  const selectorOf = (el, i) => {
    const t = el.tagName.toLowerCase();
    if (el.id) return `${t}#${el.id}`;
    if (el.dataset && el.dataset.next !== undefined) return `${t}[data-next="${el.dataset.next}"]`;
    const href = el.getAttribute('href');
    if (href) return `${t}[href="${href}"]`;
    const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return `${t}${c}:nth(${i})`;
  };
  const fillForms = () => {
    const d = doc();
    d.querySelectorAll('form').forEach((form) => {
      const submit = form.querySelector('[type=submit]');
      if (!submit || !submit.disabled) return;
      form.querySelectorAll('[required]').forEach((f) => {
        if (f.tagName === 'SELECT') { const o = [...f.options].find((x) => x.value); if (o) f.value = o.value; }
        else if (f.type === 'checkbox' || f.type === 'radio') f.checked = true;
        else if (f.type === 'email') f.value = 'check@example.test';
        else if (f.type === 'number') f.value = '1';
        else if (f.type === 'tel') f.value = '0500000000';
        else if (f.type === 'password') f.value = 'Aa123456!';
        else f.value = 'בדיקה';
        f.dispatchEvent(new (win().Event)('input', { bubbles: true }));
        f.dispatchEvent(new (win().Event)('change', { bubbles: true }));
      });
    });
  };
  const load = async (file, search) => { await bp.route(file, search, true); await wait(150); fillForms(); };

  const items = []; const skipped = []; const visits = [];
  const queue = bp.data.screens.filter((s) => s.built).map((s) => ({ file: s.file, search: '' }));
  const seen = new Set(queue.map((v) => v.file + v.search));
  for (let qi = 0; qi < queue.length && qi < 80; qi++) {
    const visit = queue[qi];
    await load(visit.file, visit.search);
    const first = collect();
    for (const el of first) {
      const st = stateOf(el.getAttribute('href') || (el.dataset && el.dataset.next));
      if (!st) continue;
      const t = bp.resolveTo(visit.file, el.getAttribute('href') || el.dataset.next);
      const key = t.file + st;
      if (bp.kindOf(t.file) === 'built' && !seen.has(key)) { seen.add(key); queue.push({ file: t.file, search: st }); }
    }
    const label = visit.file + visit.search;
    visits.push({ file: visit.file, search: visit.search, controls: first.length });
    let dirty = false;
    for (let i = 0; i < first.length; i++) {
      if (dirty) { await load(visit.file, visit.search); dirty = false; }
      const el = collect()[i];
      if (!el) break;
      const base = { screen: label, selector: selectorOf(el, i), name: shortName(el) };
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') { skipped.push({ ...base, why: 'disabled' }); continue; }
      const d = doc();
      const beforeEvents = bp.events.length;
      const beforeActive = d.activeElement;
      const beforeDialogs = d.querySelectorAll('dialog[open]').length;
      let changed = false;
      const mo = new (win().MutationObserver)(() => { changed = true; });
      mo.observe(d.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      el.click();
      const got = () => bp.events.length > beforeEvents;
      for (let t = 0; t < 600 && !got(); t += 50) await wait(50);
      const slow = el.dataset && (el.dataset.next !== undefined || el.dataset.busy !== undefined) || el.getAttribute('aria-busy') === 'true' || (el.dataset && el.dataset.loading === 'true');
      if (!got() && changed && slow) for (let t = 0; t < 1800 && !got(); t += 50) await wait(50);
      mo.disconnect();
      const event = bp.events.length > beforeEvents ? bp.events[beforeEvents] : null;
      let focusMoved = false; let dialogOpened = false;
      try {
        const now = doc();
        focusMoved = now.activeElement !== beforeActive && now.activeElement !== now.body && now.activeElement !== el;
        dialogOpened = now.querySelectorAll('dialog[open]').length > beforeDialogs;
      } catch { /* the screen was replaced */ }
      const kind = classify({ event, demoAttr: !!el.closest('[data-demo]'), changed, dialogOpened, focusMoved });
      const item = { ...base, kind };
      if (event && event.t === 'go') item.target = event.file + event.search;
      if (event && event.t === 'external') item.target = event.href;
      items.push(item);
      dirty = kind !== 'nothing' && kind !== 'demo' && kind !== 'external' || changed;
    }
  }
  const dead = items.filter((x) => x.kind === 'dead-missing' || x.kind === 'dead-unknown');
  const nothing = items.filter((x) => x.kind === 'nothing');
  const summary = summarize(items, visits);
  summary.skipped = skipped.length;
  await bp.route(bp.data.defaultFile, '', true);
  return { screens: visits, controls: items.length, dead, nothing, skipped, items, summary };
}
