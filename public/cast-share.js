(function () {
  'use strict';

  var idPattern = /^[A-Za-z0-9_-]{1,128}$/;
  var codePattern = /^[1-9][0-9]{6}$/;
  var currentContext = null;
  var sessions = Object.create(null);
  var active = null;
  var busy = false;
  var lastFocus = null;

  function $(id) { return document.getElementById(id); }
  function sourceUrl(value) {
    try {
      var url = new URL(String(value || ''));
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : '';
    } catch (_) { return ''; }
  }
  function supportedIframe(value) {
    try {
      var url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.hostname !== 'serv01.meusdoramas.club' ||
          url.port || url.username || url.password || url.pathname !== '/' || url.search) return null;
      var route = url.hash.match(/^#\/video\/([0-9]{1,12})\/([0-9]{1,4})\/([0-9]{1,4})\/$/);
      if (!route) return null;
      return { animeId: 'md_' + route[1], episodeId: 's' + route[2] + '_e' + route[3],
        sourceId: 'serv01_iframe', iframeUrl: url.href };
    } catch (_) { return null; }
  }
  function episodeKey(value) {
    try {
      var url = new URL(String(value || ''), 'https://meusanimes.blog/');
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch (_) { return ''; }
  }
  function castOrigin() {
    var configured = window.XBUNNY_CAST_SHARE_CONFIG && window.XBUNNY_CAST_SHARE_CONFIG.origin;
    try {
      var url = new URL(String(configured || ''));
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
          (url.pathname === '/' || !url.pathname)) return url.origin;
    } catch (_) {}
    return '';
  }
  function matchSource(context) {
    var config = window.XBUNNY_CAST_SHARE_CONFIG || {};
    var entries = Array.isArray(config.entries) ? config.entries : [];
    var selected = sourceUrl(context.sourceUrl);
    var direct = selected && entries.find(function (item) {
      return item && item.animeSlug === context.animeSlug &&
        episodeKey(item.episodeLink) === episodeKey(context.episodeLink) &&
        Array.isArray(item.sourceUrls) && item.sourceUrls.indexOf(selected) >= 0 &&
        idPattern.test(item.animeId) && idPattern.test(item.episodeId) && idPattern.test(item.sourceId);
    });
    return direct || supportedIframe(context.iframeUrl);
  }
  function makeCode() {
    if (!window.crypto || !window.crypto.getRandomValues) throw new Error('Este WebView não oferece geração segura de códigos.');
    var sample = new Uint32Array(1);
    var range = 9000000;
    var limit = Math.floor(4294967296 / range) * range;
    do { window.crypto.getRandomValues(sample); } while (sample[0] >= limit);
    var code = String(1000000 + sample[0] % range);
    if (!codePattern.test(code)) throw new Error('Não foi possível gerar o código.');
    return code;
  }
  function status(message, kind) {
    var node = $('dk-cast-status');
    if (!node) return;
    node.textContent = message || '';
    node.setAttribute('data-kind', kind || '');
  }
  function show() {
    var modal = $('dk-cast-modal');
    if (!modal) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    $('dk-btn-cast').setAttribute('aria-expanded', 'true');
    $('dk-cast-close').focus();
  }
  function hide() {
    var modal = $('dk-cast-modal');
    if (!modal) return;
    modal.hidden = true;
    $('dk-btn-cast').setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function controls(enabled) {
    $('dk-cast-copy').disabled = !enabled;
    $('dk-cast-end').disabled = !enabled;
  }
  function contextKey(context, item) {
    return context.animeSlug + '|' + episodeKey(context.episodeLink) + '|' + item.sourceId + '|' + (item.iframeUrl || '');
  }
  async function create() {
    if (busy) return;
    show();
    var context = currentContext;
    $('dk-cast-link').value = '';
    controls(false);
    $('dk-cast-anime').textContent = context && context.animeTitle || 'Anime';
    $('dk-cast-episode').textContent = context && context.episodeTitle || 'Episódio';
    if (!context) { controls(false); status('Esta fonte não permite compartilhamento pelo Cast.', 'error'); return; }
    var origin = castOrigin();
    if (!origin) { controls(false); status('O domínio HTTPS do X-Bunny Cast ainda não foi configurado.', 'error'); return; }
    var item = matchSource(context);
    if (!item) { controls(false); status('Esta fonte ainda não foi autorizada para reprodução no X-Bunny Cast.', 'error'); return; }
    var key = contextKey(context, item);
    active = sessions[key] || null;
    if (active && active.expiresAt > Date.now()) {
      $('dk-cast-link').value = active.link;
      controls(true);
      status('Link pronto para abrir em outro navegador.', 'success');
      return;
    }
    var user = window.firebase && firebase.auth && firebase.auth().currentUser;
    var session = window.RabbitHubSession && window.RabbitHubSession.get ? window.RabbitHubSession.get() : null;
    if (!user || !user.emailVerified || !session || session.status !== 'authenticated' || session.uid !== user.uid) {
      controls(false);
      status('Entre com uma conta verificada para transmitir.', 'error');
      return;
    }
    busy = true;
    controls(false);
    $('dk-cast-link').value = '';
    status('Criando um link exclusivo…');
    try {
      if (window.navigator && window.navigator.onLine === false) throw new Error('Sem conexão com a internet.');
      await user.getIdToken(true);
      if (firebase.auth().currentUser !== user) throw new Error('Sua sessão mudou. Entre novamente.');
      var db = firebase.database();
      var offset = await db.ref('.info/serverTimeOffset').once('value');
      var code, payload, saved = false;
      for (var attempt = 0; attempt < 8 && !saved; attempt++) {
        code = makeCode();
        payload = {
          id: code, ownerUid: user.uid,
          animeId: item.animeId, episodeId: item.episodeId, sourceId: item.sourceId,
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          expiresAt: Math.floor(Date.now() + (Number(offset.val()) || 0) + 2 * 60 * 60 * 1000),
          status: 'active'
        };
        if (item.iframeUrl) payload.iframeUrl = item.iframeUrl;
        var result = await db.ref('castSessions/' + code).transaction(function (current) {
          return current === null ? payload : undefined;
        }, undefined, false);
        saved = result.committed === true;
      }
      if (!saved) throw new Error('Não foi possível reservar um código. Tente novamente.');
      var link = origin + '/assistir/' + code;
      active = { code: code, key: key, link: link, expiresAt: payload.expiresAt };
      sessions[key] = active;
      $('dk-cast-link').value = link;
      controls(true);
      status('Link pronto. Ele continua válido mesmo após fechar o aplicativo, até expirar ou ser encerrado.', 'success');
    } catch (error) {
      var denied = error && (error.code === 'PERMISSION_DENIED' || error.code === 'permission_denied');
      status(denied ? 'O Firebase recusou a sessão. Confirme a fonte autorizada e as regras do Cast.' :
        (error && error.message || 'Falha de conexão ao criar a sessão. Tente novamente.'), 'error');
    } finally { busy = false; }
  }
  async function copy() {
    var input = $('dk-cast-link');
    if (!active || !input.value) return;
    var copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(input.value);
        copied = true;
      }
    } catch (_) {}
    if (!copied) {
      input.focus();
      input.select();
      try { copied = document.execCommand('copy') === true; } catch (_) {}
    }
    status(copied ? 'Link copiado.' : 'Não foi possível copiar automaticamente. Selecione o link e copie manualmente.', copied ? 'success' : 'error');
  }
  async function end() {
    if (!active || busy) return;
    busy = true;
    controls(false);
    status('Encerrando compartilhamento…');
    try {
      var user = firebase.auth().currentUser;
      if (!user) throw new Error('Sua conta não está autenticada.');
      await user.getIdToken(true);
      await firebase.database().ref('castSessions/' + active.code + '/status').set('ended');
      delete sessions[active.key];
      active = null;
      $('dk-cast-link').value = '';
      status('Compartilhamento encerrado. O link não reproduz mais o episódio.', 'success');
    } catch (error) {
      controls(true);
      status(error && error.message || 'Não foi possível encerrar. Verifique a conexão e tente novamente.', 'error');
    } finally { busy = false; }
  }
  function init() {
    var button = $('dk-btn-cast');
    if (!button) return;
    button.addEventListener('click', function (event) { event.stopPropagation(); create(); });
    $('dk-cast-copy').addEventListener('click', copy);
    $('dk-cast-end').addEventListener('click', end);
    $('dk-cast-close').addEventListener('click', hide);
    $('dk-cast-modal').addEventListener('click', function (event) { if (event.target === this) hide(); });
    document.addEventListener('keydown', function (event) {
      if ($('dk-cast-modal').hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); hide(); }
      if (event.key === 'Tab') {
        var first = $('dk-cast-close'), last = $('dk-cast-end');
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }
  window.XBunnyCastShare = Object.freeze({ setContext: function (context) { currentContext = context; }, create: create, copy: copy, end: end });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
