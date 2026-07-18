/* =====================================================================
 * DRAKSYON • Integração em tempo real com Firebase (site)
 * ---------------------------------------------------------------------
 * - Lê /config/site em tempo real:
 *      { manutencao:bool, mensagem_manutencao, aviso_ativo:bool,
 *        aviso_titulo, aviso_texto, aviso_id, bloquear_conteudo:bool }
 * - Mostra modal de manutenção (bloqueante) ou de aviso (dispensável).
 * - Marca presença online do usuário em /presence/{uid}.
 * - Registra token FCM em /fcm_tokens/{uid}/{token} (se suportado).
 * - Verifica banimento em /users/{uid}.banido -> força signOut.
 * - Aparência 100% alinhada ao tema Draksyon (usa --brand, --bg, etc.).
 * Requer: firebase-config.js + Firebase compat SDKs (app/auth/firestore).
 * =====================================================================*/
(function(){
  if (window.__DK_RT_LOADED__) return;
  window.__DK_RT_LOADED__ = true;

  // ---------- CSS ----------
  var css = `
  .dk-modal-backdrop{
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);
    -webkit-backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;
    padding:24px 16px;animation:dkFadeIn .25s ease;
  }
  @keyframes dkFadeIn{from{opacity:0}to{opacity:1}}
  @keyframes dkPopIn{from{transform:translateY(12px) scale(.96);opacity:0}
                     to{transform:none;opacity:1}}
  .dk-modal{
    width:100%;max-width:460px;
    background:var(--bg-elev-1,#111113);
    border:1px solid var(--border-strong,rgba(255,255,255,.12));
    border-radius:18px;overflow:hidden;
    box-shadow:0 24px 60px -12px rgba(0,0,0,.85), var(--shadow-brand,0 8px 24px rgba(37,75,255,.35));
    animation:dkPopIn .28s cubic-bezier(.2,.9,.3,1);
    color:var(--text,#fff);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  }
  .dk-modal-head{
    padding:18px 20px;display:flex;align-items:center;gap:12px;
    border-bottom:1px solid var(--border,rgba(255,255,255,.06));
    background:linear-gradient(180deg, rgba(var(--brand-rgb,37,75,255),.18), transparent);
  }
  .dk-modal-icon{
    width:44px;height:44px;border-radius:12px;flex-shrink:0;
    background:var(--grad-brand-135,linear-gradient(135deg,#254BFF,#3A56F6));
    display:flex;align-items:center;justify-content:center;
    color:#fff;box-shadow:var(--shadow-brand,0 8px 24px rgba(37,75,255,.35));
  }
  .dk-modal-icon svg{width:22px;height:22px}
  .dk-modal-title{font-size:16px;font-weight:800;letter-spacing:.3px}
  .dk-modal-sub{font-size:12.5px;color:var(--text-muted,#9aa0a6);margin-top:2px}
  .dk-modal-body{padding:20px;line-height:1.55;font-size:14.5px;color:#e8e8ea}
  .dk-modal-body p{margin:0 0 10px}
  .dk-modal-body p:last-child{margin-bottom:0}
  .dk-modal-foot{
    padding:14px 20px 18px;display:flex;gap:10px;justify-content:flex-end;
    border-top:1px solid var(--border,rgba(255,255,255,.06));
  }
  .dk-btn{
    appearance:none;border:0;cursor:pointer;
    padding:10px 16px;border-radius:10px;
    font-weight:700;font-size:13.5px;letter-spacing:.2px;
    transition:transform .12s ease, box-shadow .18s ease, background .18s ease;
  }
  .dk-btn:active{transform:translateY(1px)}
  .dk-btn-primary{
    background:var(--grad-brand,linear-gradient(90deg,#254BFF,#3A56F6));
    color:#fff;box-shadow:var(--shadow-brand,0 8px 24px rgba(37,75,255,.35));
  }
  .dk-btn-primary:hover{box-shadow:var(--shadow-brand-strong,0 12px 32px rgba(37,75,255,.55))}
  .dk-btn-ghost{
    background:transparent;color:#e8e8ea;
    border:1px solid var(--border-strong,rgba(255,255,255,.12));
  }
  .dk-btn-ghost:hover{background:rgba(255,255,255,.05)}
  .dk-badge{
    display:inline-block;padding:3px 8px;border-radius:999px;
    background:var(--brand-soft-2,rgba(37,75,255,.20));
    color:var(--brand-light,#5B7FFF);font-size:11px;font-weight:700;
    letter-spacing:.4px;text-transform:uppercase;
  }
  .dk-maint-pulse{
    display:inline-block;width:8px;height:8px;border-radius:50%;
    background:#ffb020;box-shadow:0 0 0 0 rgba(255,176,32,.7);
    animation:dkPulse 1.6s infinite;margin-right:6px;vertical-align:middle;
  }
  @keyframes dkPulse{
    0%{box-shadow:0 0 0 0 rgba(255,176,32,.6)}
    70%{box-shadow:0 0 0 10px rgba(255,176,32,0)}
    100%{box-shadow:0 0 0 0 rgba(255,176,32,0)}
  }
  .dk-banned-screen{
    position:fixed;inset:0;z-index:99999;background:#0d0d0f;color:#fff;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:24px;text-align:center;font-family:inherit;
  }
  .dk-banned-screen h1{font-size:22px;margin-bottom:8px;color:#ff5c5c}
  .dk-banned-screen p{color:#9aa0a6;max-width:420px;line-height:1.5}
  `;
  var s = document.createElement('style'); s.textContent = css;
  document.head.appendChild(s);

  // ---------- helpers ----------
  function esc(t){ return String(t==null?'':t).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  }); }

  function openModal(opts){
    closeModal(opts.id);
    var wrap = document.createElement('div');
    wrap.className = 'dk-modal-backdrop';
    wrap.setAttribute('data-dk-modal', opts.id || 'generic');
    wrap.innerHTML = `
      <div class="dk-modal" role="dialog" aria-modal="true">
        <div class="dk-modal-head">
          <div class="dk-modal-icon">${opts.icon || iconInfo()}</div>
          <div style="flex:1;min-width:0">
            <div class="dk-modal-title">${esc(opts.title||'Aviso')}</div>
            <div class="dk-modal-sub">
              ${opts.badge? '<span class="dk-badge">'+esc(opts.badge)+'</span> ' : ''}
              ${esc(opts.subtitle||'Draksyon')}
            </div>
          </div>
        </div>
        <div class="dk-modal-body">${opts.bodyHTML || esc(opts.body||'')}</div>
        <div class="dk-modal-foot">
          ${opts.dismissible!==false ? '<button class="dk-btn dk-btn-ghost" data-dk-close>Fechar</button>' : ''}
          ${opts.actionText ? '<button class="dk-btn dk-btn-primary" data-dk-action>'+esc(opts.actionText)+'</button>' : ''}
        </div>
      </div>`;
    if (opts.dismissible !== false){
      wrap.addEventListener('click', function(e){
        if (e.target === wrap) closeModal(opts.id);
      });
    }
    wrap.querySelectorAll('[data-dk-close]').forEach(function(b){
      b.addEventListener('click', function(){ closeModal(opts.id); });
    });
    if (opts.onAction){
      var a = wrap.querySelector('[data-dk-action]');
      if (a) a.addEventListener('click', opts.onAction);
    }
    document.body.appendChild(wrap);
    return wrap;
  }
  function closeModal(id){
    var sel = id ? '[data-dk-modal="'+id+'"]' : '.dk-modal-backdrop';
    document.querySelectorAll(sel).forEach(function(n){ n.remove(); });
  }

  function iconWrench(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 1 0 5 5L20 12l-8 8-5-5 8-8 .7-.3z"/><path d="M6 20l-2-2"/></svg>';}
  function iconInfo(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>';}
  function iconBell(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>';}

  // ---------- Firebase init ----------
  function initFirebase(){
    if (!window.firebase || !window.DK_FIREBASE_CONFIG) return null;
    if (!window.__DK_FB_INIT__){
      try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); } catch(e){}
      window.__DK_FB_INIT__ = true;
    }
    return firebase;
  }

  function whenReady(cb){
    var t = setInterval(function(){
      if (window.firebase && firebase.firestore && firebase.auth){
        clearInterval(t); cb();
      }
    }, 60);
    setTimeout(function(){ clearInterval(t); }, 10000);
  }

  // ---------- Site config listener ----------
  var lastSeenAvisoId = null;
  try { lastSeenAvisoId = localStorage.getItem('dk_seen_aviso_id') || null; } catch(e){}

  function listenSiteConfig(db){
    db.collection('config').doc('site').onSnapshot(function(snap){
      var d = snap.exists ? (snap.data()||{}) : {};
      window.DK_SITE_CONFIG = d;

      // Manutenção (bloqueante)
      if (d.manutencao === true){
        openModal({
          id:'maint',
          title:'Site em manutenção',
          subtitle:'Draksyon',
          badge:'Manutenção',
          icon: iconWrench(),
          bodyHTML:
            '<p><span class="dk-maint-pulse"></span>Estamos fazendo melhorias no site.</p>' +
            '<p>'+esc(d.mensagem_manutencao || 'Voltaremos em breve. Obrigado pela paciência!')+'</p>',
          dismissible:false
        });
        if (d.bloquear_conteudo !== false){
          // esconde a página por baixo
          document.documentElement.style.overflow = 'hidden';
        }
      } else {
        closeModal('maint');
        document.documentElement.style.overflow = '';
      }

      // Aviso normal (dispensável, por id)
      if (d.aviso_ativo === true && d.aviso_id && d.aviso_id !== lastSeenAvisoId && d.manutencao !== true){
        openModal({
          id:'aviso',
          title: d.aviso_titulo || 'Novo aviso',
          subtitle:'Draksyon',
          badge:'Aviso',
          icon: iconBell(),
          bodyHTML: '<p>'+esc(d.aviso_texto||'')+'</p>',
          actionText:'Entendi',
          onAction: function(){
            lastSeenAvisoId = d.aviso_id;
            try { localStorage.setItem('dk_seen_aviso_id', d.aviso_id); } catch(e){}
            closeModal('aviso');
          }
        });
      }
    }, function(err){ console.warn('[DK] config listener', err); });
  }

  // ---------- Presence ----------
  function startPresence(db, user){
    var ref = db.collection('presence').doc(user.uid);
    var payload = {
      uid: user.uid,
      email: user.email || null,
      last_seen: firebase.firestore.FieldValue.serverTimestamp(),
      user_agent: navigator.userAgent.slice(0,180),
      page: (location.pathname.split('/').pop() || 'index.html')
    };
    try { payload.profile = JSON.parse(localStorage.getItem('dk_active_profile')||'null'); } catch(e){}

    function ping(extra){
      var body = Object.assign({}, payload, extra||{}, {
        last_seen: firebase.firestore.FieldValue.serverTimestamp(),
        online: true
      });
      ref.set(body, { merge:true }).catch(function(){});
    }
    ping();
    var iv = setInterval(ping, 45000);
    window.addEventListener('beforeunload', function(){
      try {
        ref.set({ online:false, last_seen: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      } catch(e){}
      clearInterval(iv);
    });
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') ping();
    });
  }

  // ---------- User doc (upsert + banimento) ----------
  function upsertUser(db, user){
    var ref = db.collection('users').doc(user.uid);
    ref.set({
      uid: user.uid,
      email: user.email || null,
      display_name: user.displayName || null,
      photo_url: user.photoURL || null,
      last_login: firebase.firestore.FieldValue.serverTimestamp(),
      provider: (user.providerData && user.providerData[0] && user.providerData[0].providerId) || 'password',
    }, { merge:true }).catch(function(){});
    // primeiro login: created_at
    ref.get().then(function(s){
      if (s.exists && !s.data().created_at){
        ref.set({ created_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      } else if (!s.exists){
        ref.set({ created_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      }
    }).catch(function(){});

    // listener de banimento
    ref.onSnapshot(function(s){
      var d = s.exists ? s.data() : {};
      if (d && d.banido === true){
        showBanned(d.motivo_ban || 'Sua conta foi banida por violação dos termos.');
        try { firebase.auth().signOut(); } catch(e){}
      }
    });
  }

  function showBanned(motivo){
    var el = document.createElement('div');
    el.className = 'dk-banned-screen';
    el.innerHTML = '<h1>Conta banida</h1><p>'+esc(motivo)+'</p>' +
      '<p style="margin-top:16px"><a href="login.html" style="color:var(--brand-light,#5B7FFF)">Voltar ao login</a></p>';
    document.body.innerHTML = '';
    document.body.appendChild(el);
  }

  // ---------- FCM (opcional) ----------
  function initFCM(db, user){
    if (!('serviceWorker' in navigator)) return;
    if (!firebase.messaging || !firebase.messaging.isSupported || !firebase.messaging.isSupported()) return;
    // vapidKey opcional; se não configurada, apenas ignora silenciosamente
    var vapid = window.DK_FCM_VAPID_KEY || null;
    try {
      navigator.serviceWorker.register('/firebase-messaging-sw.js').then(function(reg){
        var msg = firebase.messaging();
        var opts = { serviceWorkerRegistration: reg };
        if (vapid) opts.vapidKey = vapid;
        msg.getToken(opts).then(function(token){
          if (!token) return;
          db.collection('fcm_tokens').doc(user.uid).collection('tokens').doc(token).set({
            token: token,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            user_agent: navigator.userAgent.slice(0,180)
          }, { merge:true }).catch(function(){});
        }).catch(function(){ /* permissão negada, ok */ });
        msg.onMessage(function(payload){
          var n = (payload && payload.notification) || {};
          openModal({
            id:'fcm',
            title: n.title || 'Notificação',
            subtitle:'Draksyon',
            badge:'Push',
            icon: iconBell(),
            bodyHTML: '<p>'+esc(n.body||'')+'</p>',
            actionText:'OK',
            onAction: function(){ closeModal('fcm'); }
          });
        });
      }).catch(function(){});
    } catch(e){}
  }

  // ---------- Boot ----------
  whenReady(function(){
    initFirebase();
    var db;
    try { db = firebase.firestore(); } catch(e){ return; }

    // config é público (para o site poder ler antes do login)
    listenSiteConfig(db);

    firebase.auth().onAuthStateChanged(function(user){
      if (!user) return;
      upsertUser(db, user);
      startPresence(db, user);
      initFCM(db, user);
    });
  });

  // API pública
  window.DK_openModal  = openModal;
  window.DK_closeModal = closeModal;
})();
