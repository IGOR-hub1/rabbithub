/* X-Bunny Animes • guarda de sessão baseada no Firebase Authentication real. */
(function(){
  'use strict';

  var page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  if(page==='admin.html'||page==='login.html')return;

  var currentSession=null;
  var deviceRef=null;
  var deviceHeartbeat=null;
  var leaving=false;

  function go(url){
    if((location.pathname.split('/').pop()||'').toLowerCase()!==url)location.replace(url);
  }
  function readJSON(key,fallback){
    try{var value=JSON.parse(localStorage.getItem(key)||'null');return value==null?fallback:value;}
    catch(e){return fallback;}
  }
  function safeSegment(value){
    if(window.RabbitHubUid&&window.RabbitHubUid.safeSegment)return window.RabbitHubUid.safeSegment(value);
    return String(value||'item').replace(/[.#$\[\]\/]/g,'_').slice(0,180);
  }
  function clearLocalSession(){
    try{localStorage.removeItem('dk_active_profile');localStorage.removeItem('dk_session');}
    catch(e){}
  }
  function randomId(){
    try{if(crypto.randomUUID)return crypto.randomUUID().replace(/-/g,'');}catch(e){}
    return Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
  }
  function ensureSessionId(session){
    if(!session.sessionId)session.sessionId=randomId();
    return String(session.sessionId);
  }
  function deviceName(){
    var ua=String(navigator.userAgent||'');
    var platform=/Android/i.test(ua)?'Android':(/iPhone|iPad|iPod/i.test(ua)?'iPhone / iPad':(/Windows/i.test(ua)?'Windows':(/Mac OS/i.test(ua)?'macOS':(/Linux/i.test(ua)?'Linux':'Dispositivo'))));
    var browser=/wv\)|; wv|Version\/\d+.*Chrome/i.test(ua)?'App X-Bunny Animes':(/Edg\//i.test(ua)?'Edge':(/Firefox\//i.test(ua)?'Firefox':(/Chrome\//i.test(ua)?'Chrome':(/Safari\//i.test(ua)?'Safari':'Navegador'))));
    return platform+' • '+browser;
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
  function activeProfile(){return readJSON('dk_active_profile',{})||{};}
  function normalizeProfile(data,session){
    data=data||{};
    var existing=activeProfile(),list=profileList(data),selected=null;
    if(existing.id)selected=list.filter(function(item){return String(item.id||item.profileId||'')===String(existing.id);})[0]||null;
    selected=selected||data.profile||list[0]||existing||{};
    return {
      id:String(selected.id||selected.profileId||'principal'),
      name:String(selected.name||selected.profileName||data.profileName||data.displayName||session.displayName||'Perfil').trim().slice(0,24)||'Perfil',
      avatar:String(selected.avatar||selected.profileAvatar||data.profileAvatar||session.profileAvatar||'img/logo-blue.jpg').trim(),
      bio:String(selected.bio||data.bio||'').trim().slice(0,280),
      banner:String(selected.banner||'default'),
      theme:String(selected.theme||'blue')
    };
  }
  function storeSession(session,profile){
    session.displayName=profile.name;
    session.profileAvatar=profile.avatar;
    session.bio=profile.bio;
    ensureSessionId(session);
    currentSession=session;
    try{
      localStorage.setItem('dk_session',JSON.stringify(session));
      localStorage.setItem('dk_active_profile',JSON.stringify(profile));
      localStorage.setItem('dk_profiles_'+session.uid,JSON.stringify([profile]));
    }catch(e){}
  }
  function registerDevice(db,user,session){
    var id=ensureSessionId(session);
    deviceRef=db.ref('users/'+safeSegment(user.uid)+'/devices/'+safeSegment(id));
    return deviceRef.once('value').then(function(snapshot){
      var previous=snapshot.val();
      if(previous&&previous.active===false){
        leaving=true;clearLocalSession();
        return firebase.auth().signOut().then(function(){go('login.html?reason=device');return false;});
      }
      var now=firebase.database.ServerValue.TIMESTAMP;
      return deviceRef.update({
        id:id,name:deviceName(),platform:String(navigator.platform||'').slice(0,80),
        userAgent:String(navigator.userAgent||'').slice(0,300),active:true,
        createdAt:previous&&previous.createdAt||now,lastSeen:now
      }).then(function(){
        deviceRef.child('active').on('value',function(activeSnapshot){
          if(activeSnapshot.val()===false&&!leaving){
            leaving=true;clearLocalSession();
            firebase.auth().signOut().finally(function(){go('login.html?reason=device');});
          }
        });
        if(deviceHeartbeat)clearInterval(deviceHeartbeat);
        deviceHeartbeat=setInterval(function(){
          if(deviceRef&&!document.hidden)deviceRef.child('lastSeen').set(firebase.database.ServerValue.TIMESTAMP).catch(function(){});
        },5*60*1000);
        return true;
      });
    });
  }
  function exposeDevices(db){
    window.RabbitHubDevices={
      currentId:function(){return currentSession?ensureSessionId(currentSession):'';},
      list:function(){
        if(!currentSession)return Promise.resolve([]);
        return db.ref('users/'+safeSegment(currentSession.uid)+'/devices').once('value').then(function(snapshot){
          var list=[];
          snapshot.forEach(function(child){var value=child.val()||{};value.id=value.id||child.key;list.push(value);});
          return list.sort(function(a,b){return Number(b.lastSeen||0)-Number(a.lastSeen||0);});
        }).catch(function(){return [];});
      },
      revoke:function(id){
        var allowed=window.RabbitHubPlans&&window.RabbitHubPlans.can&&window.RabbitHubPlans.can('connectedDevices');
        if(!allowed)return Promise.reject(new Error('Gerenciar dispositivos é um recurso VIP.'));
        if(!currentSession)return Promise.reject(new Error('Entre novamente.'));
        return db.ref('users/'+safeSegment(currentSession.uid)+'/devices/'+safeSegment(id)).update({active:false,revokedAt:firebase.database.ServerValue.TIMESTAMP});
      }
    };
  }
  function markReady(){document.documentElement.setAttribute('data-dk-ready','1');}
  function init(){
    if(!window.firebase||!firebase.auth||!firebase.database||!window.DK_FIREBASE_CONFIG){
      setTimeout(init,60);return;
    }
    try{if(!firebase.apps||!firebase.apps.length)firebase.initializeApp(window.DK_FIREBASE_CONFIG);}catch(e){}
    window.__DK_FB_INIT__=true;
    var auth=firebase.auth(),db=firebase.database();
    exposeDevices(db);
    auth.onAuthStateChanged(function(user){
      if(!user){clearLocalSession();go('login.html?reason=auth');return;}
      var old=readJSON('dk_session',{})||{};
      var base={
        uid:user.uid,email:user.email||'',displayName:user.displayName||old.displayName||'',
        sessionId:old.uid===user.uid?old.sessionId||'':''
      };
      ensureSessionId(base);
      db.ref('users/'+safeSegment(user.uid)).once('value').then(function(snapshot){
        var data=snapshot.val();
        if(!data){
          leaving=true;clearLocalSession();
          return auth.signOut().then(function(){go('login.html?reason=profile');});
        }
        if(data.banned===true){
          leaving=true;clearLocalSession();
          alert('Sua conta foi banida. Entre em contato com o suporte.');
          return auth.signOut().then(function(){go('login.html?reason=banned');});
        }
        base.plan=data.plan||data.currentPlan||'Free';
        base.currentPlan=data.currentPlan||data.plan||'Free';
        base.premium=data.premium===true;
        var profile=normalizeProfile(data,base);
        storeSession(base,profile);
        window.DK_USER={
          uid:user.uid,email:user.email||data.email||'',displayName:profile.name,
          profileAvatar:profile.avatar,bio:profile.bio,plan:base.plan,currentPlan:base.currentPlan,
          premium:base.premium,premiumUntil:data.premiumUntil||0
        };
        var updates={
          uid:user.uid,email:user.email||data.email||'',displayName:profile.name,
          profileName:profile.name,profileAvatar:profile.avatar,profile:profile,profiles:[profile],
          lastLogin:firebase.database.ServerValue.TIMESTAMP,passwordHash:null
        };
        db.ref('users/'+safeSegment(user.uid)).update(updates).catch(function(){});
        registerDevice(db,user,base).catch(function(){});
        try{
          document.dispatchEvent(new CustomEvent('dk:userready',{detail:window.DK_USER}));
          document.dispatchEvent(new CustomEvent('rh:uidchange',{detail:{uid:user.uid}}));
          document.dispatchEvent(new CustomEvent('dk:profilechange',{detail:profile}));
        }catch(e){}
        markReady();
      }).catch(function(){
        var fallback=normalizeProfile({},base);
        storeSession(base,fallback);
        markReady();
      });
    });
    window.DK_logout=function(){
      leaving=true;
      var close=deviceRef?deviceRef.update({active:false,signedOutAt:firebase.database.ServerValue.TIMESTAMP}).catch(function(){}):Promise.resolve();
      return close.then(function(){return auth.signOut();}).catch(function(){}).then(function(){clearLocalSession();go('login.html');});
    };
  }
  init();
})();
