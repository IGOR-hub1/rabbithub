(function () {
  'use strict';

  // Complementa frame-ancestors/X-Frame-Options quando o HTML é aberto sem
  // os headers do servidor (arquivo local, cache ou hospedagem de teste).
  if (window.self !== window.top) {
    document.documentElement.style.display = 'none';
    try { window.top.location.replace(window.self.location.href); } catch (ignored) {}
    return;
  }

  try { window.opener = null; } catch (ignored) {}
  try { window.name = ''; } catch (ignored) {}

  var blockedProtocols = {
    'javascript:': true,
    'data:': true,
    'file:': true,
    'content:': true,
    'intent:': true,
    'vbscript:': true
  };

  function parsedUrl(value) {
    try { return new URL(String(value || ''), window.location.href); }
    catch (ignored) { return null; }
  }

  function unsafeUrl(value) {
    var url = parsedUrl(value);
    return !url || !!blockedProtocols[String(url.protocol || '').toLowerCase()];
  }

  function hardenAnchor(anchor) {
    if (!anchor || !anchor.getAttribute) return;
    var raw = anchor.getAttribute('href');
    if (!raw) return;
    if (unsafeUrl(raw)) {
      anchor.removeAttribute('href');
      anchor.setAttribute('aria-disabled', 'true');
      anchor.setAttribute('data-rh-blocked-link', 'true');
      return;
    }
    var url = parsedUrl(raw);
    if (anchor.target === '_blank' || (url && /^https?:$/.test(url.protocol)
        && url.origin !== window.location.origin)) {
      var rel = String(anchor.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
      ['noopener', 'noreferrer'].forEach(function (value) {
        if (rel.indexOf(value) < 0) rel.push(value);
      });
      anchor.setAttribute('rel', rel.join(' '));
    }
  }

  function formIsSafe(form) {
    var raw = form && form.getAttribute && form.getAttribute('action');
    if (!raw) return true;
    var url = parsedUrl(raw);
    return !!url && /^https?:$/.test(url.protocol) && url.origin === window.location.origin;
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (String(root.tagName).toLowerCase() === 'a') hardenAnchor(root);
    var anchors = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    for (var i = 0; i < anchors.length; i++) hardenAnchor(anchors[i]);
  }

  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== document && String(node.tagName).toLowerCase() !== 'a') {
      node = node.parentNode;
    }
    if (!node || node === document) return;
    hardenAnchor(node);
    if (node.getAttribute('data-rh-blocked-link') === 'true') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('submit', function (event) {
    if (!formIsSafe(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  function start() {
    scan(document.documentElement);
    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        for (var j = 0; j < records[i].addedNodes.length; j++) scan(records[i].addedNodes[j]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
