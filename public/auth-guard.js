/* =====================================================================
 * DRAKSYON • Guarda de autenticação e perfis
 * ---------------------------------------------------------------------
 * Regras:
 *  - Se o usuário nunca logou → redireciona para /login.html
 *  - Se está logado mas não escolheu um perfil → /perfis.html
 *  - Executa em toda página (exceto login.html e perfis.html)
 * Requer: firebase-config.js + Firebase compat SDK.
 * ===================================================================== */
(function(){
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var isAuthPage    = (page === 'login.html');
  var isProfilePage = (page === 'perfis.html');

  function go(url){
    if (location.pathname.split('/').pop().toLowerCase() === url) return;
    location.replace(url);
  }

  function activeProfile(){
    try { return JSON.parse(localStorage.getItem('dk_active_profile') || 'null'); }
    catch(e){ return null; }
  }

  function initFirebase(){
    if (window.__DK_FB_INIT__) return;
    if (!window.firebase || !window.DK_FIREBASE_CONFIG) return;
    try {
      firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      window.__DK_FB_INIT__ = true;
    } catch(e){ /* já iniciado */ window.__DK_FB_INIT__ = true; }
  }

  function ready(cb){
    if (window.firebase && window.firebase.auth) return cb();
    var t = setInterval(function(){
      if (window.firebase && window.firebase.auth) { clearInterval(t); cb(); }
    }, 60);
    setTimeout(function(){ clearInterval(t); }, 8000);
  }

  ready(function(){
    initFirebase();
    if (!window.firebase || !window.firebase.auth) return;
    firebase.auth().onAuthStateChanged(function(user){
      window.DK_USER = user || null;
      if (!user) {
        if (!isAuthPage) go('login.html');
        return;
      }
      if (isAuthPage) { go('perfis.html'); return; }
      if (!activeProfile() && !isProfilePage) { go('perfis.html'); return; }
      document.documentElement.setAttribute('data-dk-ready','1');
    });
  });

  window.DK_logout = function(){
    try { localStorage.removeItem('dk_active_profile'); } catch(e){}
    if (window.firebase && firebase.auth) firebase.auth().signOut().finally(function(){ go('login.html'); });
    else go('login.html');
  };
})();
