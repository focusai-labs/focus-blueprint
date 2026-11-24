// Turns a Blueprint document (the Markdown subset the templates use) into one
// self-contained HTML page, Hebrew RTL. Node builtins only, no dependencies.
//   renderDoc(markdown, map, tokensCss, { client })  ->  html string
// The review version keeps the voice bubbles, highlights assumptions, labels the
// generated blocks and shows the map stamp as a short footer. The client version
// has none of the markers. Everything that comes from the Markdown is escaped; the
// only markup that is not escaped is what this file builds itself.
import { canonicalHash, migrateMap } from './blueprint-model/map-model.mjs';
import { GEN_KINDS } from './blueprint-model/render-blocks.mjs';
import { processSvg, KIND_STYLE, DEFAULT_LABELS } from '../ui/process-svg.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SRC_WORD = { client: 'הלקוח', ours: 'אנחנו', assumed: 'הנחה' };
const SRC_LETTER = { client: 'ל', ours: 'א', assumed: '?' };
const SRC_END = /\s*<!--\s*src:(client|ours|assumed)\s*-->\s*$/;
const MARKER = /^\s*(\/?gen:[a-z]+|\/?voices|prd:assumptions)\s*$/;
const SAFE_URL = /^(?:(?:https?|mailto|tel):|#|\/|\.{1,2}\/|[^:]*$)/i;

// ---------------------------------------------------------------- inline
function inline(raw, ctx) {
  const stash = [];
  const keep = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };
  let s = String(raw).replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/`([^`]+)`/g, (m, code) => keep(`<code dir="ltr">${esc(code)}</code>`));
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const plain = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(plain)) return text;
    const ltr = /^[\x20-\x7e]+$/.test(text.replace(/\u0000\d+\u0000/g, 'x')) ? ' dir="ltr"' : '';
    return keep(`<a href="${url}"${/^https?:/i.test(plain) ? ' rel="noopener"' : ''}><bdi${ltr}>${inlineFormat(text, keep)}</bdi></a>`);
  });
  s = s.replace(/\bhttps?:\/\/[^\s<>()\u0000]+[^\s<>().,;:!?\u0000]/g, (url) => keep(`<bdi dir="ltr"><a href="${url}" rel="noopener">${url}</a></bdi>`));
  s = inlineFormat(s, keep);
  if (!ctx.client) s = s.replace(/&lt;&lt;fill&gt;&gt;/g, '<span class="fill">&lt;&lt;fill&gt;&gt;</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
}
function inlineFormat(s, keep) {
  s = s.replace(/\*\*([^*\u0000][^*]*?)\*\*/g, (m, t) => `<strong>${t}</strong>`);
  s = s.replace(/(^|[\s(>-])__([^_]+?)__(?=[\s).,;:!?<]|$)/g, (m, p, t) => `${p}<strong>${t}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, (m, p, t) => `${p}<em>${t}</em>`);
  s = s.replace(/(^|[\s(>-])_([^_\s][^_]*?)_(?=[\s).,;:!?<]|$)/g, (m, p, t) => `${p}<em>${t}</em>`);
  return s;
}

// ---------------------------------------------------------------- blocks
const isFence = (t) => /^\s*```/.test(t);
const isHeading = (t) => /^#{1,6}\s+\S/.test(t);
const isHr = (t) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(t);
const isQuote = (t) => /^\s*>/.test(t);
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isTableSep = (t) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(t) && t.includes('-') && (t.includes('|'));
const isTableStart = (ls, i) => /^\s*\|/.test(ls[i].t) && i + 1 < ls.length && isTableSep(ls[i + 1].t);

function splitRow(t) {
  const cells = [];
  let cur = '';
  const body = t.trim();
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') { cur += '|'; i++; } else if (body[i] === '|') { cells.push(cur); cur = ''; } else cur += body[i];
  }
  cells.push(cur);
  if (body.startsWith('|')) cells.shift();
  if (body.endsWith('|') && !body.endsWith('\\|')) cells.pop();
  return cells.map((c) => c.trim());
}

function bubble(src, ctx) {
  if (ctx.client || !src) return '';
  return ` <span class="src src-${src}" title="${esc(SRC_WORD[src])}" aria-label="${esc(SRC_WORD[src])}">${SRC_LETTER[src]}</span>`;
}
const cls = (lines, ctx) => {
  if (ctx.client) return '';
  return lines.some((l) => l.src === 'assumed' || l.assume) ? ' class="assumed"' : '';
};
const lastSrc = (lines) => { for (let i = lines.length - 1; i >= 0; i--) if (lines[i].src) return lines[i].src; return null; };

function blocks(ls, ctx) {
  const out = [];
  let i = 0;
  while (i < ls.length) {
    const L = ls[i];
    if (!L.t.trim()) { i++; continue; }
    if (isFence(L.t)) {
      const code = [];
      i++;
      while (i < ls.length && !isFence(ls[i].t)) code.push(ls[i++].t);
      i++;
      out.push(`<pre dir="ltr"><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (isHeading(L.t)) {
      const m = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(L.t);
      out.push(`<h${m[1].length}${cls([L], ctx)}>${inline(m[2], ctx)}${bubble(L.src, ctx)}</h${m[1].length}>`);
      i++;
      continue;
    }
    if (isHr(L.t)) { out.push('<hr>'); i++; continue; }
    if (isTableStart(ls, i)) {
      const head = splitRow(L.t);
      const aligns = splitRow(ls[i + 1].t).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'left' : ''));
      i += 2;
      const rows = [];
      while (i < ls.length && /^\s*\|/.test(ls[i].t)) rows.push(ls[i++]);
      const td = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c, ctx)}</${tag}>`;
      const body = rows.map((r) => {
        const cells = splitRow(r.t);
        const last = cells.length - 1;
        return `<tr${cls([r], ctx)}>${cells.map((c, k) => td('td', c, k).replace(/<\/td>$/, `${k === last ? bubble(r.src, ctx) : ''}</td>`)).join('')}</tr>`;
      }).join('');
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }
    if (isQuote(L.t)) {
      const inner = [];
      while (i < ls.length && isQuote(ls[i].t)) { inner.push({ ...ls[i], t: ls[i].t.replace(/^\s*>\s?/, '') }); i++; }
      out.push(`<blockquote>${blocks(inner, ctx)}</blockquote>`);
      continue;
    }
    if (LIST.test(L.t)) {
      const res = list(ls, i, ctx);
      out.push(res.html);
      i = res.next;
      continue;
    }
    // paragraph
    const para = [];
    while (i < ls.length && ls[i].t.trim() && !isFence(ls[i].t) && !isHeading(ls[i].t) && !isHr(ls[i].t) && !isQuote(ls[i].t) && !isTableStart(ls, i) && !(para.length && LIST.test(ls[i].t))) para.push(ls[i++]);
    out.push(`<p${cls(para, ctx)}>${para.map((l) => inline(l.t.trim(), ctx)).join(' ')}${bubble(lastSrc(para), ctx)}</p>`);
  }
  return out.join('\n');
}

function list(ls, start, ctx) {
  const base = LIST.exec(ls[start].t)[1].length;
  const ordered = /\d/.test(LIST.exec(ls[start].t)[2]);
  const items = [];
  let i = start;
  while (i < ls.length) {
    const t = ls[i].t;
    if (!t.trim()) break;
    const m = LIST.exec(t);
    if (m && m[1].length === base) {
      items.push({ lines: [{ ...ls[i], t: m[3] }], kids: [] });
      i++;
    } else if (m && m[1].length > base && items.length) {
      items[items.length - 1].kids.push(ls[i]);
      i++;
    } else if (!m && /^\s+\S/.test(t) && items.length) {
      const it = items[items.length - 1];
      if (it.kids.length) it.kids.push(ls[i]); else it.lines.push({ ...ls[i], t: t.trim() });
      i++;
    } else break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const html = items.map((it) => {
    const text = it.lines.map((l) => inline(l.t, ctx)).join(' ');
    const src = lastSrc(it.lines);
    let kids = '';
    if (it.kids.length) {
      const minIndent = Math.min(...it.kids.map((l) => /^\s*/.exec(l.t)[0].length));
      kids = blocks(it.kids.map((l) => ({ ...l, t: l.t.slice(minIndent) })), ctx);
    }
    return `<li${cls(it.lines, ctx)}>${text}${bubble(src, ctx)}${kids}</li>`;
  }).join('');
  return { html: `<${tag}>${html}</${tag}>`, next: i };
}

// ---------------------------------------------------------------- document
function legendHtml() {
  return `<div class="kinds">${Object.keys(KIND_STYLE).map((k) => `<span><i style="background:${KIND_STYLE[k].fill};border-color:${KIND_STYLE[k].stroke}"></i>${esc(DEFAULT_LABELS.kinds[k])}</span>`).join('')}</div>`;
}

function processFigures(map, ctx) {
  return arr(map.processes).filter((p) => arr(p.steps).length).map((p) => {
    let svg = processSvg(map, p.id, { sources: !ctx.client });
    const w = /width="([\d.]+)"/.exec(svg);
    svg = svg.replace(/ width="[\d.]+" height="[\d.]+"/, ` style="width:100%;height:auto;max-width:${w ? w[1] : 1200}px"`);
    return `<figure class="proc"><figcaption>${esc(p.name || p.id)}</figcaption>${svg}${legendHtml()}</figure>`;
  }).join('\n');
}

const pick = (names, fallback) => names.reduceRight((acc, n) => `var(--${n}, ${acc})`, fallback);

const CSS = `
:root{--d-bg:${pick(['color-bg', 'color-background', 'bg', 'background', 'color-surface'], '#ffffff')};--d-fg:${pick(['color-text', 'color-fg', 'color-ink', 'fg', 'text', 'foreground'], '#1d1a2b')};--d-muted:${pick(['color-text-muted', 'color-muted', 'muted', 'text-muted'], '#5a5570')};--d-accent:${pick(['color-primary', 'color-accent', 'color-brand', 'primary', 'accent', 'brand'], '#5b3fd6')};--d-line:${pick(['color-border', 'color-line', 'border', 'line'], '#d9d4ea')};--d-soft:${pick(['color-surface', 'color-surface-alt', 'surface', 'bg-soft'], '#f6f4fc')};--d-font:${pick(['font-body', 'font-sans', 'font-family', 'font-base', 'font'], 'system-ui, -apple-system, "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif')}}
*{box-sizing:border-box}
body{margin:0;background:var(--d-bg);color:var(--d-fg);font-family:var(--d-font);font-size:17px;line-height:1.7}
main{max-width:980px;margin:0 auto;padding:40px 20px 72px}
h1{font-size:32px;line-height:1.25;margin:0 0 20px}h2{font-size:24px;line-height:1.3;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--d-line)}h3{font-size:19px;margin:24px 0 8px}h4,h5,h6{font-size:17px;margin:18px 0 6px}
p{margin:0 0 12px}ul,ol{margin:0 0 14px;padding-inline-start:26px}li{margin:3px 0}
a{color:var(--d-accent)}hr{border:0;border-top:1px solid var(--d-line);margin:28px 0}
blockquote{margin:0 0 14px;padding:8px 16px;border-inline-start:4px solid var(--d-accent);background:var(--d-soft);border-radius:6px}blockquote p:last-child{margin:0}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:var(--d-soft);padding:1px 6px;border-radius:5px;unicode-bidi:isolate}
pre{direction:ltr;text-align:left;background:var(--d-soft);border:1px solid var(--d-line);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:0 0 14px}pre code{background:none;padding:0}
.table-wrap{overflow-x:auto;margin:0 0 16px}table{border-collapse:collapse;width:100%;font-size:15.5px}th,td{text-align:start;padding:8px 10px;border:1px solid var(--d-line);vertical-align:top}th{background:var(--d-soft);font-weight:700}
figure.proc{margin:0 0 20px;padding:12px;border:1px solid var(--d-line);border-radius:12px;background:#fff;overflow-x:auto}figure.proc figcaption{font-weight:700;margin:0 0 8px}figure.proc svg{display:block;margin-inline:auto}
.kinds{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;color:var(--d-muted);margin-top:8px}.kinds span{display:inline-flex;align-items:center;gap:6px}.kinds i{display:inline-block;width:14px;height:14px;border-radius:4px;border:2px solid}
.src{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:12px;font-weight:700;line-height:1;vertical-align:middle;margin-inline-start:6px;border:1.5px solid ${KIND_STYLE.ai.stroke};cursor:help}
.src-client{background:#5b3fd6;color:#fff}.src-ours{background:#fff;color:#3d27a3}.src-assumed{background:#fff4e0;color:#8a4b00;border:1.5px dashed #b86e00}
.assumed{background:#fff4e0;box-shadow:-4px 0 0 #b86e00}li.assumed,p.assumed{padding-inline-start:6px}tr.assumed td{background:#fff4e0}
.fill{background:#fdecea;color:#b42318;border-radius:4px;padding:0 4px}
.from-map{font-size:13px;color:var(--d-muted);margin:0 0 6px;display:flex;align-items:center;gap:6px}.from-map:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--d-accent);opacity:.6}
.review-bar{font-size:14px;color:var(--d-muted);border:1px solid var(--d-line);border-radius:10px;padding:8px 14px;margin:0 0 24px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;background:var(--d-soft)}
footer.stamp{margin-top:48px;padding-top:12px;border-top:1px solid var(--d-line);font-size:13px;color:var(--d-muted)}
@media print{main{max-width:none;padding:0}h2{break-after:avoid}figure.proc,table,pre,blockquote{break-inside:avoid}.review-bar{display:none}}
@media (max-width:560px){body{font-size:16px}h1{font-size:26px}main{padding:24px 14px 48px}}
`;

/** Tokens go in as they are, except for the two things that would break the page or reach out to the network. */
function cleanTokens(css) {
  return String(css || '').replace(/@import[^;]*;?/gi, '').replace(/<\/style/gi, '<\\/style').replace(/<!--/g, '');
}

export function renderDoc(markdown, map, tokensCss, { client = false } = {}) {
  const ctx = { client: Boolean(client) };
  const m = migrateMap(map || {});
  let text = String(markdown ?? '').replace(/\r\n?/g, '\n');
  const stampMatch = /^<!-- blueprint-map: ([0-9a-f]{64}) -->[ \t]*\n?/.exec(text);
  const stamp = stampMatch ? stampMatch[1] : null;
  if (stampMatch) text = text.slice(stampMatch[0].length);

  // comments: keep only the markers this renderer knows, drop the rest
  text = text.replace(/<!--([\s\S]*?)-->/g, (all, body) => (MARKER.test(body) || /^\s*src:(client|ours|assumed)\s*$/.test(body) ? all : ''));

  const lines = [];
  let assume = false;
  for (const raw of text.split('\n')) {
    let t = raw;
    let src = null;
    const sm = SRC_END.exec(t);
    if (sm) { src = sm[1]; t = t.slice(0, sm.index); }
    const mk = /^\s*<!--\s*(\/?gen:[a-z]+|\/?voices|prd:assumptions)\s*-->\s*$/.exec(t);
    if (mk) {
      if (mk[1] === 'prd:assumptions') assume = true;
      lines.push({ t: '', marker: mk[1] });
      continue;
    }
    if (/^#{1,6}\s/.test(t)) assume = false;
    lines.push({ t: t.replace(/<!--\s*src:(?:client|ours|assumed)\s*-->/g, ''), src, assume });
  }

  const html = [];
  let buf = [];
  const flush = () => { if (buf.length) html.push(blocks(buf, ctx)); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    const mk = lines[i].marker;
    const open = mk && /^gen:/.exec(mk) && GEN_KINDS.includes(mk.slice(4));
    if (!open) { if (!mk) buf.push(lines[i]); continue; }
    const kind = mk.slice(4);
    let j = i + 1;
    while (j < lines.length && lines[j].marker !== `/gen:${kind}`) j++;
    flush();
    const inner = lines.slice(i + 1, j).filter((l) => !l.marker);
    html.push(`<section class="gen" data-gen="${kind}">${ctx.client ? '' : '<p class="from-map">מהמפה</p>'}${kind === 'processes' ? processFigures(m, ctx) : ''}${blocks(inner, ctx)}</section>`);
    i = j;
  }
  flush();

  const body = html.join('\n');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  const title = h1 ? h1[1].replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : 'מסמך';

  let bar = '';
  let footer = '';
  if (!ctx.client) {
    bar = `<div class="review-bar" role="note"><strong>גרסת סקירה</strong><span>${['client', 'ours', 'assumed'].map((k) => `<span class="src src-${k}">${SRC_LETTER[k]}</span> ${esc(SRC_WORD[k])}`).join(' &nbsp; ')}</span></div>`;
    if (stamp) {
      const fresh = map ? canonicalHash(m) === stamp : null;
      footer = `<footer class="stamp">נבנה מהמפה, חותמת ${stamp.slice(0, 8)}${fresh === null ? '' : fresh ? ', המסמך מעודכן.' : ', המפה השתנתה מאז, כדאי להריץ bp render.'}</footer>`;
    }
  }
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${cleanTokens(tokensCss)}
${CSS}
</style>
</head>
<body>
<main>
${bar}
${body}
${footer}
</main>
</body>
</html>
`;
}
