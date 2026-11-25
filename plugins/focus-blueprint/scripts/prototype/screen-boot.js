(function () {
  var P = window.parent;
  var post = function (m) { try { P.postMessage(m, '*'); } catch (e) { /* no parent */ } };
  window.__bpGo = function (u) { post({ bp: 'go', to: String(u == null ? '' : u) }); };
  var isExternal = function (h) { return /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i.test(h) && !/^javascript:/i.test(h); };
  var pressable = 'a, button, input[type=submit], input[type=button], [role=button]';
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var demo = t.closest('[data-demo]');
    if (demo) {
      if (demo.matches(pressable)) e.preventDefault();
      post({ bp: 'demo' });
      return;
    }
    var a = t.closest('a[href]');
    if (!a) return;
    var h = a.getAttribute('href') || '';
    if (h.charAt(0) === '#') {
      e.preventDefault();
      if (h.length > 1) {
        var id = decodeURIComponent(h.slice(1));
        var el = document.getElementById(id) || document.getElementsByName(id)[0];
        if (el && el.scrollIntoView) el.scrollIntoView();
      }
      return;
    }
    if (/^javascript:/i.test(h)) return;
    e.preventDefault();
    if (isExternal(h)) post({ bp: 'external', href: h });
    else window.__bpGo(h);
  }, true);
  window.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    var act = e.target && e.target.getAttribute && e.target.getAttribute('action');
    if (act && act.charAt(0) !== '#' && !isExternal(act)) window.__bpGo(act);
  });
  // Assets that a script builds at run time (a folder name plus a file name) are swapped for their inlined copy.
  var fixUrl = function (v) {
    if (!v || /^(?:data:|https?:|\/\/|#|blob:)/i.test(v)) return null;
    try { return P.__bpAsset(v); } catch (e) { return null; }
  };
  // Markup written by a script (innerHTML, insertAdjacentHTML) is fixed before the browser parses it, so no request goes out for the original path.
  var fixHtml = function (h) {
    if (typeof h !== 'string' || (h.indexOf('src=') < 0 && h.indexOf('url(') < 0 && h.indexOf('poster=') < 0)) return h;
    return h.replace(/\b(src|poster)=(["'])([^"']+)\2/g, function (m, n, q, u) { var r = fixUrl(u); return r ? n + '=' + q + r + q : m; })
      .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, function (m, q, u) { var r = fixUrl(u); return r ? 'url(' + q + r + q + ')' : m; });
  };
  try {
    var d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { d.set.call(this, fixHtml(v)); } });
    var iah = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (pos, h) { return iah.call(this, pos, fixHtml(h)); };
  } catch (e) { /* the observer below still swaps them */ }
  var fixEl = function (el) {
    if (!el || el.nodeType !== 1) return;
    ['src', 'poster'].forEach(function (n) {
      var v = el.getAttribute(n); var r = fixUrl(v);
      if (r && r !== v) el.setAttribute(n, r);
    });
    var st = el.getAttribute('style');
    if (st && st.indexOf('url(') > -1) {
      var ns = st.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, function (m, q, u) { var r = fixUrl(u); return r ? 'url("' + r + '")' : m; });
      if (ns !== st) el.setAttribute('style', ns);
    }
  };
  var fixTree = function (root) {
    fixEl(root);
    if (root.querySelectorAll) root.querySelectorAll('[src],[poster],[style]').forEach(fixEl);
  };
  var start = function () {
    fixTree(document.documentElement);
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'attributes') fixEl(m.target);
        else m.addedNodes.forEach(fixTree);
      });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'poster', 'style'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
