// Focus Blueprint: the three directions page. Vanilla JS, no external script.
// The page reads api/directions, shows each screen of each direction in a scaled
// frame, and saves one choice per screen through api/answer (name "directions").
(() => {
  'use strict';

  // ---- Helpers duplicated from ui.js (api, t, h). Delete this block when the page
  // ---- moves onto the shared app bar and uses window.BP's own helpers.
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
    try { strings = { he: await (await fetch(base + 'strings.he.json')).json() }; } catch { strings = { he: {} }; }
  }
  function t(key, vars) {
    const s = lookup(strings.he, key);
    if (typeof s !== 'string') return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
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
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  // ---- end of the duplicated helpers

  const DESIGN = { phone: { w: 390, h: 844 }, desktop: { w: 1280, h: 800 } };
  const NOTE_WAIT = 500;

  const screenUrl = (n, key) => `api/direction-screen?n=${encodeURIComponent(n)}&screen=${encodeURIComponent(key)}`;

  async function directionsPage() {
    const board = $('#board');
    const foot = $('#foot');
    const saveEl = $('#save');
    const setState = (state) => {
      saveEl.className = `save ${state}`;
      saveEl.textContent = state === 'saved' ? `✓ ${t('common.saved')}` : state === 'saving' ? t('common.saving') : state === 'failed' ? t('common.saveFailed') : '';
    };

    const [data, saved] = await Promise.all([api('api/directions'), api('api/answers?name=directions').catch(() => ({ answers: {} }))]);
    const dirs = data.directions || [];
    const screens = data.screens || [];
    if (!dirs.length || !screens.length) { board.append(h('p', {}, t('directions.empty'))); return; }

    const choices = {};
    for (const s of screens) {
      const a = saved.answers && saved.answers[`screen:${s.key}`];
      if (a && Number.isInteger(a.value) && dirs.some((d) => d.n === a.value && d.screens.some((x) => x.key === s.key))) choices[s.key] = a.value;
    }
    let override = null; // the switch: null means each screen row keeps its own device
    const rowMode = (s) => override || (s.device === 'desktop' ? 'desktop' : 'phone');
    const rows = new Map(); // key -> row element
    const cells = new Map(); // `${key}:${n}` -> { box, pick }

    // ---------------------------------------------------------------- the enlarged view
    const dlgTitle = h('h2', {});
    const dlgCap = h('p', { class: 'muted small' });
    const dlgFrame = h('iframe', { sandbox: 'allow-scripts', title: '' });
    const dlgClose = h('button', { type: 'button', class: 'quiet' }, t('directions.close'));
    const dlg = h('dialog', { class: 'big', 'aria-labelledby': 'big-title' },
      h('div', { class: 'big-head' }, h('div', {}, dlgTitle, dlgCap), dlgClose), h('div', { class: 'big-body' }, dlgFrame));
    dlgTitle.id = 'big-title';
    document.body.append(dlg);
    let opener = null;
    dlgClose.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { dlgFrame.removeAttribute('src'); if (opener && opener.isConnected) opener.focus(); });
    function enlarge(d, s, button) {
      opener = button;
      const w = DESIGN[rowMode(s)].w;
      dlg.style.setProperty('--bw', `${w + 32}px`);
      dlg.style.setProperty('--bwi', String(w));
      const name = d.name || t('directions.directionN', { n: d.n });
      dlgTitle.textContent = name;
      dlgCap.textContent = s.caption;
      dlgFrame.title = `${s.caption}, ${name}`;
      dlgFrame.src = base + screenUrl(d.n, s.key);
      dlg.showModal();
      dlgClose.focus();
    }

    // ---------------------------------------------------------------- the board
    board.append(h('div', { class: 'heads' },
      h('div', { class: 'spacer' }),
      dirs.map((d) => h('div', { class: 'head' },
        h('p', { class: 'dn' }, t('directions.directionN', { n: d.n })),
        h('h2', {}, d.name || t('directions.directionN', { n: d.n })),
        d.move ? h('p', {}, d.move) : null))));

    function pickDirection(key, n) {
      choices[key] = n;
      refresh();
      setState('saving');
      api('api/answer', { name: 'directions', id: `screen:${key}`, value: n }).then(() => setState('saved'), () => setState('failed'));
    }

    for (const s of screens) {
      const row = h('section', { class: 'shot-row', 'aria-labelledby': `cap-${s.key}` }, h('h3', { class: 'cap', id: `cap-${s.key}` }, s.caption));
      row.dataset.mode = rowMode(s);
      rows.set(s.key, row);
      for (const d of dirs) {
        const own = d.screens.find((x) => x.key === s.key);
        if (!own) { row.append(h('div', { class: 'cellbox' }, h('div', { class: 'shot none' }, '—'))); continue; }
        const label = `${s.caption}, ${d.name || t('directions.directionN', { n: d.n })}`;
        const frame = h('iframe', { sandbox: 'allow-scripts', title: label, tabindex: '-1', src: base + screenUrl(d.n, s.key) });
        const pick = h('button', { type: 'button', class: 'pick', 'aria-pressed': 'false', onclick: () => pickDirection(s.key, d.n) }, t('directions.choose'));
        const big = h('button', { type: 'button', class: 'quiet', onclick: (e) => enlarge(d, s, e.currentTarget) }, t('directions.enlarge'));
        const box = h('div', { class: 'cellbox', 'data-screen': s.key, 'data-n': String(d.n), 'data-chosen': 'false' },
          h('div', { class: 'shot' }, frame), h('div', { class: 'acts' }, pick, big));
        pick.setAttribute('aria-label', `${t('directions.choose')}: ${label}`);
        big.setAttribute('aria-label', `${t('directions.enlarge')}: ${label}`);
        cells.set(`${s.key}:${d.n}`, { box, pick });
        row.append(box);
      }
      board.append(row);
    }

    // ---------------------------------------------------------------- the footer
    const note = $('#note');
    const done = $('#done');
    const missingEl = $('#missing');
    const back = $('#back');
    note.value = (saved.answers && saved.answers.note && typeof saved.answers.note.value === 'string') ? saved.answers.note.value : '';
    let noteTimer = null;
    let noteDirty = false;
    async function flushNote() {
      clearTimeout(noteTimer);
      if (!noteDirty) return;
      noteDirty = false;
      try { await api('api/answer', { name: 'directions', id: 'note', value: note.value }); setState('saved'); } catch { noteDirty = true; setState('failed'); throw new Error('note not saved'); }
    }
    note.addEventListener('input', () => {
      noteDirty = true; setState('saving');
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { flushNote().catch(() => {}); }, NOTE_WAIT);
    });
    done.addEventListener('click', async () => {
      done.disabled = true;
      try {
        await flushNote();
        await api('api/done', { name: 'directions' });
        back.textContent = t('common.backToClaude');
        back.hidden = false;
        missingEl.textContent = '';
        setState('');
      } catch { setState('failed'); done.disabled = false; }
    });

    function refresh() {
      for (const [id, c] of cells) {
        const n = Number(id.split(':').pop());
        const key = id.slice(0, id.lastIndexOf(':'));
        const on = choices[key] === n;
        c.box.dataset.chosen = on ? 'true' : 'false';
        c.pick.setAttribute('aria-pressed', on ? 'true' : 'false');
        c.pick.textContent = on ? t('directions.chosen') : t('directions.choose');
      }
      const missing = screens.filter((s) => !Number.isInteger(choices[s.key]));
      done.disabled = missing.length > 0 || !back.hidden;
      missingEl.textContent = missing.length ? t('directions.missing', { screens: missing.map((s) => s.caption).join(', ') }) : '';
    }
    foot.hidden = false;
    refresh();

    // ---------------------------------------------------------------- phone or desktop, and the scale
    const modeEl = $('#mode');
    const MODES = ['phone', 'desktop'];
    const modeButtons = MODES.map((m) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setMode(override === m ? null : m) }, t(`directions.${m}`)));
    modeEl.append(...modeButtons);
    function fit() {
      for (const s of screens) {
        const row = rows.get(s.key);
        const probe = row && row.querySelector('.shot:not(.none)');
        if (!probe) continue;
        const width = probe.clientWidth;
        if (width > 0) row.style.setProperty('--s', String(Math.min(1, width / DESIGN[rowMode(s)].w)));
      }
    }
    function setMode(m) {
      override = m;
      board.dataset.mode = m || 'auto';
      for (const s of screens) rows.get(s.key).dataset.mode = rowMode(s);
      modeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(MODES[i] === m)));
      fit();
    }
    board.dataset.mode = 'auto';
    new ResizeObserver(fit).observe(board);
    fit();
  }

  // ---------------------------------------------------------------- start
  // After the move onto the shared app bar the page registers itself there instead.
  async function standalone() {
    await loadStrings();
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    document.title = t('directions.title');
    try { await directionsPage(); } catch (e) { const m = $('#fatal'); if (m) { m.hidden = false; m.textContent = t('common.loadFailed'); } console.error(e); }
  }
  if (window.BP && typeof window.BP.register === 'function') window.BP.register('directions', async () => { await loadStrings(); await directionsPage(); });
  else standalone();
})();
