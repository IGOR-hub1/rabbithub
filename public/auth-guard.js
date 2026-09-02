/* =====================================================================
 * DRAKSYON • Guarda de sessão (sem Firebase Authentication)
 * ---------------------------------------------------------------------
 * A sessão vive em localStorage (dk_session = {uid,email,displayName}).
 * Em toda página (exceto login/perfis/admin) verifica:
 *   - sessão existe   → senão vai para login.html
 *   - usuário banido  → limpa sessão e volta para login.html
 *   - perfil ativo    → senão vai para perfis.html
 * ===================================================================== */
(function(){
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var isAuthPage    = (page === 'login.html');
  var isProfilePage = (page === 'perfis.html');
  var isAdminPage   = (page === 'admin.html');

  if (isAdminPage) return; // painel admin não passa por sessão

  function go(url){
    if (location.pathname.split('/').pop().toLowerCase() === url) return;
    location.replace(url);
  }
  function session(){
    try { return JSON.parse(localStorage.getItem('dk_session') || 'null'); }
    catch(e){ return null; }
  }
  function activeProfile(){
    try { return JSON.parse(localStorage.getItem('dk_active_profile') || 'null'); }
    catch(e){ return null; }
  }
  function initFirebase(){
    if (window.__DK_FB_INIT__) return;
    if (!window.firebase || !window.DK_FIREBASE_CONFIG) return;
    try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); window.__DK_FB_INIT__ = true; }
    catch(e){ window.__DK_FB_INIT__ = true; }
  }
  function ready(cb){
    if (window.firebase && window.firebase.database) return cb();
    var t = setInterval(function(){
      if (window.firebase && window.firebase.database) { clearInterval(t); cb(); }
    }, 60);
    setTimeout(function(){ clearInterval(t); }, 8000);
  }

  var s = session();
  if (!s || !s.uid){
    if (!isAuthPage) go('login.html');
    return;
  }

  ready(function(){
    initFirebase();
    if (!window.firebase || !window.firebase.database) return;
    firebase.database().ref('users/' + s.uid).once('value').then(function(snap){
      var data = snap.val();
      if (!data){
        localStorage.removeItem('dk_session');
        localStorage.removeItem('dk_active_profile');
        go('login.html');
        return;
      }
      if (data.banned === true){
        localStorage.removeItem('dk_session');
        localStorage.removeItem('dk_active_profile');
        alert('Sua conta foi banida. Entre em contato com o suporte.');
        go('login.html');
        return;
      }
      window.DK_USER = {
        uid: s.uid,
        email: data.email,
        displayName: data.displayName,
        plan: data.plan || data.currentPlan || 'Free',
        currentPlan: data.currentPlan || data.plan || 'Free',
        premium: data.premium === true,
        premiumUntil: data.premiumUntil || 0
      };
      try {
        s.plan = window.DK_USER.plan;
        s.currentPlan = window.DK_USER.currentPlan;
        s.premium = window.DK_USER.premium;
        localStorage.setItem('dk_session',JSON.stringify(s));
      } catch(e){}
      try {
        document.dispatchEvent(new CustomEvent('dk:userready', { detail: window.DK_USER }));
      } catch(e){}
      if (isAuthPage) { go('perfis.html'); return; }
      if (!activeProfile() && !isProfilePage) { go('perfis.html'); return; }
      document.documentElement.setAttribute('data-dk-ready','1');
    }).catch(function(){
      // se der erro (regras/rede), deixa passar para não travar o site
      document.documentElement.setAttribute('data-dk-ready','1');
    });
  });

  window.DK_logout = function(){
    try {
      localStorage.removeItem('dk_active_profile');
      localStorage.removeItem('dk_session');
    } catch(e){}
    go('login.html');
  };
})();
