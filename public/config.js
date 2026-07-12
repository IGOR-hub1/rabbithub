/* =========================================================
 * CONFIG • Aponta o frontend (Vercel) para o backend (LunesHost)
 * ---------------------------------------------------------
 * Troque o valor abaixo pela URL pública do seu servidor na
 * LunesHost. Ex.: "https://meuserver.luneshost.com"
 * Deixe SEM barra no final.
 * ========================================================= */
window.LUNES_BACKEND = "https://node62.lunes.host:3224.luneshost.com";

(function () {
  var BACKEND = (window.LUNES_BACKEND || "").replace(/\/+$/, "");
  if (!BACKEND) return;

  function rewrite(u) {
    if (typeof u !== "string") return u;
    if (u.indexOf("/proxy?") === 0 || u.indexOf("/stream?") === 0) {
      return BACKEND + u;
    }
    return u;
  }

  // 1) fetch()
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      if (typeof input === "string") input = rewrite(input);
      else if (input && input.url && (input.url.indexOf("/proxy?") === 0 || input.url.indexOf("/stream?") === 0)) {
        input = new Request(rewrite(input.url), input);
      }
      return origFetch(input, init);
    };
  }

  // 2) XMLHttpRequest
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, u) {
    arguments[1] = rewrite(u);
    return origOpen.apply(this, arguments);
  };

  // 3) src de <video>, <source>, <iframe>, <img> atribuído via JS
  ["HTMLVideoElement", "HTMLSourceElement", "HTMLIFrameElement", "HTMLImageElement"].forEach(function (name) {
    var proto = window[name] && window[name].prototype;
    if (!proto) return;
    var desc = Object.getOwnPropertyDescriptor(proto, "src") ||
               Object.getOwnPropertyDescriptor(HTMLElement.prototype, "src");
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) { desc.set.call(this, rewrite(v)); }
    });
  });

  // 4) setAttribute("src", ...)
  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === "src") value = rewrite(value);
    return origSetAttr.call(this, name, value);
  };
})();
