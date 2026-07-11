/* =====================================================================
 * DRAKSYON • Sistema de Avisos / Manutenção / Presença / Push (v2)
 * ---------------------------------------------------------------------
 * - Escuta em tempo real config/site (manutenção + aviso/modal).
 * - Registra users/{uid}, presence/{uid} (heartbeat 45s) e logs/{auto}.
 * - Registra token FCM em fcmTokens/{uid} para receber pushes do admin.
 * - Respeita o design do Draksyon (usa as CSS vars do site).
 * ===================================================================== */
(function () {
  var FB_VER = '10.12.2';
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  function ensure(name, url) {
    if (window.firebase && firebase[name]) return Promise.resolve();
    return loadScript(url);
  }
  function initFb() {
    if (!window.firebase || !window.DK_FIREBASE_CONFIG) return;
    if (!window.__DK_FB_INIT__) {
      try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); } catch (e) {}
      window.__DK_FB_INIT__ = true;
    }
  }

  /* ---------- CSS (100% design Draksyon) ---------- */
  var CSS =
  '#dk-modal-root,#dk-maint-root{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#fff}'+
  '#dk-modal-root.show,#dk-maint-root.show{display:flex}'+
  '.dk-mask{position:absolute;inset:0;background:rgba(4,6,12,.72);backdrop-filter:blur(8px)}'+
  '.dk-card{position:relative;width:min(460px,100%);background:var(--bg-elev-1,#111113);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:16px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}'+
  '.dk-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border,rgba(255,255,255,.06));background:linear-gradient(135deg,rgba(var(--brand-rgb,37,75,255),.14),transparent 70%)}'+
  '.dk-logo{width:44px;height:44px;border-radius:12px;overflow:hidden;flex:none;background:var(--bg-elev-2,#18181b);display:flex;align-items:center;justify-content:center}'+
  '.dk-logo img{width:100%;height:100%;object-fit:cover;display:block}'+
  '.dk-htxt{flex:1;min-width:0}'+
  '.dk-title{font-size:15px;font-weight:800;letter-spacing:.2px}'+
  '.dk-sub{font-size:11px;color:var(--text-muted,#9aa0a6);margin-top:2px}'+
  '.dk-close{background:transparent;border:0;color:var(--text-muted,#9aa0a6);cursor:pointer;padding:6px;border-radius:8px}'+
  '.dk-close:hover{color:#fff;background:rgba(255,255,255,.06)}'+
  '.dk-body{padding:18px;line-height:1.55;font-size:14px;color:#e7e7ea;white-space:pre-line}'+
  '.dk-actions{display:flex;gap:8px;justify-content:flex-end;padding:0 18px 18px}'+
  '.dk-btn{cursor:pointer;border:0;border-radius:10px;padding:10px 16px;font-weight:700;font-size:13px;color:#fff;background:var(--grad-brand-135,linear-gradient(135deg,#254BFF,#3A56F6));box-shadow:var(--shadow-brand,0 8px 24px rgba(37,75,255,.35))}'+
  '.dk-btn.ghost{background:transparent;border:1px solid var(--border-strong,rgba(255,255,255,.12));box-shadow:none}'+
  '.dk-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;background:var(--brand-soft,rgba(37,75,255,.12));color:var(--brand-light,#5B7FFF);border:1px solid rgba(var(--brand-rgb,37,75,255),.35)}'+
  '.dk-maint-icon{width:72px;height:72px;margin:8px auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--brand-soft-2,rgba(37,75,255,.20));color:var(--brand-light,#5B7FFF)}'+
  '.dk-maint-icon svg{width:36px;height:36px}'+
  '.dk-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:99998;max-width:92%;background:var(--bg-elev-1,#111113);border:1px solid var(--border-strong,rgba(255,255,255,.12));border-left:4px solid var(--brand,#254BFF);border-radius:12px;padding:12px 14px;box-shadow:0 20px 50px -12px rgba(0,0,0,.6);animation:dkin .35s ease}'+
  '.dk-toast .t{font-weight:700;font-size:13px}'+
  '.dk-toast .m{font-size:12px;color:var(--text-muted,#9aa0a6);margin-top:2px}'+
  '@keyframes dkin{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}';

  function injectCss() {
    if (document.getElementById('dk-notice-css')) return;
    var s = document.createElement('style'); s.id = 'dk-notice-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function logoUrl() {
    try { return window.DK_getLogoUrl ? DK_getLogoUrl() : 'img/logo-blue.jpg'; } catch (e) { return 'img/logo-blue.jpg'; }
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function makeRoot(id) {
    var r = document.getElementById(id);
    if (r) return r;
    r = document.createElement('div'); r.id = id;
    document.body.appendChild(r);
    return r;
  }

  /* ---------- Modais ---------- */
  function showAviso(data) {
    injectCss();
    var root = makeRoot('dk-modal-root');
    var tipo = data.avisoTipo || 'info';
    var badge = tipo === 'alerta' ? 'AVISO' : (tipo === 'sucesso' ? 'NOVIDADE' : 'INFO');
    root.innerHTML =
      '<div class="dk-mask"></div>'+
      '<div class="dk-card">'+
        '<div class="dk-head">'+
          '<div class="dk-logo"><img data-dk-logo src="'+logoUrl()+'" alt="Draksyon"></div>'+
          '<div class="dk-htxt">'+
            '<div class="dk-title">'+escapeHtml(data.avisoTitulo||'Aviso')+'</div>'+
            '<div class="dk-sub"><span class="dk-badge">'+badge+'</span></div>'+
          '</div>'+
          '<button class="dk-close" aria-label="Fechar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'+
        '</div>'+
        '<div class="dk-body">'+escapeHtml(data.avisoTexto||'')+'</div>'+
        '<div class="dk-actions"><button class="dk-btn" data-ok>Entendi</button></div>'+
      '</div>';
    root.classList.add('show');
    function close(){ root.classList.remove('show'); try{ localStorage.setItem('dk_aviso_visto', data.avisoId||'x'); }catch(e){} }
    root.querySelector('.dk-close').onclick = close;
    root.querySelector('[data-ok]').onclick = close;
    root.querySelector('.dk-mask').onclick = close;
    try { window.DK_refreshLogos && DK_refreshLogos(); } catch(e){}
  }
  function showManutencao(msg) {
    injectCss();
    var root = makeRoot('dk-maint-root');
    root.innerHTML =
      '<div class="dk-mask"></div>'+
      '<div class="dk-card">'+
        '<div class="dk-head">'+
          '<div class="dk-logo"><img data-dk-logo src="'+logoUrl()+'" alt="Draksyon"></div>'+
          '<div class="dk-htxt"><div class="dk-title">Em manutenção</div><div class="dk-sub"><span class="dk-badge">MANUTENÇÃO</span></div></div>'+
        '</div>'+
        '<div class="dk-body" style="text-align:center">'+
          '<div class="dk-maint-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>'+
          '<div style="margin-top:6px">'+escapeHtml(msg||'Estamos aprimorando o Draksyon. Volte em instantes.')+'</div>'+
        '</div>'+
        '<div class="dk-actions" style="justify-content:center"><button class="dk-btn ghost" onclick="location.reload()">Tentar novamente</button></div>'+
      '</div>';
    root.classList.add('show');
    try { document.body.style.overflow = 'hidden'; } catch(e){}
  }
  function hideManutencao() {
    var r = document.getElementById('dk-maint-root');
    if (r) r.classList.remove('show');
    try { document.body.style.overflow = ''; } catch(e){}
  }
  function toast(title, msg) {
    injectCss();
    var el = document.createElement('div');
    el.className = 'dk-toast';
    el.innerHTML = '<div class="t">'+escapeHtml(title)+'</div><div class="m">'+escapeHtml(msg||'')+'</div>';
    document.body.appendChild(el);
    setTimeout(function(){ el.style.opacity='0'; el.style.transition='opacity .4s'; }, 4500);
    setTimeout(function(){ el.remove(); }, 5000);
  }
  window.DK_toast = toast;

  /* ---------- Presença + usuário ---------- */
  var heartbeatTimer = null;
  function trackUser(user, db) {
    if (!user) return;
    var userRef = db.collection('users').doc(user.uid);
    var presRef = db.collection('presence').doc(user.uid);
    var ts = firebase.firestore.FieldValue.serverTimestamp;

    // Só define criadoEm na 1ª vez para não estragar estatísticas de "novos usuários"
    userRef.get().then(function (snap) {
      var base = {
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        lastLogin: ts()
      };
      if (!snap.exists || !snap.data().criadoEm) base.criadoEm = ts();
      userRef.set(base, { merge: true }).catch(function(){});
    }).catch(function(){
      userRef.set({ uid:user.uid, email:user.email||null, lastLogin:ts(), criadoEm:ts() }, { merge:true }).catch(function(){});
    });

    function beat() {
      presRef.set({
        uid: user.uid,
        email: user.email || null,
        online: true,
        lastSeen: ts(),
        page: (location.pathname.split('/').pop() || 'index.html')
      }, { merge: true }).catch(function(){});
    }
    beat();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(beat, 45000);

    window.addEventListener('beforeunload', function () {
      try { presRef.set({ online:false, lastSeen: ts() }, { merge:true }); } catch(e){}
    });

    try {
      db.collection('logs').add({
        tipo: 'pageview', uid: user.uid, email: user.email || null,
        page: (location.pathname.split('/').pop() || 'index.html'),
        criadoEm: ts()
      });
    } catch (e) {}
  }

  /* ---------- Ban check (bloqueia usuário desativado pelo admin) ---------- */
  function checkBan(user, db) {
    if (!user) return;
    db.collection('users').doc(user.uid).onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : {};
      if (d && d.banido) {
        showManutencao(d.motivoBan || 'Sua conta foi desativada pelo administrador.');
        try { firebase.auth().signOut(); } catch(e){}
      }
    });
  }

  /* ---------- FCM (push) ---------- */
  function setupPush(user, db) {
    if (!user || !window.firebase || !firebase.messaging) return;
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    try {
      navigator.serviceWorker.register('/firebase-messaging-sw.js').then(function (reg) {
        var m = firebase.messaging();
        // O admin (server) envia — o site apenas registra token e escuta em foreground.
        Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') return;
          m.getToken({ serviceWorkerRegistration: reg, vapidKey: window.DK_VAPID_KEY || undefined })
            .then(function (token) {
              if (!token) return;
              db.collection('fcmTokens').doc(user.uid).set({
                uid: user.uid, email: user.email||null, token: token,
                ua: navigator.userAgent, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
              }, { merge:true }).catch(function(){});
            }).catch(function(e){ console.warn('[dk-notice] getToken', e); });
        });
        m.onMessage(function (payload) {
          var n = (payload && payload.notification) || {};
          toast(n.title || 'Draksyon', n.body || '');
        });
      });
    } catch (e) { console.warn('[dk-notice] fcm', e); }
  }

  /* ---------- Bootstrap ---------- */
  Promise.resolve()
    .then(function(){ return ensure('firestore', 'https://www.gstatic.com/firebasejs/'+FB_VER+'/firebase-firestore-compat.js'); })
    .then(function(){ return ensure('messaging', 'https://www.gstatic.com/firebasejs/'+FB_VER+'/firebase-messaging-compat.js').catch(function(){}); })
    .then(function () {
      initFb();
      if (!window.firebase || !firebase.firestore) return;
      var db = firebase.firestore();

      // Escuta config/site em tempo real
      db.collection('config').doc('site').onSnapshot(function (snap) {
        var d = snap.exists ? (snap.data()||{}) : {};
        if (d.manutencao) {
          showManutencao(d.mensagemManutencao);
        } else {
          hideManutencao();
          if (d.avisoAtivo) {
            var visto = null; try { visto = localStorage.getItem('dk_aviso_visto'); } catch(e){}
            if ((d.avisoId||'x') !== visto) showAviso(d);
          }
        }
      }, function (err) { console.warn('[dk-notice] snapshot', err); });

      firebase.auth().onAuthStateChanged(function (u) {
        trackUser(u, db);
        checkBan(u, db);
        setupPush(u, db);
      });
    })
    .catch(function (e) { console.warn('[dk-notice] load', e); });
})();
