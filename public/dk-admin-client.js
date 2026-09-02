/* =====================================================================
 * DRAKSYON • Cliente de administração (para todas as páginas do site)
 * ---------------------------------------------------------------------
 * - Escuta modo manutenção em /maintenance -> bloqueia o site
 * - Escuta banimento em /users/{uid}/banned -> desloga
 * - Escuta notificações globais e por usuário e exibe dialog
 * - Expõe window.DK_USER_DATA com { premium, isAdmin, banned, ... }
 * Requer: firebase-app-compat, firebase-auth-compat, firebase-database-compat.
 * ===================================================================== */
(function(){
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var isLogin = page === 'login.html';

  function ensureDb(){
    if (!window.firebase || !firebase.database) return null;
    if (!window.__DK_FB_INIT__ && window.DK_FIREBASE_CONFIG) {
      try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); } catch(e){}
      window.__DK_FB_INIT__ = true;
    }
    try { return firebase.database(); } catch(e){ return null; }
  }

  /* ---------- Estilos ---------- */
  var css = ''
  + '.dkov{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);'
  + 'display:flex;align-items:center;justify-content:center;z-index:2147483000;padding:20px;'
  + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;animation:dkfade .2s ease}'
  + '.dkov.dk-mnt{background:#0d0d0f;backdrop-filter:none}'
  + '.dkcard{background:#111113;border:1px solid rgba(255,255,255,.08);border-radius:16px;'
  + 'max-width:440px;width:100%;padding:28px;color:#fff;box-shadow:0 20px 50px -12px rgba(0,0,0,.8);'
  + 'animation:dkpop .25s cubic-bezier(.34,1.56,.64,1)}'
  + '.dkcard .dkicon{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#6366f1,#a855f7);'
  + 'display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px}'
  + '.dkcard.dk-warn .dkicon{background:linear-gradient(135deg,#f59e0b,#ef4444)}'
  + '.dkcard.dk-prem .dkicon{background:linear-gradient(135deg,#facc15,#f97316)}'
  + '.dkcard h3{font-size:20px;font-weight:800;text-align:center;margin-bottom:8px;letter-spacing:.2px}'
  + '.dkcard p{font-size:14px;color:#b3b3b3;text-align:center;line-height:1.5;white-space:pre-wrap}'
  + '.dkcard .dkbtn{margin-top:20px;width:100%;padding:12px;border-radius:10px;border:0;'
  + 'background:#fff;color:#000;font-weight:700;font-size:14px;cursor:pointer;transition:.15s}'
  + '.dkcard .dkbtn:hover{opacity:.85}'
  + '@keyframes dkfade{from{opacity:0}to{opacity:1}}'
  + '@keyframes dkpop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}';
  var st = document.createElement('style'); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  function dialog(opts){
    var ov = document.createElement('div');
    ov.className = 'dkov' + (opts.maintenance ? ' dk-mnt' : '');
    var cls = opts.type === 'warn' ? ' dk-warn' : (opts.type === 'premium' ? ' dk-prem' : '');
    var icon = opts.type === 'warn' ? '⚠️' : (opts.type === 'premium' ? '👑' : (opts.type === 'maintenance' ? '🛠️' : '🔔'));
    ov.innerHTML =
      '<div class="dkcard'+cls+'">'
      + '<div class="dkicon">'+icon+'</div>'
      + '<h3></h3><p></p>'
      + (opts.dismissible !== false ? '<button class="dkbtn">OK, entendi</button>' : '')
      + '</div>';
    ov.querySelector('h3').textContent = opts.title || 'Aviso';
    ov.querySelector('p').textContent  = opts.message || '';
    var btn = ov.querySelector('.dkbtn');
    if (btn) btn.onclick = function(){ ov.remove(); if (opts.onOk) opts.onOk(); };
    document.body.appendChild(ov);
    return ov;
  }

  window.DK_dialog = dialog;
  window.DK_USER_DATA = null;

  var seenNotif = {};
  try { seenNotif = JSON.parse(localStorage.getItem('dk_seen_notif') || '{}'); } catch(e){}
  function markSeen(id){ seenNotif[id] = 1; try{ localStorage.setItem('dk_seen_notif', JSON.stringify(seenNotif)); }catch(e){} }

  function watchMaintenance(db, uid, isAdmin){
    db.ref('maintenance').on('value', function(snap){
      var m = snap.val() || {};
      var old = document.getElementById('dk-mnt-overlay');
      if (m.enabled && !isAdmin) {
        if (old) return;
        var ov = dialog({
          type:'maintenance',
          title: m.title || 'Site em manutenção',
          message: m.message || 'Estamos fazendo melhorias no RabbitHub. Volte em alguns minutos.',
          dismissible:false,
          maintenance:true
        });
        ov.id = 'dk-mnt-overlay';
      } else if (old) { old.remove(); }
    });
  }

  function watchNotifications(db, uid){
    db.ref('notifications/global').limitToLast(5).on('child_added', function(snap){
      var n = snap.val(); var id = 'g:'+snap.key;
      if (!n || seenNotif[id]) return;
      var age = Date.now() - (n.createdAt || 0);
      if (age > 7*24*3600*1000) return;
      markSeen(id);
      dialog({ type:n.type||'info', title:n.title||'Notificação', message:n.message||'' });
    });
    if (!uid) return;
    db.ref('notifications/user/'+uid).limitToLast(10).on('child_added', function(snap){
      var n = snap.val(); var id = 'u:'+snap.key;
      if (!n || seenNotif[id]) return;
      markSeen(id);
      dialog({ type:n.type||'info', title:n.title||'Mensagem para você', message:n.message||'' });
    });
  }

  function watchUser(db, user){
    var uid = user.uid;
    var ref = db.ref('users/'+uid);
    // registra/atualiza
    ref.transaction(function(cur){
      cur = cur || {};
      cur.email = user.email || cur.email || '';
      cur.name  = user.displayName || cur.name || (user.email ? user.email.split('@')[0] : 'Usuário');
      cur.createdAt = cur.createdAt || Date.now();
      cur.lastLoginAt = Date.now();
      return cur;
    });
    ref.on('value', function(snap){
      var d = snap.val() || {};
      // expira premium
      if (d.premium && d.premiumUntil && d.premiumUntil < Date.now()) {
        d.premium = false;
        ref.update({ premium:false });
      }
      window.DK_USER_DATA = d;
      document.documentElement.setAttribute('data-dk-premium', d.premium ? '1' : '0');
      document.documentElement.setAttribute('data-dk-admin',  d.isAdmin ? '1' : '0');
      window.dispatchEvent(new CustomEvent('dk:userdata', { detail: d }));
      if (d.banned) {
        dialog({
          type:'warn', title:'Conta suspensa',
          message: d.banReason || 'Sua conta foi suspensa por violar os termos de uso.',
          dismissible:false
        });
        try { firebase.auth().signOut(); } catch(e){}
        setTimeout(function(){ location.replace('login.html'); }, 4000);
      }
    });
    watchNotifications(db, uid);
    watchMaintenance(db, uid, !!(window.DK_USER_DATA && window.DK_USER_DATA.isAdmin));
    // recheck maintenance admin flag when user data arrives
    setTimeout(function(){
      db.ref('maintenance').once('value').then(function(){});
    }, 500);
  }

  function boot(){
    var db = ensureDb();
    if (!db) { setTimeout(boot, 120); return; }
    if (isLogin) { watchMaintenance(db, null, false); watchNotifications(db, null); return; }
    if (!firebase.auth) { setTimeout(boot, 120); return; }
    firebase.auth().onAuthStateChanged(function(u){
      if (!u) return;
      watchUser(db, u);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
