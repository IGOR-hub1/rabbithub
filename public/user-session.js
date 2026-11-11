/* RabbitHub - sessao e conta centralizadas no Firebase Authentication/RTDB. */
(function(){
  'use strict';

  var listeners=[];
  var accountRef=null;
  var accountTimeout=null;
  var authUnsubscribe=null;
  var started=false;
  var readyResolve;
  var readyPromise=new Promise(function(resolve){readyResolve=resolve;});
  var state={status:'loading',ready:false,uid:'',authUser:null,account:null,profile:null,error:null};

  function copy(){
    return {
      status:state.status,ready:state.ready,uid:state.uid,authUser:state.authUser,
      account:state.account,profile:state.profile,error:state.error
    };
  }
  function readJSON(key,fallback){
    try{var value=JSON.parse(localStorage.getItem(key)||'null');return value==null?fallback:value;}
    catch(e){return fallback;}
  }
  function safeSegment(value){
    if(window.RabbitHubUid&&window.RabbitHubUid.safeSegment)return window.RabbitHubUid.safeSegment(value);
    return String(value||'').replace(/[.#$\[\]\/]/g,'_').slice(0,180);
  }
  function profileList(account){
    var source=account&&account.profiles;
    if(Array.isArray(source))return source.filter(function(item){return item&&typeof item==='object';});
    if(source&&typeof source==='object')return Object.keys(source).map(function(key){
      var item=source[key];
      return item&&typeof item==='object'?Object.assign({id:item.id||key},item):null;
    }).filter(Boolean);
    return [];
  }
  function normalizeProfile(account,user){
    account=account||{};
    var cached=readJSON('dk_active_profile',{})||{};
    var oldSession=readJSON('dk_session',{})||{};
    if(String(oldSession.uid||'')!==String(user.uid||''))cached={};
    var profiles=profileList(account),chosen=null;
    if(cached.id)chosen=profiles.filter(function(item){
      return String(item.id||item.profileId||'')===String(cached.id);
    })[0]||null;
    chosen=chosen||profiles[0]||account.profile||{};
    return {
      id:String(chosen.id||chosen.profileId||'principal'),
      name:String(chosen.name||chosen.profileName||account.profileName||account.displayName||user.displayName||(user.email||'').split('@')[0]||'Perfil').trim().slice(0,24)||'Perfil',
      avatar:String(chosen.avatar||chosen.profileAvatar||account.profileAvatar||user.photoURL||'img/logo-blue.jpg').trim(),
      bio:String(chosen.bio||account.bio||'').trim().slice(0,280),
      banner:String(chosen.banner||'default'),
      theme:String(chosen.theme||'blue')
    };
  }
  function planSession(account,target){
    target=target||{};
    if(window.RabbitHubAccountPlan&&window.RabbitHubAccountPlan.mergeSession){
      return window.RabbitHubAccountPlan.mergeSession(target,account||{});
    }
    var raw=String(account&&account.plan||account&&account.currentPlan||'');
    var vip=account&&(
      account.premium===true||account.vip===true||account.isPremium===true||/(?:vip|pro|premium)/i.test(raw)
    );
    target.plan=vip?'VIP':'Free';target.currentPlan=target.plan;
    target.premium=vip;target.vip=vip;
    return target;
  }
  function persist(user,account,profile){
    var previous=readJSON('dk_session',{})||{};
    var session=planSession(account,{
      uid:user.uid,email:user.email||account.email||'',emailVerified:true,
      displayName:profile.name,profileAvatar:profile.avatar,bio:profile.bio,
      sessionId:String(previous.uid||'')===String(user.uid)?String(previous.sessionId||''):''
    });
    try{
      localStorage.setItem('dk_session',JSON.stringify(session));
      localStorage.setItem('dk_active_profile',JSON.stringify(profile));
      localStorage.setItem('dk_profiles_'+user.uid,JSON.stringify(profileList(account)));
    }catch(e){}
    window.DK_USER=Object.assign({},session,{
      uid:user.uid,email:user.email||account.email||'',emailVerified:true,
      displayName:profile.name,profileAvatar:profile.avatar,bio:profile.bio
    });
    return session;
  }
  function clearLocal(){
    try{
      localStorage.removeItem('dk_session');
      localStorage.removeItem('dk_active_profile');
      localStorage.removeItem('dk_current_plan');
      localStorage.removeItem('dk_plan');
      localStorage.removeItem('rh_plan_access_v1');
    }catch(e){}
    try{delete window.DK_USER;}catch(e){window.DK_USER=null;}
  }
  function notify(next){
    state=Object.assign({},state,next||{});
    listeners.slice().forEach(function(callback){try{callback(copy());}catch(e){}});
    try{document.dispatchEvent(new CustomEvent('rh:sessionchange',{detail:copy()}));}catch(e){}
  }
  function stopAccount(){
    if(accountTimeout){clearTimeout(accountTimeout);accountTimeout=null;}
    if(accountRef){try{accountRef.off();}catch(e){} accountRef=null;}
  }
  function fail(error){
    stopAccount();
    var value=error instanceof Error?error:new Error(String(error||'Falha ao sincronizar a conta.'));
    notify({status:'error',ready:false,account:null,profile:null,error:value});
  }
  function defaultAccount(user){
    var name=String(user.displayName||(user.email||'').split('@')[0]||'Perfil').trim().slice(0,24)||'Perfil';
    var profile={id:'principal',name:name,avatar:user.photoURL||'img/logo-blue.jpg',bio:'',banner:'default',theme:'blue'};
    return {
      uid:user.uid,email:user.email||'',displayName:name,profileName:name,profileAvatar:profile.avatar,
      profile:profile,profiles:[profile],bio:'',banned:false,blocked:false,
      plan:'Free',currentPlan:'Free',premium:false,vip:false,emailVerified:true,
      createdAt:firebase.database.ServerValue.TIMESTAMP,lastLogin:firebase.database.ServerValue.TIMESTAMP
    };
  }
  function acceptAccount(user,account){
    if(!account||typeof account!=='object')return;
    if(account.banned===true||account.blocked===true){
      var error=new Error('Esta conta esta bloqueada.');error.code='account/blocked';
      clearLocal();
      fail(error);
      firebase.auth().signOut().catch(function(){});
      return;
    }
    var profile=normalizeProfile(account,user);
    var firstReady=state.status!=='authenticated';
    var previousProfile=state.profile;
    var profileChanged=firstReady||!previousProfile||JSON.stringify(profile)!==JSON.stringify(previousProfile);
    var previousPlan=state.account&&window.RabbitHubAccountPlan&&window.RabbitHubAccountPlan.normalize
      ? window.RabbitHubAccountPlan.normalize(state.account) : null;
    var nextPlan=window.RabbitHubAccountPlan&&window.RabbitHubAccountPlan.normalize
      ? window.RabbitHubAccountPlan.normalize(account) : null;
    var planChanged=firstReady||!previousPlan||!nextPlan||previousPlan.key!==nextPlan.key||previousPlan.expiresAt!==nextPlan.expiresAt;
    if(profileChanged||planChanged)persist(user,account,profile);
    notify({status:'authenticated',ready:true,uid:user.uid,authUser:user,account:account,profile:profile,error:null});
    if(firstReady){
      try{readyResolve(copy());}catch(e){}
      try{
        document.dispatchEvent(new CustomEvent('dk:userready',{detail:window.DK_USER}));
        document.dispatchEvent(new CustomEvent('rh:uidchange',{detail:{uid:user.uid}}));
      }catch(e){}
    }
    if(profileChanged){try{document.dispatchEvent(new CustomEvent('dk:profilechange',{detail:profile}));}catch(e){}}
  }
  function watchAccount(db,user){
    stopAccount();
    var received=false;
    var creating=false;
    var pendingCreated=null;
    accountRef=db.ref('users/'+safeSegment(user.uid));
    var watchedRef=accountRef;
    accountTimeout=setTimeout(function(){
      if(!received){var error=new Error('O Firebase demorou para sincronizar sua conta.');error.code='account/timeout';fail(error);}
    },20000);
    accountRef.on('value',function(snapshot){
      if(accountRef!==watchedRef)return;
      var account=snapshot.val();
      if(!account){
        if(creating)return;
        creating=true;
        var created=defaultAccount(user);
        accountRef.set(created).then(function(){
          if(accountRef!==watchedRef)return;
          received=true;
          if(accountTimeout){clearTimeout(accountTimeout);accountTimeout=null;}
          creating=false;
          acceptAccount(user,pendingCreated||created);
        }).catch(fail);
        return;
      }
      if(creating){pendingCreated=account;return;}
      received=true;
      if(accountTimeout){clearTimeout(accountTimeout);accountTimeout=null;}
      acceptAccount(user,account);
    },fail);
  }
  function verifyUser(user){
    if(!user)return Promise.resolve(false);
    return user.getIdTokenResult(false).then(function(result){
      return user.emailVerified===true&&result&&result.claims&&result.claims.email_verified===true;
    });
  }
  function handleAuth(db,user){
    stopAccount();
    if(!user){
      clearLocal();
      notify({status:'anonymous',ready:true,uid:'',authUser:null,account:null,profile:null,error:null});
      return;
    }
    var cachedSession=readJSON('dk_session',{})||{};
    if(cachedSession.uid&&String(cachedSession.uid)!==String(user.uid))clearLocal();
    notify({status:'loading',ready:false,uid:user.uid,authUser:user,account:null,profile:null,error:null});
    verifyUser(user).then(function(valid){
      if(!valid){
        var error=new Error('Confirme seu e-mail antes de continuar.');error.code='auth/email-not-verified';
        clearLocal();
        fail(error);
        return firebase.auth().signOut().catch(function(){});
      }
      watchAccount(db,user);
    }).catch(fail);
  }
  function start(){
    if(started)return;
    if(!window.firebase||!firebase.auth||!firebase.database||!window.DK_FIREBASE_CONFIG){setTimeout(start,50);return;}
    started=true;
    try{if(!firebase.apps||!firebase.apps.length)firebase.initializeApp(window.DK_FIREBASE_CONFIG);}catch(e){}
    window.__DK_FB_INIT__=true;
    var auth=firebase.auth(),db=firebase.database();
    var persistence=firebase.auth.Auth&&firebase.auth.Auth.Persistence&&firebase.auth.Auth.Persistence.LOCAL;
    Promise.resolve(persistence?auth.setPersistence(persistence):null).catch(function(){}).then(function(){
      authUnsubscribe=auth.onAuthStateChanged(function(user){handleAuth(db,user);},fail);
    });
  }

  window.RabbitHubSession={
    get:copy,
    ready:function(){
      if(state.status==='authenticated')return Promise.resolve(copy());
      if(state.status==='error')return Promise.reject(state.error||new Error('Sessao indisponivel.'));
      return readyPromise;
    },
    subscribe:function(callback){
      if(typeof callback!=='function')return function(){};
      listeners.push(callback);callback(copy());
      return function(){listeners=listeners.filter(function(item){return item!==callback;});};
    },
    refresh:function(){
      var user=firebase&&firebase.auth&&firebase.auth().currentUser;
      if(!user)return Promise.reject(new Error('Sessao ausente.'));
      return user.getIdToken(true).then(function(){watchAccount(firebase.database(),user);});
    },
    accountRef:function(){return accountRef;},
    stop:function(){stopAccount();if(typeof authUnsubscribe==='function')authUnsubscribe();authUnsubscribe=null;started=false;}
  };
  start();
})();
