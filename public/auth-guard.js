/* =====================================================================
 * DRAKSYON • Guarda de sessão (sem Firebase Authentication)
 * ---------------------------------------------------------------------
 * A sessão vive em localStorage (dk_session = {uid,email,displayName}).
 * Em toda página (exceto login/admin) verifica:
 *   - sessão existe   → senão vai para login.html
 *   - usuário banido  → limpa sessão e volta para login.html
 *   - perfil único     → normaliza dados antigos automaticamente
 * ===================================================================== */
(function(){
  'use strict';
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var isAuthPage    = (page === 'login.html');
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
  function profileList(data){
    var source=data&&data.profiles;
    if(Array.isArray(source))return source.filter(Boolean);
    if(source&&typeof source==='object')return Object.keys(source).map(function(key){
      var item=source[key];
      return item&&typeof item==='object'?Object.assign({id:item.id||key},item):null;
    }).filter(Boolean);
    return [];
  }
  function ensureSingleProfile(db,data){
    data=data||{};
    var existing=activeProfile()||{},list=profileList(data),selected=null;
    if(existing.id)selected=list.filter(function(item){return String(item.id||item.profileId||'')===String(existing.id);})[0]||null;
    selected=selected||data.profile||list[0]||existing||{};
    var profile={
      id:String(selected.id||selected.profileId||'principal'),
      name:String(selected.name||selected.profileName||data.profileName||data.displayName||s.displayName||'Perfil').trim().slice(0,24)||'Perfil',
      avatar:String(selected.avatar||selected.profileAvatar||data.profileAvatar||s.profileAvatar||'img/logo-blue.jpg').trim(),
      bio:String(selected.bio||data.bio||'').trim().slice(0,280),
      banner:String(selected.banner||'default'),theme:String(selected.theme||'blue')
    };
    try{
      localStorage.setItem('dk_active_profile',JSON.stringify(profile));
      localStorage.setItem('dk_profiles_'+String(s.uid||'anon'),JSON.stringify([profile]));
      s.displayName=profile.name;s.profileAvatar=profile.avatar;s.bio=profile.bio;
      localStorage.setItem('dk_session',JSON.stringify(s));
    }catch(e){}
    var alreadySingle=list.length===1&&String(list[0].id||list[0].profileId||'')===profile.id&&data.profile&&String(data.profile.id||data.profile.profileId||'')===profile.id;
    if(alreadySingle)return Promise.resolve(profile);
    return db.ref('users/'+safeSegment(s.uid)).update({
      displayName:profile.name,profileName:profile.name,profileAvatar:profile.avatar,
      profile:profile,profiles:[profile]
    }).catch(function(){return null;}).then(function(){return profile;});
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
        profileAvatar:data.profileAvatar || '',
        bio: String(data.bio || '').slice(0,280),
        plan: data.plan || data.currentPlan || 'Free',
        currentPlan: data.currentPlan || data.plan || 'Free',
        premium: data.premium === true,
        premiumUntil: data.premiumUntil || 0
      };
      return ensureSingleProfile(db,data).then(function(profile){
        try {
          s.plan = window.DK_USER.plan;
          s.currentPlan = window.DK_USER.currentPlan;
          s.premium = window.DK_USER.premium;
          s.bio = profile.bio || window.DK_USER.bio;
          s.displayName=profile.name;s.profileAvatar=profile.avatar;
          localStorage.setItem('dk_session',JSON.stringify(s));
        } catch(e){}
        window.DK_USER.displayName=profile.name;window.DK_USER.profileAvatar=profile.avatar;
        registerDevice(db,s).catch(function(){});
        try { document.dispatchEvent(new CustomEvent('dk:userready', { detail: window.DK_USER })); } catch(e){}
        if (isAuthPage) { go('index.html'); return; }
        document.documentElement.setAttribute('data-dk-ready','1');
      });
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
