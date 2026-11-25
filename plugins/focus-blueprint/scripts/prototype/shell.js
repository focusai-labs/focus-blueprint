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

  var init = function () {
    document.documentElement.lang = 'he'; document.documentElement.dir = 'rtl';
    $('bp-project').textContent = D.project;
    $('bp-banner').textContent = S.banner;
    $('bp-phone').textContent = S.phone; $('bp-computer').textContent = S.computer;
    $('bp-device').setAttribute('aria-label', S.device);
    $('bp-map-btn').textContent = S.pageMap;
    $('bp-dialog-title').textContent = S.pageMap;
    $('bp-dialog-close').textContent = S.close;
    $('bp-ph-back').textContent = S.back;
    if (TEST) { $('bp-map-btn').hidden = true; $('bp-device').hidden = true; }
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
    frame: frame, resolveTo: resolveTo, kindOf: kindOf, test: TEST,
  };
  init();
})();
