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
  'use strict';
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
  function safeSegment(value){
    if (window.RabbitHubUid && window.RabbitHubUid.safeSegment) return window.RabbitHubUid.safeSegment(value);
    return String(value || 'item').replace(/[.#$\[\]\/]/g,'_').slice(0,180);
  }
  function randomId(){
    try { if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g,''); } catch(e){}
    return Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
  }
  function ensureSessionId(value){
    if (!value.sessionId) {
      value.sessionId = randomId();
      try { localStorage.setItem('dk_session',JSON.stringify(value)); } catch(e){}
    }
    return String(value.sessionId);
  }
  function deviceName(){
    var ua=String(navigator.userAgent||'');
    var platform=/Android/i.test(ua)?'Android':(/iPhone|iPad|iPod/i.test(ua)?'iPhone / iPad':(/Windows/i.test(ua)?'Windows':(/Mac OS/i.test(ua)?'macOS':(/Linux/i.test(ua)?'Linux':'Dispositivo'))));
    var browser=/wv\)|; wv|Version\/\d+.*Chrome/i.test(ua)?'App RabbitHub':(/Edg\//i.test(ua)?'Edge':(/Firefox\//i.test(ua)?'Firefox':(/Chrome\//i.test(ua)?'Chrome':(/Safari\//i.test(ua)?'Safari':'Navegador'))));
    return platform+' • '+browser;
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
  ensureSessionId(s);

  var deviceRef=null;
  var deviceHeartbeat=null;
  var revokedLocally=false;
  function clearLocalSession(){
    try { localStorage.removeItem('dk_active_profile');localStorage.removeItem('dk_session'); } catch(e){}
  }
  function registerDevice(db,user){
    var id=ensureSessionId(s);
    deviceRef=db.ref('users/'+safeSegment(user.uid)+'/devices/'+safeSegment(id));
    return deviceRef.once('value').then(function(snapshot){
      var previous=snapshot.val();
      if(previous&&previous.active===false){
        revokedLocally=true;clearLocalSession();go('login.html');return false;
      }
      var now=firebase.database.ServerValue.TIMESTAMP;
      return deviceRef.update({
        id:id,name:deviceName(),platform:String(navigator.platform||'').slice(0,80),
        userAgent:String(navigator.userAgent||'').slice(0,300),active:true,
        createdAt:previous&&previous.createdAt||now,lastSeen:now
      }).then(function(){
        deviceRef.child('active').on('value',function(activeSnapshot){
          if(activeSnapshot.val()===false&&!revokedLocally){revokedLocally=true;clearLocalSession();go('login.html');}
        });
        if(deviceHeartbeat)clearInterval(deviceHeartbeat);
        deviceHeartbeat=setInterval(function(){if(deviceRef&&!document.hidden)deviceRef.child('lastSeen').set(firebase.database.ServerValue.TIMESTAMP).catch(function(){});},5*60*1000);
        return true;
      });
    });
  }

  window.RabbitHubDevices={
    currentId:function(){return ensureSessionId(s);},
    list:function(){
      var db=window.firebase&&firebase.database?firebase.database():null;
      if(!db||!s.uid)return Promise.resolve([]);
      return db.ref('users/'+safeSegment(s.uid)+'/devices').once('value').then(function(snapshot){
        var list=[];snapshot.forEach(function(child){var value=child.val()||{};value.id=value.id||child.key;list.push(value);});
        return list.sort(function(a,b){return Number(b.lastSeen||0)-Number(a.lastSeen||0);});
      }).catch(function(){return [];});
    },
    revoke:function(id){
      var allowed=window.RabbitHubPlans&&window.RabbitHubPlans.can&&window.RabbitHubPlans.can('connectedDevices');
      if(!allowed)return Promise.reject(new Error('Gerenciar dispositivos é um recurso VIP.'));
      var db=window.firebase&&firebase.database?firebase.database():null;
      if(!db||!s.uid)return Promise.reject(new Error('Banco de dados indisponível.'));
      return db.ref('users/'+safeSegment(s.uid)+'/devices/'+safeSegment(id)).update({active:false,revokedAt:firebase.database.ServerValue.TIMESTAMP});
    }
  };

  ready(function(){
    initFirebase();
    if (!window.firebase || !window.firebase.database) return;
    var db = firebase.database();
    var migrate = window.RabbitHubUid && window.RabbitHubUid.migrateSession
      ? window.RabbitHubUid.migrateSession(db,s).catch(function(){ return {session:s}; })
      : Promise.resolve({session:s});
    migrate.then(function(result){
      s = result && result.session ? result.session : s;
      var segment = window.RabbitHubUid && window.RabbitHubUid.safeSegment
        ? window.RabbitHubUid.safeSegment(s.uid) : String(s.uid).replace(/[.#$\[\]\/]/g,'_');
      return db.ref('users/' + segment).once('value');
    }).then(function(snap){
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
        bio: String(data.bio || '').slice(0,280),
        plan: data.plan || data.currentPlan || 'Free',
        currentPlan: data.currentPlan || data.plan || 'Free',
        premium: data.premium === true,
        premiumUntil: data.premiumUntil || 0
      };
      try {
        s.plan = window.DK_USER.plan;
        s.currentPlan = window.DK_USER.currentPlan;
        s.premium = window.DK_USER.premium;
        s.bio = window.DK_USER.bio;
        localStorage.setItem('dk_session',JSON.stringify(s));
      } catch(e){}
      registerDevice(db,s).catch(function(){});
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
    revokedLocally=true;
    if(deviceRef)deviceRef.update({active:false,signedOutAt:firebase.database.ServerValue.TIMESTAMP}).catch(function(){});
    clearLocalSession();
    go('login.html');
  };
})();
