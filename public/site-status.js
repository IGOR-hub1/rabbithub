/* =====================================================================
 * DRAKSYON • Integração de Avisos / Manutenção / Boas-Vindas
 * ---------------------------------------------------------------------
 * Lê em tempo real do Firestore:
 *   config/site        → { manutencao: bool, mensagem: string,
 *                          aviso: { ativo, titulo, texto, tipo },
 *                          boasVindas: { ativo, titulo, texto } }
 *
 * Também registra presença (usuários online) e atualiza último acesso
 * em `presence/{uid}` quando houver usuário autenticado.
 * ===================================================================== */
(function () {
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  function ensureFirebase(){
    if (!window.firebase || !window.DK_FIREBASE_CONFIG) return null;
    if (!window.__DK_FB_INIT__) {
      try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); window.__DK_FB_INIT__ = true; } catch(e){}
    }
    return firebase;
  }

  function injectStyles(){
    if (document.getElementById('dk-status-styles')) return;
    var css = `
      .dk-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px);}
      .dk-modal{background:#121826;color:#e6edf7;border:1px solid #263043;border-radius:14px;max-width:520px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
      .dk-modal h2{margin:0 0 10px;font-size:20px;color:#7cc4ff;}
      .dk-modal p{margin:0 0 18px;line-height:1.5;color:#c7d2e4;white-space:pre-wrap;}
      .dk-modal .dk-actions{display:flex;justify-content:flex-end;gap:8px;}
      .dk-btn{background:#2b6cff;color:#fff;border:0;border-radius:8px;padding:9px 16px;cursor:pointer;font-weight:600;}
      .dk-btn.secondary{background:#263043;}
      .dk-banner{position:fixed;top:0;left:0;right:0;z-index:99997;padding:10px 16px;text-align:center;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;}
      .dk-banner.info{background:#0b3d91;color:#fff;}
      .dk-banner.warn{background:#b8860b;color:#111;}
      .dk-banner.danger{background:#b00020;color:#fff;}
      .dk-maint{position:fixed;inset:0;background:#0b0f17;color:#e6edf7;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:system-ui,sans-serif;}
      .dk-maint h1{font-size:32px;margin:0 0 12px;color:#7cc4ff;}
      .dk-maint p{max-width:560px;line-height:1.55;color:#c7d2e4;white-space:pre-wrap;}
    `;
    var s = document.createElement('style'); s.id='dk-status-styles'; s.textContent = css; document.head.appendChild(s);
  }

  function showMaintenance(msg){
    injectStyles();
    if (document.getElementById('dk-maint')) return;
    var el = document.createElement('div');
    el.id = 'dk-maint'; el.className = 'dk-maint';
    el.innerHTML = '<h1>🛠 Em manutenção</h1><p>'+ (msg || 'Estamos realizando melhorias. Volte em instantes.') +'</p>';
    document.body.appendChild(el);
  }
  function hideMaintenance(){ var el=document.getElementById('dk-maint'); if(el) el.remove(); }

  function showBanner(aviso){
    injectStyles();
    var old = document.getElementById('dk-banner'); if (old) old.remove();
    if (!aviso || !aviso.ativo) return;
    var el = document.createElement('div');
    el.id='dk-banner';
    el.className = 'dk-banner ' + (aviso.tipo || 'info');
    el.textContent = aviso.texto || '';
    document.body.appendChild(el);
    document.body.style.paddingTop = (el.offsetHeight) + 'px';
  }

  function showWelcome(bv){
    injectStyles();
    if (!bv || !bv.ativo) return;
    var key = 'dk_bv_seen_' + (bv.id || bv.titulo || 'v1');
    if (localStorage.getItem(key)) return;
    var back = document.createElement('div'); back.className='dk-modal-backdrop';
    back.innerHTML = '<div class="dk-modal"><h2>'+ (bv.titulo||'Boas-vindas!') +'</h2><p>'+ (bv.texto||'') +'</p><div class="dk-actions"><button class="dk-btn">Entendi</button></div></div>';
    document.body.appendChild(back);
    back.querySelector('.dk-btn').addEventListener('click', function(){
      localStorage.setItem(key, '1'); back.remove();
    });
  }

  function bindPresence(db, auth){
    auth.onAuthStateChanged(function(user){
      if (!user) return;
      var ref = db.collection('presence').doc(user.uid);
      var payload = {
        uid: user.uid,
        email: user.email || null,
        nome: user.displayName || null,
        online: true,
        userAgent: navigator.userAgent,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      };
      ref.set(payload, { merge: true }).catch(function(){});
      // heartbeat
      var beat = setInterval(function(){
        ref.set({ online:true, lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true }).catch(function(){});
      }, 45000);
      window.addEventListener('beforeunload', function(){
        try { ref.set({ online:false, lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true }); } catch(e){}
        clearInterval(beat);
      });

      // Cria/atualiza documento em users/{uid} para o painel admin
      db.collection('users').doc(user.uid).set({
        uid: user.uid,
        email: user.email || null,
        nome: user.displayName || null,
        photoURL: user.photoURL || null,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        ultimoAcesso: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(function(){});
    });
  }

  function watchConfig(db){
    db.collection('config').doc('site').onSnapshot(function(snap){
      var data = snap.exists ? snap.data() : {};
      if (data.manutencao) showMaintenance(data.mensagem); else hideMaintenance();
      showBanner(data.aviso);
      showWelcome(data.boasVindas);
    }, function(err){ console.warn('[DK status]', err && err.message); });
  }

  ready(function(){
    var fb = ensureFirebase(); if (!fb) return;
    if (!fb.firestore) { console.warn('Firestore SDK ausente'); return; }
    var db = fb.firestore();
    var auth = fb.auth ? fb.auth() : null;
    watchConfig(db);
    if (auth) bindPresence(db, auth);
  });
})();
