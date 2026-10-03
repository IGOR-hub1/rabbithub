/* =====================================================================
 * DRAKSYON • Integração REAL com Painel Admin
 * ---------------------------------------------------------------------
 * Usa o próprio servidor Node do site (/admin-api) para gerenciar:
 * - usuários autenticados por e-mail no Firebase Auth
 * - Premium, bloqueio, manutenção e dialogs/notificações
 * ===================================================================== */
(function () {
  'use strict';

  var API_BASE = (window.DK_ADMIN_API_BASE || '').replace(/\/$/, '');
  var POLL_MS = 4000;
  var currentUid = null;
  var lastStateHash = '';
  var pollTimer = null;
  window.DK_PREMIUM = false;
  window.DK_ADMIN_READY = false;

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(API_BASE + path, Object.assign({}, options, { headers: headers, cache: 'no-store' }))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
  }

  function waitFirebase(cb) {
    var tries = 0;
    var t = setInterval(function () {
      if (window.firebase && firebase.auth) {
        clearInterval(t);
        cb();
      } else if (++tries > 120) {
        clearInterval(t);
        startPolling(null);
      }
    }, 80);
  }

  function initFirebaseIfNeeded() {
    if (!window.firebase || !firebase.auth) return false;
    if (!window.__DK_FB_INIT__ && window.DK_FIREBASE_CONFIG) {
      try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); } catch (_) {}
      window.__DK_FB_INIT__ = true;
    }
    return true;
  }

  function cleanString(value, fallback) {
    value = value == null ? '' : String(value);
    value = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return value || fallback || '';
  }

  function userPayload(user) {
    var provider = '';
    try { provider = user.providerData && user.providerData[0] && user.providerData[0].providerId || ''; } catch (_) {}
    return {
      uid: cleanString(user && user.uid),
      email: cleanString(user && user.email),
      displayName: cleanString(user && user.displayName, user && user.email ? String(user.email).split('@')[0] : 'Usuário'),
      photoURL: cleanString(user && user.photoURL),
      provider: cleanString(provider, 'password')
    };
  }

  function syncUser(user) {
    if (!user || !user.uid) return Promise.resolve(null);
    currentUid = user.uid;
    return api('/admin-api/register-user', {
      method: 'POST',
      body: JSON.stringify(userPayload(user))
    }).then(function (data) {
      applyUserState(data.user || null);
      return data;
    }).catch(function () { return null; });
  }
  window.DK_ADMIN_SYNC_USER = syncUser;

  function seenKey(uid) { return 'dk_admin_seen_notifs_' + (uid || 'anon'); }
  function seenList() {
    try { return JSON.parse(localStorage.getItem(seenKey(currentUid)) || '[]'); }
    catch (_) { return []; }
  }
  function markSeen(id) {
    if (!id) return;
    var list = seenList();
    if (list.indexOf(id) === -1) list.push(id);
    try { localStorage.setItem(seenKey(currentUid), JSON.stringify(list.slice(-180))); } catch (_) {}
  }

  function injectStyles() {
    if (document.getElementById('dk-admin-dialog-style')) return;
    var st = document.createElement('style');
    st.id = 'dk-admin-dialog-style';
    st.textContent = [
      '.dk-admin-lock{position:fixed;inset:0;z-index:2147483600;background:radial-gradient(circle at top,var(--brand-soft,rgba(108,92,231,.18)),transparent 42%),rgba(7,7,10,.97);color:#fff;display:flex;align-items:center;justify-content:center;padding:22px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}',
      '.dk-admin-lock__box{width:min(460px,100%);text-align:center;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:30px 22px;box-shadow:0 28px 80px rgba(0,0,0,.62)}',
      '.dk-admin-lock__icon{width:64px;height:64px;border-radius:18px;display:inline-flex;align-items:center;justify-content:center;background:var(--grad-brand-135,linear-gradient(135deg,#6c5ce7,#a29bfe));box-shadow:var(--shadow-brand,0 12px 40px rgba(108,92,231,.35));font-size:32px;margin-bottom:16px}',
      '.dk-admin-lock h2{margin:0 0 10px;font-size:23px;line-height:1.2;font-weight:900;letter-spacing:0}',
      '.dk-admin-lock p{margin:0;color:#d7d7df;font-size:14.5px;line-height:1.55;white-space:pre-wrap}',
      '.dk-admin-dialog-backdrop{position:fixed;inset:0;z-index:2147483500;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:18px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;animation:dkAdminFade .18s ease both}',
      '.dk-admin-dialog{width:min(430px,100%);background:#151519;border:1px solid rgba(255,255,255,.12);border-radius:18px;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden}',
      '.dk-admin-dialog__bar{height:4px;background:var(--grad-brand-135,linear-gradient(135deg,#6c5ce7,#a29bfe))}',
      '.dk-admin-dialog__body{padding:20px}',
      '.dk-admin-dialog__top{display:flex;gap:12px;align-items:flex-start}',
      '.dk-admin-dialog__icon{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.07);flex:0 0 auto;font-size:22px}',
      '.dk-admin-dialog h3{margin:0 0 6px;font-size:18px;font-weight:900;letter-spacing:0;line-height:1.25}',
      '.dk-admin-dialog p{margin:0;color:#c9c9d3;font-size:14px;line-height:1.5;white-space:pre-wrap}',
      '.dk-admin-dialog__actions{display:flex;justify-content:flex-end;margin-top:18px}',
      '.dk-admin-dialog button{background:var(--grad-brand-135,linear-gradient(135deg,#6c5ce7,#a29bfe));color:#fff;border:0;border-radius:10px;font-weight:800;padding:10px 18px;cursor:pointer;box-shadow:var(--shadow-brand,0 12px 34px rgba(108,92,231,.22))}',
      '.dk-admin-dialog--warning .dk-admin-dialog__bar{background:linear-gradient(135deg,#f59e0b,#f97316)}',
      '.dk-admin-dialog--success .dk-admin-dialog__bar{background:linear-gradient(135deg,#22c55e,#16a34a)}',
      '.dk-admin-dialog--danger .dk-admin-dialog__bar{background:linear-gradient(135deg,#ef4444,#f97316)}',
      '.dk-premium-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,204,85,.32);background:rgba(255,204,85,.10);color:#ffd76a;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:900;letter-spacing:.4px;text-transform:uppercase}',
      '@keyframes dkAdminFade{from{opacity:0}to{opacity:1}}'
    ].join('');
    document.head.appendChild(st);
  }

  function showMaintenance(cfg) {
    injectStyles();
    var old = document.getElementById('dk-admin-maintenance');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'dk-admin-maintenance';
    box.className = 'dk-admin-lock';
    var inner = document.createElement('div'); inner.className = 'dk-admin-lock__box';
    var icon = document.createElement('div'); icon.className = 'dk-admin-lock__icon'; icon.textContent = '🛠️';
    var h = document.createElement('h2'); h.textContent = cleanString(cfg && cfg.title, 'Site em manutenção');
    var p = document.createElement('p'); p.textContent = cleanString(cfg && cfg.message, 'Voltamos em breve. Obrigado pela paciência!');
    inner.appendChild(icon); inner.appendChild(h); inner.appendChild(p); box.appendChild(inner);
    document.body.appendChild(box);
  }

  function hideMaintenance() {
    var old = document.getElementById('dk-admin-maintenance');
    if (old) old.remove();
  }

  function showDialog(n, options) {
    options = options || {};
    injectStyles();
    var type = cleanString(n && n.type, 'info');
    var iconMap = { warning: '⚠️', success: '✅', danger: '⛔', maintenance: '🛠️', premium: '👑', info: '📢' };
    var backdrop = document.createElement('div');
    backdrop.className = 'dk-admin-dialog-backdrop';
    var dialog = document.createElement('div');
    dialog.className = 'dk-admin-dialog dk-admin-dialog--' + type;
    var bar = document.createElement('div'); bar.className = 'dk-admin-dialog__bar';
    var body = document.createElement('div'); body.className = 'dk-admin-dialog__body';
    var top = document.createElement('div'); top.className = 'dk-admin-dialog__top';
    var ic = document.createElement('div'); ic.className = 'dk-admin-dialog__icon'; ic.textContent = iconMap[type] || iconMap.info;
    var text = document.createElement('div');
    var title = document.createElement('h3'); title.textContent = cleanString(n && n.title, 'Aviso');
    var msg = document.createElement('p'); msg.textContent = cleanString(n && n.message, '');
    text.appendChild(title); text.appendChild(msg); top.appendChild(ic); top.appendChild(text);
    var actions = document.createElement('div'); actions.className = 'dk-admin-dialog__actions';
    var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = options.button || 'Entendi';
    function close(){ backdrop.remove(); if (typeof options.onClose === 'function') options.onClose(); }
    btn.onclick = close;
    backdrop.onclick = function(e){ if (e.target === backdrop && !options.locked) close(); };
    actions.appendChild(btn); body.appendChild(top); body.appendChild(actions); dialog.appendChild(bar); dialog.appendChild(body); backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
  }

  function applyUserState(user) {
    user = user || {};
    var wasPremium = window.DK_PREMIUM === true;
    var nowPremium = user.premium === true;
    window.DK_PREMIUM = nowPremium;
    window.DK_ADMIN_USER_STATE = user;
    if (wasPremium !== nowPremium) {
      window.dispatchEvent(new CustomEvent('dk:premium-change', { detail: { premium: nowPremium, user: user } }));
      window.dispatchEvent(new CustomEvent('dk:admin-state', { detail: { user: user } }));
    }
    if (user.blocked === true) {
      showDialog({ type: 'danger', title: 'Conta bloqueada', message: 'Sua conta foi bloqueada por um administrador.' }, {
        locked: true,
        button: 'Sair',
        onClose: function () { if (window.DK_logout) window.DK_logout(); else location.replace('login.html'); }
      });
      setTimeout(function(){ if (window.DK_logout) window.DK_logout(); }, 2200);
    }
  }

  function applyState(state) {
    if (!state) return;
    var hash = JSON.stringify({ m: state.maintenance, u: state.user && { premium: state.user.premium, blocked: state.user.blocked } });
    if (hash !== lastStateHash) {
      lastStateHash = hash;
      window.DK_ADMIN_READY = true;
      if (state.maintenance && state.maintenance.enabled) showMaintenance(state.maintenance);
      else hideMaintenance();
      if (state.user) applyUserState(state.user);
    }

    var notifications = Array.isArray(state.notifications) ? state.notifications : [];
    notifications.forEach(function (n) {
      var id = cleanString(n && n.id);
      if (!id || seenList().indexOf(id) !== -1) return;
      markSeen(id);
      showDialog(n);
    });
  }

  function pollOnce() {
    var qs = currentUid ? ('?uid=' + encodeURIComponent(currentUid)) : '';
    return api('/admin-api/state' + qs).then(applyState).catch(function () {});
  }

  function startPolling(user) {
    if (user && user.uid) currentUid = user.uid;
    if (pollTimer) clearInterval(pollTimer);
    pollOnce();
    pollTimer = setInterval(pollOnce, POLL_MS);
  }

  function boot() {
    injectStyles();
    waitFirebase(function () {
      initFirebaseIfNeeded();
      if (!window.firebase || !firebase.auth) { startPolling(null); return; }
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) {
          syncUser(user).finally(function () { startPolling(user); });
        } else {
          currentUid = null;
          startPolling(null);
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
