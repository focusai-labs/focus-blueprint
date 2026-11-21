// Focus Blueprint local pages: shared helpers and the four page scripts.
// No framework, no external script. Texts come from strings.he.json by key.
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
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

  /** The "נשמר" indicator. */
  function indicator(el) {
    return (state) => {
      el.className = `save ${state}`;
      el.textContent = state === 'saved' ? `✓ ${t('common.saved')}` : state === 'saving' ? t('common.saving') : state === 'failed' ? t('common.saveFailed') : '';
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

  async function questionnaire() {
    const round = params.get('round') || 'a';
    const qs = new URLSearchParams({ round });
    if (params.get('screens')) qs.set('screens', params.get('screens'));
    const setState = indicator($('#save'));
    const root = $('#stage');
    $('#round-title').textContent = t(`questionnaire.rounds.${round}`);
    let data = await api(`api/questions?${qs}`);
    let list = data.questions;
    let idx = 0;
    let finished = false;

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
      $('#progress-text').textContent = finished ? '' : t('questionnaire.progress', { i: Math.min(idx + 1, list.length), n: list.length });
    }

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
      const all = opts.map((o) => ({ v: o.v, t: o.t }));
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
        box.append(h('label', { class: `choice${o.other ? ' other-field' : ''}` }, input, h('span', {}, o.t), o.other ? otherInput : null));
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
        const nextBtn = h('button', { type: 'button', class: pre ? '' : 'primary', onclick: go(1) }, t('common.next'));
        const confirmBtn = pre ? h('button', { type: 'button', class: 'primary', onclick: async () => { await save(q, { confirm: true }); q.answer = { ...q.answer, confirmed: true, decidedBy: 'user' }; drawPrefill(); drawActions(); updateProgress(); } }, t('questionnaire.confirm')) : null;
        const side = h('div', { class: 'row' },
          q.decideButton !== false ? h('button', { type: 'button', class: 'quiet', onclick: async () => { await save(q, { decidedBy: 'claude' }); q.answer = { value: null, decidedBy: 'claude' }; markNote(); drawPrefill(); drawActions(); updateProgress(); } }, t('questionnaire.decideForMe')) : null,
          h('button', { type: 'button', class: 'quiet', onclick: async () => { await save(q, { value: null, pending: true }); q.answer = { value: null, pending: true }; markNote(); drawPrefill(); drawActions(); updateProgress(); } }, t('questionnaire.dontKnow')));
        const nav = h('div', { class: 'row spread' },
          h('button', { type: 'button', class: 'quiet', disabled: idx === 0, onclick: go(-1) }, t('common.back')),
          h('div', { class: 'row' }, confirmBtn, nextBtn));
        actions.append(side, nav);
      };
      const ed = editor(q, (v) => {
        q.answer = { value: v, decidedBy: 'user' };
        markNote(); drawPrefill(); drawActions(); updateProgress();
      });
      const go = (d) => async () => {
        await ed.flush();
        await refetch().catch(() => {});
        idx += d;
        if (idx >= list.length) { idx = list.length; finished = true; renderEnd(); } else { idx = Math.max(0, idx); finished = false; renderQuestion(); }
        updateProgress();
      };
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
      const pre = list.filter((q) => isPrefill(q.answer));
      if (list.length === 0) { root.append(h('p', {}, t('questionnaire.noQuestions'))); return; }
      root.append(h('h2', {}, t('questionnaire.finishTitle')));
      if (pre.length) {
        root.append(h('p', {}, t('questionnaire.unconfirmedTitle')));
        const ul = h('ul', { class: 'plain' });
        pre.forEach((q) => ul.append(h('li', {}, h('button', { type: 'button', class: 'quiet', onclick: () => { idx = list.indexOf(q); finished = false; renderQuestion(); updateProgress(); } }, q.text))));
        root.append(ul);
      } else {
        root.append(h('p', { class: 'muted' }, t('questionnaire.finishAllAnswered')));
        root.append(h('div', { class: 'row spread' },
          h('button', { type: 'button', class: 'quiet', onclick: () => { idx = list.length - 1; finished = false; renderQuestion(); updateProgress(); } }, t('common.back')),
          h('button', { type: 'button', class: 'primary', id: 'round-done', onclick: async () => {
            try { await api('api/done', { name: data.name }); clear(root); root.append(h('p', { class: 'note' }, t('common.backToClaude'))); }
            catch (e) { if (e.status === 409) { await refetch(); renderEnd(); } else setState('failed'); }
          } }, t('questionnaire.roundDone'))));
      }
      if (pre.length) root.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'quiet', onclick: () => { idx = list.length - 1; finished = false; renderQuestion(); updateProgress(); } }, t('common.back'))));
    }

    if (data.done) { root.append(h('p', { class: 'note' }, t('common.backToClaude'))); }
    if (list.length === 0) root.append(h('p', {}, t('questionnaire.noQuestions')));
    else { renderQuestion(); updateProgress(); }
  }

  // ---------------------------------------------------------------- catalog
  const CATALOG_IDS = { visual: 'b-03', nav: 'b-04', density: 'b-05', structure: 'b-06', login: 'b-07' };
  async function catalog() {
    const setState = indicator($('#save'));
    const root = $('#dims');
    const [cat, saved] = await Promise.all([api('api/catalog'), api('api/answers?name=round-b').catch(() => ({ answers: {} }))]);
    const chosen = {};
    for (const [dim, id] of Object.entries(CATALOG_IDS)) { const a = saved.answers && saved.answers[id]; if (a && typeof a.value === 'string') chosen[dim] = a.value; }
    const dims = ['visual', 'nav', 'structure', 'login', 'density'];
    if (dims.every((d) => !(cat[d] || []).length)) { root.append(h('p', {}, t('catalog.empty'))); return; }
    const render = () => {
      clear(root);
      for (const dim of dims) {
        const items = cat[dim] || [];
        if (!items.length) continue;
        const cards = h('div', { class: 'cards' });
        items.forEach((o) => {
          const on = chosen[dim] === o.id;
          const frame = h('iframe', { title: `${t('catalog.exampleTitle')}: ${o.name_he}`, sandbox: '', tabindex: '-1' });
          frame.srcdoc = o.html || '';
          cards.append(h('div', { class: `card opt${on ? ' chosen' : ''}` },
            frame,
            h('div', { class: 'body' },
              h('h3', {}, o.name_he, ' ', h('span', { class: 'en', lang: 'en' }, o.term_en)),
              o.fits ? h('p', { class: 'small' }, h('strong', {}, `${t('catalog.fits')}: `), o.fits) : null,
              o.less ? h('p', { class: 'small muted' }, h('strong', {}, `${t('catalog.less')}: `), o.less) : null,
              h('button', { type: 'button', class: on ? 'primary' : '', 'aria-pressed': on ? 'true' : 'false', onclick: async () => {
                chosen[dim] = o.id; render();
                try { await api('api/answer', { name: 'round-b', id: CATALOG_IDS[dim], value: o.id }); setState('saved'); } catch { setState('failed'); }
              } }, on ? `✓ ${t('catalog.chosen')}` : t('catalog.choose')))));
        });
        root.append(h('section', { class: 'dim' }, h('h2', {}, t(`catalog.dimensions.${dim}`)), cards));
      }
    };
    render();
  }

  // ---------------------------------------------------------------- board
  const STATUS_TONE = { done: 'ok', done_with_concerns: 'warn', blocked: 'bad', needs_context: 'bad', in_progress: '', not_started: '' };
  const statusWord = (s) => t(`board.statuses.${s}`) === `board.statuses.${s}` ? s : t(`board.statuses.${s}`);

  async function board() {
    const root = $('#board');
    let timer = null;
    async function load() {
      let s;
      try { s = await api('api/state'); } catch { clear(root); root.append(h('p', { class: 'note' }, t('common.loadFailed'))); return; }
      draw(s);
    }
    const card = (title, ...kids) => h('section', { class: 'card' }, h('h3', {}, title), ...kids);
    const kv = (k, v) => h('p', { class: 'small' }, h('span', { class: 'muted' }, `${k}: `), v);
    const list = (items, empty) => (items.length ? h('ul', { class: 'plain small' }, items.map((x) => h('li', {}, x))) : h('p', { class: 'muted small' }, empty || t('common.empty')));

    function draw(s) {
      const st = s.state || {};
      const map = s.map || { capabilities: [], screens: [], tables: [], automations: [], later: [] };
      const defs = s.stagesDef || [];
      clear(root);
      root.append(h('header', { class: 'top' }, h('h1', {}, st.project || t('board.title')), h('p', { class: 'muted small' }, t('board.readOnly'))));

      // chapters and stages
      const chapters = [];
      defs.forEach((d) => { let c = chapters.find((x) => x.name === d.chapter); if (!c) { c = { name: d.chapter, stages: [] }; chapters.push(c); } c.stages.push(d); });
      const curDef = defs.find((d) => d.n === st.stage);
      root.append(h('div', { class: 'chapters', 'aria-label': t('board.stagesProgress') }, chapters.map((c, i) => {
        const here = c.stages.some((d) => d.n === st.stage);
        return h('div', { class: `chapter${here ? ' current' : ''}`, 'aria-current': here ? 'step' : null },
          h('strong', {}, `${i + 1}. ${c.name}`),
          h('div', { class: 'stagechips' }, c.stages.map((d) => {
            const closed = s.closes && s.closes[d.n] && ['done', 'done_with_concerns'].includes(s.closes[d.n].status);
            return h('span', { class: `chip${d.n === st.stage ? ' now' : closed ? ' done' : ''}`, title: d.name }, String(d.n));
          })));
      })));

      const grid = h('div', { class: 'grid' });
      grid.append(card(t('board.currentStage'),
        h('p', {}, h('strong', {}, curDef ? `${t('board.rulingsCols.stage')} ${st.stage}: ${curDef.name}` : `${t('board.rulingsCols.stage')} ${st.stage}`), ' ', h('span', { class: `badge ${STATUS_TONE[st.status] || ''}` }, statusWord(st.status))),
        kv(t('board.nextStep'), curDef ? curDef.name : ''),
        kv(t('board.drift'), st.lastDriftCheck || t('common.never'))));
      grid.append(card(t('board.lastSummary'), s.lastSession ? h('pre', { class: 'summary' }, s.lastSession.trim().split(/\r?\n/).slice(0, 12).join('\n')) : h('p', { class: 'muted small' }, t('common.empty'))));
      const real = map.capabilities.filter((c) => c.status === 'real').length;
      grid.append(card(t('board.decisions'),
        kv(t('board.rulings'), String((s.rulings || []).length)),
        kv(t('board.pending'), `${(st.pending || []).length}${(st.pending || []).length ? ` (${st.pending.join(', ')})` : ''}`)));
      grid.append(card(t('board.map'),
        kv(t('board.capabilities', { real, total: map.capabilities.length }), `${map.capabilities.length - real} ${t('board.mock')}`),
        kv(t('board.screens'), String(map.screens.length)), kv(t('board.tables'), String(map.tables.length)), kv(t('board.automations'), String(map.automations.length))));
      grid.append(card(t('board.later'), list((map.later || []).map((l) => l.text))));
      grid.append(card(t('board.changes'), list((s.changes || []).slice(-8).reverse().map((c) => `${c.text} (${c.decision})`), t('board.noChanges'))));
      grid.append(card(t('board.evals'), list((s.evals || []).map((e) => e.file))));
      const g = s.git || {};
      grid.append(card(t('board.git'), g.available ? [kv(t('board.branch'), h('bdi', { dir: 'ltr' }, g.branch || '-')), h('p', { class: 'small' }, g.changed ? t('board.changedFiles', { n: g.changed }) : t('board.clean'))] : h('p', { class: 'muted small' }, t('board.noGit'))));
      grid.append(card(t('board.where'), list(Object.entries(st.where || {}).filter(([, v]) => v).map(([k, v]) => h('span', {}, `${k}: `, h('bdi', { dir: 'ltr' }, v))))));
      grid.append(card(t('board.connections'), list(Object.entries(st.connections || {}).map(([k, v]) => `${v && v.ok ? '✓' : '✗'} ${k}`))));
      grid.append(card(t('board.limits'), h('p', { class: 'muted small' }, t('board.limitsNote'))));
      root.append(grid);

      // close line per stage
      const closes = Object.entries(s.closes || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
      root.append(h('section', { class: 'dim' }, h('h2', {}, t('board.close')), closes.length ? closes.map(([n, c]) => {
        const def = defs.find((d) => String(d.n) === n);
        return h('div', { class: `stage-close ${c.status}` }, h('strong', {}, `${t('board.rulingsCols.stage')} ${n}${def ? `: ${def.name}` : ''}`), ' ', h('span', { class: `badge ${STATUS_TONE[c.status] || ''}` }, statusWord(c.status)), c.note ? h('p', { class: 'small' }, c.note) : null);
      }) : h('p', { class: 'muted small' }, t('board.noClose'))));

      // rulings
      const rulings = [...(s.rulings || [])].reverse();
      const rc = ['decision', 'why', 'price', 'stage', 'reported'];
      root.append(h('section', { class: 'dim' }, h('h2', {}, t('board.rulings')), rulings.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, rc.map((c) => h('th', { scope: 'col' }, t(`board.rulingsCols.${c}`))))),
        h('tbody', {}, rulings.map((r) => h('tr', {}, h('td', {}, r.decision), h('td', {}, r.why), h('td', {}, r.priceIfWrong), h('td', {}, String(r.stage ?? '')), h('td', {}, r.reported ? '✓' : h('span', { class: 'badge warn' }, t('board.newRuling')))))))) : h('p', { class: 'muted small' }, t('board.noRulings'))));

      // evidence per capability
      root.append(h('section', { class: 'dim' }, h('h2', {}, t('board.evidence')), map.capabilities.length ? map.capabilities.map((c) => {
        const ev = c.evidence || {};
        const mark = (e) => (e && e.path ? `✓ (${e.exit === 0 ? 'exit 0' : `exit ${e.exit}`})` : '—');
        const rv = c.review;
        return h('div', { class: `card${c.halted ? ' halted' : ''}` },
          h('h3', {}, c.name || c.id, ' ', h('span', { class: `badge ${c.status === 'real' ? 'ok' : ''}` }, c.status === 'real' ? t('board.real') : t('board.mock')), c.halted ? [' ', h('span', { class: 'badge bad' }, `⛔ ${t('board.halted')}`)] : null),
          ev.adopted ? h('p', { class: 'small' }, `✓ ${t('board.baseline')}`) : h('div', {}, kv(t('board.red'), mark(ev.red)), kv(t('board.green'), mark(ev.green))),
          rv ? h('p', { class: 'small' }, `${t('board.review')}: ${t('board.reviewSpec')} ${t(rv.spec === 'pass' ? 'board.pass' : 'board.findings')}, ${t('board.reviewQuality')} ${t(rv.quality === 'pass' ? 'board.pass' : 'board.findings')}`) : null,
          c.halted ? h('p', { class: 'small' }, t('board.haltedNote')) : null,
          (c.openFindings || []).length ? h('div', {}, h('strong', { class: 'small' }, `${t('board.openFindings')}:`), list(c.openFindings)) : null);
      }) : h('p', { class: 'muted small' }, t('board.capabilitiesEmpty'))));

      // halted stages
      Object.entries(st.stages || {}).filter(([, v]) => v && v.halted).forEach(([n, v]) => {
        root.append(h('div', { class: 'card halted' }, h('h3', {}, `⛔ ${t('board.halted')}: ${t('board.rulingsCols.stage')} ${n}`), h('p', { class: 'small' }, t('board.haltedNote')), list(v.openFindings || [])));
      });
    }
    await load();
    timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
    window.addEventListener('pagehide', () => clearInterval(timer));
  }

  // ---------------------------------------------------------------- start
  const pages = { 'brain-dump': brainDump, questionnaire, catalog, board };
  (async () => {
    await loadStrings();
    fillStatic();
    try { await pages[document.body.dataset.page](); }
    catch (e) { const m = $('#fatal'); if (m) { m.hidden = false; m.textContent = t('common.loadFailed'); } console.error(e); }
  })();
})();
