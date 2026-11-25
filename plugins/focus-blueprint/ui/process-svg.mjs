// Draws one process of the map as an SVG: stages in columns (the first stage on the
// right), actors in rows, one card per step, arrows along `next`. Pure and isomorphic:
// no static imports, no DOM, so the same file runs in the browser and in Node.

export const KIND_STYLE = {
  system: { fill: '#e3f4ea', stroke: '#18794e', ink: '#0f5132' },
  human: { fill: '#fff1d6', stroke: '#b86e00', ink: '#6b3f00' },
  ai: { fill: '#efe9ff', stroke: '#5b3fd6', ink: '#3d27a3' },
  external: { fill: '#e4f0fd', stroke: '#1d62b8', ink: '#0f3f7a' },
  rejection: { fill: '#fdecea', stroke: '#b42318', ink: '#7a1a12' },
};
export const KINDS = Object.keys(KIND_STYLE);

// The process-map labels live in pages/strings.he.json (process.*), the one source. Node reads
// the file here (the review document is drawn without the page); the browser always passes the
// labels it already loaded, and falls back to the plain keys if it did not.
const SOURCE = (typeof process !== 'undefined' && process.versions && process.versions.node)
  ? JSON.parse((await import('node:fs')).readFileSync(new URL('./pages/strings.he.json', import.meta.url), 'utf8')).process || {}
  : {};
const group = (name, keys) => Object.fromEntries(keys.map((k) => [k, (SOURCE[name] || {})[k] ?? k]));
export const DEFAULT_LABELS = {
  kinds: group('kinds', ['system', 'human', 'ai', 'external', 'rejection']),
  src: group('src', ['client', 'ours', 'assumed']),
  srcLetter: group('srcLetter', ['client', 'ours', 'assumed']),
  actors: group('actors', ['screen', 'server', 'automation', 'ai', 'external']),
  timers: SOURCE.timers ?? 'timers',
  failure: SOURCE.failure ?? 'failure',
  noSteps: SOURCE.noSteps ?? 'noSteps',
};

const SRC_STYLE = {
  client: { fill: '#5b3fd6', ink: '#ffffff', stroke: '#5b3fd6', dash: '' },
  ours: { fill: '#ffffff', ink: '#3d27a3', stroke: '#5b3fd6', dash: '' },
  assumed: { fill: '#fff4e0', ink: '#8a4b00', stroke: '#b86e00', dash: '3 2' },
};
const FONT = 'Heebo, "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif';
const FONT_CSS = "Heebo, 'Segoe UI', Arial, 'Noto Sans Hebrew', sans-serif";
const XHTML = 'http://www.w3.org/1999/xhtml';
const INK = '#1d1a2b';
const MUTED = '#5a5570';
const LINE = '#d9d4ea';
const RED = '#b42318';

const arr = (x) => (Array.isArray(x) ? x : []);
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(n * 10) / 10;

/**
 * Multi-word Hebrew text goes through the browser's own line breaker: a foreignObject
 * holding an HTML div (dir=rtl), CSS wrapping, a fixed box and a line clamp. SVG <text>
 * cannot wrap, and the hand-made wrapping reversed lines and overlapped words.
 * Static SVG inside a rendered document still works, since it is plain markup.
 * opts: size, weight, color, lines (clamp), lh (line height), align, center (vertical), tip.
 */
function fo(x, y, w, h, text, opts = {}) {
  const { size = 13, weight = 400, color = INK, lines = 1, lh = Math.round(size * 1.3), align = 'start', center = false, tip = text } = opts;
  const font = `font:${weight} ${size}px/${lh}px ${FONT_CSS};color:${color};text-align:${align};direction:rtl;margin:0;padding:0;box-sizing:border-box;overflow:hidden;overflow-wrap:anywhere`;
  const clamp = `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};line-clamp:${lines};max-height:${lines * lh}px;max-width:${num(w)}px`;
  const inner = `<div dir="rtl" lang="he" title="${esc(tip)}" style="${font};${clamp}">${esc(text)}</div>`;
  const body = center
    ? `<div xmlns="${XHTML}" style="display:flex;align-items:center;justify-content:${align === 'center' ? 'center' : 'flex-start'};direction:rtl;width:${num(w)}px;height:${num(h)}px;margin:0;padding:0;overflow:hidden">${inner}</div>`
    : `<div xmlns="${XHTML}" style="width:${num(w)}px;height:${num(h)}px;margin:0;padding:0;overflow:hidden">${inner}</div>`;
  return `<foreignObject x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}">${body}</foreignObject>`;
}

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
    : { cardW: 196, cardH: 86, failH: 48, colW: 252, labelW: 128, headH: 68, rowPad: 14, vgap: 14, pad: 14, fontSize: 13 };
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
  const LOOSE_W = 300; const LOOSE_H = 42;
  const perRow = Math.max(1, Math.floor((W - D.pad * 2 - 90) / (LOOSE_W + 10)));
  const looseRows = Math.ceil(loose.length / perRow);
  const stripH = !mini && loose.length ? 14 + looseRows * (LOOSE_H + 8) : 0;
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
  o(`<style>.bp-bub{cursor:help;outline:none}.bp-bub:focus .bp-ring{stroke-width:3;stroke:${INK}}`
    + `[role=button].bp-card,[role=button].bp-timer{cursor:pointer;outline:none}`
    + `[role=button].bp-card:hover .bp-box,[role=button].bp-card:focus-visible .bp-box,[role=button].bp-timer:hover .bp-pill,[role=button].bp-timer:focus-visible .bp-pill{stroke-width:3.5;stroke:${INK}}`
    + `[role=button].bp-card[aria-expanded=true] .bp-box,[role=button].bp-timer[aria-expanded=true] .bp-pill{stroke-width:3.5;stroke:#5b3fd6}</style>`);

  if (!mini) {
    // row bands and actor labels
    actors.forEach((a, r) => {
      const bandX = D.pad;
      o(`<rect x="${bandX}" y="${num(rowY[r])}" width="${num(W - D.pad * 2)}" height="${num(rowH[r])}" fill="${r % 2 ? '#ffffff' : '#f6f4fc'}" stroke="${LINE}"/>`);
      o(fo(W - D.pad - D.labelW + 9, rowY[r], D.labelW - 18, rowH[r], actorLabel(map, a, labels), { size: 14, weight: 600, lines: 3, lh: 18, center: true }));
    });
    // label column divider
    o(`<line x1="${num(W - D.pad - D.labelW)}" y1="${num(D.pad + D.headH)}" x2="${num(W - D.pad - D.labelW)}" y2="${num(matrixBottom)}" stroke="${LINE}"/>`);
    // stage headers
    stages.forEach((st, c) => {
      const right = colRight(c);
      const cx = right - D.colW / 2;
      o(`<line x1="${num(right - D.colW)}" y1="${num(D.pad + D.headH)}" x2="${num(right - D.colW)}" y2="${num(matrixBottom)}" stroke="${LINE}" stroke-dasharray="2 4"/>`);
      const mine = attached.filter((t) => t.stage === st.id);
      const tl = mine.length ? 1 : 2;
      o(`<g><circle cx="${num(right - 26)}" cy="${num(D.pad + 22)}" r="13" fill="#5b3fd6"/><text x="${num(right - 26)}" y="${num(D.pad + 27)}" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">${c + 1}</text>`);
      o(fo(right - 48 - (D.colW - 70), D.pad + 22 - (tl * 18) / 2, D.colW - 70, tl * 18, st.name, { size: 15, weight: 700, lines: tl, lh: 18 }) + '</g>');
      let cxr = right - 12;
      for (const t of mine) {
        const chip = clock(t, 0, D.pad + 36, labels, true, cxr, null, opts.interactive);
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

  for (const [, a] of pos) o(card(a, labels, mini, D, esc(p.id), opts.sources !== false, opts.interactive));

  if (!mini && loose.length) {
    const sy = matrixBottom + 10;
    o(`<text x="${num(W - D.pad - 4)}" y="${num(sy + 22)}" text-anchor="start" font-size="13" font-weight="600" fill="${MUTED}">${esc(labels.timers)}</text>`);
    loose.forEach((t, i) => {
      const row = Math.floor(i / perRow); const col = i % perRow;
      const chip = clock(t, 0, sy + 4 + row * (LOOSE_H + 8), labels, false, W - D.pad - 80 - col * (LOOSE_W + 10), { w: LOOSE_W, h: LOOSE_H }, opts.interactive);
      o(chip.svg);
    });
  }
  if (!steps.length) {
    o(fo(W / 2 - 150, top + 22, 300, 24, labels.noSteps, { size: 15, color: MUTED, align: 'center', center: true, lh: 20 }));
  }
  o('</svg>');
  return out.join('');
}

const BTN = (on, label) => (on ? ` role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(label)}"` : ' role="img"');

/** A clock badge. On a stage header it is a small chip; in the strip it carries its text. */
function clock(t, _cx, y, labels, onStage, x, box, interactive) {
  const dur = durationHe(t.duration);
  const full = [t.text, dur, t.onExpire].filter(Boolean).join(' - ');
  const label = onStage ? dur : `${dur}: ${t.text || ''}`;
  const w = onStage ? Math.max(64, measure(label, 12.5) + 44) : box.w;
  const h = onStage ? 28 : box.h;
  const left = x - w; // x is the right edge
  const yy = y;
  const cy = yy + h / 2;
  const svg = `<g class="bp-timer" data-timer="${esc(t.id || '')}"${BTN(interactive, full)}><title>${esc(full)}</title>`
    + `<rect class="bp-pill" x="${num(left)}" y="${num(yy)}" width="${num(w)}" height="${h}" rx="${num(Math.min(14, h / 2))}" fill="#fff4e0" stroke="#b86e00"/>`
    + `<circle cx="${num(x - 17)}" cy="${num(cy)}" r="8" fill="none" stroke="#8a4b00" stroke-width="1.6"/>`
    + `<path d="M${num(x - 17)} ${num(cy - 4.5)}V${num(cy)}L${num(x - 13.5)} ${num(cy + 2)}" fill="none" stroke="#8a4b00" stroke-width="1.6" stroke-linecap="round"/>`
    + fo(left + 10, onStage ? yy + 6 : yy + 6, w - 42, h - 12, label, { size: 12.5, weight: 600, color: '#6b3f00', lines: onStage ? 1 : 2, lh: 15, tip: full, center: true })
    + '</g>';
  return { svg, w };
}

function card(a, labels, mini, D, pid, sources, interactive) {
  const { s } = a;
  const st = KIND_STYLE[s.kind] || KIND_STYLE.system;
  const g = [];
  const full = [s.id, s.text, s.onFailure ? `${labels.failure}: ${s.onFailure}` : '', sources && s.source ? `${labels.src[s.src] || ''}: ${s.source}` : ''].filter(Boolean).join('\n');
  const btn = interactive && !mini;
  g.push(`<g class="bp-card" data-step="${esc(s.id)}" data-kind="${esc(s.kind || '')}"${btn ? BTN(true, s.text || s.id) : ''}><title>${esc(full)}</title>`);
  g.push(`<rect x="${num(a.x)}" y="${num(a.y)}" class="bp-box" width="${a.w}" height="${a.h}" rx="${mini ? 3 : 10}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${mini ? 1 : 1.6}"/>`);
  if (mini) { g.push('</g>'); return g.join(''); }
  const right = a.x + a.w;
  // kind label, top right, next to the source bubble
  const kindLabel = labels.kinds[s.kind] || s.kind || '';
  g.push(fo(a.x + 38, a.y + 8, a.w - 50, 16, kindLabel, { size: 11.5, weight: 700, color: st.ink, lh: 16 }));
  g.push(fo(a.x + 12, a.y + 28, a.w - 24, 51, s.text || '', { size: 13, lines: 3, lh: 17, tip: full }));
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
    const pw = 172; const px = right - pw; const py = a.y + a.h + 12; const ph = D.failH;
    const ftip = `${labels.failure}: ${s.onFailure}`;
    g.push(`<path d="M${num(px + pw / 2)} ${num(a.y + a.h)}V${num(py)}" stroke="${RED}" stroke-width="1.6" stroke-dasharray="4 3" fill="none" marker-end="url(#bp-arrr-${pid})"/>`);
    g.push(`<g class="bp-fail" role="img" aria-label="${esc(ftip)}"><title>${esc(ftip)}</title><rect x="${num(px)}" y="${num(py)}" width="${pw}" height="${ph}" rx="8" fill="#fdecea" stroke="${RED}" stroke-dasharray="4 3"/>`
      + fo(px + 8, py + 4, pw - 16, ph - 8, s.onFailure, { size: 11.5, color: RED, lines: 3, lh: 13, tip: ftip }) + '</g>');
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
