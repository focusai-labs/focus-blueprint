// Focus Blueprint: the prototype review page. Vanilla JS, no external script.
// The page embeds mockup/prototype.html (files/mockup/prototype.html?embed=1) and talks to it only
// through postMessage: it receives { bp: 'ready', screens } and { bp: 'route', file, state },
// and sends { bp: 'nav', file, state? } and { bp: 'device', value: 'phone' | 'computer' }.
// Notes and approval go to api/prototype-note, the end of the round to api/prototype-done.
(() => {
  'use strict';
  const { h, t, api, register, indicator, autosaver, icon, $ } = window.BP;

  const PROTOTYPE_URL = 'files/mockup/prototype.html?embed=1';
  const roundUrl = (n) => `api/prototype-round?n=${encodeURIComponent(n)}&embed=1`;
  const wide = window.matchMedia ? window.matchMedia('(min-width: 900px)') : { matches: true, addEventListener() {} };

  const STATUS = {
    approved: { cls: 'ok', icon: 'check', text: 'prototype.approved' },
    note: { cls: 'warn', icon: 'dot', text: 'prototype.hasNote' },
    open: { cls: 'neutral', icon: null, text: 'prototype.open' },
  };
  const chip = (status) => {
    const s = STATUS[status] || STATUS.open;
    return h('span', { class: `badge ${s.cls}` }, s.icon ? icon(s.icon) : null, t(s.text));
  };
  const post = (frame, msg) => { try { frame.contentWindow.postMessage(msg, '*'); } catch { /* the frame is gone */ } };

  async function prototypePage() {
    const state = await api('api/prototype');
    const roundEl = $('#round');
    roundEl.textContent = t('prototype.round', { n: state.round });
    roundEl.hidden = false;
    if (!state.exists) { $('#missing').hidden = false; return; }

    const setSave = indicator($('#save'));
    const data = {};
    for (const [file, s] of Object.entries(state.screens || {})) data[file] = { status: s.status, note: typeof s.note === 'string' ? s.note : '' };
    const entry = (file) => data[file] || { status: 'open', note: '' };
    const prev = state.previousRound && state.previousRound.snapshot ? state.previousRound : null;
    let screens = [];
    let current = null;
    let routeState = null;
    let device = wide.matches ? 'computer' : 'phone';
    let locked = state.done === true;
    let comparing = false;
    let prevFrame = null;

    // ---------------------------------------------------------------- the stage: the prototype, large
    const mainFrame = h('iframe', { class: 'proto-frame', sandbox: 'allow-scripts', title: t('prototype.after'), 'data-key': 'frame-main' });
    const prevHolder = h('div', { class: 'pane pane-before', hidden: true });
    const panes = h('div', { class: 'panes', 'data-compare': 'false' },
      prevHolder,
      h('div', { class: 'pane pane-after' }, h('p', { class: 'pane-cap', 'aria-hidden': 'true' }, t('prototype.after')), mainFrame));

    const deviceBtns = ['phone', 'computer'].map((v) => h('button', { type: 'button', 'aria-pressed': 'false', 'data-key': `device-${v}`, onclick: () => setDevice(v) }, t(v === 'phone' ? 'directions.phone' : 'directions.desktop')));
    function setDevice(v) {
      device = v;
      deviceBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['phone', 'computer'][i] === v)));
      post(mainFrame, { bp: 'device', value: v });
      if (prevFrame) post(prevFrame, { bp: 'device', value: v });
    }
    const prevBtn = prev ? h('button', { type: 'button', class: 'quiet', 'data-key': 'previous-toggle', onclick: () => toggleCompare() }, t('prototype.showPrevious')) : null;
    function toggleCompare() {
      comparing = !comparing;
      prevBtn.textContent = t(comparing ? 'prototype.hidePrevious' : 'prototype.showPrevious');
      panes.dataset.compare = String(comparing);
      prevHolder.hidden = !comparing;
      if (comparing && !prevFrame) {
        prevFrame = h('iframe', { class: 'proto-frame', sandbox: 'allow-scripts', title: t('prototype.before'), 'data-key': 'frame-previous', src: roundUrl(prev.n) });
        prevHolder.append(h('p', { class: 'pane-cap', 'aria-hidden': 'true' }, t('prototype.before')), prevFrame);
      }
    }
    const stage = h('section', { class: 'proto-stage' }, h('div', { class: 'proto-tools' }, h('div', { class: 'seg', role: 'group' }, deviceBtns), prevBtn), panes);

    // ---------------------------------------------------------------- the panel: the list, the current screen, the end
    const listEl = h('ul', { class: 'plain proto-list', 'data-key': 'screen-list' });
    const nameEl = h('h3', { class: 'proto-cur-name' });
    const note = h('textarea', { id: 'proto-note', rows: 4 });
    const approve = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', 'data-key': 'approve', onclick: () => { const e = entry(current); setEntry(current, { approved: e.status !== 'approved' }); } }, icon('check'), t('prototype.approve'));
    const prevNoteHead = h('h4', { class: 'proto-prev-head' }, t('prototype.previousNote'));
    const prevNoteText = h('p', { class: 'quote', 'data-key': 'previous-note' });
    const prevNoteBox = h('div', { class: 'proto-prev', hidden: true }, prevNoteHead, prevNoteText);
    const curBox = h('section', { class: 'proto-cur', hidden: true, 'aria-labelledby': 'proto-cur-title' },
      nameEl, h('div', { class: 'proto-note-field' }, h('label', { for: 'proto-note' }, t('prototype.noteLabel')), note), approve, prevNoteBox);
    nameEl.id = 'proto-cur-title';
    const doneBtn = h('button', { type: 'button', class: 'primary', 'data-key': 'done', onclick: finish }, t('prototype.done'));
    const doneNote = h('p', { class: 'proto-done', role: 'status', hidden: true }, t('prototype.doneNote'));

    const sheetName = h('span', { class: 'sheet-name' });
    const sheetChip = h('span', { class: 'sheet-chip' });
    const sheetBtn = h('button', { type: 'button', class: 'bare sheet-btn', 'aria-expanded': 'false', 'aria-controls': 'proto-panel-body', 'data-key': 'sheet-toggle', onclick: () => setSheet(sheetBtn.getAttribute('aria-expanded') !== 'true') }, sheetName, sheetChip, icon('chevD'));
    const panelBody = h('div', { class: 'panel-body', id: 'proto-panel-body' },
      h('h2', { class: 'panel-title' }, t('prototype.screens')), listEl, curBox, h('div', { class: 'panel-foot' }, doneBtn, doneNote));
    const panel = h('aside', { class: 'proto-panel', 'data-open': 'false', 'aria-label': t('prototype.screens') }, sheetBtn, panelBody);
    function setSheet(open) {
      sheetBtn.setAttribute('aria-expanded', String(open));
      panel.dataset.open = String(open);
    }
    wide.addEventListener('change', () => setSheet(false));

    $('#body').append(stage, panel);
    $('#body').hidden = false;
    setDevice(device);

    // ---------------------------------------------------------------- saving
    const failed = new Set();
    const savers = new Map();
    function saverFor(file) {
      if (!savers.has(file)) {
        savers.set(file, autosaver(async () => {
          const e = entry(file);
          try { await api('api/prototype-note', { file, note: e.note, approved: e.status === 'approved' }); failed.delete(file); } catch (err) { failed.add(file); throw err; }
        }, setSave));
      }
      return savers.get(file);
    }
    function setEntry(file, patch) {
      if (!file || locked) return;
      const e = entry(file);
      const noteText = 'note' in patch ? patch.note : e.note;
      const approved = 'approved' in patch ? patch.approved : e.status === 'approved';
      data[file] = { note: noteText, status: approved ? 'approved' : noteText.trim() ? 'note' : 'open' };
      paintCurrent(false);
      paintList();
      saverFor(file).push(1);
    }
    note.addEventListener('input', () => setEntry(current, { note: note.value }));

    // ---------------------------------------------------------------- painting
    function paintList() {
      listEl.replaceChildren(...screens.map((s) => h('li', {},
        h('button', { type: 'button', class: 'bare proto-row', 'data-file': s.file, 'aria-current': s.file === current ? 'true' : null, onclick: () => go(s.file) },
          h('span', { class: 'proto-row-name' }, s.name || s.file), chip(entry(s.file).status)))));
      const cur = screens.find((s) => s.file === current);
      sheetName.textContent = cur ? (cur.name || cur.file) : t('prototype.screens');
      sheetChip.replaceChildren(cur ? chip(entry(current).status) : '');
    }
    function paintCurrent(full) {
      const cur = screens.find((s) => s.file === current);
      curBox.hidden = !cur;
      if (!cur) return;
      const e = entry(current);
      nameEl.textContent = cur.name || cur.file;
      if (full) note.value = e.note;
      approve.setAttribute('aria-pressed', String(e.status === 'approved'));
      const before = prev && prev.screens && prev.screens[current];
      const text = before && typeof before.note === 'string' ? before.note.trim() : '';
      prevNoteBox.hidden = !text;
      prevNoteText.textContent = text;
    }
    function lock() {
      locked = true;
      note.disabled = true;
      approve.disabled = true;
      doneBtn.disabled = true;
      doneNote.hidden = false;
    }

    // ---------------------------------------------------------------- the conversation with the prototype
    function go(file) {
      post(mainFrame, { bp: 'nav', file });
      if (file !== current) { current = file; paintList(); paintCurrent(true); }
    }
    window.addEventListener('message', (ev) => {
      const fromMain = ev.source === mainFrame.contentWindow;
      const fromPrev = Boolean(prevFrame) && ev.source === prevFrame.contentWindow;
      const m = ev.data;
      if (!(fromMain || fromPrev) || !m || typeof m !== 'object') return;
      if (m.bp === 'ready') {
        if (fromMain) {
          screens = (Array.isArray(m.screens) ? m.screens : []).filter((s) => s && typeof s.file === 'string' && s.built !== false);
          paintList();
          paintCurrent(true);
        } else {
          post(prevFrame, { bp: 'device', value: device });
          if (current) post(prevFrame, { bp: 'nav', file: current, state: routeState || undefined });
        }
      } else if (m.bp === 'route' && typeof m.file === 'string') {
        const changed = m.file !== current || (m.state || null) !== routeState;
        current = m.file;
        routeState = m.state || null;
        if (changed) {
          const other = fromMain ? prevFrame : mainFrame;
          if (other) post(other, { bp: 'nav', file: m.file, state: routeState || undefined });
          paintList();
          paintCurrent(true);
        }
      }
    });
    mainFrame.src = PROTOTYPE_URL;

    // ---------------------------------------------------------------- the end of the round
    async function finish() {
      doneBtn.disabled = true;
      await Promise.all([...savers.values()].map((s) => s.flush()));
      if (failed.size) { setSave('failed'); doneBtn.disabled = false; return; }
      try {
        await api('api/prototype-done', {});
        lock();
        setSave('saved');
      } catch { setSave('failed'); doneBtn.disabled = false; }
    }
    if (locked) lock();
  }

  register('prototype', prototypePage);
})();
