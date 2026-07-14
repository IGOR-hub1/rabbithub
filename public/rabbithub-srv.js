/* RABBITHUB — shim para roteamento do servidor embutido no APK.
   Redireciona /proxy?... e /stream?... para o servidor local que
   o app RABBITHUB gera na Wi-Fi (passado via ?srv=... na URL). */
(function () {
  try {
    var p = new URLSearchParams(location.search);
    var s = p.get('srv');
    if (s) {
      try { localStorage.setItem('DK_SRV', s); } catch (_) {}
    }
    var SRV = '';
    try { SRV = localStorage.getItem('DK_SRV') || ''; } catch (_) {}
    if (!SRV) return; // sem servidor -> nada a fazer (usuário fora do APK)
    SRV = SRV.replace(/\/+$/, '');
    window.__DK_SRV__ = SRV;

    function rewrite(u) {
      if (!u) return u;
      if (typeof u !== 'string') {
        try { u = u.toString(); } catch (_) { return u; }
      }
      // Já absoluto para o servidor? deixa
      if (u.indexOf(SRV) === 0) return u;
      // Caminhos relativos ou absolutos do mesmo host
      if (u.indexOf('/proxy?') === 0 || u.indexOf('/stream?') === 0) {
        return SRV + u;
      }
      // URLs absolutas com o host atual + /proxy | /stream
      try {
        var url = new URL(u, location.href);
        if (url.origin === location.origin &&
            (url.pathname === '/proxy' || url.pathname === '/stream')) {
          return SRV + url.pathname + url.search;
        }
      } catch (_) {}
      return u;
    }

    // fetch
    var _fetch = window.fetch;
    if (_fetch) {
      window.fetch = function (input, init) {
        try {
          if (typeof input === 'string') {
            input = rewrite(input);
          } else if (input && input.url) {
            var nu = rewrite(input.url);
            if (nu !== input.url) input = new Request(nu, input);
          }
        } catch (_) {}
        return _fetch.call(this, input, init);
      };
    }

    // XHR
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { arguments[1] = rewrite(u); } catch (_) {}
      return _open.apply(this, arguments);
    };

    // Elementos <video>/<source>/<img> com src /proxy | /stream
    function patchAttr(el, attr) {
      try {
        var v = el.getAttribute(attr);
        var nv = rewrite(v);
        if (nv && nv !== v) el.setAttribute(attr, nv);
      } catch (_) {}
    }
    var mo = new MutationObserver(function (recs) {
      recs.forEach(function (r) {
        r.addedNodes && r.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.hasAttribute && n.hasAttribute('src')) patchAttr(n, 'src');
          if (n.querySelectorAll) {
            n.querySelectorAll('[src]').forEach(function (e) { patchAttr(e, 'src'); });
          }
        });
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* silencioso */ }
})();
