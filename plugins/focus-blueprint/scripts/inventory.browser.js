() => {
  const DESTRUCTIVE = /(^|\s)(מחק|מחיקה|הסר|הסרה|בטל הכל|נקה|delete|remove|clear all)(\s|$)/i;
  const PAYMENT = /תשלום|לתשלום|\bpay/i;
  const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || null;
  const textOf = (el) => clean(el.innerText || el.value || el.getAttribute('aria-label') || '');
  const inDialog = (el) => !!el.closest('dialog');

  // links to other mockup pages (relative hrefs only)
  const links = [...new Set([...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => h && !/^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(h)))];

  // actions: buttons, submit inputs, role=button, and links marked as primary or confirm
  const actions = [...document.querySelectorAll('button, input[type=submit], [role=button], a[data-primary], a[data-confirm]')]
    .filter((el) => !inDialog(el))
    .map((el) => {
      const text = textOf(el);
      const isLink = el.tagName === 'A';
      const submit = !isLink && (el.type === 'submit') && !!el.form;
      return {
        text,
        type: isLink ? 'link' : submit ? 'submit' : 'button',
        destructive: DESTRUCTIVE.test(text),
        primary: el.hasAttribute('data-primary'),
        confirm: el.getAttribute('data-confirm') || null,
      };
    });

  // forms and their fields
  const forms = [...document.querySelectorAll('form')].map((f, i) => ({
    id: f.id || f.getAttribute('name') || `form-${i + 1}`,
    fields: [...f.querySelectorAll('input, select, textarea')]
      .filter((e) => !['hidden', 'submit', 'button', 'reset', 'image'].includes(e.type))
      .map((e) => ({
        name: e.name || e.id || null,
        label: clean([...(e.labels || [])].map((l) => l.textContent).join(' ') || e.getAttribute('aria-label') || ''),
        type: e.tagName === 'INPUT' ? e.type : e.tagName.toLowerCase(),
        required: e.required,
      })),
  }));

  // data items from [data-field], entity from the nearest [data-entity]
  const dataItems = [...document.querySelectorAll('[data-field]')].map((el) => ({
    entity: el.closest('[data-entity]')?.getAttribute('data-entity') || null,
    field: el.getAttribute('data-field'),
    sample: clean(el.value !== undefined && el.value !== '' ? el.value : el.textContent),
  }));

  // lists: repeated rows inside [data-entity] containers
  const lists = [];
  for (const c of document.querySelectorAll('[data-entity]')) {
    const rows = [...c.querySelectorAll('li, tbody > tr, [data-row]')].filter((r) => r.closest('[data-entity]') === c && !r.closest('thead'));
    if (rows.length >= 2) lists.push({ entity: c.getAttribute('data-entity'), rows: rows.length });
  }

  // externals
  const externals = [];
  for (const el of document.querySelectorAll('iframe, video, input[type=file], [data-map]')) {
    if (el.tagName === 'IFRAME') {
      const src = el.getAttribute('src') || '';
      const kind = /maps|openstreetmap/i.test(src) ? 'map' : /youtube|vimeo/i.test(src) ? 'video' : 'iframe';
      externals.push({ kind, detail: clean(el.getAttribute('title') || src) });
    } else if (el.tagName === 'VIDEO') externals.push({ kind: 'video', detail: clean(el.getAttribute('src') || el.getAttribute('title') || 'video') });
    else if (el.type === 'file') externals.push({ kind: 'upload', detail: clean(el.name || el.getAttribute('accept') || 'file') });
    else externals.push({ kind: 'map', detail: clean(el.getAttribute('data-map') || el.textContent) });
  }
  const payEls = new Set(document.querySelectorAll('[data-payment]'));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || /^(SCRIPT|STYLE)$/.test(p.tagName) || inDialog(p) || !PAYMENT.test(n.textContent)) continue;
    payEls.add(p.closest('[data-payment]') || p);
  }
  for (const el of payEls) externals.push({ kind: 'payment', detail: textOf(el) || clean(el.getAttribute('data-payment')) });

  return { url: location.href, screen: meta('blueprint:screen'), persona: meta('blueprint:persona'), links, actions, forms, dataItems, lists, externals };
} /* inventory: v1 */
