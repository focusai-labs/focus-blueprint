// Focus Blueprint local pages: shared helpers, the app bar, drawers and popovers, and the page scripts.
// No framework, no external script. Texts come from strings.he.json by key.
// A page script loaded after this file adds its page with BP.register('name', fn): pages start on
// DOMContentLoaded, after every deferred script has run.
(() => {
  'use strict';
  const base = location.pathname.replace(/[^/]*$/, '');

  async function api(path, body) {
    const init = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(base + path, init);
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || String(res.status)), { status: res.status, data });
    return data;
  }

  let strings = {};
  const lookup = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  async function loadStrings() {
    const get = async (f) => { try { return await (await fetch(base + f)).json(); } catch { return {}; } };
    strings = { he: await get('strings.he.json') };
  }
  function t(key, vars) {
    let s = lookup(strings.he, key);
    if (typeof s !== 'string') return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  }
  const has = (key) => typeof lookup(strings.he, key) === 'string';
  function fillStatic() {
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
    document.title = t(document.body.dataset.title || 'common.saved');
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };
  const arr = (x) => (Array.isArray(x) ? x : []);
  const byKey = (root, key) => (key ? root.querySelector(`[data-key="${CSS.escape(key)}"]`) : null);

  // ---------------------------------------------------------------- motion
  // Every animation asks first. With reduced motion everything happens at once.
  const motionOK = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  /** Resolves when the element's transition ends (or after ms), at once without motion. */
  function settle(el, ms) {
    if (!motionOK()) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const end = () => { if (done) return; done = true; el.removeEventListener('transitionend', onEnd); clearTimeout(timer); resolve(); };
      const onEnd = (e) => { if (e.target === el) end(); };
      el.addEventListener('transitionend', onEnd);
      const timer = setTimeout(end, ms + 60);
    });
  }

  // ---------------------------------------------------------------- icons (fixed markup, never user text)
  const ICONS = {
    check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
    x: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
    dash: '<path d="M6 10h8"/>',
    chevL: '<path d="M12 5l-5 5 5 5"/>',
    chevR: '<path d="M8 5l5 5-5 5"/>',
    chevD: '<path d="M5.5 8l4.5 4.5L14.5 8"/>',
    moon: '<path d="M15.6 12.4A6.2 6.2 0 0 1 7.6 4.4a6.2 6.2 0 1 0 8 8z"/>',
    sun: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2.6v1.6M10 15.8v1.6M2.6 10h1.6M15.8 10h1.6M4.8 4.8l1.1 1.1M14.1 14.1l1.1 1.1M4.8 15.2l1.1-1.1M14.1 5.9l1.1-1.1"/>',
    menu: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
    ext: '<path d="M11.5 4.5h4v4M15.5 4.5l-6 6M13.5 12v3.5h-9v-9H8"/>',
    alert: '<circle cx="10" cy="10" r="7"/><path d="M10 6.4v4.2M10 13.5v.1"/>',
    help: '<circle cx="10" cy="10" r="7"/><path d="M8.1 8.1a2 2 0 1 1 2.8 1.9c-.6.2-.9.7-.9 1.2v.3M10 13.7v.1"/>',
    stop: '<path d="M7.1 3h5.8L17 7.1v5.8L12.9 17H7.1L3 12.9V7.1z"/><path d="M7.5 10h5"/>',
    ring: '<circle cx="10" cy="10" r="6"/>',
    dotring: '<circle cx="10" cy="10" r="6" stroke-dasharray="2.4 2.4"/>',
    half: '<circle cx="10" cy="10" r="6"/><path d="M10 4a6 6 0 0 0 0 12z" fill="currentColor" stroke="none"/>',
    dot: '<circle cx="10" cy="10" r="3.5" fill="currentColor" stroke="none"/>',
    spark: '<path d="M10 3.2l1.7 5.1 5.1 1.7-5.1 1.7L10 16.8l-1.7-5.1L3.2 10l5.1-1.7z"/>',
  };
  function icon(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', cls ? `i ${cls}` : 'i');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  // ---------------------------------------------------------------- night mode: day unless the reader chose night
  const THEME_KEY = 'bp-theme';
  function readTheme() { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } }
  function saveTheme(v) { try { localStorage.setItem(THEME_KEY, v); } catch { /* storage is blocked: the choice lasts for this page only */ } }
  function applyTheme(v) { if (v === 'dark') document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme; }
  applyTheme(readTheme());

  /** The save status in the bar. A failed save also shows the full sentence under the bar. */
  function indicator(el) {
    let last = ''; let alertEl = null;
    return (state) => {
      if (!el || state === last) return;
      last = state;
      el.className = `save ${state}`;
      clear(el);
      if (state === 'saved') el.append(icon('check'), t('common.saved'));
      else if (state === 'saving') el.append(t('common.saving'));
      else if (state === 'failed') el.append(icon('alert'), t('common.saveFailedShort'));
      el.classList.remove('is-fresh'); void el.offsetWidth; el.classList.add('is-fresh');
      if (state === 'failed') {
        if (!alertEl) { alertEl = h('p', { class: 'save-alert', role: 'alert' }); document.body.append(alertEl); }
        alertEl.textContent = t('common.saveFailed');
      } else if (alertEl) { alertEl.remove(); alertEl = null; }
    };
  }
  /** Debounced autosave: push(value) saves after a pause, flush() saves now. */
  function autosaver(send, setState, wait = 400) {
    let timer = null; let has = false; let latest;
    async function flush() {
      clearTimeout(timer);
      if (!has) return;
      const v = latest; has = false;
      try { await send(v); setState('saved'); } catch { setState('failed'); }
    }
    return { push(v) { latest = v; has = true; setState('saving'); clearTimeout(timer); timer = setTimeout(flush, wait); }, flush };
  }

  const params = new URLSearchParams(location.search);
  const $ = (sel, root = document) => root.querySelector(sel);

  function selectNode({ key, label, labelledBy, value, options, onchange }) {
    const sel = h('select', { 'data-key': key || null, 'aria-label': labelledBy ? null : label, 'aria-labelledby': labelledBy || null });
    for (const [v, text] of options) sel.append(h('option', { value: String(v) }, text));
    sel.value = String(value);
    sel.addEventListener('change', () => onchange(sel.value));
    return h('span', { class: 'select' }, sel, icon('chevD'));
  }
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
  };

  // ---------------------------------------------------------------- popover: one at a time, next to its button
  const popover = (() => {
    let el = null; let anchor = null; let opts = {}; let raf = 0;
    const isOpen = () => Boolean(el);
    const isOpenFor = (a) => Boolean(el) && anchor === a;
    function place() {
      if (!el || !anchor) return;
      if (!anchor.isConnected) { close({ returnFocus: false, instant: true }); return; }
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth; const ht = el.offsetHeight;
      const vw = document.documentElement.clientWidth; const vh = window.innerHeight;
      let top = r.bottom + 8;
      const up = top + ht > vh - 8 && r.top - 8 - ht > 8;
      if (up) top = r.top - 8 - ht;
      // right to left: the popover starts at the button's right edge
      const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
      el.style.top = `${Math.round(top)}px`;
      el.style.left = `${Math.round(left)}px`;
      el.classList.toggle('is-up', up);
    }
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    function onDown(e) { if (el && !el.contains(e.target) && !anchor.contains(e.target)) close({ returnFocus: false }); }
    function onFocusOut(e) {
      const to = e.relatedTarget;
      if (el && to && !el.contains(to) && !anchor.contains(to)) close({ returnFocus: false });
    }
    function open(anchorEl, content, o = {}) {
      close({ returnFocus: false, instant: true });
      anchor = anchorEl; opts = o;
      const id = `pop-${Math.random().toString(36).slice(2, 8)}`;
      const anim = o.animate !== false && motionOK();
      el = h('div', { class: `pop${o.className ? ` ${o.className}` : ''}`, id, role: o.role === undefined ? 'dialog' : o.role, 'aria-label': o.label || null, 'aria-labelledby': o.labelledBy || null, tabindex: '-1', 'data-state': anim ? 'enter' : null }, content);
      anchor.after(el);
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', id);
      place();
      if (anim) { const node = el; nextFrame().then(() => { if (node === el) node.removeAttribute('data-state'); }); }
      document.addEventListener('pointerdown', onDown, true);
      window.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
      el.addEventListener('focusout', onFocusOut);
      if (o.focus !== false) {
        const first = o.focusFirst ? el.querySelector(o.focusFirst === true ? 'a[href], button:not([disabled])' : o.focusFirst) : null;
        (first || el).focus({ preventScroll: true });
      }
      return el;
    }
    function close({ returnFocus = true, instant = false } = {}) {
      if (!el) return;
      const node = el; const a = anchor; const cb = opts.onClose;
      el = null; anchor = null; opts = {};
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      node.removeEventListener('focusout', onFocusOut);
      const hadFocus = node.contains(document.activeElement);
      if (a) { a.setAttribute('aria-expanded', 'false'); a.removeAttribute('aria-controls'); }
      if (returnFocus && a && a.isConnected && (hadFocus || document.activeElement === document.body)) a.focus({ preventScroll: true });
      if (instant || !motionOK()) node.remove();
      else { node.inert = true; node.dataset.state = 'leave'; settle(node, 180).then(() => node.remove()); }
      if (cb) cb();
    }
    return { open, close, isOpen, isOpenFor, place, get element() { return el; }, get anchor() { return anchor; } };
  })();

  // ---------------------------------------------------------------- drawer: one at a time, from the left (a sheet on a phone)
  const drawer = (() => {
    let el = null; let backdrop = null; let opener = null; let opts = {}; let parts = null;
    const isOpen = () => Boolean(el);
    const FOCUSABLE = 'a[href], button:not([disabled]), select, textarea, input, [tabindex="0"]';
    function fill(o) {
      parts.kicker.textContent = o.kicker || '';
      parts.kicker.hidden = !o.kicker;
      parts.title.textContent = o.title || '';
      const y = parts.body.scrollTop;
      clear(parts.body);
      parts.body.append(...[o.body].flat(Infinity).filter(Boolean));
      parts.body.scrollTop = y;
      // the same footer buttons stay in place, so a focused button keeps its focus
      const f = [o.footer].flat(Infinity).filter(Boolean);
      const same = f.length === parts.foot.children.length && f.every((n, i) => parts.foot.children[i] === n);
      if (!same) { clear(parts.foot); parts.foot.append(...f); }
      parts.foot.hidden = !f.length;
    }
    function trap(e) {
      if (e.key !== 'Tab' || !el || opts.modal === false) return;
      const list = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0]; const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function open(o) {
      if (el) close({ returnFocus: false, instant: true });
      opts = { ...o };
      opener = o.opener || document.activeElement;
      const modal = o.modal !== false;
      const anim = o.animate !== false && motionOK();
      parts = { kicker: h('p', { class: 'kicker' }), title: h('h2', { id: 'drawer-title' }), body: h('div', { class: 'drawer-body' }), foot: h('div', { class: 'drawer-foot' }) };
      const closeBtn = h('button', { type: 'button', class: 'bare icon-btn', 'aria-label': t('common.close'), title: t('common.close'), 'data-key': 'drawer-close', onclick: () => close() }, icon('x'));
      el = h('aside', { class: `drawer${modal ? '' : ' is-docked'}`, role: 'dialog', 'aria-modal': modal ? 'true' : 'false', 'aria-labelledby': 'drawer-title', tabindex: '-1', 'data-state': anim ? 'enter' : null },
        h('div', { class: 'drawer-head' }, h('div', { class: 'titles' }, parts.kicker, parts.title), closeBtn), parts.body, parts.foot);
      fill(o);
      if (modal) {
        backdrop = h('div', { class: 'backdrop', 'data-state': anim ? 'enter' : null, onclick: () => close() });
        for (const node of [...document.body.children]) if (!node.inert && node.tagName !== 'SCRIPT') { node.inert = true; node.dataset.bpInert = '1'; }
        document.documentElement.classList.add('is-locked');
        document.body.append(backdrop);
      }
      document.body.append(el);
      el.addEventListener('keydown', trap);
      if (anim) { const node = el; const bd = backdrop; nextFrame().then(() => { node.removeAttribute('data-state'); if (bd) bd.removeAttribute('data-state'); }); }
      el.focus({ preventScroll: true });
      return el;
    }
    /** New content in the open drawer: no slide, the focus and the scroll stay. */
    function update(o) {
      if (!el) return;
      const active = el.contains(document.activeElement) ? document.activeElement : null;
      const key = active && active.dataset ? active.dataset.key : null;
      if (o.key !== undefined) opts.key = o.key;
      if (o.onClose !== undefined) opts.onClose = o.onClose;
      if (o.opener) opener = o.opener;
      fill(o);
      if (o.swap && motionOK()) { parts.body.classList.remove('is-swapping'); void parts.body.offsetWidth; parts.body.classList.add('is-swapping'); }
      if (active && !active.isConnected) {
        const again = byKey(el, key);
        if (again && !again.disabled) again.focus({ preventScroll: true });
        else (el.querySelector('.drawer-foot button:not([disabled])') || el).focus({ preventScroll: true });
      }
    }
    function close({ returnFocus = true, instant = false } = {}) {
      if (!el) return;
      const node = el; const bd = backdrop; const back = opener; const cb = opts.onClose; const modal = opts.modal !== false;
      el = null; backdrop = null; opener = null; opts = {}; parts = null;
      if (modal) {
        document.querySelectorAll('[data-bp-inert]').forEach((n) => { n.inert = false; delete n.dataset.bpInert; });
        document.documentElement.classList.remove('is-locked');
      }
      const anim = !instant && motionOK();
      for (const n of [node, bd]) {
        if (!n) continue;
        if (anim) { n.inert = true; n.dataset.state = 'leave'; settle(n, 220).then(() => n.remove()); } else n.remove();
      }
      if (cb) cb();
      if (returnFocus && back && back.isConnected) back.focus({ preventScroll: true });
    }
    return {
      open, update, close, isOpen,
      key: () => (el ? opts.key : null),
      setOpener(n) { if (el && n) opener = n; },
      get element() { return el; },
    };
  })();

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (popover.isOpen()) { e.preventDefault(); popover.close(); return; }
    if (drawer.isOpen()) { e.preventDefault(); drawer.close(); }
  });

  // ---------------------------------------------------------------- the app bar, on every page
  const bar = (() => {
    let el = null; let projectEl = null; let sepEl = null; let chipEl = null; let menuBtn = null; let page = '';
    const navLinks = () => [
      h('a', { href: 'board', 'aria-current': page === 'board' ? 'page' : null }, t('nav.board')),
      h('a', { href: 'process', 'aria-current': page === 'process' ? 'page' : null }, t('nav.process')),
    ];
    function paintTheme(btn) {
      const dark = document.documentElement.dataset.theme === 'dark';
      clear(btn);
      btn.append(icon(dark ? 'sun' : 'moon'));
      btn.setAttribute('aria-label', t(dark ? 'nav.day' : 'nav.night'));
      btn.title = t(dark ? 'nav.day' : 'nav.night');
    }
    function openMenu() {
      if (popover.isOpenFor(menuBtn)) { popover.close(); return; }
      const chip = chipEl && !chipEl.hidden ? h('a', { class: 'stage-chip', href: chipEl.getAttribute('href') }, chipEl.textContent) : null;
      popover.open(menuBtn, [navLinks(), chip], { className: 'menu-panel', role: null, label: t('nav.menu'), focusFirst: true });
    }
    function build(pageName) {
      page = pageName;
      el = document.getElementById('appbar');
      if (!el) { el = h('header', { id: 'appbar' }); document.body.prepend(el); }
      el.className = 'appbar';
      const save = document.getElementById('save');
      if (save) save.remove();
      clear(el);
      projectEl = h('span', { class: 'project', hidden: true });
      sepEl = h('span', { class: 'brand-sep', 'aria-hidden': 'true', hidden: true });
      chipEl = h('a', { class: 'stage-chip', href: 'board#overview', hidden: true });
      const theme = h('button', { type: 'button', class: 'bare icon-btn', 'data-key': 'theme', onclick: (e) => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(next); saveTheme(next); paintTheme(e.currentTarget);
      } });
      paintTheme(theme);
      menuBtn = h('button', { type: 'button', class: 'bare menu-btn', 'aria-expanded': 'false', onclick: openMenu }, icon('menu'), t('nav.menu'));
      el.append(
        h('div', { class: 'brand' }, h('span', { class: 'brand-name ltr', lang: 'en' }, 'Focus Blueprint'), sepEl, projectEl),
        h('nav', { class: 'appnav', 'aria-label': t('nav.menu') }, navLinks()),
        h('div', { class: 'end' }, save, chipEl, menuBtn, theme));
      const onScroll = () => el.classList.toggle('is-scrolled', window.scrollY > 2);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    function update(s) {
      if (!el) return;
      const st = (s && s.state) || null;
      const name = st && st.project ? String(st.project) : '';
      projectEl.textContent = name;
      projectEl.hidden = !name; sepEl.hidden = !name;
      if (st && st.stage != null) {
        const def = arr(s.stagesDef).find((d) => d.n === st.stage);
        chipEl.textContent = def ? t('nav.stage', { n: st.stage, name: def.name }) : t('board.stageN', { n: st.stage });
        chipEl.hidden = false;
      } else chipEl.hidden = true;
    }
    return { build, update };
  })();

  // ---------------------------------------------------------------- a small markdown reader: text nodes only
  function inlineMd(el, text) {
    const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.append(document.createTextNode(text.slice(last, m.index)));
      if (m[1] != null) el.append(h('code', { dir: 'ltr' }, m[1]));
      else el.append(h('strong', {}, m[2]));
      last = re.lastIndex;
    }
    if (last < text.length) el.append(document.createTextNode(text.slice(last)));
    return el;
  }
  function renderMd(src) {
    const out = h('div', { class: 'md' });
    let list = null; let para = null;
    for (const raw of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim();
      if (!line) { list = null; para = null; continue; }
      let m = /^(#{1,6})\s+(.+)$/.exec(line);
      if (m) { list = null; para = null; out.append(inlineMd(h(`h${Math.min(5, m[1].length + 2)}`), m[2].replace(/\s+#+$/, ''))); continue; }
      m = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (m) {
        const tag = /^\d/.test(line) ? 'OL' : 'UL';
        if (!list || list.tagName !== tag) { list = h(tag.toLowerCase()); out.append(list); }
        para = null;
        list.append(inlineMd(h('li'), m[1]));
        continue;
      }
      list = null;
      if (para) para.append(h('br')); else { para = h('p'); out.append(para); }
      inlineMd(para, line);
    }
    return out;
  }

  // ---------------------------------------------------------------- brain dump
  async function brainDump() {
    const setState = indicator($('#save'));
    const stepWhy = $('#step-why'); const stepDump = $('#step-dump');
    const why = $('#why'); const dump = $('#dump'); const cont = $('#why-continue'); const done = $('#done'); const count = $('#count');
    const saved = await api('api/answers?name=brain-dump').catch(() => ({}));
    const sendWhy = (v) => api('api/answer', { name: 'brain-dump', id: 'why', value: v });
    const whySaver = autosaver(sendWhy, setState);
    const dumpSaver = autosaver((v) => api('api/answer', { name: 'brain-dump', answer: v }), setState);

    const words = () => (dump.value.trim() ? dump.value.trim().split(/\s+/).length : 0);
    const refresh = () => { count.textContent = t('brainDump.wordCount', { n: words() }); done.disabled = words() === 0; };
    const unlock = () => { stepWhy.hidden = true; stepDump.hidden = false; dump.disabled = false; dump.focus(); refresh(); };

    why.value = (saved.answers && saved.answers.why && saved.answers.why.value) || '';
    dump.value = typeof saved.answer === 'string' ? saved.answer : '';
    cont.disabled = !why.value.trim();
    why.addEventListener('input', () => { cont.disabled = !why.value.trim(); if (why.value.trim()) whySaver.push(why.value); });
    cont.addEventListener('click', async () => { await whySaver.flush(); await sendWhy(why.value).then(() => setState('saved'), () => setState('failed')); unlock(); });
    dump.addEventListener('input', () => { refresh(); dumpSaver.push(dump.value); });
    done.addEventListener('click', async () => {
      await dumpSaver.flush();
      try { await api('api/done', { name: 'brain-dump' }); stepDump.hidden = true; $('#finished').hidden = false; }
      catch { setState('failed'); }
    });
    if (why.value.trim()) unlock();
    refresh();
  }

  // ---------------------------------------------------------------- questionnaire
  const isPrefill = (a) => Boolean(a) && a.from === 'idea' && a.confirmed === false;
  /** answered | pending | decided | prefilled | empty */
  function answerStatus(a) {
    if (isPrefill(a)) return 'prefilled';
    if (a && a.pending) return 'pending';
    if (a && a.decidedBy === 'claude') return 'decided';
    if (a && a.value != null && a.value !== '' && !(Array.isArray(a.value) && !a.value.length)) return 'answered';
    return 'empty';
  }
  const STATUS_ICONS = { answered: 'check', pending: 'help', decided: 'spark', prefilled: 'dotring', empty: 'ring' };

  async function questionnaire() {
    const round = params.get('round') || 'a';
    const qs = new URLSearchParams({ round });
    if (params.get('screens')) qs.set('screens', params.get('screens'));
    const setState = indicator($('#save'));
    const card = $('#stage');
    const root = h('div', { class: 'q-body' });
    card.append(root);
    const listBtn = $('#progress-text');
    $('#round-title').textContent = t(`questionnaire.rounds.${round}`);
    let data = await api(`api/questions?${qs}`);
    let list = data.questions;
    let idx = 0;
    let finished = false;
    let current = null; // the editor on screen, so a move saves it first
    let moving = false;

    async function refetch() {
      const fresh = await api(`api/questions?${qs}`);
      const cur = list[idx] && list[idx].id;
      list = fresh.questions;
      const at = list.findIndex((q) => q.id === cur);
      if (at >= 0) idx = at;
      return fresh;
    }
    const save = async (q, patch) => {
      try { await api('api/answer', { name: data.name, id: q.id, ...patch }); setState('saved'); } catch { setState('failed'); }
    };
    function updateProgress() {
      const answered = list.filter((q) => q.answer && !isPrefill(q.answer)).length;
      const pct = list.length ? Math.round((answered / list.length) * 100) : 0;
      $('#progress-bar').style.width = `${pct}%`;
      $('#progress-bar').parentElement.setAttribute('aria-valuenow', String(pct));
      clear(listBtn);
      listBtn.append(h('span', {}, finished ? t('questionnaire.allQuestions') : t('questionnaire.progress', { i: Math.min(idx + 1, list.length), n: list.length })), icon('chevD'));
      listBtn.hidden = !list.length;
    }

    /** Next moves toward the left: the old question leaves to the right, the new one comes in from the left. */
    async function slide(dir, render, focusAfter) {
      const focus = focusAfter || card.contains(document.activeElement);
      if (dir && motionOK()) {
        const ease = 'cubic-bezier(.2, .8, .2, 1)';
        const out = root.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${24 * dir}px)`, opacity: 0 }], { duration: 90, easing: ease, fill: 'forwards' });
        await out.finished.catch(() => {});
        render();
        out.cancel();
        root.animate([{ transform: `translateX(${-24 * dir}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: ease });
      } else render();
      if (focus) {
        const head = root.querySelector('.qtext, h2');
        if (head) { head.tabIndex = -1; head.focus({ preventScroll: true }); }
      }
    }
    function show(target) {
      if (target >= list.length) { idx = list.length; finished = true; renderEnd(); }
      else { idx = Math.max(0, target); finished = false; renderQuestion(); }
      updateProgress();
    }
    async function moveBy(d) {
      if (moving) return;
      moving = true;
      try {
        if (current) await current.flush();
        await refetch().catch(() => {});
        await slide(d > 0 ? 1 : -1, () => show(idx + d));
      } finally { moving = false; }
    }
    async function jumpTo(id) {
      if (moving) return;
      moving = true;
      try {
        if (current) await current.flush();
        await refetch().catch(() => {});
        const target = list.findIndex((q) => q.id === id);
        if (target < 0) return;
        const dir = finished || target < idx ? -1 : target > idx ? 1 : 0;
        await slide(dir, () => show(target), true);
      } finally { moving = false; }
    }

    function openList() {
      if (popover.isOpenFor(listBtn)) { popover.close(); return; }
      const groups = [];
      list.forEach((q, i) => {
        let g = groups[groups.length - 1];
        if (!g || g.name !== (q.block || '')) { g = { name: q.block || '', items: [] }; groups.push(g); }
        g.items.push({ q, i });
      });
      const content = [h('p', { class: 'q-title', id: 'qlist-title' }, t('questionnaire.allQuestions'))];
      for (const g of groups) {
        if (g.name) content.push(h('p', { class: 'q-group' }, g.name));
        content.push(h('ul', {}, g.items.map(({ q, i }) => {
          const st = answerStatus(q.answer);
          return h('li', {}, h('button', { type: 'button', class: 'bare qitem', 'aria-current': i === idx && !finished ? 'step' : null, onclick: () => { popover.close({ returnFocus: false }); jumpTo(q.id); } },
            icon(STATUS_ICONS[st], `st-${st}`), h('span', { class: 'q-t' }, q.text), h('span', { class: 'q-s' }, t(`questionnaire.status.${st}`))));
        })));
      }
      const pop = popover.open(listBtn, content, { className: 'qlist', labelledBy: 'qlist-title', focusFirst: '.qitem[aria-current="step"], .qitem' });
      const cur = pop.querySelector('.qitem[aria-current="step"]');
      if (cur) pop.scrollTop = Math.max(0, cur.offsetTop - pop.clientHeight / 2 + cur.offsetHeight / 2);
      pop.addEventListener('keydown', (e) => {
        const items = [...pop.querySelectorAll('.qitem')];
        const at = items.indexOf(document.activeElement);
        let to = null;
        if (e.key === 'ArrowDown') to = Math.min(items.length - 1, at + 1);
        else if (e.key === 'ArrowUp') to = Math.max(0, at - 1);
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = items.length - 1;
        if (to == null) return;
        e.preventDefault();
        items[to].focus();
      });
    }
    listBtn.addEventListener('click', openList);

    function editor(q, onChange) {
      const a = q.answer || {};
      const val = a.value;
      const opts = q.options || [];
      const name = `q-${q.id}`;
      if (q.type === 'open') {
        const id = `f-${q.id}`;
        const ta = h('textarea', { id, name, 'aria-label': q.text });
        ta.value = typeof val === 'string' ? val : '';
        const saver = autosaver((v) => save(q, { value: v }).then(() => onChange(v)), setState);
        ta.addEventListener('input', () => saver.push(ta.value));
        ta.addEventListener('blur', () => saver.flush());
        return { el: ta, flush: saver.flush };
      }
      if (q.type === 'pairs') {
        let rows = Array.isArray(val) && val.length ? val.map((r) => ({ ...r })) : [{ role: '', question: '', a: '', b: '' }];
        const box = h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch' });
        const saver = autosaver((v) => save(q, { value: v }).then(() => onChange(v)), setState);
        const draw = () => {
          clear(box);
          rows.forEach((r, i) => {
            const field = (key, label) => {
              const fid = `f-${q.id}-${i}-${key}`;
              const input = h('input', { type: 'text', id: fid, value: r[key] || '' });
              input.addEventListener('input', () => { r[key] = input.value; saver.push(rows); });
              return h('div', {}, h('label', { for: fid }, label), input);
            };
            box.append(h('div', { class: 'pairs-row' }, field('role', t('questionnaire.pairsRole')), field('question', t('questionnaire.pairsQuestion')), field('a', t('questionnaire.pairsGroupA')), field('b', t('questionnaire.pairsGroupB'))));
          });
          box.append(h('button', { type: 'button', class: 'quiet', onclick: () => { rows.push({ role: '', question: '', a: '', b: '' }); draw(); } }, t('questionnaire.pairsAdd')));
        };
        draw();
        return { el: box, flush: saver.flush };
      }
      if (q.type === 'scale') {
        const max = Number(q.max) || 5;
        const box = h('div', { class: 'scale', role: 'radiogroup', 'aria-label': q.text });
        for (let n = 1; n <= max; n++) {
          const input = h('input', { type: 'radio', name, value: String(n), checked: val === n });
          input.addEventListener('change', () => { save(q, { value: n }).then(() => onChange(n)); });
          box.append(h('label', { class: 'choice' }, input, h('span', {}, String(n))));
        }
        return { el: h('div', {}, box, h('div', { class: 'scale-ends' }, h('span', {}, t('questionnaire.scaleLow')), h('span', {}, t('questionnaire.scaleHigh')))), flush: async () => {} };
      }
      // single or multi
      const multi = q.type === 'multi';
      const box = h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch', role: multi ? 'group' : 'radiogroup', 'aria-label': q.text });
      const current = () => (multi ? (Array.isArray(val) ? [...val] : []) : val);
      let chosen = current();
      let otherText = typeof a.other === 'string' ? a.other : '';
      const otherInput = h('input', { type: 'text', id: `f-${q.id}-other`, 'aria-label': t('common.other'), placeholder: t('common.otherPlaceholder') });
      otherInput.value = otherText;
      const commit = () => {
        const patch = { value: multi ? chosen : chosen };
        const hasOther = multi ? chosen.includes('other') : chosen === 'other';
        if (hasOther) patch.other = otherText;
        return save(q, patch).then(() => onChange(chosen));
      };
      const otherSaver = autosaver(commit, setState);
      otherInput.addEventListener('input', () => { otherText = otherInput.value; otherSaver.push(chosen); });
      const refreshOther = () => { const on = multi ? chosen.includes('other') : chosen === 'other'; otherInput.disabled = !on; };
      // an option may carry a short hint: { v, t, hint }
      const all = opts.map((o) => ({ v: o.v, t: o.t, hint: typeof o.hint === 'string' && o.hint.trim() ? o.hint : null }));
      if (q.allowOther) all.push({ v: 'other', t: t('common.other'), other: true });
      all.forEach((o) => {
        const input = h('input', { type: multi ? 'checkbox' : 'radio', name, value: o.v, 'aria-label': undefined });
        input.checked = multi ? chosen.includes(o.v) : chosen === o.v;
        input.addEventListener('change', () => {
          if (multi) chosen = input.checked ? [...new Set([...chosen, o.v])] : chosen.filter((x) => x !== o.v);
          else chosen = o.v;
          refreshOther();
          commit();
        });
        box.append(h('label', { class: `choice${o.other ? ' other-field' : ''}` }, input, h('span', { class: 'opt' }, h('span', {}, o.t), o.hint ? h('span', { class: 'hint' }, o.hint) : null), o.other ? otherInput : null));
      });
      refreshOther();
      return { el: box, flush: otherSaver.flush };
    }

    function renderQuestion() {
      const q = list[idx];
      clear(root);
      const status = h('div', { 'aria-live': 'polite' });
      const prefillBox = h('div', { class: 'card' });
      const actions = h('div', { class: 'actions' });
      const markNote = () => {
        clear(status);
        const a = q.answer;
        if (a && a.pending) status.append(h('p', { class: 'note' }, t('questionnaire.dontKnowNote')));
        else if (a && a.decidedBy === 'claude') status.append(h('p', { class: 'note' }, t('questionnaire.decideForMeNote')));
      };
      const drawPrefill = () => {
        clear(prefillBox);
        prefillBox.hidden = !isPrefill(q.answer);
        if (prefillBox.hidden) return;
        prefillBox.append(h('p', {}, h('span', { class: 'badge' }, t('questionnaire.fromIdeaBadge'))), h('p', { class: 'muted small' }, t('questionnaire.fromIdeaQuote')), h('blockquote', { class: 'quote' }, q.answer.quote || ''));
      };
      const drawActions = () => {
        clear(actions);
        const pre = isPrefill(q.answer);
        const nextBtn = h('button', { type: 'button', class: pre ? '' : 'primary', onclick: () => moveBy(1) }, t('common.next'));
        const confirmBtn = pre ? h('button', { type: 'button', class: 'primary', onclick: async () => { await save(q, { confirm: true }); q.answer = { ...q.answer, confirmed: true, decidedBy: 'user' }; drawPrefill(); drawActions(); updateProgress(); } }, t('questionnaire.confirm')) : null;
        const side = h('div', { class: 'row' },
          q.decideButton !== false ? h('button', { type: 'button', class: 'quiet', onclick: async () => { await save(q, { decidedBy: 'claude' }); q.answer = { value: null, decidedBy: 'claude' }; markNote(); drawPrefill(); drawActions(); updateProgress(); } }, t('questionnaire.decideForMe')) : null,
          h('button', { type: 'button', class: 'quiet', onclick: async () => { await save(q, { value: null, pending: true }); q.answer = { value: null, pending: true }; markNote(); drawPrefill(); drawActions(); updateProgress(); } }, t('questionnaire.dontKnow')));
        const nav = h('div', { class: 'row spread' },
          h('button', { type: 'button', class: 'quiet', disabled: idx === 0, onclick: () => moveBy(-1) }, t('common.back')),
          h('div', { class: 'row' }, confirmBtn, nextBtn));
        actions.append(side, nav);
      };
      const ed = editor(q, (v) => {
        q.answer = { value: v, decidedBy: 'user' };
        markNote(); drawPrefill(); drawActions(); updateProgress();
      });
      current = ed;
      const isOpen = q.type === 'open';
      const head = isOpen ? h('label', { for: `f-${q.id}`, class: 'qtext', style: 'font-size:20px' }, q.text) : h('p', { class: 'qtext', style: 'font-weight:600;font-size:20px;line-height:1.4' }, q.text);
      root.append(
        h('p', { class: 'muted small' }, q.block || ''),
        head,
        q.why ? h('p', { class: 'muted small' }, `${t('questionnaire.whyLabel')}: ${q.why}`) : null,
        prefillBox, ed.el, status, actions);
      drawPrefill(); markNote(); drawActions();
    }

    function renderEnd() {
      clear(root);
      current = null;
      const pre = list.filter((q) => isPrefill(q.answer));
      if (list.length === 0) { root.append(h('p', {}, t('questionnaire.noQuestions'))); return; }
      root.append(h('h2', {}, t('questionnaire.finishTitle')));
      const backToLast = () => slide(-1, () => show(list.length - 1));
      if (pre.length) {
        root.append(h('p', {}, t('questionnaire.unconfirmedTitle')));
        const ul = h('ul', { class: 'plain' });
        pre.forEach((q) => ul.append(h('li', {}, h('button', { type: 'button', class: 'quiet', onclick: () => slide(-1, () => show(list.indexOf(q))) }, q.text))));
        root.append(ul);
      } else {
        root.append(h('p', { class: 'muted' }, t('questionnaire.finishAllAnswered')));
        root.append(h('div', { class: 'row spread' },
          h('button', { type: 'button', class: 'quiet', onclick: backToLast }, t('common.back')),
          h('button', { type: 'button', class: 'primary', id: 'round-done', onclick: async () => {
            try { await api('api/done', { name: data.name }); clear(root); root.append(h('p', { class: 'note' }, t('common.backToClaude'))); }
            catch (e) { if (e.status === 409) { await refetch(); renderEnd(); } else setState('failed'); }
          } }, t('questionnaire.roundDone'))));
      }
      if (pre.length) root.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'quiet', onclick: backToLast }, t('common.back'))));
    }

    if (data.done) { root.append(h('p', { class: 'note' }, t('common.backToClaude'))); }
    if (list.length === 0) { root.append(h('p', {}, t('questionnaire.noQuestions'))); updateProgress(); }
    else { renderQuestion(); updateProgress(); }
  }

  // ---------------------------------------------------------------- board
  const STATUS_TONE = { done: 'ok', done_with_concerns: 'warn', blocked: 'bad', needs_context: 'bad', in_progress: '', not_started: 'neutral' };
  const STATUS_ICON = { done: 'check', done_with_concerns: 'check', blocked: 'alert', needs_context: 'help', in_progress: 'half', not_started: 'ring' };
  const statusWord = (s) => (has(`board.statuses.${s}`) ? t(`board.statuses.${s}`) : String(s ?? ''));
  const statusBadge = (s) => h('span', { class: `badge ${STATUS_TONE[s] ?? ''}` }, icon(STATUS_ICON[s] || 'ring'), statusWord(s));
  const decisionWord = (d) => (has(`board.decisions_words.${d}`) ? t(`board.decisions_words.${d}`) : String(d ?? ''));
  const TABS = ['overview', 'rulings', 'changes', 'capabilities', 'closes', 'tech'];
  const CONNECTION_NAMES = { github: 'GitHub', playwright: 'Playwright', supabase: 'Supabase', vercel: 'Vercel', n8n: 'n8n', cloudinary: 'Cloudinary', fal: 'fal' };
  const WHERE_NAMES = { repo: 'GitHub', supabaseRef: 'Supabase', vercelProject: 'Vercel', n8nBase: 'n8n' };
  const section = (title, text) => (text ? h('section', { class: 'd-sec' }, h('h3', {}, title), h('p', {}, text)) : null);

  async function board() {
    const root = $('#board');
    // What the reader is looking at: it survives every refresh.
    const ui = {
      tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
      rulingStage: 'all', onlyNew: false, changeFilter: 'all',
      openCloses: new Set(), seenCloses: new Set(), openChanges: new Set(),
      summaryOpen: false, popStage: null, drawer: null,
    };
    let s = null; let lastJson = ''; let first = true;
    let els = { tabs: {}, panels: {}, ink: null, wrap: null, list: null };
    const afterShow = {};

    function derive() {
      const st = (s && s.state) || {};
      const m = (s && s.map) || {};
      const map = { ...m, capabilities: arr(m.capabilities), screens: arr(m.screens), tables: arr(m.tables), automations: arr(m.automations), later: arr(m.later), roles: arr(m.roles) };
      const defs = arr(s && s.stagesDef);
      const chapters = [];
      defs.forEach((d) => { let c = chapters.find((x) => x.name === d.chapter); if (!c) { c = { name: d.chapter, stages: [] }; chapters.push(c); } c.stages.push(d); });
      const rulings = arr(s && s.rulings);
      return { st, map, defs, chapters, rulings, unreported: rulings.filter((r) => !r.reported), closes: (s && s.closes) || {} };
    }
    const closeOf = (d, n) => d.closes[n] || d.closes[String(n)] || null;
    function stageStatus(d, n) {
      const c = closeOf(d, n);
      if (c && c.status) return c.status;
      if (n === d.st.stage && d.st.status) return d.st.status;
      const v = (d.st.stages || {})[n];
      return (v && v.status) || 'not_started';
    }
    const isStuck = (status) => status === 'blocked' || status === 'needs_context';
    function stuckStages(d) {
      const out = [];
      for (const [n, c] of Object.entries(d.closes)) if (c && isStuck(c.status)) out.push({ n: Number(n), note: c.note || statusWord(c.status) });
      for (const [n, v] of Object.entries(d.st.stages || {})) if (v && v.halted && !out.some((x) => x.n === Number(n))) out.push({ n: Number(n), note: t('board.haltedNote') });
      return out.sort((a, b) => a.n - b.n);
    }
    const focusKey = (key) => { const el = byKey(root, key); if (el) el.focus({ preventScroll: true }); };

    // ---- header: the project and the stage chips
    function chipNode(d, x) {
      const status = stageStatus(d, x.n);
      const now = x.n === d.st.stage;
      const cls = now ? 'is-now' : status === 'done' ? 'is-done' : status === 'done_with_concerns' ? 'is-concern' : isStuck(status) ? 'is-stuck' : '';
      const mark = now ? null : (status === 'done' || status === 'done_with_concerns') ? icon('check') : isStuck(status) ? icon('alert') : null;
      const b = h('button', { type: 'button', class: `bare chip ${cls}`, 'aria-label': `${t('nav.stage', { n: x.n, name: x.name })}, ${statusWord(status)}`, 'aria-current': now ? 'step' : null, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-key': `chip-${x.n}`, onclick: (e) => toggleStagePop(x.n, e.currentTarget) }, mark, String(x.n));
      if (now && first) b.classList.add('pulse-once');
      return b;
    }
    function headNode(d) {
      return h('div', { class: 'board-head' },
        h('h1', {}, d.st.project || t('board.title')),
        h('div', { class: 'stepper', role: 'group', 'aria-label': t('board.stagesProgress') }, d.chapters.map((c, i) => {
          const here = c.stages.some((x) => x.n === d.st.stage);
          return h('div', { class: `chapter${here ? ' is-current' : ''}` },
            h('p', { class: 'chapter-label' }, `${i + 1}. ${c.name}`),
            h('div', { class: 'chips' }, c.stages.map((x) => chipNode(d, x))));
        })));
    }
    function stagePopContent(d, n) {
      const def = d.defs.find((x) => x.n === n);
      const c = closeOf(d, n);
      return [
        h('p', { class: 'pop-title', id: 'pop-stage-title' }, def ? t('nav.stage', { n, name: def.name }) : t('board.stageN', { n })),
        statusBadge(stageStatus(d, n)),
        c && c.note ? h('p', { class: 'pop-note' }, c.note) : null,
        c ? h('button', { type: 'button', class: 'bare linkish', onclick: () => goToClose(n) }, t('board.toClose'), icon('chevL')) : null,
      ];
    }
    function toggleStagePop(n, chip, { animate = true, focus = true } = {}) {
      if (popover.isOpenFor(chip)) { popover.close(); return; }
      ui.popStage = n;
      popover.open(chip, stagePopContent(derive(), n), { labelledBy: 'pop-stage-title', animate, focus, onClose: () => { if (ui.popStage === n) ui.popStage = null; } });
    }
    function goToClose(n) {
      popover.close({ returnFocus: false });
      ui.openCloses.add(Number(n)); ui.seenCloses.add(Number(n));
      fillPanel('closes');
      selectTab('closes');
      const btn = byKey(root, `close-${n}`);
      if (btn) { btn.scrollIntoView({ block: 'center', behavior: motionOK() ? 'smooth' : 'auto' }); btn.focus({ preventScroll: true }); }
    }

    // ---- tabs (WAI-ARIA tabs: arrows, Home and End; the tab lives in the address)
    function tabsNode(d) {
      const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('board.title') });
      for (const id of TABS) {
        const n = id === 'rulings' ? d.unreported.length : 0;
        const label = t(`tabs.${id}`);
        const b = h('button', { type: 'button', class: 'bare tab', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'aria-selected': id === ui.tab ? 'true' : 'false', tabindex: id === ui.tab ? '0' : '-1', 'data-key': `tab-${id}`, onclick: () => selectTab(id) },
          label, n ? h('span', { class: 'count', 'aria-hidden': 'true' }, String(n)) : null);
        if (n) b.setAttribute('aria-label', `${label}, ${n === 1 ? t('board.newOne') : t('board.newMany', { n })}`);
        els.tabs[id] = b;
        list.append(b);
      }
      els.ink = h('span', { class: 'tab-ink', 'aria-hidden': 'true' });
      list.append(els.ink);
      list.addEventListener('keydown', onTabKey);
      list.addEventListener('scroll', updateFades, { passive: true });
      els.list = list;
      els.wrap = h('div', { class: 'tabs-wrap' }, list);
      return els.wrap;
    }
    function onTabKey(e) {
      const i = TABS.indexOf(ui.tab);
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
      let j = null;
      if (e.key === 'ArrowLeft') j = rtl ? i + 1 : i - 1;
      else if (e.key === 'ArrowRight') j = rtl ? i - 1 : i + 1;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = TABS.length - 1;
      if (j == null) return;
      e.preventDefault();
      selectTab(TABS[(j + TABS.length) % TABS.length], { focusTab: true });
    }
    function positionInk() {
      const b = els.tabs[ui.tab]; const ink = els.ink;
      if (!b || !ink || !b.offsetWidth) return;
      ink.style.width = `${b.offsetWidth}px`;
      ink.style.transform = `translateX(${b.offsetLeft}px)`;
      if (!ink.classList.contains('is-ready')) requestAnimationFrame(() => ink.classList.add('is-ready'));
    }
    function updateFades() {
      const l = els.list; const w = els.wrap;
      if (!l || !w) return;
      const max = l.scrollWidth - l.clientWidth;
      const x = Math.abs(l.scrollLeft); // right to left: 0 at the first tab, growing toward the left
      w.classList.toggle('fade-left', max > 2 && x < max - 2);
      w.classList.toggle('fade-right', max > 2 && x > 2);
    }
    function selectTab(id, { focusTab = false } = {}) {
      const changed = id !== ui.tab;
      ui.tab = id;
      for (const k of TABS) {
        const on = k === id;
        els.tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
        els.tabs[k].tabIndex = on ? 0 : -1;
        els.panels[k].hidden = !on;
      }
      const p = els.panels[id];
      if (changed && motionOK()) {
        p.classList.remove('is-entering'); void p.offsetWidth; p.classList.add('is-entering');
        p.addEventListener('animationend', () => p.classList.remove('is-entering'), { once: true });
      }
      if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
      runAfterShow(id);
      positionInk();
      showTab(motionOK() ? 'smooth' : 'auto');
      const b = els.tabs[id];
      if (focusTab) b.focus({ preventScroll: true });
      if (b.getBoundingClientRect().top < 64) b.scrollIntoView({ block: 'nearest' });
    }
    // on a phone the strip scrolls: the chosen tab is always fully in view
    function showTab(behavior) {
      const b = els.tabs[ui.tab];
      if (!b || !els.list) return;
      const lr = els.list.getBoundingClientRect(); const br = b.getBoundingClientRect();
      const pad = 44; // clear of the faded edge
      if (br.left < lr.left + pad) els.list.scrollBy({ left: br.left - lr.left - pad, behavior });
      else if (br.right > lr.right - pad) els.list.scrollBy({ left: br.right - lr.right + pad, behavior });
    }
    function runAfterShow(id) {
      const p = els.panels[id];
      if (p && !p.hidden && afterShow[id]) afterShow[id]();
    }
    function fillPanel(id, d = derive()) {
      const p = els.panels[id];
      if (!p) return;
      afterShow[id] = null;
      clear(p);
      p.append(...[BUILD[id](d)].flat(Infinity).filter(Boolean));
      if (!p.hidden) requestAnimationFrame(() => runAfterShow(id));
    }

    // ---- overview
    function waitingRows(d) {
      const rows = [];
      const row = (key, ic, text, onclick, tone) => h('button', { type: 'button', class: `bare row-btn${tone ? ` tone-${tone}` : ''}`, 'data-key': key, onclick }, icon(ic, 'lead'), h('span', { class: 'row-text' }, text), icon('chevL', 'chev'));
      const pending = Array.isArray(s.pendingQuestions) ? s.pendingQuestions : arr(d.st.pending).map((id) => ({ id: String(id) }));
      for (const q of pending) rows.push(row(`wait-q-${q.id}`, 'help', t('board.waitingQuestion', { text: q.text || q.id }), (e) => openDrawer({ kind: 'question', id: q.id }, e.currentTarget)));
      const n = d.unreported.length;
      if (n) {
        rows.push(row('wait-rulings', 'dot', n === 1 ? t('board.waitingRulingsOne') : t('board.waitingRulingsMany', { n }), () => {
          ui.onlyNew = true; ui.rulingStage = 'all';
          fillPanel('rulings');
          selectTab('rulings', { focusTab: true });
        }));
      }
      for (const x of stuckStages(d)) rows.push(row(`wait-stage-${x.n}`, 'alert', t('board.waitingStuck', { n: x.n, note: x.note }), () => goToClose(x.n), 'bad'));
      for (const c of d.map.capabilities.filter((x) => x.halted)) {
        rows.push(row(`wait-cap-${c.id}`, 'stop', t('board.waitingHalted', { name: c.name || c.id }), (e) => {
          selectTab('capabilities');
          openDrawer({ kind: 'capability', id: c.id }, byKey(root, `cap-${c.id}`) || e.currentTarget);
        }, 'bad'));
      }
      return rows;
    }
    function tilesNode(d) {
      const { map } = d;
      const real = map.capabilities.filter((c) => c.status === 'real').length;
      const tiles = [
        ['capabilities', t('board.capabilitiesLabel'), map.capabilities.length, map.capabilities.length ? t('board.capabilitiesTile', { real, total: map.capabilities.length }) : null],
        ['screens', t('board.screens'), map.screens.length],
        ['tables', t('board.tables'), map.tables.length],
        ['automations', t('board.automations'), map.automations.length],
      ];
      return h('div', { class: 'tiles' }, tiles.map(([id, label, n, sub]) => {
        const kids = [h('span', { class: 't-label' }, label), h('span', { class: 't-num' }, String(n)), sub ? h('span', { class: 't-sub' }, sub) : null];
        if (!n) return h('div', { class: 'tile is-empty' }, kids);
        return h('button', { type: 'button', class: 'bare tile', 'aria-haspopup': 'dialog', 'data-key': `tile-${id}`, onclick: (e) => openDrawer({ kind: 'list', id }, e.currentTarget) }, kids, icon('chevL', 'chev'));
      }));
    }
    function lastStopNode() {
      const card = h('section', { class: 'card', 'aria-labelledby': 'last-title' }, h('h2', { class: 'card-title', id: 'last-title' }, t('board.lastStop')));
      const text = String((s && s.lastSession) || '').trim();
      if (!text) { card.append(h('p', { class: 'empty' }, t('common.empty'))); return card; }
      const box = h('div', { class: 'clamp-box is-clamped', id: 'last-md' }, renderMd(text));
      const label = h('span', {}, t('board.readMore'));
      const btn = h('button', { type: 'button', class: 'bare linkish more-btn', 'aria-expanded': 'false', 'aria-controls': 'last-md', 'data-key': 'md-toggle', hidden: true }, label, icon('chevD'));
      const paint = (open) => { btn.setAttribute('aria-expanded', open ? 'true' : 'false'); label.textContent = open ? t('board.readLess') : t('board.readMore'); };
      btn.addEventListener('click', () => {
        ui.summaryOpen = !ui.summaryOpen;
        paint(ui.summaryOpen);
        if (!motionOK()) { box.classList.toggle('is-clamped', !ui.summaryOpen); return; }
        const from = box.offsetHeight;
        box.classList.toggle('is-clamped', !ui.summaryOpen);
        const to = ui.summaryOpen ? box.scrollHeight : box.offsetHeight;
        box.style.maxHeight = `${from}px`;
        void box.offsetHeight;
        box.classList.add('is-animating');
        box.style.maxHeight = `${to}px`;
        settle(box, 220).then(() => { box.style.maxHeight = ''; box.classList.remove('is-animating'); });
      });
      card.append(box, btn);
      afterShow.overview = () => {
        if (!box.isConnected) return;
        box.classList.add('is-clamped');
        const long = box.scrollHeight > box.clientHeight + 8;
        btn.hidden = !long;
        box.classList.toggle('is-clamped', long && !ui.summaryOpen);
        paint(ui.summaryOpen);
      };
      return card;
    }
    function overviewPanel(d) {
      const out = h('div', { class: 'overview' });
      const waiting = waitingRows(d);
      if (d.st.stage != null) {
        const def = d.defs.find((x) => x.n === d.st.stage);
        const ch = def ? d.chapters.findIndex((c) => c.name === def.chapter) : -1;
        out.append(h('section', { class: `card ov-stage${waiting.length ? ' with-waiting' : ''}` },
          h('p', { class: 'kicker' }, t('board.currentStage')),
          h('div', { class: 'stage-line' }, h('h2', {}, def ? t('nav.stage', { n: d.st.stage, name: def.name }) : t('board.stageN', { n: d.st.stage })), statusBadge(d.st.status || 'in_progress')),
          ch >= 0 ? h('p', { class: 'muted' }, t('board.chapterOf', { n: ch + 1, name: def.chapter })) : null));
      }
      if (waiting.length) out.append(h('section', { class: 'card ov-waiting', 'aria-labelledby': 'waiting-title' }, h('h2', { class: 'card-title', id: 'waiting-title' }, t('board.waiting')), h('ul', { class: 'rows' }, waiting.map((w) => h('li', {}, w)))));
      out.append(tilesNode(d), lastStopNode());
      return out;
    }

    // ---- rulings
    function rulingsPanel(d) {
      const stages = [...new Set(d.rulings.map((r) => r.stage).filter((x) => x != null))].sort((a, b) => a - b);
      if (ui.rulingStage !== 'all' && !stages.some((n) => String(n) === String(ui.rulingStage))) ui.rulingStage = 'all';
      const list = [...d.rulings].reverse().filter((r) => (ui.rulingStage === 'all' || String(r.stage) === String(ui.rulingStage)) && (!ui.onlyNew || !r.reported));
      const toolbar = h('div', { class: 'toolbar' },
        h('h2', {}, t('board.rulings')),
        selectNode({ key: 'sel-ruling-stage', label: t('board.rulingsCols.stage'), value: ui.rulingStage, options: [['all', t('board.allStages')], ...stages.map((n) => [n, t('board.stageN', { n })])], onchange: (v) => { ui.rulingStage = v; fillPanel('rulings'); focusKey('sel-ruling-stage'); } }),
        h('button', { type: 'button', class: 'toggle', 'aria-pressed': ui.onlyNew ? 'true' : 'false', 'data-key': 'only-new', onclick: () => { ui.onlyNew = !ui.onlyNew; fillPanel('rulings'); focusKey('only-new'); } }, icon('check'), t('board.onlyNew')),
        h('span', { class: 'count-text', role: 'status' }, t('board.rulingsCount', { n: list.length })));
      if (!list.length) return h('section', { class: 'card flush' }, toolbar, h('p', { class: 'empty table-empty' }, t('board.noRulings')));
      const col = (k) => h('th', { scope: 'col' }, t(`board.rulingsCols.${k}`));
      return h('section', { class: 'card flush' }, toolbar, h('table', { class: 'table stack' },
        h('thead', {}, h('tr', {}, col('decision'), col('stage'), col('reported'))),
        h('tbody', {}, list.map((r) => {
          const open = h('button', { type: 'button', class: 'bare row-link', 'aria-haspopup': 'dialog', 'data-key': `ruling-${r.id}`, onclick: (e) => { e.stopPropagation(); openDrawer({ kind: 'ruling', id: r.id }, e.currentTarget); } }, r.decision);
          return h('tr', { class: 'is-link', onclick: () => open.click() },
            h('td', {}, open),
            h('td', { class: 'num' }, h('span', { class: 'cell-label' }, t('board.rulingsCols.stage')), String(r.stage ?? '')),
            h('td', { class: 'mark' }, h('span', { class: 'cell-label' }, t('board.rulingsCols.reported')),
              r.reported ? h('span', { class: 'mark-yes', title: t('common.yes') }, icon('check'), h('span', { class: 'sr-only' }, t('common.yes'))) : h('span', { class: 'badge' }, icon('dot'), t('board.newRuling'))));
        }))));
    }

    // ---- changes
    function changesPanel(d) {
      const all = arr(s.changes).map((c, i) => ({ c, key: `change-${i}` })).reverse();
      const list = all.filter(({ c }) => ui.changeFilter === 'all' || c.decision === ui.changeFilter);
      const head = h('div', { class: 'toolbar' }, h('h2', { id: 'changes-title' }, t('board.changes')),
        selectNode({ key: 'sel-change', labelledBy: 'changes-title', value: ui.changeFilter, options: [['all', t('board.filterAll')], ['now', decisionWord('now')], ['later', decisionWord('later')]], onchange: (v) => { ui.changeFilter = v; fillPanel('changes'); focusKey('sel-change'); } }));
      let body;
      if (!list.length) body = h('p', { class: 'empty table-empty' }, t('board.noChanges'));
      else {
        body = h('ul', { class: 'changes' }, list.map(({ c, key }) => h('li', { class: `change${ui.openChanges.has(key) ? ' is-open' : ''}`, 'data-key': key },
          h('span', { class: `badge${c.decision === 'now' ? '' : ' neutral'}` }, decisionWord(c.decision)),
          h('p', { class: 'c-text' }, c.text),
          c.stage != null ? h('span', { class: 'c-meta' }, t('board.stageN', { n: c.stage })) : null)));
        const toggle = (li) => {
          const open = !li.classList.contains('is-open');
          li.classList.toggle('is-open', open);
          li.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (open) ui.openChanges.add(li.dataset.key); else ui.openChanges.delete(li.dataset.key);
        };
        body.addEventListener('click', (e) => { const li = e.target.closest('.change.is-expandable'); if (li && !String(window.getSelection ? window.getSelection() : '').trim()) toggle(li); });
        body.addEventListener('keydown', (e) => { const li = e.target.closest('.change.is-expandable'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(li); } });
        // only an item that is cut short can open
        afterShow.changes = () => {
          for (const li of body.children) {
            const txt = li.querySelector('.c-text');
            const open = li.classList.contains('is-open');
            const long = open || txt.scrollHeight > txt.clientHeight + 2;
            li.classList.toggle('is-expandable', long);
            if (long) { li.setAttribute('role', 'button'); li.tabIndex = 0; li.setAttribute('aria-expanded', open ? 'true' : 'false'); }
            else { li.removeAttribute('role'); li.removeAttribute('tabindex'); li.removeAttribute('aria-expanded'); }
          }
        };
      }
      const later = d.map.later;
      return [
        h('section', { class: 'card flush' }, head, body),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, t('board.later')), later.length ? h('ul', { class: 'later' }, later.map((l) => h('li', {}, l.text))) : h('p', { class: 'empty' }, t('common.empty'))),
      ];
    }

    // ---- capabilities and acceptance tests
    const markNode = (e) => (e && e.path
      ? h('span', { class: 'status ok' }, icon('check'), h('span', { class: 'ltr' }, `exit ${e.exit}`))
      : h('span', { class: 'status off' }, icon('dash'), h('span', { class: 'sr-only' }, t('common.no'))));
    const passNode = (v) => (v === 'pass'
      ? h('span', { class: 'status ok' }, icon('check'), t('board.pass'))
      : h('span', { class: 'status warn' }, icon('alert'), t('board.findings')));
    const capBadge = (c) => h('span', { class: `badge ${c.status === 'real' ? 'ok' : 'neutral'}` }, icon(c.status === 'real' ? 'check' : 'ring'), c.status === 'real' ? t('board.realOne') : t('board.mock'));
    const haltedBadge = () => h('span', { class: 'badge bad' }, icon('stop'), t('board.halted'));
    const findings = (list) => h('ul', { class: 'findings' }, list.map((f) => h('li', {}, f)));
    function capabilitiesPanel(d) {
      const { map } = d;
      const real = map.capabilities.filter((c) => c.status === 'real').length;
      const out = [map.capabilities.length
        ? h('p', { class: 'cap-sum' }, t('board.capabilities', { real, total: map.capabilities.length, mock: map.capabilities.length - real }))
        : h('p', { class: 'empty' }, t('board.capabilitiesEmpty'))];
      if (map.capabilities.length) {
        const col = (text) => h('th', { scope: 'col' }, text);
        out.push(h('section', { class: 'card flush' }, h('table', { class: 'table stack caps' },
          h('thead', {}, h('tr', {}, col(t('drawer.capability')), col(t('board.red')), col(t('board.green')), col(t('board.review')))),
          h('tbody', {}, map.capabilities.map((c) => {
            const ev = c.evidence || {};
            const open = h('button', { type: 'button', class: 'bare row-link', 'aria-haspopup': 'dialog', 'data-key': `cap-${c.id}`, onclick: (e) => { e.stopPropagation(); openDrawer({ kind: 'capability', id: c.id }, e.currentTarget); } }, c.name || c.id);
            return h('tr', { class: 'is-link', onclick: () => open.click() },
              h('td', {}, h('div', { class: 'row', style: 'gap:6px 10px' }, open, capBadge(c), c.halted ? haltedBadge() : null)),
              ev.adopted
                ? h('td', { class: 'mark', colspan: '2' }, h('span', { class: 'status ok' }, icon('check'), t('board.baseline')))
                : [h('td', { class: 'mark' }, h('span', { class: 'cell-label' }, t('board.red')), markNode(ev.red)), h('td', { class: 'mark' }, h('span', { class: 'cell-label' }, t('board.green')), markNode(ev.green))],
              h('td', { class: 'mark' }, h('span', { class: 'cell-label' }, t('board.review')), c.review ? passNode(c.review.spec === 'pass' && c.review.quality === 'pass' ? 'pass' : 'findings') : h('span', { class: 'status off' }, icon('dash'), h('span', { class: 'sr-only' }, t('common.no')))));
          })))));
      }
      const evals = arr(s.evals);
      out.push(h('section', { class: 'card' }, h('h2', { class: 'card-title' }, t('board.evals')),
        evals.length ? h('ul', { class: 'evals' }, evals.map((e) => h('li', {}, h('a', { class: 'link ext', href: `api/eval?path=${encodeURIComponent(e.file)}`, target: '_blank', rel: 'noopener' }, h('bdi', { dir: 'ltr' }, e.file), icon('ext'))))) : h('p', { class: 'empty' }, t('common.empty'))));
      return out;
    }

    // ---- stage closes
    function closesPanel(d) {
      const nums = new Set(Object.keys(d.closes).map(Number));
      for (const [n, v] of Object.entries(d.st.stages || {})) if (v && v.halted) nums.add(Number(n));
      const list = [...nums].filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      if (!list.length) return h('p', { class: 'empty' }, t('board.noClose'));
      return h('div', { class: 'accordion' }, list.map((n) => {
        const c = closeOf(d, n);
        const stv = (d.st.stages || {})[n] || {};
        const status = c ? c.status : (stv.halted ? 'blocked' : stv.status || 'not_started');
        const stuck = isStuck(status) || Boolean(stv.halted);
        if (!ui.seenCloses.has(n)) { ui.seenCloses.add(n); if (stuck) ui.openCloses.add(n); }
        const open = ui.openCloses.has(n);
        const def = d.defs.find((x) => x.n === n);
        const item = h('div', { class: `acc${stuck ? ' tone-bad' : ''}${open ? ' is-open' : ''}` });
        const btn = h('button', { type: 'button', class: 'bare acc-head', id: `close-btn-${n}`, 'aria-expanded': open ? 'true' : 'false', 'aria-controls': `close-panel-${n}`, 'data-key': `close-${n}`, onclick: () => {
          const now = !item.classList.contains('is-open');
          item.classList.toggle('is-open', now);
          btn.setAttribute('aria-expanded', now ? 'true' : 'false');
          if (now) ui.openCloses.add(n); else ui.openCloses.delete(n);
        } }, h('span', { class: 'acc-num' }, String(n)), h('span', { class: 'acc-name' }, def ? def.name : t('board.stageN', { n })), statusBadge(status), stv.halted ? haltedBadge() : null, icon('chevD', 'acc-chev'));
        const body = h('div', { class: 'acc-body' },
          c && c.note ? h('p', {}, c.note) : null,
          stv.halted ? h('p', {}, t('board.haltedNote')) : null,
          arr(stv.openFindings).length ? h('div', {}, h('strong', {}, t('board.openFindings')), findings(stv.openFindings)) : null,
          c && c.at ? h('p', { class: 'when' }, fmtDate(c.at)) : null);
        item.append(h('h3', {}, btn), h('div', { class: 'acc-panel', id: `close-panel-${n}`, role: 'region', 'aria-labelledby': `close-btn-${n}` }, h('div', { class: 'acc-inner' }, body)));
        return item;
      }));
    }

    // ---- technical details
    function techPanel(d) {
      const g = (s && s.git) || {};
      const git = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, t('board.git')),
        g.available
          ? [h('dl', { class: 'kv' }, h('dt', {}, t('board.branch')), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, g.branch || '-'))),
            h('p', { class: 'small' }, g.changed ? t('board.changedFiles', { n: g.changed }) : t('board.clean')),
            arr(g.files).length ? h('ul', { class: 'files mono' }, g.files.map((f) => h('li', {}, h('span', { class: 'st' }, String(f).slice(0, 2)), h('span', {}, String(f).slice(3))))) : null]
          : h('p', { class: 'empty' }, t('board.noGit')));
      const where = Object.entries(d.st.where || {}).filter(([, v]) => v);
      const whereCard = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, t('board.where')),
        where.length ? h('dl', { class: 'kv' }, where.map(([k, v]) => [h('dt', {}, h('bdi', { dir: 'ltr' }, WHERE_NAMES[k] || k)), h('dd', {}, h('bdi', { class: 'mono', dir: 'ltr' }, String(v)))])) : h('p', { class: 'empty' }, t('common.empty')));
      const conns = Object.entries(d.st.connections || {});
      const connCard = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, t('board.connections')),
        conns.length ? h('ul', { class: 'conns' }, conns.map(([k, v]) => h('li', {},
          h('bdi', { class: 'c-name', dir: 'ltr' }, CONNECTION_NAMES[k] || k),
          v && v.ok ? h('span', { class: 'status ok' }, icon('check'), t('board.connected')) : h('span', { class: 'status off' }, icon('x'), t('board.notConnected')),
          v && v.note ? h('p', { class: 'c-note' }, v.note) : null))) : h('p', { class: 'empty' }, t('common.empty')));
      const drift = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, t('board.drift')), h('p', {}, d.st.lastDriftCheck ? fmtDate(d.st.lastDriftCheck) : t('common.never')));
      return h('div', { class: 'cols-2' }, h('div', { class: 'col' }, git, whereCard), h('div', { class: 'col' }, connCard, drift));
    }

    const BUILD = { overview: overviewPanel, rulings: rulingsPanel, changes: changesPanel, capabilities: capabilitiesPanel, closes: closesPanel, tech: techPanel };

    // ---- drawers on the board: modal, with a backdrop; they follow the data on every refresh
    function personaName(d, id) {
      if (!id) return '';
      const named = s.personas && s.personas[id];
      if (named) return named;
      const role = d.map.roles.find((r) => id === r.id || String(id).startsWith(`${r.id}-`));
      return role && role.name ? role.name : String(id);
    }
    function drawerSpec(spec, d = derive()) {
      const { map } = d;
      if (spec.kind === 'ruling') {
        const r = d.rulings.find((x) => x.id === spec.id);
        if (!r) return null;
        return { kicker: r.stage != null ? `${t('drawer.ruling')} · ${t('board.stageN', { n: r.stage })}` : t('drawer.ruling'), title: r.decision, body: [section(t('board.rulingsCols.why'), r.why), section(t('board.rulingsCols.price'), r.priceIfWrong)] };
      }
      if (spec.kind === 'question') {
        const q = arr(s.pendingQuestions).find((x) => x.id === spec.id) || (arr(d.st.pending).map(String).includes(spec.id) ? { id: spec.id } : null);
        if (!q) return null;
        return { kicker: q.block || t('board.pending'), title: q.text || q.id, body: [h('p', {}, h('span', { class: 'badge warn' }, icon('help'), t('questionnaire.status.pending'))), section(t('questionnaire.whyLabel'), q.why)] };
      }
      if (spec.kind === 'capability') {
        const c = map.capabilities.find((x) => x.id === spec.id);
        if (!c) return null;
        const ev = c.evidence || {};
        return {
          kicker: t('drawer.capability'),
          title: c.name || c.id,
          body: [
            h('div', { class: 'row', style: 'gap:8px' }, capBadge(c), c.halted ? haltedBadge() : null),
            h('section', { class: 'd-sec' }, h('h3', {}, t('board.evidence')), ev.adopted ? h('p', {}, t('board.baseline')) : h('dl', { class: 'kv' }, h('dt', {}, t('board.red')), h('dd', {}, markNode(ev.red)), h('dt', {}, t('board.green')), h('dd', {}, markNode(ev.green)))),
            c.review ? h('section', { class: 'd-sec' }, h('h3', {}, t('board.review')), h('dl', { class: 'kv' }, h('dt', {}, t('board.reviewSpec')), h('dd', {}, passNode(c.review.spec)), h('dt', {}, t('board.reviewQuality')), h('dd', {}, passNode(c.review.quality)))) : null,
            c.halted ? h('p', { class: 'note' }, t('board.haltedNote')) : null,
            arr(c.openFindings).length ? h('section', { class: 'd-sec' }, h('h3', {}, t('board.openFindings')), findings(c.openFindings)) : null,
          ],
        };
      }
      if (spec.kind === 'list' && spec.id === 'screens' && map.screens.length) {
        const exists = s.screenFiles || {};
        return {
          title: t('board.screensList'),
          body: h('ul', { class: 'd-list' }, map.screens.map((sc) => h('li', {},
            h('div', { class: 'd-main' }, h('span', { class: 'd-name' }, sc.name || sc.file),
              sc.persona ? h('span', { class: 'd-sub' }, personaName(d, sc.persona)) : null,
              sc.journeyStage ? h('span', { class: 'd-sub' }, sc.journeyStage) : null),
            sc.file && exists[sc.file] !== false ? h('a', { class: 'link ext', href: `api/file?path=${encodeURIComponent(sc.file)}`, target: '_blank', rel: 'noopener' }, t('board.open'), icon('ext')) : null))),
        };
      }
      if (spec.kind === 'list' && spec.id === 'capabilities' && map.capabilities.length) {
        return { title: t('board.capabilitiesLabel'), body: h('ul', { class: 'd-list' }, map.capabilities.map((c) => h('li', {}, h('div', { class: 'd-main' }, h('span', { class: 'd-name' }, c.name || c.id)), h('div', { class: 'row', style: 'gap:6px' }, capBadge(c), c.halted ? haltedBadge() : null)))) };
      }
      if (spec.kind === 'list' && spec.id === 'tables' && map.tables.length) {
        return { title: t('board.tables'), body: h('ul', { class: 'd-list' }, map.tables.map((x) => h('li', {}, h('div', { class: 'd-main' }, h('bdi', { class: 'd-name mono', dir: 'ltr' }, x.name || ''), x.migration ? h('bdi', { class: 'd-sub mono', dir: 'ltr' }, x.migration) : null)))) };
      }
      if (spec.kind === 'list' && spec.id === 'automations' && map.automations.length) {
        return { title: t('board.automations'), body: h('ul', { class: 'd-list' }, map.automations.map((x) => h('li', {}, h('div', { class: 'd-main' }, h('bdi', { class: 'd-name' }, x.name || x.id || ''), x.name && x.id ? h('bdi', { class: 'd-sub mono', dir: 'ltr' }, x.id) : null)))) };
      }
      return null;
    }
    const openerKey = (spec) => ({ ruling: `ruling-${spec.id}`, question: `wait-q-${spec.id}`, capability: `cap-${spec.id}`, list: `tile-${spec.id}` })[spec.kind];
    function openDrawer(spec, from) {
      const content = drawerSpec(spec);
      if (!content) return;
      ui.drawer = spec;
      drawer.open({ ...content, opener: from, key: `${spec.kind}:${spec.id}`, onClose: () => { if (ui.drawer === spec) ui.drawer = null; } });
    }

    // ---- one full draw; a refresh keeps the tab, the filters, the open rows, the drawer and the scroll
    function render() {
      const d = derive();
      const y = window.scrollY;
      const active = document.activeElement;
      const keepFocus = active && root.contains(active) && active.dataset ? active.dataset.key : null;
      const popWas = popover.isOpen() ? ui.popStage : null;
      const focusInPop = Boolean(popover.element && popover.element.contains(active));
      const stripX = els.list ? els.list.scrollLeft : 0;
      if (popover.isOpen()) popover.close({ returnFocus: false, instant: true });
      els = { tabs: {}, panels: {}, ink: null, wrap: null, list: null };
      const tabs = tabsNode(d);
      const panels = h('div', {}, TABS.map((id) => {
        els.panels[id] = h('section', { class: 'tabpanel', role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, tabindex: '0', hidden: id !== ui.tab });
        return els.panels[id];
      }));
      clear(root);
      root.append(h('div', { class: 'board' }, headNode(d), tabs, panels, h('p', { class: 'board-foot' }, t('board.readOnly'))));
      for (const id of TABS) fillPanel(id, d);
      runAfterShow(ui.tab);
      positionInk();
      if (first) showTab('auto');
      else els.list.scrollLeft = stripX;
      updateFades();
      if (!first) window.scrollTo(0, y);
      if (keepFocus) focusKey(keepFocus);
      if (popWas != null) { const chip = byKey(root, `chip-${popWas}`); if (chip) toggleStagePop(popWas, chip, { animate: false, focus: focusInPop }); }
      if (drawer.isOpen() && ui.drawer) {
        const content = drawerSpec(ui.drawer, d);
        if (content) { drawer.update(content); drawer.setOpener(byKey(root, openerKey(ui.drawer))); }
        else { ui.drawer = null; drawer.close({ returnFocus: false }); els.panels[ui.tab].focus({ preventScroll: true }); }
      }
      first = false;
    }

    async function load() {
      let fresh;
      try { fresh = await api('api/state'); } catch { if (!s) { clear(root); root.append(h('p', { class: 'note' }, t('common.loadFailed'))); } return; }
      const json = JSON.stringify(fresh);
      if (json === lastJson) return;
      lastJson = json; s = fresh;
      bar.update(s);
      render();
    }

    window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (TABS.includes(id) && els.tabs[id]) selectTab(id); });
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { positionInk(); updateFades(); runAfterShow(ui.tab); }, 120); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { positionInk(); updateFades(); runAfterShow(ui.tab); });
    await load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
    window.addEventListener('pagehide', () => clearInterval(timer));
  }

  // ---------------------------------------------------------------- process map
  const KIND_COLORS = { system: ['#e3f4ea', '#18794e'], human: ['#fff1d6', '#b86e00'], ai: ['#efe9ff', '#5b3fd6'], external: ['#e4f0fd', '#1d62b8'], rejection: ['#fdecea', '#b42318'] };
  const SRC_COLORS = { client: ['#5b3fd6', '#ffffff', '#5b3fd6'], ours: ['#ffffff', '#3d27a3', '#5b3fd6'], assumed: ['#fff4e0', '#8a4b00', '#b86e00'] };

  async function processPage() {
    const root = $('#process');
    const tip = $('#tip');
    const svgMod = await import(base + 'process-svg.mjs');
    let map;
    try { map = await api('api/map'); } catch { clear(root); root.append(h('p', { class: 'note' }, t('common.loadFailed'))); return; }
    const labels = { kinds: strings.he.process.kinds, src: strings.he.process.src, srcLetter: strings.he.process.srcLetter, actors: strings.he.process.actors, timers: t('process.timers'), failure: t('process.failure'), noSteps: t('process.noSteps') };
    const procs = map.processes || [];
    const wanted = params.get('p');

    const back = (to, text) => h('a', { class: 'link', href: to }, text);
    const frameSvg = (svg) => { const d = h('div', {}); d.innerHTML = svg; return d.firstChild; };

    // one tooltip for every source bubble, on hover and on keyboard focus
    function showTip(el) {
      tip.textContent = el.getAttribute('data-tip') || '';
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      tip.style.top = `${Math.max(8, r.bottom + 8)}px`;
      tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
    }
    const hideTip = () => { tip.hidden = true; };
    root.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
    root.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
    root.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
    root.addEventListener('focusout', hideTip);
    window.addEventListener('scroll', hideTip, true);

    const legend = () => h('div', { class: 'legend', 'aria-label': t('process.legend') },
      Object.keys(KIND_COLORS).map((k) => h('span', { class: 'sw' }, h('i', { style: `background:${KIND_COLORS[k][0]};border-color:${KIND_COLORS[k][1]}` }), t(`process.kinds.${k}`))),
      h('span', { class: 'sep', 'aria-hidden': 'true' }),
      Object.keys(SRC_COLORS).map((k) => h('span', { class: 'sw' }, h('i', { class: 'round', style: `background:${SRC_COLORS[k][0]};color:${SRC_COLORS[k][1]};border-color:${SRC_COLORS[k][2]}${k === 'assumed' ? ';border-style:dashed' : ''}` }, t(`process.srcLetter.${k}`)), t(`process.src.${k}`))));

    function listView() {
      clear(root);
      root.append(h('header', { class: 'proc-head' }, h('h1', {}, t('process.title')), back('board', t('process.back'))));
      if (!procs.length) { root.append(h('p', { class: 'note' }, t('process.empty'))); return; }
      root.append(legend());
      root.append(h('div', { class: 'proc-grid' }, procs.map((p) => {
        const st = svgMod.processStats(map, p.id);
        const mini = h('div', { class: 'mini', 'aria-hidden': 'true' });
        mini.innerHTML = svgMod.processSvg(map, p.id, { mini: true });
        return h('a', { class: 'card proc-card', href: `process?p=${encodeURIComponent(p.id)}` }, mini, h('h2', {}, p.name || p.id), h('p', { class: 'muted small' }, t('process.stats', { steps: st.steps, stages: st.stages })));
      })));
    }

    const fileLink = (rel) => (rel ? h('a', { class: 'link', href: `api/file?path=${encodeURIComponent(rel)}`, target: '_blank', rel: 'noopener' }, h('bdi', { dir: 'ltr' }, rel)) : null);
    const stageName = (p, id) => { const st = (p.stages || []).find((x) => x.id === id); return st ? (st.name || st.id) : (id || ''); };
    const filled = (v) => !(v == null || v === '' || (Array.isArray(v) && !v.length));
    // an empty field is left out
    const fieldList = (rows) => h('dl', { class: 'fields' }, rows.filter(([, v]) => filled(v)).map(([k, v]) => h('div', { class: 'f' }, h('dt', {}, t(`process.detail.${k}`)), h('dd', {}, v))));
    const caseWord = (k) => (has(`process.caseKinds.${k}`) ? t(`process.caseKinds.${k}`) : String(k || ''));
    function stepRows(p, s) {
      const srcText = s.src ? `${labels.src[s.src] || s.src}${s.source ? `: ${s.source}` : ''}` : (s.source || '');
      return [['level', labels.kinds[s.kind] || s.kind], ['stage', stageName(p, s.stage)], ['source', srcText], ['failure', s.onFailure], ['screen', fileLink(s.screen)],
        ['capability', s.capability], ['tables', (s.tables || []).join(', ')], ['permission', s.permission], ['test', fileLink(s.test)]];
    }

    // The clock chips on a stage header are sized by an estimate of the text width. With Heebo a
    // label can come out wider and end in an ellipsis: widen such a chip toward the left, and move
    // the chips after it on the same header by the same amount.
    function fitClockChips(frame) {
      let shift = 0; let prevLeft = null;
      for (const g of frame.querySelectorAll('.bp-timer')) {
        const pill = g.querySelector('.bp-pill'); const fo = g.querySelector('foreignObject');
        const box = fo && fo.firstElementChild; const text = box && box.firstElementChild;
        if (!pill || !text || Number(pill.getAttribute('height')) !== 28) continue;
        // always from the drawn geometry, so a second pass (after the font loads) starts clean
        if (!g.dataset.x0) Object.assign(g.dataset, { x0: pill.getAttribute('x'), w0: pill.getAttribute('width'), fx0: fo.getAttribute('x'), fw0: fo.getAttribute('width') });
        const x = Number(g.dataset.x0); const w = Number(g.dataset.w0); const fw = Number(g.dataset.fw0);
        if (prevLeft === null || Math.abs(x + w - (prevLeft - 8)) > 0.6) shift = 0;
        prevLeft = x;
        const keep = text.getAttribute('style');
        text.style.display = 'inline-block'; text.style.whiteSpace = 'nowrap'; text.style.maxWidth = 'none'; text.style.webkitLineClamp = 'unset';
        const need = Math.max(0, text.offsetWidth + 2 - fw);
        text.setAttribute('style', keep);
        pill.setAttribute('x', String(x - need)); pill.setAttribute('width', String(w + need));
        fo.setAttribute('x', String(Number(g.dataset.fx0) - need)); fo.setAttribute('width', String(fw + need));
        box.style.width = `${fw + need}px`; text.style.maxWidth = `${fw + need}px`;
        const hit = g.querySelector('.bp-hit');
        if (hit) { hit.setAttribute('x', String(x - need)); hit.setAttribute('width', String(w + need)); }
        if (shift) g.setAttribute('transform', `translate(${-shift} 0)`); else g.removeAttribute('transform');
        shift += need;
      }
    }

    function oneView(p) {
      drawer.close({ returnFocus: false, instant: true });
      clear(root);
      const st = svgMod.processStats(map, p.id);
      const steps = p.steps || [];
      const switcher = procs.length > 1
        ? selectNode({ key: 'proc-switch', label: t('process.switch'), value: p.id, options: procs.map((x) => [x.id, x.name || x.id]), onchange: (v) => { location.href = `process?p=${encodeURIComponent(v)}`; } })
        : null;
      root.append(h('header', { class: 'proc-head' },
        h('div', {}, h('h1', {}, p.name || p.id), h('p', { class: 'muted small' }, t('process.stats', { steps: st.steps, stages: st.stages }))),
        h('div', { class: 'row' }, switcher, procs.length > 1 ? back('process', t('process.all')) : null, back('board', t('process.back')))));
      root.append(legend());
      const frame = h('div', { class: 'proc-frame', tabindex: '0', role: 'region', 'aria-label': p.name || p.id });
      frame.append(frameSvg(svgMod.processSvg(map, p.id, { labels, interactive: true })));
      const fitBtn = h('button', { type: 'button', 'aria-pressed': 'false' }, t('process.fit'));
      const fullBtn = h('button', { type: 'button', 'aria-pressed': 'true' }, t('process.full'));
      const setFit = (on) => { frame.classList.toggle('is-fit', on); fitBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); fullBtn.setAttribute('aria-pressed', on ? 'false' : 'true'); };
      fitBtn.addEventListener('click', () => setFit(true));
      fullBtn.addEventListener('click', () => setFit(false));
      root.append(h('div', { class: 'frame-box' }, h('div', { class: 'frame-bar' }, h('div', { class: 'seg' }, fitBtn, fullBtn)), frame));
      fitClockChips(frame);
      if (document.fonts) {
        document.fonts.ready.then(() => fitClockChips(frame));
        document.fonts.addEventListener('loadingdone', () => fitClockChips(frame));
      }
      // a clock chip is short: an invisible strip makes it at least 44px tall to tap
      frame.querySelectorAll('.bp-timer[role=button]').forEach((g) => {
        const b = g.getBBox();
        if (b.height >= 44) return;
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [k, v] of Object.entries({ x: b.x, y: b.y - (44 - b.height) / 2, width: b.width, height: 44, fill: 'transparent', class: 'bp-hit' })) hit.setAttribute(k, String(v));
        g.prepend(hit);
      });

      // ---- the drawer: docked on the left, no backdrop, the map stays in view
      function markCurrent(el) {
        frame.querySelectorAll('.bp-card.is-current, [role=button][aria-expanded="true"]').forEach((x) => { x.classList.remove('is-current'); x.setAttribute('aria-expanded', 'false'); });
        if (el) { el.classList.add('is-current'); el.setAttribute('aria-expanded', 'true'); }
      }
      // brings a card into view, clear of the drawer
      function reveal(el) {
        const behavior = motionOK() ? 'smooth' : 'auto';
        const r = el.getBoundingClientRect(); const fr = frame.getBoundingClientRect();
        // the drawer's resting size: it may still be sliding in
        const dw = drawer.element ? drawer.element.offsetWidth : 0; const dh = drawer.element ? drawer.element.offsetHeight : 0;
        const sheet = dw >= document.documentElement.clientWidth - 1;
        const leftEdge = Math.max(fr.left, sheet ? 0 : dw) + 16;
        const rightEdge = fr.right - 16;
        let dx = 0;
        if (r.left < leftEdge) dx = r.left - leftEdge;
        else if (r.right > rightEdge) dx = r.right - rightEdge;
        if (dx) frame.scrollBy({ left: dx, behavior });
        const top = 56 + 16; const bottom = window.innerHeight - (sheet ? dh : 0) - 16;
        let dy = 0;
        if (r.top < top) dy = r.top - top;
        else if (r.bottom > bottom) dy = Math.min(r.top - top, r.bottom - bottom);
        if (dy) window.scrollBy({ top: dy, behavior });
      }
      function show(spec, opener, mark) {
        if (drawer.isOpen()) drawer.update({ ...spec, opener, swap: true });
        else drawer.open({ ...spec, modal: false, opener, onClose: () => markCurrent(null) });
        markCurrent(mark);
        if (mark) reveal(mark);
      }
      // the steps in the process's order
      let cur = -1;
      const prevBtn = h('button', { type: 'button', class: 'quiet', 'data-key': 'prev', onclick: () => showStep(cur - 1) }, icon('chevR'), t('drawer.prev'));
      const nextBtn = h('button', { type: 'button', class: 'quiet', 'data-key': 'next', onclick: () => showStep(cur + 1) }, t('drawer.next'), icon('chevL'));
      function showStep(i) {
        const s = steps[i];
        if (!s) return;
        cur = i;
        const el = frame.querySelector(`.bp-card[data-step="${CSS.escape(s.id)}"]`);
        const had = document.activeElement;
        prevBtn.disabled = i <= 0;
        nextBtn.disabled = i >= steps.length - 1;
        show({ kicker: `${t('drawer.step')} · ${svgMod.actorLabel(map, s.actor, labels)}`, title: s.text || t('process.detail.title'), body: fieldList(stepRows(p, s)), footer: [prevBtn, nextBtn] }, el, el);
        if ((had === prevBtn || had === nextBtn) && had.disabled) (had === prevBtn ? nextBtn : prevBtn).focus({ preventScroll: true });
      }
      function showTimer(tm, el) {
        show({ kicker: t('drawer.timer'), title: [svgMod.durationHe(tm.duration), tm.text].filter(Boolean).join(': '), body: fieldList([['stage', stageName(p, tm.stage)], ['failure', tm.onExpire], ['test', fileLink(tm.test)]]) }, el, el);
      }
      const hit = (e) => (e.target.closest ? e.target.closest('.bp-card[role=button], .bp-timer[role=button]') : null);
      const openFor = (el) => {
        if (el.classList.contains('bp-card')) { const i = steps.findIndex((x) => x.id === el.getAttribute('data-step')); if (i >= 0) showStep(i); }
        else { const tm = (p.timers || []).find((x) => (x.id || '') === el.getAttribute('data-timer')); if (tm) showTimer(tm, el); }
      };
      frame.addEventListener('click', (e) => { const el = hit(e); if (el) openFor(el); });
      frame.addEventListener('keydown', (e) => { if (e.target.closest && e.target.closest('.bp-bub')) return; const el = hit(e); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openFor(el); } });

      const timers = p.timers || [];
      if (timers.length) {
        root.append(h('section', { class: 'dim' }, h('h2', {}, t('process.timers')), h('div', {}, timers.map((tm) => h('div', { class: 'timer-row' },
          h('span', { class: 'badge warn' }, svgMod.durationHe(tm.duration)), h('span', {}, tm.text), tm.onExpire ? h('span', { class: 'muted small' }, `${t('process.onExpire')}: ${tm.onExpire}`) : null)))));
      }
      const cases = p.cases || [];
      const openCase = (c, from) => show({ kicker: `${t('drawer.case')} · ${caseWord(c.kind)}`, title: c.text, body: c.eval ? fieldList([['test', fileLink(c.eval)]]) : h('p', {}, h('span', { class: 'badge neutral' }, t('process.noTest'))) }, from, null);
      root.append(h('section', { class: 'dim' }, h('h2', {}, t('process.cases')), cases.length ? h('div', { class: 'proc-list' }, cases.map((c) => {
        const btn = h('button', { type: 'button', class: 'bare case-text', 'aria-haspopup': 'dialog', onclick: (e) => { e.stopPropagation(); openCase(c, e.currentTarget); } }, c.text);
        return h('div', { class: 'case-row', onclick: (e) => { if (!e.target.closest('a')) btn.click(); } },
          h('span', { class: `badge ${c.kind === 'happy' ? 'ok' : c.kind === 'rejection' ? 'bad' : 'warn'}` }, caseWord(c.kind)),
          btn,
          c.eval ? h('a', { class: 'link small', href: `api/eval?path=${encodeURIComponent(c.eval)}`, target: '_blank', rel: 'noopener' }, t('process.evalLink')) : h('span', { class: 'badge neutral' }, t('process.noTest')));
      })) : h('p', { class: 'muted small' }, t('process.noCases'))));
    }

    if (wanted) {
      const p = procs.find((x) => x.id === wanted);
      if (p) return oneView(p);
      listView();
      root.prepend(h('p', { class: 'note' }, t('process.notFound')));
      return;
    }
    if (procs.length === 1) return oneView(procs[0]);
    listView();
  }

  // ---------------------------------------------------------------- start
  const registry = Object.create(null);
  function register(name, fn) { registry[name] = fn; }
  register('brain-dump', brainDump);
  register('questionnaire', questionnaire);
  register('board', board);
  register('process', processPage);

  window.BP = { h, t, api, register, drawer, popover, icon, clear, $, params, base, indicator, autosaver, md: renderMd, bar, motionOK, selectNode };

  let started = false;
  async function start() {
    if (started) return;
    started = true;
    await loadStrings();
    fillStatic();
    const page = document.body.dataset.page;
    bar.build(page);
    if (page !== 'board') api('api/state').then((st) => bar.update(st), () => {});
    try { if (registry[page]) await registry[page](); }
    catch (e) { const m = $('#fatal'); if (m) { m.hidden = false; m.textContent = t('common.loadFailed'); } console.error(e); }
  }
  if (document.readyState === 'complete') setTimeout(start, 0);
  else { document.addEventListener('DOMContentLoaded', start, { once: true }); window.addEventListener('load', start, { once: true }); }
})();
