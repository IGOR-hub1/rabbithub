/* =====================================================================
 * DRAKSYON • Broadcast + Manutenção (Firebase Realtime DB)
 * ---------------------------------------------------------------------
 *  /dk_broadcast/current      -> { id, title, body, buttonText, buttonUrl,
 *                                  variant: 'info'|'success'|'warning'|'announce',
 *                                  dismissible: bool, views: int, updatedAt }
 *  /dk_broadcast/maintenance  -> { enabled: bool, title, body, until, updatedAt }
 *
 *  Estética 100% alinhada ao site (mesmos tokens, mesma linguagem visual
 *  do .card / .card-head / .btn / .btn.ghost).
 * ===================================================================== */
(function () {
  if (window.__DK_MSG_INIT__) return;
  window.__DK_MSG_INIT__ = true;

  var SEEN_KEY = 'dk_msg_seen_id';

  /* ---------------- CSS (segue exatamente o design system do site) ---------------- */
  var css = [
    /* overlay */
    '.dk-ov{position:fixed;inset:0;background:rgba(6,6,8,.72);backdrop-filter:blur(12px) saturate(1.1);-webkit-backdrop-filter:blur(12px) saturate(1.1);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .22s ease}',
    '.dk-ov.show{opacity:1;pointer-events:auto}',

    /* ===== CARD — idêntico ao .card do site ===== */
    '.dk-card{width:100%;max-width:420px;background:var(--bg-elev-1,#111113);border:1px solid var(--border,rgba(255,255,255,.06));border-radius:var(--r-xl,16px);overflow:hidden;box-shadow:var(--shadow-lg,0 20px 50px -12px rgba(0,0,0,.8));font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--text,#fff);transform:translateY(12px) scale(.98);transition:transform .32s cubic-bezier(.34,1.56,.64,1)}',
    '.dk-ov.show .dk-card{transform:none}',

    /* ===== CARD-HEAD — idêntico ao .card-head do site ===== */
    '.dk-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border,rgba(255,255,255,.06))}',
    '.dk-logo{width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;border:1px solid var(--border-strong,rgba(255,255,255,.12));background:var(--bg-elev-2,#18181b) center/cover no-repeat;background-image:var(--dk-logo-url,url("img/logo-blue.jpg"))}',
    '.dk-htext{flex:1;min-width:0}',
    '.dk-brand{font-size:14.5px;font-weight:800;letter-spacing:-.01em;color:#fff;display:flex;align-items:center;gap:6px;line-height:1.15}',
    '.dk-brand em{font-style:normal;color:var(--brand-light,#5B7FFF);font-weight:700}',
    '.dk-kind{font-size:11.5px;font-weight:700;color:var(--text-muted,#9aa0a6);text-transform:uppercase;letter-spacing:.6px;margin-top:3px;display:flex;align-items:center;gap:6px}',
    '.dk-dot{width:6px;height:6px;border-radius:50%;background:var(--brand,#254BFF);box-shadow:0 0 8px var(--brand-glow,rgba(37,75,255,.35));flex-shrink:0}',

    /* botão de fechar (X) — mesma vibe dos .icon-btn */
    '.dk-close{width:32px;height:32px;border-radius:8px;background:transparent;border:1px solid transparent;color:var(--text-muted,#9aa0a6);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .18s ease,background .18s ease,border-color .18s ease;padding:0;flex-shrink:0}',
    '.dk-close:hover{color:#fff;background:rgba(255,255,255,.06);border-color:var(--border,rgba(255,255,255,.06))}',
    '.dk-close svg{width:14px;height:14px}',

    /* ===== CARD-BODY — mesmo padding do site ===== */
    '.dk-body{padding:18px 18px 20px}',
    '.dk-title{font-size:18px;font-weight:800;margin:0 0 8px;letter-spacing:-.015em;color:#fff;line-height:1.3}',
    '.dk-text{font-size:14px;line-height:1.55;color:var(--text-muted,#9aa0a6);margin:0 0 18px;white-space:pre-wrap;word-wrap:break-word}',
    '.dk-actions{display:flex;flex-direction:column;gap:8px}',

    /* ===== BOTÕES — idênticos ao .btn / .btn.ghost do site ===== */
    '.dk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;width:100%;padding:0 16px;border:0;border-radius:var(--r-md,10px);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:transform .15s ease,box-shadow .2s ease,opacity .2s ease;text-decoration:none;color:#fff;background:var(--grad-brand-135,linear-gradient(135deg,#254BFF,#3A56F6));box-shadow:var(--shadow-brand,0 8px 24px rgba(37,75,255,.35));letter-spacing:.1px}',
    '.dk-btn:hover{transform:translateY(-1px);box-shadow:var(--shadow-brand-strong,0 12px 32px rgba(37,75,255,.55))}',
    '.dk-btn:active{transform:none}',
    '.dk-btn.ghost{background:transparent;color:var(--text-muted,#9aa0a6);box-shadow:none;height:42px;font-weight:600;font-size:13px;border:1px solid var(--border-strong,rgba(255,255,255,.12))}',
    '.dk-btn.ghost:hover{color:#fff;background:rgba(255,255,255,.04)}',

    /* ===== VARIANTES (ponto colorido + borda superior sutil) ===== */
    '.dk-card.v-success .dk-dot{background:#22C55E;box-shadow:0 0 8px rgba(34,197,94,.55)}',
    '.dk-card.v-warning .dk-dot{background:#F59E0B;box-shadow:0 0 8px rgba(245,158,11,.55)}',
    '.dk-card.v-announce .dk-dot{background:var(--brand-light,#5B7FFF);box-shadow:0 0 8px var(--brand-glow,rgba(37,75,255,.45))}',

    /* ===== MANUTENÇÃO — tela cheia, sem fechar ===== */
    '.dk-maint .dk-close{display:none}',
    '.dk-maint .dk-title{font-size:19px;text-align:center}',
    '.dk-maint .dk-text{text-align:center}',
    '.dk-maint .dk-eta{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--brand-light,#5B7FFF);background:var(--brand-soft,rgba(37,75,255,.12));border:1px solid var(--brand-soft-2,rgba(37,75,255,.20));padding:6px 12px;border-radius:999px;margin:0 auto 16px;letter-spacing:.3px}',
    '.dk-maint-etarow{text-align:center}',
    '.dk-maint-anim{width:52px;height:52px;border-radius:50%;background:var(--brand-soft,rgba(37,75,255,.12));display:flex;align-items:center;justify-content:center;margin:4px auto 16px;position:relative}',
    '.dk-maint-anim::before{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--brand,#254BFF);border-top-color:transparent;animation:dkspin 1.1s linear infinite}',
    '@keyframes dkspin{to{transform:rotate(360deg)}}',
    '.dk-maint-anim svg{width:22px;height:22px;color:var(--brand-light,#5B7FFF)}'
  ].join('');

  function injectCss(){
    if (document.getElementById('dk-msg-style')) return;
    var s = document.createElement('style');
    s.id = 'dk-msg-style';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  function escAttr(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function kindLabel(v){
    return v==='success'?'Novidade':v==='warning'?'Aviso importante':v==='announce'?'Anúncio':'Comunicado';
  }

  /* ---------------- Modal genérico ---------------- */
  function showModal(opts){
    injectCss();
    var overlay = document.createElement('div');
    overlay.className = 'dk-ov';
    var variant = opts.variant || 'info';
    var dismissible = opts.dismissible !== false;
    var buttonUrl = (opts.buttonUrl||'').trim();
    var buttonText = (opts.buttonText||'').trim();
    var maint = !!opts.maintenance;

    var extraTop = '';
    if (maint){
      extraTop = '<div class="dk-maint-anim"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></div>';
      if (opts.until){
        extraTop += '<div class="dk-maint-etarow"><span class="dk-eta">⏱ '+escAttr(opts.until)+'</span></div>';
      }
    }

    var btnHtml = '';
    if (buttonText){
      btnHtml = buttonUrl
        ? '<a class="dk-btn" href="'+escAttr(buttonUrl)+'" target="_blank" rel="noopener">'+escAttr(buttonText)+'</a>'
        : '<button class="dk-btn" type="button" data-act="primary">'+escAttr(buttonText)+'</button>';
    }
    var closeHtml = dismissible ? '<button class="dk-btn ghost" type="button" data-act="close">Fechar</button>' : '';
    var xHtml = dismissible
      ? '<button class="dk-close" type="button" aria-label="Fechar" data-act="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
      : '';

    overlay.innerHTML =
      '<div class="dk-card v-'+variant+(maint?' dk-maint':'')+'" role="dialog" aria-modal="true">'+
        '<div class="dk-head">'+
          '<div class="dk-logo"></div>'+
          '<div class="dk-htext">'+
            '<div class="dk-brand">Draksyon <em>•</em> ANIMES</div>'+
            '<div class="dk-kind"><span class="dk-dot"></span>'+escAttr(maint?'Modo manutenção':kindLabel(variant))+'</div>'+
          '</div>'+
          xHtml+
        '</div>'+
        '<div class="dk-body">'+
          extraTop+
          '<h2 class="dk-title"></h2>'+
          '<p class="dk-text"></p>'+
          '<div class="dk-actions">'+btnHtml+closeHtml+'</div>'+
        '</div>'+
      '</div>';

    overlay.querySelector('.dk-title').textContent = opts.title || '';
    overlay.querySelector('.dk-text').textContent  = opts.body  || '';

    function close(){
      if (!dismissible) return;
      overlay.classList.remove('show');
      setTimeout(function(){ overlay.parentNode && overlay.parentNode.removeChild(overlay); }, 280);
    }
    overlay.addEventListener('click', function(e){
      var t = e.target;
      while (t && t !== overlay){
        var a = t.getAttribute && t.getAttribute('data-act');
        if (a === 'close'){ close(); return; }
        t = t.parentNode;
      }
      if (e.target === overlay && dismissible) close();
    });
    document.addEventListener('keydown', function esc(ev){
      if (ev.key === 'Escape' && dismissible){ close(); document.removeEventListener('keydown', esc); }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(function(){ overlay.classList.add('show'); });
    return { close:close, el:overlay };
  }

  window.DK_showMessage = showModal;

  /* ---------------- Firebase listener ---------------- */
  function boot(){
    if (window.DK_MSG_NO_LISTEN) return;
    if (typeof firebase === 'undefined' || !firebase.database) return;
    try { if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.DK_FIREBASE_CONFIG); } catch(e){}
    var db;
    try { db = firebase.database(); } catch(e){ return; }

    /* --- Tema forçado pelo admin (opcional) --- */
    try {
      db.ref('dk_broadcast/config/forcedTheme').on('value', function(s){
        var v = s.val();
        if (v && window.DK_setTheme) window.DK_setTheme(v);
      });
    } catch(e){}

    /* --- Manutenção (prioridade) --- */
    var maintOpen = null;
    db.ref('dk_broadcast/maintenance').on('value', function(snap){
      var m = snap.val();
      if (m && m.enabled){
        if (maintOpen) return;
        maintOpen = showModal({
          title: m.title || 'Estamos em manutenção',
          body:  m.body  || 'O Draksyon está passando por uma atualização rápida. Volte em instantes!',
          until: m.until || '',
          variant:'warning',
          dismissible:false,
          maintenance:true
        });
      } else if (maintOpen){
        try { maintOpen.el.parentNode.removeChild(maintOpen.el); } catch(e){}
        maintOpen = null;
      }
    });

    /* --- Broadcast normal --- */
    db.ref('dk_broadcast/current').on('value', function(snap){
      var msg = snap.val(); if (!msg || !msg.id) return;
      var seen; try { seen = localStorage.getItem(SEEN_KEY); } catch(e){}
      if (String(seen) === String(msg.id)) return;
      if (maintOpen) return;
      showModal({
        title: msg.title, body: msg.body,
        buttonText: msg.buttonText, buttonUrl: msg.buttonUrl,
        variant: msg.variant || 'info',
        dismissible: msg.dismissible !== false
      });
      try { localStorage.setItem(SEEN_KEY, String(msg.id)); } catch(e){}
      try {
        db.ref('dk_broadcast/current/views').transaction(function(v){ return (v||0)+1; });
      } catch(e){}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
