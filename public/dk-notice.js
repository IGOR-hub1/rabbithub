/* =====================================================================
 * DRAKSYON • Sistema de Avisos, Mensagens e Manutenção
 * ---------------------------------------------------------------------
 * - Escuta config em tempo real no Firebase Realtime Database:
 *     • maintenance         -> bloqueia o site para todos (exceto admin)
 *     • notifications/global -> dialog para todos
 *     • notifications/user/{uid} -> dialog para 1 usuário
 *     • users/{uid}/banned   -> desloga e mostra aviso
 * - Registra o usuário em users/{uid} ao logar (email, nome, lastLoginAt)
 * - Dialogs no estilo da referência:
 *     banda colorida no topo (Success/Failed/Warning/Confirmation)
 *     + ícone circular branco + botão pill
 * - Segue as CSS vars do tema (--brand, --brand-rgb, --grad-brand-135…)
 * - Requer: firebase-app-compat, firebase-auth-compat (a Database é
 *   carregada automaticamente por este script).
 * ===================================================================== */
(function () {
  var FB_VER = '10.12.2';

  /* ---------- utilitários ---------- */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  function ensureDb() {
    return new Promise(function (resolve) {
      (function wait() {
        if (window.firebase && firebase.auth && window.DK_FIREBASE_CONFIG) {
          if (!window.__DK_FB_INIT__) {
            try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); } catch (e) {}
            window.__DK_FB_INIT__ = true;
          }
          if (firebase.database) return resolve(firebase.database());
          loadScript('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-database-compat.js')
            .then(function () { resolve(firebase.database()); })
            .catch(function () { resolve(null); });
          return;
        }
        setTimeout(wait, 120);
      })();
    });
  }

  /* ---------- CSS (estética Draksyon + referência) ---------- */
  var CSS = ''
+ '#dk-root,#dk-mnt-root{position:fixed;inset:0;z-index:2147483000;display:none;'
+ 'align-items:center;justify-content:center;padding:20px;'
+ 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;'
+ 'animation:dkfade .22s ease}'
+ '#dk-root.show,#dk-mnt-root.show{display:flex}'
+ '.dk-mask{position:absolute;inset:0;background:rgba(4,6,12,.72);backdrop-filter:blur(8px)}'
+ '#dk-mnt-root .dk-mask{background:#0a0a0d;backdrop-filter:none}'
+ '.dk-card{position:relative;width:min(420px,100%);background:#111113;'
+ 'border:1px solid rgba(255,255,255,.10);border-radius:18px;overflow:hidden;'
+ 'box-shadow:0 30px 80px -20px rgba(0,0,0,.75);'
+ 'animation:dkpop .28s cubic-bezier(.34,1.56,.64,1);color:#fff}'
+ '.dk-band{position:relative;height:92px;display:flex;align-items:center;justify-content:center;'
+ 'background-image:radial-gradient(rgba(255,255,255,.20) 1px,transparent 1px);'
+ 'background-size:7px 7px}'
+ '.dk-band::after{content:"";position:absolute;inset:0;'
+ 'background:linear-gradient(180deg,rgba(255,255,255,0),rgba(0,0,0,.08))}'
+ '.dk-ico{position:relative;z-index:1;width:60px;height:60px;border-radius:50%;background:#fff;'
+ 'display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(0,0,0,.32)}'
+ '.dk-ico svg{width:30px;height:30px}'
+ '.dk-close{position:absolute;top:10px;right:10px;z-index:2;background:rgba(0,0,0,.28);'
+ 'border:0;color:#fff;cursor:pointer;width:30px;height:30px;border-radius:50%;'
+ 'display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;transition:.15s}'
+ '.dk-close:hover{background:rgba(0,0,0,.5)}'
+ '.dk-body{padding:22px 22px 6px;text-align:center}'
+ '.dk-title{font-size:20px;font-weight:800;margin:0 0 8px;letter-spacing:.2px}'
+ '.dk-msg{font-size:14px;color:#b9b9c2;line-height:1.55;margin:0;white-space:pre-line}'
+ '.dk-actions{display:flex;gap:10px;justify-content:center;padding:18px 22px 22px}'
+ '.dk-btn{cursor:pointer;border:0;border-radius:999px;padding:9px 22px;font-weight:800;font-size:13px;'
+ 'letter-spacing:.3px;transition:.15s;min-width:96px}'
+ '.dk-btn.primary{color:#fff}'
+ '.dk-btn.ghost{background:transparent;border:1.5px solid currentColor}'
+ '.dk-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}'
+ /* cores por tipo */
+ '.dk-t-success .dk-band{background-color:#2ecc71}'
+ '.dk-t-success .dk-ico svg{color:#2ecc71}'
+ '.dk-t-success .dk-btn.primary{background:#2ecc71}'
+ '.dk-t-success .dk-btn.ghost{color:#2ecc71}'
+ '.dk-t-error .dk-band{background-color:#e74c3c}'
+ '.dk-t-error .dk-ico svg{color:#e74c3c}'
+ '.dk-t-error .dk-btn.primary{background:#e74c3c}'
+ '.dk-t-error .dk-btn.ghost{color:#e74c3c}'
+ '.dk-t-warning .dk-band{background-color:#f1c40f}'
+ '.dk-t-warning .dk-ico svg{color:#f1c40f}'
+ '.dk-t-warning .dk-btn.primary{background:#f1c40f;color:#231a00}'
+ '.dk-t-warning .dk-btn.ghost{color:#f1c40f}'
+ '.dk-t-info .dk-band{background-color:#3498db}'
+ '.dk-t-info .dk-ico svg{color:#3498db}'
+ '.dk-t-info .dk-btn.primary{background:#3498db}'
+ '.dk-t-info .dk-btn.ghost{color:#3498db}'
+ /* brand fallback usa cor do tema */
+ '.dk-t-brand .dk-band{background:var(--brand,#254BFF)}'
+ '.dk-t-brand .dk-ico svg{color:var(--brand,#254BFF)}'
+ '.dk-t-brand .dk-btn.primary{background:var(--grad-brand-135,linear-gradient(135deg,#254BFF,#3A56F6));'
+ 'box-shadow:var(--shadow-brand,0 8px 22px rgba(37,75,255,.35))}'
+ '.dk-t-brand .dk-btn.ghost{color:var(--brand-light,#5B7FFF)}'
+ '@keyframes dkfade{from{opacity:0}to{opacity:1}}'
+ '@keyframes dkpop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}'
+ '@media(max-width:480px){.dk-band{height:78px}.dk-ico{width:52px;height:52px}.dk-ico svg{width:26px;height:26px}.dk-title{font-size:18px}}';

  (function injectCss() {
    var st = document.createElement('style');
    st.id = 'dk-notice-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  })();

  /* ---------- ícones SVG ---------- */
  var ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    brand:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
  };

  /* mapeamento dos "types" salvos no banco -> chaves de estilo */
  function normalizeType(t) {
    t = (t || '').toLowerCase();
    if (t === 'success' || t === 'ok')       return 'success';
    if (t === 'danger'  || t === 'error'
      || t === 'failed' || t === 'fail')     return 'error';
    if (t === 'warning' || t === 'warn')     return 'warning';
    if (t === 'info'    || t === 'confirmation'
      || t === 'confirm')                    return 'info';
    return 'brand';
  }
  var LABELS = {
    success:{title:'Sucesso',  ok:'Okay'},
    error:  {title:'Erro',     ok:'Okay'},
    warning:{title:'Atenção',  ok:'Entendi'},
    info:   {title:'Confirmação', ok:'Ok', cancel:'Cancelar'},
    brand:  {title:'Aviso',    ok:'OK, entendi'}
  };

  /* ---------- dialog público ---------- */
  var DEFAULT_ROOT_ID = 'dk-root';

  function makeDialog(opts, rootId) {
    var kind = normalizeType(opts.type);
    var label = LABELS[kind] || LABELS.brand;
    var confirm = !!opts.confirm || kind === 'info' && opts.confirm !== false && !!opts.onConfirm;
    var dismissible = opts.dismissible !== false;

    var rootIdFinal = rootId || DEFAULT_ROOT_ID;
    var existing = document.getElementById(rootIdFinal);
    if (existing) existing.remove();

    var root = document.createElement('div');
    root.id = rootIdFinal;
    root.className = 'dk-t-' + kind;

    var actionsHtml = '';
    if (confirm) {
      actionsHtml =
        '<button class="dk-btn ghost" data-dk-cancel>' + (opts.cancelText || label.cancel || 'Cancelar') + '</button>' +
        '<button class="dk-btn primary" data-dk-ok>' + (opts.okText || label.ok || 'Confirmar') + '</button>';
    } else if (dismissible) {
      actionsHtml = '<button class="dk-btn primary" data-dk-ok>' + (opts.okText || label.ok || 'Okay') + '</button>';
    }

    root.innerHTML =
      '<div class="dk-mask"></div>' +
      '<div class="dk-card" role="dialog" aria-modal="true">' +
        (dismissible ? '<button class="dk-close" data-dk-close aria-label="Fechar">✕</button>' : '') +
        '<div class="dk-band"><div class="dk-ico">' + (ICONS[kind] || ICONS.brand) + '</div></div>' +
        '<div class="dk-body">' +
          '<h3 class="dk-title"></h3>' +
          '<p class="dk-msg"></p>' +
        '</div>' +
        (actionsHtml ? '<div class="dk-actions">' + actionsHtml + '</div>' : '') +
      '</div>';

    root.querySelector('.dk-title').textContent = opts.title || label.title;
    root.querySelector('.dk-msg').textContent   = opts.message || '';

    function close() {
      root.classList.remove('show');
      setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 220);
    }
    function ok()     { close(); if (opts.onOk)     opts.onOk(); if (opts.onConfirm) opts.onConfirm(); }
    function cancel() { close(); if (opts.onCancel) opts.onCancel(); }

    var btnOk     = root.querySelector('[data-dk-ok]');
    var btnCancel = root.querySelector('[data-dk-cancel]');
    var btnClose  = root.querySelector('[data-dk-close]');
    if (btnOk)     btnOk.onclick     = ok;
    if (btnCancel) btnCancel.onclick = cancel;
    if (btnClose)  btnClose.onclick  = close;
    if (dismissible) {
      root.querySelector('.dk-mask').onclick = close;
    }

    document.body.appendChild(root);
    // força reflow p/ ativar animação
    requestAnimationFrame(function () { root.classList.add('show'); });

    return { root: root, close: close };
  }

  window.DK_dialog = function (opts) { return makeDialog(opts || {}); };

  /* ---------- persistência de "vistos" (evita repetir dialog) ---------- */
  var seen = {};
  try { seen = JSON.parse(localStorage.getItem('dk_seen_notif') || '{}'); } catch (e) {}
  function markSeen(id) {
    seen[id] = 1;
    try { localStorage.setItem('dk_seen_notif', JSON.stringify(seen)); } catch (e) {}
  }

  /* ---------- watchers ---------- */
  function watchMaintenance(db, isAdmin) {
    db.ref('maintenance').on('value', function (snap) {
      var m = snap.val() || {};
      var old = document.getElementById('dk-mnt-root');
      if (m.enabled && !isAdmin) {
        if (old) return;
        makeDialog({
          type: 'warning',
          title: m.title || 'Site em manutenção',
          message: m.message || 'Estamos fazendo melhorias no Draksyon. Volte em alguns minutos.',
          dismissible: false
        }, 'dk-mnt-root');
      } else if (old) {
        old.classList.remove('show');
        setTimeout(function(){ if (old.parentNode) old.parentNode.removeChild(old); }, 200);
      }
    });
  }

  function watchNotifications(db, uid) {
    // globais (últimas 5)
    db.ref('notifications/global').limitToLast(5).on('child_added', function (snap) {
      var n = snap.val(); if (!n) return;
      var id = 'g:' + snap.key;
      if (seen[id]) return;
      var age = Date.now() - (n.createdAt || 0);
      if (age > 7 * 24 * 3600 * 1000) return;   // ignora >7 dias
      markSeen(id);
      makeDialog({ type: n.type || n.kind, title: n.title, message: n.message });
    });
    if (!uid) return;
    db.ref('notifications/user/' + uid).limitToLast(10).on('child_added', function (snap) {
      var n = snap.val(); if (!n) return;
      var id = 'u:' + snap.key;
      if (seen[id]) return;
      markSeen(id);
      makeDialog({ type: n.type || n.kind, title: n.title || 'Mensagem para você', message: n.message });
    });
  }

  function watchUser(db, user) {
    var uid = user.uid;
    var ref = db.ref('users/' + uid);
    // registra / atualiza dados básicos
    ref.transaction(function (cur) {
      cur = cur || {};
      cur.email       = user.email || cur.email || '';
      cur.name        = user.displayName || cur.name || (user.email ? user.email.split('@')[0] : 'Usuário');
      cur.createdAt   = cur.createdAt || Date.now();
      cur.lastLoginAt = Date.now();
      return cur;
    });
    ref.on('value', function (snap) {
      var d = snap.val() || {};
      window.DK_USER_DATA = d;
      document.documentElement.setAttribute('data-dk-premium', d.premium ? '1' : '0');
      document.documentElement.setAttribute('data-dk-admin',   d.isAdmin ? '1' : '0');
      try { window.dispatchEvent(new CustomEvent('dk:userdata', { detail: d })); } catch (e) {}

      // premium expirado
      if (d.premium && d.premiumUntil && d.premiumUntil < Date.now()) {
        ref.update({ premium: false });
      }
      // banido
      if (d.banned) {
        makeDialog({
          type: 'error',
          title: 'Conta suspensa',
          message: d.banReason || 'Sua conta foi suspensa por violar os termos de uso.',
          dismissible: false
        });
        try { firebase.auth().signOut(); } catch (e) {}
        setTimeout(function () { location.replace('login.html'); }, 4200);
      }
    });

    watchNotifications(db, uid);
    // manutenção depois de saber se é admin
    ref.child('isAdmin').once('value').then(function (s) {
      watchMaintenance(db, !!s.val());
    });
  }

  /* ---------- boot ---------- */
  ensureDb().then(function (db) {
    if (!db) return;
    // sempre observa globais + manutenção
    var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var isLogin = page === 'login.html';

    if (isLogin) {
      watchMaintenance(db, false);
      watchNotifications(db, null);
      return;
    }
    if (!firebase.auth) { watchMaintenance(db, false); watchNotifications(db, null); return; }
    firebase.auth().onAuthStateChanged(function (u) {
      if (u) {
        watchUser(db, u);
      } else {
        watchMaintenance(db, false);
        watchNotifications(db, null);
      }
    });
  });
})();
