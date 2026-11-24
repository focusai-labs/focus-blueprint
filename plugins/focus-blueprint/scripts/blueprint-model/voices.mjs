// Voices: lines in a <!-- voices --> ... <!-- /voices --> section carry a src marker.
// Node builtins only, no imports.

const SRC_RE = /<!--\s*src:(client|ours|assumed)\s*-->\s*$/;
const norm = (s) => String(s).replace(/<!--[\s\S]*?-->/g, ' ').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();

/**
 * Lines inside voices sections: [{ line (1-based), text, src: 'client'|'ours'|'assumed'|null }].
 * Blank lines, headings, comment-only lines, table separators and table header rows are skipped.
 */
export function parseVoices(markdown) {
  const ls = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inside = false;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (/<!--\s*voices\s*-->/.test(l)) { inside = true; continue; }
    if (/<!--\s*\/voices\s*-->/.test(l)) { inside = false; continue; }
    if (!inside) continue;
    const t = l.trim();
    if (!t || /^#/.test(t) || /^<!--[\s\S]*-->$/.test(t) && !SRC_RE.test(t)) continue;
    if (/^\|[\s|:-]+\|?$/.test(t)) continue;
    if (/^\|/.test(t) && /^\|[\s|:-]+\|?$/.test((ls[i + 1] || '').trim())) continue;
    const m = SRC_RE.exec(t);
    out.push({ line: i + 1, text: norm(t), src: m ? m[1] : null });
  }
  return out;
}

/** The assumptions the PRD lists under <!-- prd:assumptions -->: normalized strings. */
export function assumptionsOf(prd) {
  const ls = String(prd ?? '').replace(/\r\n?/g, '\n').split('\n');
  const i = ls.findIndex((l) => /<!--\s*prd:assumptions\s*-->/.test(l));
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < ls.length; j++) {
    if (/^\s*<!--\s*[a-z-]+:/.test(ls[j]) || /^#/.test(ls[j])) break;
    const t = norm(ls[j]);
    if (t) out.push(t);
  }
  return out;
}
