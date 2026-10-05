/* =====================================================================
 * DRAKSYON • Shim de firebase.auth() a partir de localStorage.dk_session
 * ---------------------------------------------------------------------
 * Substitui o Firebase Authentication (removido) por um objeto compatível
 * com os principais métodos usados pelo site: currentUser, onAuthStateChanged
 * e signOut. Todos os módulos existentes (dk-notice, dk-realtime,
 * site-integration, site-status, etc.) continuam funcionando por UID.
 *
 * Carregue ANTES de firebase-config.js e dos módulos que usam firebase.auth.
 * ===================================================================== */
(function(){
  function readUser(){
    try {
      var s = JSON.parse(localStorage.getItem('dk_session') || 'null');
      if (!s || !s.uid) return null;
      return {
        uid: s.uid,
        email: s.email || null,
        displayName: s.displayName || null,
        emailVerified: true,
        isAnonymous: false,
        providerData: [],
        getIdToken: function(){ return Promise.resolve(''); }
      };
    } catch(e){ return null; }
  }

  var listeners = [];
  var currentUser = readUser();

  function notify(){
    currentUser = readUser();
    for (var i=0; i<listeners.length; i++){
      try { listeners[i](currentUser); } catch(e){}
    }
  }

  // Reage a mudanças em outras abas.
  window.addEventListener('storage', function(e){
    if (e && e.key === 'dk_session') notify();
  });

  var authApi = {
    get currentUser(){ return readUser(); },
    onAuthStateChanged: function(cb){
      if (typeof cb !== 'function') return function(){};
      listeners.push(cb);
      try { cb(readUser()); } catch(e){}
      return function unsubscribe(){
        var i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    signOut: function(){
      try {
        localStorage.removeItem('dk_session');
        localStorage.removeItem('dk_active_profile');
      } catch(e){}
      notify();
      return Promise.resolve();
    },
    // stubs (não usados sem Authentication)
    setPersistence: function(){ return Promise.resolve(); },
    sendPasswordResetEmail: function(){ return Promise.reject(new Error('Auth desabilitado (modo teste).')); },
    signInWithEmailAndPassword: function(){ return Promise.reject(new Error('Auth desabilitado (modo teste).')); },
    createUserWithEmailAndPassword: function(){ return Promise.reject(new Error('Auth desabilitado (modo teste).')); }
  };

  function installShim(){
    if (!window.firebase) { setTimeout(installShim, 30); return; }
    // Se o SDK oficial de auth já foi carregado, não sobrescrevemos.
    if (typeof window.firebase.auth === 'function') return;
    var fn = function(){ return authApi; };
    fn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
    try { window.firebase.auth = fn; } catch(e){}
  }
  installShim();

  // Expõe utilitário para outros scripts dispararem sync após login/logout
  window.DK_notifyAuth = notify;
})();
