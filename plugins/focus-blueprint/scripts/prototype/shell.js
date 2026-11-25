(function () {
  var D = JSON.parse(document.getElementById('bp-data').textContent);
  D.docs = JSON.parse(document.getElementById('bp-screens').textContent);
  var S = D.strings;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (k, v) { return String(S[k] || '').replace(/\{(\w+)\}/g, function (m, n) { return v && v[n] != null ? v[n] : m; }); };
  var query = location.search;
  var TEST = D.test === true || /[?&]test=1(?:&|$)/.test(query);
  var EMBED = /[?&]embed=1(?:&|$)/.test(query);
  var byFile = {};
  D.screens.forEach(function (s) { byFile[s.file] = s; });
  var frame = $('bp-frame');
  var stage = $('bp-stage');
  var current = { file: null, search: '', kind: null };
  var navCount = 0;
  var events = [];
  var pendingLoad = null;
  var expandedCache = {};

  // ---------- text pieces ----------
  var assetUri = function (n) { return D.assets[n]; };
  var expand = function (s) { return s.replace(/bp-asset:\/\/(\d+)/g, function (m, n) { return assetUri(+n) || ''; }); };
  var piece = function (kind, id) {
    var key = kind + id;
    if (!(key in expandedCache)) expandedCache[key] = expand(D[kind][id] || '');
    return expandedCache[key];
  };
  var composeDoc = function (file) {
    var html = D.docs[file];
    html = html.replace(/<!--bp:(css|js):([\w]+)(?:\|([^>]*?))?-->/g, function (m, kind, id, mod) {
      if (kind === 'css') return '<style' + (mod ? ' media="' + mod.replace(/"/g, '&quot;') + '"' : '') + '>' + piece('css', id) + '</style>';
      return '<script' + (mod === 'module' ? ' type="module"' : '') + '>' + piece('js', id) + '</script>';
    });
    return expand(html);
  };
  var norm = function (base, rel) {
    var parts = base ? base.split('/') : [];
    rel.split('/').forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') { if (!parts.length) parts = null; else parts.pop(); if (!parts) return; return; }
      parts.push(p);
    });
    return parts ? parts.join('/') : null;
  };
  var dirOf = function (f) { var i = (f || '').lastIndexOf('/'); return i < 0 ? '' : f.slice(0, i); };
  var resolveTo = function (fromFile, to) {
    var t = String(to).split('#')[0];
    var q = '';
    var qi = t.indexOf('?');
    if (qi > -1) { q = t.slice(qi); t = t.slice(0, qi); }
    if (t === '') return { file: fromFile, search: q };
    var abs = t.charAt(0) === '/';
    var parts = [];
    var segs = (abs ? t.slice(1) : dirOf(fromFile) + '/' + t).split('/');
    var ok = true;
    segs.forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') { if (!parts.length) ok = false; else parts.pop(); return; }
      try { p = decodeURIComponent(p); } catch (e) { /* keep */ }
      parts.push(p);
    });
    return { file: ok ? parts.join('/') : t, search: q };
  };
  window.__bpAsset = function (value) {
    var v = String(value).split('#')[0].split('?')[0];
    var p = resolveTo(current.file || '', v).file;
    var n = D.assetIndex[p];
    return n == null ? null : assetUri(n);
  };

  // ---------- routes ----------
  var routeOf = function (file, search) {
    var r;
    if (/^mockup\/.+\.html$/.test(file)) r = file.slice(7, -5);
    else if (/\.html$/.test(file)) r = '../' + file.slice(0, -5);
    else r = /^mockup\//.test(file) ? file.slice(7) : '../' + file;
    return '#/' + r + (search || '');
  };
  var fileOf = function (r) {
    if (r.slice(0, 3) === '../') return r.slice(3) + (/\.[a-z0-9]{1,5}$/i.test(r) ? '' : '.html');
    if (/\.[a-z0-9]{1,5}$/i.test(r)) return 'mockup/' + r;
    return 'mockup/' + r + '.html';
  };
  var parseHash = function () {
    var h = location.hash;
    if (h.indexOf('#/') !== 0) return null;
    var body = h.slice(2);
    var qi = body.indexOf('?');
    var r = qi > -1 ? body.slice(0, qi) : body;
    try { r = decodeURIComponent(r); } catch (e) { /* keep */ }
    return { file: fileOf(r), search: qi > -1 ? body.slice(qi) : '' };
  };
  var kindOf = function (file) {
    var s = byFile[file];
    if (!s) return 'unknown';
    return s.built ? 'built' : 'missing';
  };
  var postUp = function (m) { if (window.parent !== window) { try { window.parent.postMessage(m, '*'); } catch (e) { /* ignore */ } } };

  var render = function (file, search) {
    var kind = kindOf(file);
    current = { file: file, search: search || '', kind: kind };
    var ph = $('bp-placeholder');
    var wrap = $('bp-frame-wrap');
    if (kind === 'built') {
      ph.hidden = true; wrap.hidden = false;
      var boot = 'window.__bpSearch=' + JSON.stringify(current.search) + ';window.__bpPath=' + JSON.stringify('/' + file) + ';' + window.__BP_BOOT;
      var html = composeDoc(file);
      var inj = '<script>' + boot.replace(/<\/script/gi, '<\\/script') + '<\/script>';
      var m = /<head\b[^>]*>/i.exec(html) || /<html\b[^>]*>/i.exec(html) || /^\s*<!doctype[^>]*>/i.exec(html);
      html = m ? html.slice(0, m.index + m[0].length) + inj + html.slice(m.index + m[0].length) : inj + html;
      var done = new Promise(function (res) { pendingLoad = res; });
      frame.title = byFile[file].name;
      frame.srcdoc = html;
      render.done = done;
    } else {
      wrap.hidden = true; ph.hidden = false;
      var s = byFile[file];
      $('bp-ph-title').textContent = kind === 'missing' ? S.missingTitle : S.unknownTitle;
      $('bp-ph-text').textContent = kind === 'missing' ? fmt('missingText', { name: s.name }) : fmt('unknownText', { file: file });
      frame.srcdoc = '';
      render.done = Promise.resolve();
    }
    markCurrent();
    paintBadge();
    notesRefresh();
    postUp({ bp: 'route', file: file, state: current.search ? current.search.replace(/^\?(?:state=)?/, '') : '' });
    return render.done;
  };
  frame.addEventListener('load', function () { if (pendingLoad) { var r = pendingLoad; pendingLoad = null; r(); } });

  var route = function (file, search, force) {
    var want = routeOf(file, search);
    if (location.hash === want) return force ? render(file, search) : (render.done || Promise.resolve());
    suppress = true;
    location.hash = want;
    return render(file, search);
  };
  var suppress = false;
  window.addEventListener('hashchange', function () {
    if (suppress) { suppress = false; navCount++; return; }
    var p = parseHash();
    if (p) render(p.file, p.search);
  });

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (e.source === frame.contentWindow) {
      if (m.bp === 'go') {
        var t = resolveTo(current.file, m.to);
        events.push({ t: 'go', to: m.to, file: t.file, search: t.search, kind: kindOf(t.file) });
        route(t.file, t.search, true);
      } else if (m.bp === 'demo') { events.push({ t: 'demo' }); toast(S.demo); }
      else if (m.bp === 'external') { events.push({ t: 'external', href: m.href }); toast(S.external); }
      return;
    }
    if (e.source === window.parent && window.parent !== window) {
      if (m.bp === 'nav' && typeof m.file === 'string') {
        var st = typeof m.state === 'string' && m.state ? (m.state.charAt(0) === '?' ? m.state : '?state=' + m.state) : '';
        route(m.file, st, true);
      } else if (m.bp === 'device' && (m.value === 'phone' || m.value === 'computer')) setDevice(m.value);
    }
  });

  // ---------- chrome ----------
  var toastTimer;
  var toast = function (text) {
    var t = $('bp-toast');
    t.textContent = text; t.dataset.show = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.dataset.show = 'false'; }, 3500);
  };
  var setDevice = function (v) {
    stage.dataset.device = v;
    $('bp-phone').setAttribute('aria-pressed', String(v === 'phone'));
    $('bp-computer').setAttribute('aria-pressed', String(v === 'computer'));
  };
  var markCurrent = function () {
    document.querySelectorAll('#bp-groups a').forEach(function (a) {
      if (a.dataset.file === current.file) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  };
  var buildMap = function () {
    var built = D.screens.filter(function (s) { return s.built; }).length;
    $('bp-counter').textContent = fmt('counter', { built: built, total: D.screens.length });
    var groups = []; var idx = {};
    D.screens.forEach(function (s) {
      var key = s.personaName || S.noPersona;
      if (!(key in idx)) { idx[key] = groups.length; groups.push({ name: key, items: [] }); }
      groups[idx[key]].items.push(s);
    });
    var host = $('bp-groups');
    host.textContent = '';
    groups.forEach(function (g) {
      var sec = document.createElement('section');
      var h = document.createElement('h3'); h.textContent = g.name; sec.appendChild(h);
      var ul = document.createElement('ul');
      g.items.forEach(function (s) {
        var li = document.createElement('li');
        if (s.built) {
          var a = document.createElement('a');
          a.href = routeOf(s.file, ''); a.dataset.file = s.file; a.textContent = s.name;
          a.addEventListener('click', function () { setTimeout(function () { $('bp-dialog').close(); }, 0); });
          li.appendChild(a);
        } else {
          var sp = document.createElement('span');
          sp.className = 'bp-dim'; sp.setAttribute('aria-disabled', 'true'); sp.dataset.file = s.file;
          sp.appendChild(document.createTextNode(s.name));
          var sm = document.createElement('small'); sm.textContent = S.notBuilt; sp.appendChild(sm);
          li.appendChild(sp);
        }
        ul.appendChild(li);
      });
      sec.appendChild(ul); host.appendChild(sec);
    });
  };

  var paintBadge = function () {
    var s = byFile[current.file];
    $('bp-badge').textContent = s ? s.name : (current.file || '');
  };

  // ---------- notes ----------
  var notesMode = null; // 'artifact' | 'server' | 'file'
  var comments = null; var anchors = null; var commentMode = false; var lastThreads = [];
  var serverBase = null;
  var LS_KEY = 'bp-notes:' + (D.project || '');
  var statusEl = function (text) { $('bp-notes-status').textContent = text || ''; };
  var fmtTime = function (iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); };
  var localNotes = function () { try { var a = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  var saveLocalNotes = function (a) { try { localStorage.setItem(LS_KEY, JSON.stringify(a)); return true; } catch (e) { return false; } };
  var paintList = function (list) {
    var ul = $('bp-notes-list');
    ul.textContent = '';
    list.forEach(function (n) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(n.text));
      var sm = document.createElement('small'); sm.textContent = fmtTime(n.at); li.appendChild(sm);
      ul.appendChild(li);
    });
    $('bp-notes-earlier-title').hidden = list.length === 0;
  };
  var notesRefresh = function () {
    if (!notesMode || notesMode === 'artifact') { placeThreads(); return; }
    var file = current.file;
    if (!file) { paintList([]); return; }
    if (notesMode === 'file') { paintList(localNotes().filter(function (n) { return n.screen === file; })); return; }
    fetch(serverBase + 'api/prototype-notes?screen=' + encodeURIComponent(file)).then(function (r) { return r.json(); }).then(function (j) {
      if (current.file === file) paintList(Array.isArray(j.notes) ? j.notes : []);
    }).catch(function () { paintList([]); });
  };
  var saveNote = function () {
    var ta = $('bp-notes-text');
    var text = ta.value.trim();
    if (!text || !current.file) return;
    var file = current.file;
    var done = function () { ta.value = ''; statusEl(S.saved); notesRefresh(); };
    if (notesMode === 'file') {
      var all = localNotes(); all.push({ screen: file, text: text, at: new Date().toISOString() });
      if (saveLocalNotes(all)) done();
      return;
    }
    fetch(serverBase + 'api/prototype-notes', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ screen: file, text: text }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { if (x.ok) done(); else statusEl(String((x.j && x.j.error) || '')); })
      .catch(function () { statusEl(''); });
  };
  var copyAll = function () {
    var by = {};
    localNotes().forEach(function (n) { (by[n.screen] = by[n.screen] || []).push(n.text); });
    var out = [];
    D.screens.forEach(function (s) { if (by[s.file]) out.push(s.name + '\n' + by[s.file].join('\n')); });
    var text = out.join('\n\n');
    var ok = function () { statusEl(S.copied); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) ok(); } catch (e) { /* ignore */ }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  };
  var openPanel = function () {
    var p = $('bp-notes');
    p.hidden = false; statusEl(''); notesRefresh();
    $('bp-notes-text').focus();
  };
  var closePanel = function () { $('bp-notes').hidden = true; $('bp-note-btn').focus(); };
  var composeAt = function (el) {
    if (!anchors || !current.file) return;
    var s = byFile[current.file];
    anchors.compose(current.file, el, { label: s ? s.name : current.file }).catch(function () { /* the shell shows its own errors */ });
  };
  var placeThreads = function () {
    if (!anchors) return;
    var r = $('bp-badge').getBoundingClientRect();
    var pt = { x: r.left + window.pageXOffset + r.width / 2, y: r.top + window.pageYOffset };
    var map = {};
    lastThreads.forEach(function (t) { if (t.anchor === current.file) map[t.id] = pt; });
    try { anchors.placed(map); } catch (e) { /* ignore */ }
  };
  var initArtifactNotes = function () {
    var btn = $('bp-note-btn');
    comments.customAnchors({
      mode: function (on) { commentMode = on; $('bp-cover').hidden = !on; },
      threads: function (list) { lastThreads = list || []; placeThreads(); },
      reveal: function (id) {
        var t = lastThreads.filter(function (x) { return x.id === id; })[0];
        if (t && byFile[t.anchor]) route(t.anchor, '', true);
      },
    }).then(function (a) { anchors = a; placeThreads(); }).catch(function () { anchors = null; });
    btn.hidden = TEST;
    btn.addEventListener('click', function () {
      if (anchors) composeAt($('bp-badge'));
      else comments.openComposer({ element: $('bp-badge') }).catch(function () { /* ignore */ });
    });
    $('bp-cover').addEventListener('click', function (e) {
      if (anchors && current.file) anchors.compose(current.file, { x: e.pageX, y: e.pageY }, { label: (byFile[current.file] || {}).name }).catch(function () {});
    });
  };
  var initNotes = function () {
    var btn = $('bp-note-btn');
    $('bp-notes-title').textContent = S.notesTitle;
    $('bp-notes-label').textContent = S.noteLabel;
    $('bp-notes-save').textContent = S.save;
    $('bp-notes-copy').textContent = S.copyAll;
    $('bp-notes-close').textContent = S.close;
    $('bp-notes-earlier-title').textContent = S.earlierNotes;
    $('bp-notes-earlier-title').hidden = true;
    if (TEST || EMBED) return;
    var wired = false;
    var wire = function () {
      if (wired) return; wired = true;
      btn.hidden = false;
      btn.addEventListener('click', function () { if ($('bp-notes').hidden) openPanel(); else closePanel(); });
      $('bp-notes-save').addEventListener('click', saveNote);
      $('bp-notes-copy').addEventListener('click', copyAll);
      $('bp-notes-close').addEventListener('click', closePanel);
      $('bp-notes').addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    };
    if (window.claude && typeof window.claude.use === 'function') {
      // published as an artifact: the comments of the viewer's shell, or no note button at all
      notesMode = 'artifact';
      window.claude.use('comments').then(function (c) { if (c) { comments = c; initArtifactNotes(); } }).catch(function () { /* unavailable */ });
      return;
    }
    var i = location.pathname.indexOf('/files/mockup/');
    if (i >= 0 && /^https?:$/.test(location.protocol)) { notesMode = 'server'; serverBase = location.pathname.slice(0, i + 1); }
    else { notesMode = 'file'; $('bp-notes-copy').hidden = false; }
    wire();
  };

  var init = function () {
    document.documentElement.lang = 'he'; document.documentElement.dir = 'rtl';
    $('bp-label').textContent = S.label;
    $('bp-note-btn').textContent = S.note;
    $('bp-phone').textContent = S.phone; $('bp-computer').textContent = S.computer;
    $('bp-device').setAttribute('aria-label', S.device);
    $('bp-map-btn').textContent = S.pageMap;
    $('bp-dialog-title').textContent = S.pageMap;
    $('bp-dialog-close').textContent = S.close;
    $('bp-ph-back').textContent = S.back;
    if (TEST) { $('bp-map-btn').hidden = true; $('bp-note-btn').hidden = true; $('bp-device').hidden = true; }
    if (EMBED) $('bp-device').hidden = true;
    var fsBtn = $('bp-fs-btn'); var rootEl = document.documentElement;
    var fsOn = function () { return !!(document.fullscreenElement || document.webkitFullscreenElement); };
    if (!EMBED && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
      var paintFs = function () { var on = fsOn(); fsBtn.textContent = on ? S.exitFullscreen : S.fullscreen; fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
      fsBtn.hidden = false; paintFs();
      fsBtn.addEventListener('click', function () {
        if (fsOn()) { var ex = document.exitFullscreen || document.webkitExitFullscreen; if (ex) ex.call(document); return; }
        var rq = rootEl.requestFullscreen || rootEl.webkitRequestFullscreen;
        if (rq) { var pr = rq.call(rootEl); if (pr && pr.catch) pr.catch(function () {}); }
      });
      document.addEventListener('fullscreenchange', paintFs); document.addEventListener('webkitfullscreenchange', paintFs);
    }
    buildMap();
    initNotes();
    setDevice(window.innerWidth >= 900 ? 'computer' : 'phone');
    $('bp-phone').addEventListener('click', function () { setDevice('phone'); });
    $('bp-computer').addEventListener('click', function () { setDevice('computer'); });
    var dlg = $('bp-dialog'); var btn = $('bp-map-btn');
    btn.addEventListener('click', function () { markCurrent(); dlg.showModal(); });
    $('bp-dialog-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { btn.focus(); });
    $('bp-ph-back').addEventListener('click', function () {
      if (navCount > 0 && history.length > 1) history.back(); else route(D.defaultFile, '', false);
    });
    var p = parseHash();
    var first = p || { file: D.defaultFile, search: '' };
    if (!p && D.defaultFile) { suppress = false; history.replaceState(null, '', routeOf(first.file, '')); }
    if (D.defaultFile || p) render(first.file, first.search);
    if (window.parent !== window) {
      postUp({ bp: 'ready', screens: D.screens.map(function (s) { return { file: s.file, name: s.name, persona: s.persona, built: s.built }; }) });
    }
  };

  window.__bp = {
    data: D, events: events, route: route, current: function () { return current; },
    frame: frame, notesMode: function () { return notesMode; }, resolveTo: resolveTo, kindOf: kindOf, test: TEST,
  };
  init();
})();
