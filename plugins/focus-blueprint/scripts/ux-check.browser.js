() => {
  const VIEWPORT = { w: innerWidth, h: innerHeight, phone: innerWidth <= 480 };
  const results = [];
  const add = (id, principle, pass, details = [], level = 'fail') => results.push({ id, principle, pass, level: pass ? 'pass' : level, details: details.slice(0, 20) });
  const skip = (id, principle, why) => results.push({ id, principle, pass: true, level: 'skip', details: [why] });
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])';
  const DESTRUCTIVE = /(^|\s)(מחק|מחיקה|הסר|הסרה|בטל הכל|נקה|delete|remove|clear all)(\s|$)/i;
  const inDialog = (el) => !!el.closest('dialog');
  const textOf = (el) => `${el.innerText || ''} ${el.value || ''} ${el.getAttribute('aria-label') || ''}`.trim();
  const labelText = (el) => [...(el.labels || [])].map((l) => l.textContent).join(' ');
  const fieldsOf = (root) => [...root.querySelectorAll('input, select, textarea')].filter((e) => !['hidden', 'submit', 'button', 'reset', 'image'].includes(e.type));
  const pageName = location.pathname.split('/').pop() || 'index.html';

  // Walk all readable stylesheet rules (recursing into @media etc). cb(rule, mediaText).
  const walkRules = (cb) => {
    const go = (rules, media) => {
      for (const rule of rules) {
        cb(rule, media);
        if (rule.cssRules) go(rule.cssRules, rule.conditionText || media);
      }
    };
    for (const sheet of document.styleSheets) { try { go(sheet.cssRules, ''); } catch (e) { /* cross-origin sheet: unreadable */ } }
  };

  // --- contrast-text (D7): WCAG 1.4.3, 4.5:1 normal text, 3:1 large text (>= 24px, or >= 18.66px bold)
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c.rgb; } return [255, 255, 255]; };
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  {
    const bad = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement; if (!el || seen.has(el) || !n.textContent.trim() || !visible(el)) continue; seen.add(el);
      const s = getComputedStyle(el); const fg = parse(s.color); if (!fg) continue;
      const size = parseFloat(s.fontSize); const bold = parseInt(s.fontWeight, 10) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const r = ratio(fg.rgb, bgOf(el)); const need = large ? 3 : 4.5;
      if (r < need) bad.push(`${desc(el)} יחס ${r.toFixed(2)} (נדרש ${need})`);
    }
    add('contrast-text', 'D7', bad.length === 0, bad);
  }

  // --- primary-count (D7): at most one visible [data-primary] per main, dialogs excluded
  {
    const bad = [];
    const mains = [...document.querySelectorAll('main')];
    const roots = mains.length ? mains : [document.body];
    roots.forEach((m, i) => {
      const ps = [...m.querySelectorAll('[data-primary]')].filter((e) => visible(e) && !inDialog(e));
      if (ps.length > 1) bad.push(`main ${i + 1}: ${ps.length} כפתורים ראשיים: ${ps.map(desc).join(' | ')}`);
    });
    add('primary-count', 'D7', bad.length === 0, bad);
  }

  // --- target-size (D12, phone only): WCAG 2.5.8 AA, 24x24 CSS px or the 24px-circle spacing exception
  if (VIEWPORT.phone) {
    const bad = [];
    const targets = [...document.querySelectorAll(INTERACTIVE)].filter(visible).map((el) => ({ el, r: el.getBoundingClientRect() }));
    const small = targets.filter((t) => t.r.width < 24 || t.r.height < 24);
    const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    for (const t of small) {
      const c = center(t.r);
      let clash = null;
      for (const o of targets) {
        if (o === t) continue;
        if (o.el.contains(t.el) || t.el.contains(o.el)) continue;
        const oc = center(o.r);
        const oSmall = o.r.width < 24 || o.r.height < 24;
        if (oSmall) { if (Math.hypot(c.x - oc.x, c.y - oc.y) < 24) { clash = o; break; } }
        else {
          // circle radius 12 around c versus the other target's box
          const dx = Math.max(o.r.left - c.x, 0, c.x - o.r.right); const dy = Math.max(o.r.top - c.y, 0, c.y - o.r.bottom);
          if (Math.hypot(dx, dy) < 12) { clash = o; break; }
        }
      }
      if (clash) bad.push(`${desc(t.el)} ${Math.round(t.r.width)}x${Math.round(t.r.height)} קרוב ל-${desc(clash.el)}`);
    }
    add('target-size', 'D12', bad.length === 0, bad);
  } else skip('target-size', 'D12', 'phone only');

  // --- tab-order (D15, desktop only): every real control focusable, and a :focus / :focus-visible style exists
  if (!VIEWPORT.phone) {
    const bad = [];
    document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea').forEach((el) => { if (el.getAttribute('tabindex') === '-1' && visible(el)) bad.push(`tabindex=-1 על ${desc(el)}`); });
    document.querySelectorAll('div[onclick], span[onclick]').forEach((el) => { if (!el.hasAttribute('tabindex') && visible(el)) bad.push(`לחיץ בלי tabindex: ${desc(el)}`); });
    let focusRule = false;
    walkRules((rule) => { if (rule.selectorText && /:focus-visible|:focus/.test(rule.selectorText)) focusRule = true; });
    if (!focusRule) bad.push('אין כלל :focus או :focus-visible');
    add('tab-order', 'D15', bad.length === 0, bad);
  } else skip('tab-order', 'D15', 'desktop only');

  // --- field-labels (D34): every field has a label, aria-label or aria-labelledby
  {
    const bad = fieldsOf(document).filter((el) => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map(desc);
    add('field-labels', 'D34', bad.length === 0, bad);
  }

  // --- typing-replaceable (D13, D39): free-text input where a typed control exists
  {
    const RX = /תאריך|date|טלפון|phone|מייל|email|סכום|amount|מדינה|country|שעה|time/i;
    const bad = [...document.querySelectorAll('input')].filter((el) => (el.getAttribute('type') || 'text').toLowerCase() === 'text' && RX.test(`${el.name} ${el.id} ${el.placeholder} ${labelText(el)}`)).map(desc);
    add('typing-replaceable', 'D13,D39', bad.length === 0, bad, 'warn');
  }

  // --- required-gate (D40): a form with required fields has submit disabled initially, or lacks novalidate
  {
    const bad = [];
    document.querySelectorAll('form').forEach((f) => {
      if (!f.querySelector('[required]')) return;
      const subs = [...f.querySelectorAll('button:not([type=button]):not([type=reset]), input[type=submit]')];
      const gated = subs.length > 0 && subs.every((b) => b.disabled);
      if (!gated && f.hasAttribute('novalidate')) bad.push(`טופס ${f.id || '(ללא id)'}: novalidate וכפתור שליחה פעיל`);
    });
    add('required-gate', 'D40', bad.length === 0, bad, 'warn');
  }

  // --- inline-error-slot (D41): required/pattern fields point at an existing element via aria-describedby
  {
    const bad = [...document.querySelectorAll('input[required], select[required], textarea[required], input[pattern]')].filter((el) => {
      const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      return !ids.length || !ids.every((i) => document.getElementById(i));
    }).map(desc);
    add('inline-error-slot', 'D41', bad.length === 0, bad, 'warn');
  }

  // destructive controls outside dialogs (controls inside a dialog are the confirmation itself)
  const destructive = [...document.querySelectorAll('button, a[href], [role=button], input[type=button], input[type=submit]')].filter((el) => !inDialog(el) && DESTRUCTIVE.test(textOf(el)));

  // --- destructive-adjacency (D43): no destructive control within 48 px of a primary/submit control
  {
    const bad = [];
    const gap = (a, b) => Math.hypot(Math.max(a.left - b.right, 0, b.left - a.right), Math.max(a.top - b.bottom, 0, b.top - a.bottom));
    const primaries = [...document.querySelectorAll('[data-primary], [type=submit]')].filter((e) => visible(e) && !inDialog(e));
    for (const d of destructive.filter(visible)) {
      for (const p of primaries) {
        if (p === d) continue;
        if (gap(d.getBoundingClientRect(), p.getBoundingClientRect()) < 48) bad.push(`${desc(d)} צמוד ל-${desc(p)}`);
      }
    }
    add('destructive-adjacency', 'D43', bad.length === 0, bad);
  }

  // --- destructive-confirm (D47): every destructive control carries a non-empty data-confirm
  {
    const bad = destructive.filter((el) => !(el.getAttribute('data-confirm') || '').trim()).map(desc);
    add('destructive-confirm', 'D47', bad.length === 0, bad);
  }

  // --- opt-in-prechecked (D46): consent-like checkboxes start unchecked
  {
    const RX = /הסכמה|מאשר|מסכים|עדכונים|דיוור|newsletter|terms|תנאים/i;
    const bad = [...document.querySelectorAll('input[type=checkbox]')].filter((el) => el.checked && RX.test(`${labelText(el)} ${el.getAttribute('aria-label') || ''}`)).map(desc);
    add('opt-in-prechecked', 'D46', bad.length === 0, bad);
  }

  // --- line-length (D4, desktop only, guideline): p/li over 120 chars should stay within ~90 characters per line
  if (!VIEWPORT.phone) {
    const bad = [];
    document.querySelectorAll('p, li').forEach((el) => {
      if (el.textContent.trim().length <= 120 || !visible(el)) return;
      const cpl = el.getBoundingClientRect().width / (parseFloat(getComputedStyle(el).fontSize) * 0.5);
      if (cpl > 90) bad.push(`${desc(el)} ~${Math.round(cpl)} תווים בשורה`);
    });
    add('line-length', 'D4', bad.length === 0, bad, 'warn');
  } else skip('line-length', 'D4', 'desktop only');

  // --- rtl-direction (D33): Hebrew page declares dir=rtl on html or body
  {
    const hasHebrew = /[֐-׿]/.test(document.body.innerText || '');
    const rtl = document.documentElement.getAttribute('dir') === 'rtl' || document.body.getAttribute('dir') === 'rtl';
    add('rtl-direction', 'D33', !hasHebrew || rtl, ['יש עברית בלי dir=rtl']);
  }

  // --- anchor-home (S13): pages other than index.html show a [data-anchor] link
  {
    const ok = pageName === 'index.html' || [...document.querySelectorAll('[data-anchor]')].some(visible);
    add('anchor-home', 'S13', ok, [`אין [data-anchor] גלוי בעמוד ${pageName}`]);
  }

  // --- feedback-states (D17, desktop only): a stylesheet rule for hover or active
  if (!VIEWPORT.phone) {
    let found = false;
    walkRules((rule) => { if (rule.selectorText && /(?:^|[\s,>+~])(?:button|a)(?![\w-])[^\s,]*:hover|:active/.test(rule.selectorText)) found = true; });
    add('feedback-states', 'D17', found, ['אין כלל button:hover, a:hover או :active'], 'warn');
  } else skip('feedback-states', 'D17', 'desktop only');

  // --- loading-state (D18, D19): each form / [data-async] has a loading marker inside (or on itself)
  {
    const SEL = '[data-loading], [aria-busy], .spinner';
    const bad = [...document.querySelectorAll('form, [data-async]')].filter((el) => el.method !== 'dialog' && !(el.matches(SEL) || el.querySelector(SEL))).map(desc);
    add('loading-state', 'D18,D19', bad.length === 0, bad, 'warn');
  }

  // --- color-alone (D6): status-like elements carry text or an icon, not colour only (visible ones)
  {
    const RX = /error|success|warning|danger|badge|status/i;
    const bad = [...document.querySelectorAll('[class]')].filter((el) => typeof el.className === 'string' && RX.test(el.className) && visible(el)).filter((el) => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.querySelector('svg, img, [aria-label]')).map(desc);
    add('color-alone', 'D6', bad.length === 0, bad);
  }

  // --- persist-input (S14): pages with a textarea or 3+ inputs persist drafts (inline script mentions localStorage, or [data-persist])
  {
    const n = fieldsOf(document).filter((e) => e.tagName === 'TEXTAREA' || !['checkbox', 'radio'].includes(e.type)).length;
    const needs = document.querySelector('textarea') || n >= 3;
    const ok = !needs || !!document.querySelector('[data-persist]') || [...document.scripts].some((s) => /localStorage/.test(s.textContent));
    add('persist-input', 'S14', ok, ['שדות קלט בלי שמירת טיוטה (localStorage או [data-persist])'], 'warn');
  }

  // --- motion (D3): no infinite animation outside loaders; prefers-reduced-motion rule when any animation exists
  {
    const bad = [];
    let anyAnim = false;
    document.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      if (!s.animationName || s.animationName === 'none') return;
      anyAnim = true;
      if (s.animationIterationCount.split(',').some((c) => c.trim() === 'infinite') && !el.closest('.spinner, [data-loading]')) bad.push(`אנימציה אינסופית: ${desc(el)}`);
    });
    let reduced = false;
    walkRules((rule, media) => { if (rule.type === 7) anyAnim = true; if (/prefers-reduced-motion/.test(media || '')) reduced = true; });
    if (anyAnim && !reduced) bad.push('יש אנימציה בלי כלל prefers-reduced-motion');
    add('motion', 'D3', bad.length === 0, bad, 'warn');
  }

  return { url: location.href, viewport: VIEWPORT, screen: document.querySelector('meta[name="blueprint:screen"]')?.content || null, results };
}
/* ids: ["contrast-text","primary-count","target-size","tab-order","field-labels","typing-replaceable","required-gate","inline-error-slot","destructive-adjacency","destructive-confirm","opt-in-prechecked","line-length","rtl-direction","anchor-home","feedback-states","loading-state","color-alone","persist-input","motion"] */
