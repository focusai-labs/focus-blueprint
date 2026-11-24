// Draws one process of the map as an SVG: stages in columns (the first stage on the
// right), actors in rows, one card per step, arrows along `next`. Pure and isomorphic:
// no imports, no DOM, so the same file runs in the browser and in Node.

export const KIND_STYLE = {
  system: { fill: '#e3f4ea', stroke: '#18794e', ink: '#0f5132' },
  human: { fill: '#fff1d6', stroke: '#b86e00', ink: '#6b3f00' },
  ai: { fill: '#efe9ff', stroke: '#5b3fd6', ink: '#3d27a3' },
  external: { fill: '#e4f0fd', stroke: '#1d62b8', ink: '#0f3f7a' },
  rejection: { fill: '#fdecea', stroke: '#b42318', ink: '#7a1a12' },
};
export const KINDS = Object.keys(KIND_STYLE);

export const DEFAULT_LABELS = {
  kinds: { system: 'אוטומטי', human: 'אדם', ai: 'בינה מלאכותית', external: 'גורם חיצוני', rejection: 'דחייה' },
  src: { client: 'הלקוח', ours: 'אנחנו', assumed: 'הנחה' },
  srcLetter: { client: 'ל', ours: 'א', assumed: '?' },
  actors: { screen: 'מסך', server: 'שרת', automation: 'אוטומציה', ai: 'בינה מלאכותית', external: 'חיצוני' },
  stages: 'שלבים',
  timers: 'שעונים',
  failure: 'אם נכשל',
  noSteps: 'אין עדיין צעדים',
};

const SRC_STYLE = {
  client: { fill: '#5b3fd6', ink: '#ffffff', stroke: '#5b3fd6', dash: '' },
  ours: { fill: '#ffffff', ink: '#3d27a3', stroke: '#5b3fd6', dash: '' },
  assumed: { fill: '#fff4e0', ink: '#8a4b00', stroke: '#b86e00', dash: '3 2' },
};
const FONT = 'Heebo, "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif';
const INK = '#1d1a2b';
const MUTED = '#5a5570';
const LINE = '#d9d4ea';
const RED = '#b42318';

const arr = (x) => (Array.isArray(x) ? x : []);
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(n * 10) / 10;

/** Rough text width in px: good enough to wrap Hebrew without a DOM. */
function measure(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    if (ch === ' ') w += 0.3;
    else if (/[֐-׿]/.test(ch)) w += 0.52;
    else if (/[A-Z0-9]/.test(ch)) w += 0.62;
    else if (/[a-z]/.test(ch)) w += 0.54;
    else if (/[.,:;'"!|()\-]/.test(ch)) w += 0.3;
    else w += 0.6;
  }
  return w * size;
}

/** Wraps to at most maxLines lines of maxW px; the last line ends with an ellipsis when cut. */
export function wrap(text, maxW, size, maxLines) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  const fit = (s) => measure(s, size) <= maxW;
  for (let w of words) {
    while (!fit(w) && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && !fit(w.slice(0, cut))) cut--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (fit(next)) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = `${keep[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
    while (last.length > 1 && !fit(`${last}…`)) last = last.slice(0, -1);
    keep[maxLines - 1] = `${last.replace(/\s+$/, '')}…`;
    return keep;
  }
  return lines;
}

export function durationHe(iso) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(iso || ''));
  if (!m || !iso) return String(iso || '');
  const unit = [['שנים', 'שנה'], ['חודשים', 'חודש'], ['שבועות', 'שבוע'], ['ימים', 'יום'], ['שעות', 'שעה'], ['דקות', 'דקה']];
  const out = [];
  m.slice(1).forEach((v, i) => { if (v) out.push(Number(v) === 1 ? unit[i][1] : `${Number(v)} ${unit[i][0]}`); });
  return out.length ? out.join(' ו-') : String(iso);
}

export function actorLabel(map, a, labels = DEFAULT_LABELS) {
  if (typeof a !== 'string') return String(a ?? '');
  if (a.startsWith('role:')) { const r = arr(map.roles).find((x) => x.id === a.slice(5)); return r && r.name ? r.name : a.slice(5); }
  if (a.startsWith('external:')) return `${labels.actors.external}: ${a.slice(9)}`;
  return labels.actors[a] || a;
}

/** The numbers the page shows next to a process. */
export function processStats(map, processId) {
  const p = arr(map && map.processes).find((x) => x.id === processId);
  if (!p) return null;
  return { steps: arr(p.steps).length, stages: arr(p.stages).length, timers: arr(p.timers).length, cases: arr(p.cases).length };
}

function dims(mini) {
  return mini
    ? { cardW: 26, cardH: 14, failH: 0, colW: 44, labelW: 0, headH: 0, rowPad: 8, vgap: 6, pad: 6, fontSize: 0 }
    : { cardW: 196, cardH: 86, failH: 34, colW: 252, labelW: 128, headH: 68, rowPad: 14, vgap: 14, pad: 14, fontSize: 13 };
}

/**
 * processSvg(map, processId, opts) -> SVG string.
 * opts: { labels, mini, sources } (sources: false leaves the source bubbles out). labels overrides DEFAULT_LABELS (deep merge on its groups).
 */
export function processSvg(map, processId, opts = {}) {
  const labels = { ...DEFAULT_LABELS, ...(opts.labels || {}) };
  for (const g of ['kinds', 'src', 'srcLetter', 'actors']) labels[g] = { ...DEFAULT_LABELS[g], ...((opts.labels || {})[g] || {}) };
  const mini = Boolean(opts.mini);
  const D = dims(mini);
  const p = arr(map && map.processes).find((x) => x.id === processId);
  if (!p) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10" role="img"></svg>`;

  const steps = arr(p.steps);
  // stages: declared order, then any stage a step names that is not declared
  const stages = arr(p.stages).map((s) => ({ id: s.id, name: s.name || s.id }));
  for (const s of steps) if (s.stage && !stages.some((x) => x.id === s.stage)) stages.push({ id: s.stage, name: s.stage });
  if (!stages.length) stages.push({ id: '', name: '' });
  const stageIdx = (id) => { const i = stages.findIndex((x) => x.id === (id || '')); return i < 0 ? 0 : i; };
  // actors: declared order, then the ones steps use
  const actors = [...arr(p.actors)];
  for (const s of steps) if (s.actor && !actors.includes(s.actor)) actors.push(s.actor);
  if (!actors.length) actors.push('');
  const actorIdx = (a) => { const i = actors.indexOf(a || ''); return i < 0 ? 0 : i; };

  const nStages = stages.length;
  const W = D.pad * 2 + D.labelW + nStages * D.colW;

  // cell contents and row heights
  const cells = new Map();
  for (const s of steps) {
    const key = `${actorIdx(s.actor)}:${stageIdx(s.stage)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(s);
  }
  const showFail = (s) => !mini && s.onFailure && s.kind !== 'human';
  const stepH = (s) => D.cardH + (showFail(s) ? D.failH + 12 : 0);
  const rowH = actors.map((_, r) => {
    let h = 0;
    for (let c = 0; c < nStages; c++) {
      const list = cells.get(`${r}:${c}`) || [];
      const sum = list.reduce((a, s) => a + stepH(s), 0) + Math.max(0, list.length - 1) * D.vgap;
      h = Math.max(h, sum);
    }
    return Math.max(h, mini ? D.cardH : D.cardH * 0.6) + D.rowPad * 2;
  });

  // timers: on their stage when they say which, else in a strip under the matrix
  const timers = arr(p.timers);
  const attached = timers.filter((t) => t.stage && stages.some((x) => x.id === t.stage));
  const loose = timers.filter((t) => !attached.includes(t));
  const hasBack = steps.some((s) => arr(s.next).some((n) => {
    const to = steps.find((x) => x.id === n);
    return to && stageIdx(to.stage) < stageIdx(s.stage);
  }));
  const backH = hasBack && !mini ? 34 : 0;
  const stripH = !mini && loose.length ? 52 : 0;
  const top = D.pad + D.headH + backH;
  const rowY = [];
  let y = top;
  for (const h of rowH) { rowY.push(y); y += h; }
  const matrixBottom = y;
  const H = matrixBottom + stripH + D.pad;

  const colRight = (c) => W - D.pad - D.labelW - c * D.colW; // right edge of column c
  const pos = new Map();
  for (const [key, list] of cells) {
    const [r, c] = key.split(':').map(Number);
    let cy = rowY[r] + D.rowPad;
    const cx = colRight(c) - (D.colW - D.cardW) / 2 - D.cardW;
    for (const s of list) {
      pos.set(s.id, { x: cx, y: cy, w: D.cardW, h: D.cardH, r, c, s });
      cy += stepH(s) + D.vgap;
    }
  }

  const out = [];
  const o = (s) => out.push(s);
  o(`<svg xmlns="http://www.w3.org/2000/svg" class="bp-svg" viewBox="0 0 ${num(W)} ${num(H)}" width="${num(W)}" height="${num(H)}" direction="rtl" role="img" aria-label="${esc(p.name || p.id)}" font-family='${FONT}'>`);
  o(`<defs>`);
  o(`<marker id="bp-arr-${esc(p.id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${mini ? 5 : 6.5}" markerHeight="${mini ? 5 : 6.5}" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${MUTED}"/></marker>`);
  o(`<marker id="bp-arrr-${esc(p.id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${mini ? 5 : 6.5}" markerHeight="${mini ? 5 : 6.5}" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${RED}"/></marker>`);
  o(`</defs>`);
  o(`<style>.bp-bub{cursor:help;outline:none}.bp-bub:focus .bp-ring{stroke-width:3;stroke:${INK}}</style>`);

  if (!mini) {
    // row bands and actor labels
    actors.forEach((a, r) => {
      const bandX = D.pad;
      o(`<rect x="${bandX}" y="${num(rowY[r])}" width="${num(W - D.pad * 2)}" height="${num(rowH[r])}" fill="${r % 2 ? '#ffffff' : '#f6f4fc'}" stroke="${LINE}"/>`);
      const lx = W - D.pad - D.labelW / 2;
      const lines = wrap(actorLabel(map, a, labels), D.labelW - 18, 14, 3);
      const ty = rowY[r] + rowH[r] / 2 - ((lines.length - 1) * 18) / 2 + 5;
      o(`<text x="${num(lx)}" y="${num(ty)}" text-anchor="middle" font-size="14" font-weight="600" fill="${INK}">${lines.map((l, i) => `<tspan x="${num(lx)}" dy="${i ? 18 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
    });
    // label column divider
    o(`<line x1="${num(W - D.pad - D.labelW)}" y1="${num(D.pad + D.headH)}" x2="${num(W - D.pad - D.labelW)}" y2="${num(matrixBottom)}" stroke="${LINE}"/>`);
    // stage headers
    stages.forEach((st, c) => {
      const right = colRight(c);
      const cx = right - D.colW / 2;
      o(`<line x1="${num(right - D.colW)}" y1="${num(D.pad + D.headH)}" x2="${num(right - D.colW)}" y2="${num(matrixBottom)}" stroke="${LINE}" stroke-dasharray="2 4"/>`);
      const mine = attached.filter((t) => t.stage === st.id);
      const title = wrap(st.name, D.colW - 70, 15, mine.length ? 1 : 2);
      o(`<g><circle cx="${num(right - 26)}" cy="${num(D.pad + 22)}" r="13" fill="#5b3fd6"/><text x="${num(right - 26)}" y="${num(D.pad + 27)}" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">${c + 1}</text>`);
      o(`<text x="${num(right - 48)}" y="${num(D.pad + 22 - ((title.length - 1) * 9) + 5)}" text-anchor="start" font-size="15" font-weight="700" fill="${INK}">${title.map((l, i) => `<tspan x="${num(right - 48)}" dy="${i ? 18 : 0}">${esc(l)}</tspan>`).join('')}</text></g>`);
      let cxr = right - 12;
      for (const t of mine) {
        const chip = clock(t, 0, D.pad + 36, labels, true, cxr);
        o(chip.svg);
        cxr -= chip.w + 8;
      }
    });
  }

  // arrows first, cards over them
  const edges = [];
  for (const [, a] of pos) {
    for (const n of arr(a.s.next)) {
      const b = pos.get(n);
      if (!b) continue;
      edges.push(edge(a, b, { mini, top: D.pad + D.headH + (backH ? 8 : 0), pid: esc(p.id) }));
    }
  }
  out.push(...edges);

  for (const [, a] of pos) o(card(a, labels, mini, D, esc(p.id), opts.sources !== false));

  if (!mini && loose.length) {
    const sy = matrixBottom + 10;
    o(`<text x="${num(W - D.pad - 4)}" y="${num(sy + 22)}" text-anchor="start" font-size="13" font-weight="600" fill="${MUTED}">${esc(labels.timers)}</text>`);
    let tx = W - D.pad - 70;
    for (const t of loose) { const chip = clock(t, 0, sy + 4, labels, false, tx); o(chip.svg); tx -= chip.w + 10; }
  }
  if (!steps.length) {
    o(`<text x="${num(W / 2)}" y="${num(top + 40)}" text-anchor="middle" font-size="15" fill="${MUTED}">${esc(labels.noSteps)}</text>`);
  }
  o('</svg>');
  return out.join('');
}

/** A clock badge. On a stage header it is a small chip; in the strip it carries its text. */
function clock(t, _cx, y, labels, onStage, x) {
  const dur = durationHe(t.duration);
  const full = [t.text, dur, t.onExpire].filter(Boolean).join(' - ');
  const label = onStage ? dur : wrap(`${dur}: ${t.text || ''}`, 300, 12.5, 1)[0];
  const w = Math.max(64, measure(label, 12.5) + 44);
  const left = x - w; // x is the right edge
  const yy = y;
  const svg = `<g class="bp-timer" role="img" aria-label="${esc(full)}"><title>${esc(full)}</title>`
    + `<rect x="${num(left)}" y="${num(yy)}" width="${num(w)}" height="28" rx="14" fill="#fff4e0" stroke="#b86e00"/>`
    + `<circle cx="${num(x - 17)}" cy="${num(yy + 14)}" r="8" fill="none" stroke="#8a4b00" stroke-width="1.6"/>`
    + `<path d="M${num(x - 17)} ${num(yy + 9.5)}V${num(yy + 14)}L${num(x - 13.5)} ${num(yy + 16)}" fill="none" stroke="#8a4b00" stroke-width="1.6" stroke-linecap="round"/>`
    + `<text x="${num(x - 32)}" y="${num(yy + 19)}" text-anchor="start" font-size="12.5" font-weight="600" fill="#6b3f00">${esc(label)}</text></g>`;
  return { svg, w };
}

function card(a, labels, mini, D, pid, sources) {
  const { s } = a;
  const st = KIND_STYLE[s.kind] || KIND_STYLE.system;
  const g = [];
  const full = [s.id, s.text, s.onFailure ? `${labels.failure}: ${s.onFailure}` : '', sources && s.source ? `${labels.src[s.src] || ''}: ${s.source}` : ''].filter(Boolean).join('\n');
  g.push(`<g class="bp-card" data-step="${esc(s.id)}" data-kind="${esc(s.kind || '')}"><title>${esc(full)}</title>`);
  g.push(`<rect x="${num(a.x)}" y="${num(a.y)}" width="${a.w}" height="${a.h}" rx="${mini ? 3 : 10}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${mini ? 1 : 1.6}"/>`);
  if (mini) { g.push('</g>'); return g.join(''); }
  const right = a.x + a.w;
  // kind label, top right, next to the source bubble
  const kindLabel = labels.kinds[s.kind] || s.kind || '';
  g.push(`<text x="${num(right - 12)}" y="${num(a.y + 19)}" text-anchor="start" font-size="11.5" font-weight="700" fill="${st.ink}">${esc(kindLabel)}</text>`);
  const lines = wrap(s.text, a.w - 24, 13, 3);
  g.push(`<text x="${num(right - 12)}" y="${num(a.y + 40)}" text-anchor="start" font-size="13" fill="${INK}">${lines.map((l, i) => `<tspan x="${num(right - 12)}" dy="${i ? 17 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
  // source bubble, top left
  if (s.src && SRC_STYLE[s.src] && sources) {
    const b = SRC_STYLE[s.src];
    const bx = a.x + 18; const by = a.y + 15;
    const tip = `${labels.src[s.src] || s.src}${s.source ? `: ${s.source}` : ''}`;
    g.push(`<g class="bp-bub" tabindex="0" role="img" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><title>${esc(tip)}</title>`
      + `<circle class="bp-ring" cx="${num(bx)}" cy="${num(by)}" r="11" fill="${b.fill}" stroke="${b.stroke}" stroke-width="1.6"${b.dash ? ` stroke-dasharray="${b.dash}"` : ''}/>`
      + `<text x="${num(bx)}" y="${num(by + 4.5)}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${b.ink}">${esc(labels.srcLetter[s.src] || '?')}</text></g>`);
  }
  // red side path
  if (s.onFailure && s.kind !== 'human') {
    const px = right - 132; const py = a.y + a.h + 12; const pw = 132; const ph = D.failH;
    g.push(`<path d="M${num(px + pw / 2)} ${num(a.y + a.h)}V${num(py)}" stroke="${RED}" stroke-width="1.6" stroke-dasharray="4 3" fill="none" marker-end="url(#bp-arrr-${pid})"/>`);
    const fl = wrap(s.onFailure, pw - 14, 11.5, 2);
    g.push(`<g class="bp-fail" role="img" aria-label="${esc(`${labels.failure}: ${s.onFailure}`)}"><title>${esc(`${labels.failure}: ${s.onFailure}`)}</title><rect x="${num(px)}" y="${num(py)}" width="${pw}" height="${ph}" rx="8" fill="#fdecea" stroke="${RED}" stroke-dasharray="4 3"/>`
      + `<text x="${num(px + pw - 8)}" y="${num(py + 14)}" text-anchor="start" font-size="11.5" fill="${RED}">${fl.map((l, i) => `<tspan x="${num(px + pw - 8)}" dy="${i ? 13 : 0}">${esc(l)}</tspan>`).join('')}</text></g>`);
  }
  g.push('</g>');
  return g.join('');
}

function edge(a, b, { mini, top, pid }) {
  const toRej = b.s.kind === 'rejection';
  const stroke = toRej ? RED : MUTED;
  const mk = toRej ? `bp-arrr-${pid}` : `bp-arr-${pid}`;
  const style = `fill="none" stroke="${stroke}" stroke-width="${mini ? 1 : 1.8}"${toRej ? ' stroke-dasharray="6 3"' : ''} marker-end="url(#${mk})"`;
  let d;
  if (a.c < b.c) {
    const x1 = a.x; const y1 = a.y + a.h / 2; const x2 = b.x + b.w + 1; const y2 = b.y + b.h / 2;
    const k = Math.max(20, (x1 - x2) / 2);
    d = `M${num(x1)} ${num(y1)}C${num(x1 - k)} ${num(y1)} ${num(x2 + k)} ${num(y2)} ${num(x2)} ${num(y2)}`;
  } else if (a.c === b.c && b.y > a.y) {
    const x = a.x + (mini ? 6 : 28);
    d = `M${num(x)} ${num(a.y + a.h)}V${num(b.y - 1)}`;
  } else if (a.c === b.c) {
    const x = a.x; const y1 = a.y + a.h / 2; const y2 = b.y + b.h / 2; const k = mini ? 8 : 26;
    d = `M${num(x)} ${num(y1)}C${num(x - k)} ${num(y1)} ${num(x - k)} ${num(y2)} ${num(x - 1)} ${num(y2)}`;
  } else {
    // back to an earlier stage: over the top of the matrix
    const x1 = a.x + a.w / 2; const x2 = b.x + b.w / 2; const up = Math.max(4, top - (mini ? 4 : 0));
    const y1 = a.y; const y2 = b.y;
    d = `M${num(x1)} ${num(y1)}C${num(x1)} ${num(up)} ${num(x2)} ${num(up)} ${num(x2)} ${num(y2 - 1)}`;
    return `<path class="bp-edge bp-back" d="${d}" fill="none" stroke="${stroke}" stroke-width="${mini ? 1 : 1.8}" stroke-dasharray="3 4" marker-end="url(#${mk})"/>`;
  }
  return `<path class="bp-edge" d="${d}" ${style}/>`;
}
