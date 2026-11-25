// The wired prototype of stage 7: every built screen of the map joined into one self-contained HTML file.
// Node builtins only. The shell (html, css, js) lives in scripts/prototype/ and is read at build time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from './blueprint-model/secrets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHELL_DIR = path.join(here, 'prototype');
export const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ASSET = 40 * 1024 * 1024;
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon',
};
const EXT_RE = 'png|jpe?g|webp|gif|svg|woff2?|ttf|otf|ico';
const GOOGLE_FONTS = /^(?:https?:)?\/\/fonts\.(?:googleapis|gstatic)\.com\//i;
const isExternalUrl = (u) => /^(?:https?:)?\/\//i.test(u);

const readText = (f) => fs.readFileSync(f, 'utf8');

/** Same guard rules as the UI's safeAssetFile (no .., no dot segments, no symlinks), for any file type; rel is project-relative with "/". */
export function safeFile(projectDir, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.startsWith('/')) return null;
  const segs = rel.split('/');
  for (const seg of segs) if (!seg || seg === '.' || seg === '..' || seg.startsWith('.') || seg === 'node_modules' || /[\\:\0]/.test(seg)) return null;
  try {
    const realProject = fs.realpathSync(projectDir);
    let cur = realProject;
    for (const seg of segs) {
      cur = path.join(cur, seg);
      if (fs.lstatSync(cur).isSymbolicLink()) return null;
    }
    const st = fs.statSync(cur);
    if (!st.isFile() || st.size > MAX_ASSET) return null;
    return cur;
  } catch { return null; }
}
function safeDir(projectDir, rel) {
  const segs = rel.split('/').filter((x) => x !== '');
  for (const seg of segs) if (seg === '.' || seg === '..' || seg.startsWith('.') || seg === 'node_modules' || /[\\:\0]/.test(seg)) return null;
  try {
    const realProject = fs.realpathSync(projectDir);
    let cur = realProject;
    for (const seg of segs) { cur = path.join(cur, seg); if (fs.lstatSync(cur).isSymbolicLink()) return null; }
    return fs.statSync(cur).isDirectory() ? cur : null;
  } catch { return null; }
}

/** Joins a project-relative directory and a reference. Returns a project-relative path, or null when it leaves the project. */
export function resolveRef(baseDir, ref) {
  let r = String(ref).split('#')[0].split('?')[0];
  try { r = decodeURI(r); } catch { /* keep */ }
  if (!r || r.startsWith('/')) return null;
  const parts = baseDir ? baseDir.split('/') : [];
  for (const p of r.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(p);
  }
  return parts.join('/');
}
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

/** Persona display names, read-only copy of the board's source (spec/users.md headings). */
export function personaNames(projectDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(projectDir, 'spec', 'users.md'), 'utf8'); } catch { return {}; }
  const out = {};
  for (const m of text.matchAll(/^#{2,4}\s+(.+?)\s*\(`([^`]+)`\)\s*$/gm)) out[m[2]] = m[1].trim();
  return out;
}

// ---------- JavaScript scanning ----------
const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]$/;
const REGEX_WORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|delete|throw|new)$/;
/** mask[i] is 1 where char i is code (not a string, comment or regex). strings: [{start,end}] including the quotes. */
export function scanJs(text) {
  const n = text.length;
  const mask = new Uint8Array(n);
  const strings = [];
  let i = 0;
  let lastSig = '';
  let lastWordEnd = 0;
  const skipTemplate = (j) => {
    // j is just after the opening backtick; returns the index after the closing one
    while (j < n) {
      const c = text[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') return j + 1;
      if (c === '$' && text[j + 1] === '{') {
        let depth = 1; j += 2;
        while (j < n && depth) {
          const d = text[j];
          if (d === '"' || d === "'") { const q = d; j++; while (j < n && text[j] !== q) { if (text[j] === '\\') j++; j++; } j++; continue; }
          if (d === '`') { j = skipTemplate(j + 1); continue; }
          if (d === '{') depth++; else if (d === '}') depth--;
          j++;
        }
        continue;
      }
      j++;
    }
    return j;
  };
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      const start = i; i++;
      while (i < n && text[i] !== c && text[i] !== '\n') { if (text[i] === '\\') i++; i++; }
      i++; strings.push({ start, end: Math.min(i, n) }); lastSig = 'x'; continue;
    }
    if (c === '`') {
      const start = i; i = skipTemplate(i + 1);
      strings.push({ start, end: i, template: true }); lastSig = 'x'; continue;
    }
    if (c === '/') {
      const before = text.slice(Math.max(0, i - 12), i).replace(/\s+$/, '');
      if (lastSig === '' || REGEX_PREV.test(lastSig) || REGEX_WORDS.test(before)) {
        let j = i + 1; let cls = false;
        while (j < n && text[j] !== '\n') {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === '[') cls = true; else if (text[j] === ']') cls = false; else if (text[j] === '/' && !cls) break;
          j++;
        }
        i = j + 1; lastSig = 'x'; continue;
      }
    }
    mask[i] = 1;
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  void lastWordEnd;
  return { mask, strings };
}

const OPERATOR_END = /[+\-*/%&|?:,=<>!(]$/;
/** End index of the expression that starts at i: up to ; or a closing bracket at depth 0, or a newline when the line is complete. */
function exprEnd(text, mask, i) {
  let depth = 0; let j = i; let lastSigIdx = -1;
  for (; j < text.length; j++) {
    if (!mask[j]) { if (!/\s/.test(text[j])) lastSigIdx = j; continue; }
    const c = text[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if (c === ';' && depth === 0) break;
    else if (c === '\n' && depth === 0 && lastSigIdx >= 0 && !OPERATOR_END.test(text[lastSigIdx])) break;
    if (!/\s/.test(c)) lastSigIdx = j;
  }
  let e = j;
  while (e > i && /\s/.test(text[e - 1])) e--;
  return e;
}

const LOC = String.raw`(?<![\w$.])(?:(?:window|self|top|document)\s*\.\s*)?location`;
/** Navigation rewrites of the contract; returns { text, count }. */
export function rewriteNav(text) {
  let count = 0;
  const apply = (t, re, fn) => {
    const { mask } = scanJs(t);
    const edits = [];
    let m; re.lastIndex = 0;
    while ((m = re.exec(t))) {
      if (!mask[m.index]) continue;
      const e = fn(m, t, mask);
      if (e && (!edits.length || e.from >= edits[edits.length - 1].to)) edits.push(e);
    }
    let out = ''; let pos = 0;
    for (const e of edits) { out += t.slice(pos, e.from) + e.to_text; pos = e.to; count++; }
    return out + t.slice(pos);
  };
  // location.href = X, window.location = X, bare location = X
  const hrefRe = new RegExp(String.raw`(?:${LOC}\s*\.\s*href|${LOC}|(?<![\w$.])location)\s*=(?!=)\s*`, 'g');
  text = apply(text, hrefRe, (m, t, mask) => {
    const before = t.slice(Math.max(0, m.index - 6), m.index);
    if (/(?:var|let|const)\s$/.test(before)) return null;
    const start = m.index; const exprStart = m.index + m[0].length;
    const end = exprEnd(t, mask, exprStart);
    if (end <= exprStart) return null;
    return { from: start, to: end, to_text: `__bpGo(${t.slice(exprStart, end)})` };
  });
  text = apply(text, new RegExp(String.raw`${LOC}\s*\.\s*(?:assign|replace)\s*\(`, 'g'), (m) => ({ from: m.index, to: m.index + m[0].length, to_text: '__bpGo(' }));
  text = apply(text, new RegExp(String.raw`${LOC}\s*\.\s*search\b(?!\s*=(?!=))`, 'g'), (m) => ({ from: m.index, to: m.index + m[0].length, to_text: "(window.__bpSearch||'')" }));
  text = apply(text, new RegExp(String.raw`${LOC}\s*\.\s*pathname\b(?!\s*=(?!=))`, 'g'), (m) => ({ from: m.index, to: m.index + m[0].length, to_text: '(window.__bpPath||location.pathname)' }));
  return { text, count };
}

// ---------- bundler ----------
class Bundle {
  constructor(projectDir) {
    this.dir = projectDir;
    this.assets = []; this.assetPaths = []; this.assetIndex = {};
    this.css = {}; this.js = {}; this.cssIds = {}; this.jsIds = {};
    this.external = []; this.unresolved = [];
    this.cssBusy = new Set();
  }
  addAsset(rel) {
    if (rel in this.assetIndex) return this.assetIndex[rel];
    const ext = path.extname(rel).toLowerCase();
    const mime = MIME[ext];
    const file = mime ? safeFile(this.dir, rel) : null;
    if (!file) return null;
    const n = this.assets.length;
    this.assets.push(`data:${mime};base64,${fs.readFileSync(file).toString('base64')}`);
    this.assetPaths.push(rel);
    this.assetIndex[rel] = n;
    return n;
  }
  addDir(relDir) {
    const abs = safeDir(this.dir, relDir);
    if (!abs) return;
    let names = [];
    try { names = fs.readdirSync(abs).sort(); } catch { return; }
    let k = 0;
    for (const nm of names) {
      if (k >= 300) break;
      if (!MIME[path.extname(nm).toLowerCase()]) continue;
      if (this.addAsset(relDir ? `${relDir}/${nm}` : nm) != null) k++;
    }
  }
  token(rel) { const n = this.addAsset(rel); return n == null ? null : `bp-asset://${n}`; }

  /** url(...) and @import in a CSS text that lives in baseDir. */
  processCss(text, baseDir, from) {
    text = text.replace(/url\(\s*(["']?)([^"')]+?)\1\s*\)/gi, (m, q, u) => {
      u = u.trim();
      if (/^(?:data:|#|bp-asset:)/i.test(u)) return m;
      if (isExternalUrl(u)) {
        if (GOOGLE_FONTS.test(u)) return m;
        this.external.push({ file: from, url: u, kind: 'css-url' });
        return 'url("data:,")';
      }
      const ext = path.extname(u.split('#')[0].split('?')[0]).toLowerCase();
      if (!MIME[ext]) return m;
      const rel = resolveRef(baseDir, u);
      const hash = u.includes('#') ? '#' + u.split('#')[1] : '';
      const tok = rel && this.token(rel);
      if (!tok) { this.unresolved.push({ file: from, ref: u }); return m; }
      return `url("${tok}${hash}")`;
    });
    text = text.replace(/@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);/gi, (m, q1, u1, q2, u2, media) => {
      const u = (u1 || u2 || '').trim();
      if (isExternalUrl(u)) {
        if (GOOGLE_FONTS.test(u)) return m;
        this.external.push({ file: from, url: u, kind: 'css-import' });
        return '';
      }
      const rel = resolveRef(baseDir, u);
      const file = rel && safeFile(this.dir, rel);
      if (!file || this.cssBusy.has(rel)) { this.unresolved.push({ file: from, ref: u }); return ''; }
      this.cssBusy.add(rel);
      let inner = this.processCss(readText(file), dirOf(rel), rel);
      this.cssBusy.delete(rel);
      media = media.trim();
      if (media) inner = `@media ${media} {\n${inner}\n}`;
      return `/* ${rel} */\n${inner}\n`;
    });
    return text;
  }
  /** A linked stylesheet, shared between screens. */
  cssFile(rel) {
    if (rel in this.cssIds) return this.cssIds[rel];
    const file = safeFile(this.dir, rel);
    if (!file) return null;
    const id = `c${Object.keys(this.css).length + 1}`;
    this.cssIds[rel] = id;
    this.cssBusy.add(rel);
    this.css[id] = this.processCss(readText(file), dirOf(rel), rel).replace(/<\/style/gi, '<\\/style');
    this.cssBusy.delete(rel);
    return id;
  }
  /** JavaScript text: navigation rewrites, then asset strings resolved against pageDir. */
  processJs(text, pageDir, from) {
    text = rewriteNav(text).text;
    const { strings } = scanJs(text);
    const embedded = new RegExp(String.raw`(?<![\w/.:-])((?:\.{1,2}\/)*[\w\-.@%~\/]+\.(?:${EXT_RE}))(?![\w])`, 'gi');
    let out = ''; let pos = 0;
    for (const s of strings) {
      const body = text.slice(s.start + 1, s.end - 1);
      let nb = body;
      if (/^(?:\.{1,2}\/)*[\w\-.@%~]+(?:\/[\w\-.@%~]+)*\/$/.test(body) && !body.startsWith('/')) {
        const rel = resolveRef(pageDir, body);
        if (rel != null) this.addDir(rel);
      }
      if (new RegExp(`\\.(?:${EXT_RE})`, 'i').test(body)) {
        nb = body.replace(embedded, (m, p) => {
          if (isExternalUrl(p)) return m;
          const rel = resolveRef(pageDir, p);
          const tok = rel && this.token(rel);
          return tok || m;
        });
      }
      if (nb !== body) { out += text.slice(pos, s.start + 1) + nb; pos = s.end - 1; }
    }
    out += text.slice(pos);
    return out.replace(/<\/script/gi, '<\\/script');
  }
  jsFile(rel, pageDir) {
    const key = `${rel}@${pageDir}`;
    if (key in this.jsIds) return this.jsIds[key];
    const file = safeFile(this.dir, rel);
    if (!file) return null;
    const id = `j${Object.keys(this.js).length + 1}`;
    this.jsIds[key] = id;
    this.js[id] = this.processJs(readText(file), pageDir, rel);
    return id;
  }

  /** One screen document, with markers where the shared css and js go. */
  processHtml(rel) {
    const html = readText(safeFile(this.dir, rel));
    const pageDir = dirOf(rel);
    const tokenRe = /<!--[\s\S]*?-->|<script\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/script\s*>|<style\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/style\s*>|<[a-zA-Z](?:"[^"]*"|'[^']*'|[^>"'])*>/g;
    let out = ''; let pos = 0; let m;
    const deferred = [];
    while ((m = tokenRe.exec(html))) {
      out += html.slice(pos, m.index);
      pos = m.index + m[0].length;
      const piece = m[0];
      if (piece.startsWith('<!--')) { out += piece; continue; }
      const open = /^<(\w+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(piece);
      const tag = open[1].toLowerCase();
      const attrs = attrMap(open[2]);
      if (tag === 'script') out += this.scriptPiece(piece, open, attrs, pageDir, rel, deferred);
      else if (tag === 'style') {
        const body = piece.slice(open[0].length, piece.lastIndexOf('</'));
        out += open[0] + this.processCss(body, pageDir, rel).replace(/<\/style/gi, '<\\/style') + '</style>';
      } else out += this.tagPiece(piece, tag, attrs, pageDir, rel);
    }
    out += html.slice(pos);
    if (deferred.length) out = /<\/body\s*>/i.test(out) ? out.replace(/<\/body\s*>/i, (b) => deferred.join('') + b) : out + deferred.join('');
    return out;
  }
  scriptPiece(piece, open, attrs, pageDir, rel, deferred) {
    const type = (attrs.type || '').toLowerCase();
    const js = type === '' || type === 'module' || /javascript|ecmascript/.test(type);
    if (!js) return piece;
    const mod = type === 'module' ? '|module' : '';
    if (attrs.src !== undefined) {
      if (isExternalUrl(attrs.src)) { this.external.push({ file: rel, url: attrs.src, kind: 'script' }); return ''; }
      const target = resolveRef(pageDir, attrs.src);
      const id = target && this.jsFile(target, pageDir);
      if (!id) { this.unresolved.push({ file: rel, ref: attrs.src }); return piece; }
      const marker = `<!--bp:js:${id}${mod}-->`;
      if ('defer' in attrs && !mod) { deferred.push(marker); return ''; }
      return marker;
    }
    const body = piece.slice(open[0].length, piece.lastIndexOf('</'));
    return open[0] + this.processJs(body, pageDir, rel) + '</script>';
  }
  tagPiece(piece, tag, attrs, pageDir, rel) {
    if (tag === 'link' && /\bstylesheet\b/i.test(attrs.rel || '') && attrs.href !== undefined) {
      if (isExternalUrl(attrs.href)) {
        if (GOOGLE_FONTS.test(attrs.href) || /^(?:https?:)?\/\/fonts\.googleapis\.com\//i.test(attrs.href)) return piece;
        this.external.push({ file: rel, url: attrs.href, kind: 'stylesheet' });
        return '';
      }
      const target = resolveRef(pageDir, attrs.href);
      const id = target && this.cssFile(target);
      if (!id) { this.unresolved.push({ file: rel, ref: attrs.href }); return piece; }
      return `<!--bp:css:${id}${attrs.media ? '|' + attrs.media : ''}-->`;
    }
    return piece.replace(/([\w:-]+)(\s*=\s*)("([^"]*)"|'([^']*)')/g, (m, name, eq, quoted, dq, sq) => {
      const val = dq !== undefined ? dq : sq;
      const q = quoted[0];
      const lname = name.toLowerCase();
      if (lname === 'style') {
        const css = this.processCss(val, pageDir, rel);
        return `${name}${eq}${q}${q === '"' ? css.replace(/"/g, '&quot;') : css.replace(/'/g, '&#39;')}${q}`;
      }
      if (tag === 'a' || tag === 'use') return m;
      if (lname === 'srcset') {
        const nv = val.split(',').map((part) => {
          const [u, ...rest] = part.trim().split(/\s+/);
          if (isExternalUrl(u)) { this.external.push({ file: rel, url: u, kind: 'image' }); return ''; }
          const tok = this.refToken(u, pageDir);
          return [tok || u, ...rest].join(' ');
        }).filter(Boolean).join(', ');
        return `${name}${eq}${q}${nv}${q}`;
      }
      if (/^(?:https?:)?\/\//i.test(val) && ['img', 'source', 'video', 'audio', 'image', 'input', 'embed', 'object'].includes(tag) && ['src', 'poster', 'href', 'xlink:href', 'data'].includes(lname)) {
        if (new RegExp(`\\.(?:${EXT_RE})(?:[?#]|$)`, 'i').test(val) || tag === 'img') { this.external.push({ file: rel, url: val, kind: 'image' }); return ''; }
        return m;
      }
      const tok = this.refToken(val, pageDir);
      return tok ? `${name}${eq}${q}${tok}${q}` : m;
    });
  }
  /** "path.png?x#y" to "bp-asset://N#y" when the file exists. */
  refToken(val, pageDir) {
    const mm = new RegExp(`^(?!(?:[a-z][a-z0-9+.-]*:|//|#|/))([^\\s?#"'<>]+\\.(?:${EXT_RE}))((?:\\?[^#]*)?)((?:#.*)?)$`, 'i').exec(val.trim());
    if (!mm) return null;
    const rel = resolveRef(pageDir, mm[1]);
    const tok = rel && this.token(rel);
    return tok ? tok + mm[3] : null;
  }
}

function attrMap(s) {
  const o = {};
  for (const m of s.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) o[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return o;
}

/** The custom properties of design/tokens.css (the first :root block), without url() values: the shell takes its colors from them. */
function tokenVars(projectDir) {
  const f = safeFile(projectDir, 'design/tokens.css');
  if (!f) return '';
  const m = /:root\s*\{([^}]*)\}/.exec(readText(f).replace(/\/\*[\s\S]*?\*\//g, ''));
  if (!m) return '';
  const decls = m[1].split(';').map((x) => x.trim()).filter((x) => /^--[\w-]+\s*:/.test(x) && !/url\(/i.test(x));
  return `:root{${decls.join(';')}}`;
}

const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function loadDefaultStrings() {
  return JSON.parse(readText(path.join(SHELL_DIR, 'strings.he.json')));
}

/** Builds the prototype. Returns { html, report }. options: { strings, test } */
export function buildPrototype(projectDir, { strings, test = false } = {}) {
  const readJson = (rel, fb) => { try { return JSON.parse(readText(path.join(projectDir, rel))); } catch { return fb; } };
  const map = readJson('.blueprint/map.json', {});
  const state = readJson('.blueprint/state.json', {});
  const names = personaNames(projectDir);
  const str = { ...loadDefaultStrings(), ...(strings || {}) };
  const b = new Bundle(projectDir);

  const screens = [];
  const docs = {};
  const sizes = {};
  for (const s of Array.isArray(map.screens) ? map.screens : []) {
    if (!s || typeof s.file !== 'string') continue;
    const built = Boolean(safeFile(projectDir, s.file)) && /\.html?$/i.test(s.file);
    if (built) { docs[s.file] = b.processHtml(s.file); sizes[s.file] = Buffer.byteLength(docs[s.file]); }
    const persona = typeof s.persona === 'string' && s.persona ? s.persona : null;
    screens.push({ file: s.file, name: String(s.name || s.file), persona, personaName: persona ? (names[persona] || persona) : null, journeyStage: s.journeyStage || null, built });
  }
  const builtScreens = screens.filter((s) => s.built);
  const defaultFile = (builtScreens.find((s) => s.file === 'mockup/index.html') || builtScreens[0] || {}).file || null;
  const project = typeof state.project === 'string' && state.project.trim() ? state.project.trim() : path.basename(path.resolve(projectDir));

  const sources = {};
  for (const [rel, id] of Object.entries(b.cssIds)) sources[id] = rel;
  for (const [key, id] of Object.entries(b.jsIds)) sources[id] = key.split('@')[0];
  const data = { project, strings: str, test: Boolean(test), screens, defaultFile, sources, css: b.css, js: b.js, assets: b.assets, assetIndex: b.assetIndex };
  const read = (f) => readText(path.join(SHELL_DIR, f));
  const boot = `window.__BP_BOOT=${JSON.stringify(read('screen-boot.js')).replace(/</g, '\\u003c')};`;
  const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  const html = fill(read('shell.html'), {
    TITLE: project.replace(/[<>&]/g, ''),
    TOKENS: tokenVars(projectDir).replace(/<\/style/gi, ''),
    CSS: read('shell.css'),
    DATA: jsonForScript(data),
    SCREENS: jsonForScript(docs),
    BOOT: boot,
    JS: read('shell.js').replace(/<\/script/gi, '<\\/script'),
  });
  const bytes = Buffer.byteLength(html);
  const largest = b.assetPaths.map((p, i) => ({ path: p, bytes: b.assets[i].length })).sort((x, y) => y.bytes - x.bytes).slice(0, 5);
  const report = {
    total: screens.length,
    built: builtScreens.length,
    missing: screens.filter((s) => !s.built).map((s) => s.file),
    external: b.external,
    unresolved: b.unresolved,
    bytes,
    assets: b.assets.length,
    screenBytes: sizes,
  };
  if (bytes > MAX_BYTES) { report.tooLarge = true; report.limit = MAX_BYTES; report.largest = largest; }
  return { html, report };
}

// ---------- scan ----------
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;
const NOT_TLD = /^(?:png|jpe?g|gif|webp|svg|css|js|mjs|json|html?|woff2?|ttf|otf|ico|map|txt|md)$/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PHONE_RE = /(?<![\d.])(?:\+972[- ]?|0)(?:5\d[- ]?\d{3}[- ]?\d{4}|[2-4689][- ]?\d{3}[- ]?\d{4})(?!\d)/g;
const NINE_RE = /(?<![\d-])\d{9}(?![\d-])/g;

/** Israeli ID check digit (Luhn-like, weights 1,2,1,2...). */
export function validIsraeliId(s) {
  if (!/^\d{9}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) { let d = Number(s[i]) * (i % 2 === 0 ? 1 : 2); if (d > 9) d -= 9; sum += d; }
  return sum % 10 === 0 && s !== '000000000';
}

/** Personal-data candidates in one text: [{ kind, preview, line, example? }]. */
export function personalCandidates(text) {
  const out = [];
  const lineAt = (i) => text.slice(0, i).split('\n').length;
  for (const m of text.matchAll(EMAIL_RE)) {
    const domain = m[0].split('@')[1];
    if (NOT_TLD.test(domain.split('.').pop())) continue;
    out.push({ kind: 'email', preview: m[0].slice(0, 60), line: lineAt(m.index), example: EXAMPLE_DOMAIN.test(domain) });
  }
  const phoneRanges = [];
  for (const m of text.matchAll(PHONE_RE)) {
    phoneRanges.push([m.index, m.index + m[0].length]);
    out.push({ kind: 'phone', preview: m[0], line: lineAt(m.index) });
  }
  for (const m of text.matchAll(NINE_RE)) {
    if (phoneRanges.some(([a, z]) => m.index >= a && m.index < z)) continue;
    if (validIsraeliId(m[0])) out.push({ kind: 'id', preview: m[0], line: lineAt(m.index) });
  }
  return out;
}

/** Reads a built prototype file and reports secrets and personal-data candidates, per screen. Data URIs are not scanned. */
export function scanPrototype(html) {
  const m = /<script type="application\/json" id="bp-data">([\s\S]*?)<\/script>/.exec(html);
  const sm = /<script type="application\/json" id="bp-screens">([\s\S]*?)<\/script>/.exec(html);
  if (!m || !sm) throw new Error('this is not a prototype file: no bp-data or bp-screens block');
  const data = { ...JSON.parse(m[1]), docs: JSON.parse(sm[1]) };
  const parts = [];
  for (const [file, doc] of Object.entries(data.docs || {})) parts.push({ screen: file, text: doc });
  for (const [id, t] of Object.entries(data.css || {})) parts.push({ screen: (data.sources || {})[id] || `css ${id}`, text: t });
  for (const [id, t] of Object.entries(data.js || {})) parts.push({ screen: (data.sources || {})[id] || `js ${id}`, text: t });
  const secrets = []; const personal = [];
  for (const p of parts) {
    for (const s of scanText(p.text)) secrets.push({ screen: p.screen, ...s });
    for (const c of personalCandidates(p.text)) personal.push({ screen: p.screen, ...c });
  }
  return { secrets, personal };
}
