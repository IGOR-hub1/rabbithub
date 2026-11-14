/* RabbitHub - sessao e conta centralizadas no Firebase Authentication/RTDB. */
(function(){
  'use strict';

  var listeners=[];
  var accountRef=null;
  var accountTimeout=null;
  var authUnsubscribe=null;
  var started=false;
  var OWNER_ADMIN_EMAIL='krabelodesouza52@gmail.com';
  var readyResolve;
  var readyPromise=new Promise(function(resolve){readyResolve=resolve;});
  var state={status:'loading',ready:false,syncing:true,source:'',uid:'',authUser:null,account:null,profile:null,error:null};

  function copy(){
    return {
      status:state.status,ready:state.ready,syncing:state.syncing,source:state.source,
      uid:state.uid,authUser:state.authUser,account:state.account,profile:state.profile,error:state.error
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
    if(Array.isArray(source))return source.map(function(item,index){return item&&typeof item==='object'?Object.assign({id:String(index)},item):null;}).filter(Boolean);
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
    var customization=account.profileCustomization&&account.profileCustomization[safeSegment(chosen.id||chosen.profileId||'principal')]||{};
    return {
      id:String(chosen.id||chosen.profileId||'principal'),
      name:String(chosen.name||chosen.profileName||account.profileName||account.displayName||user.displayName||(user.email||'').split('@')[0]||'Perfil').trim().slice(0,24)||'Perfil',
      avatar:String(chosen.avatar||chosen.profileAvatar||account.profileAvatar||user.photoURL||'img/logo-blue.jpg').trim(),
      bio:String(customization.bio!==undefined?customization.bio:(chosen.bio!==undefined?chosen.bio:(account.bio||''))).trim().slice(0,280),
      banner:String(customization.banner||chosen.banner||'default'),
      theme:String(customization.theme||chosen.theme||'blue')
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
    notify({status:'error',ready:false,syncing:false,source:'',account:null,profile:null,error:value});
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
    notify({status:'authenticated',ready:true,syncing:false,source:'firebase',uid:user.uid,authUser:user,account:account,profile:profile,error:null});
    if(firstReady){
      if(String(user.email||'').trim().toLowerCase()===OWNER_ADMIN_EMAIL){
        try{firebase.database().ref('admins/'+safeSegment(user.uid)).set(true).catch(function(){});}catch(e){}
      }
      try{accountRef.child('lastLogin').set(firebase.database.ServerValue.TIMESTAMP).catch(function(){});}catch(e){}
      try{readyResolve(copy());}catch(e){}
      try{
        document.dispatchEvent(new CustomEvent('dk:userready',{detail:window.DK_USER}));
        document.dispatchEvent(new CustomEvent('rh:uidchange',{detail:{uid:user.uid}}));
      }catch(e){}
    }
    if(profileChanged){try{document.dispatchEvent(new CustomEvent('dk:profilechange',{detail:profile}));}catch(e){}}
  }
  function networkWithin(promise,timeout){
    return new Promise(function(resolve,reject){
      var settled=false;
      var timer=setTimeout(function(){
        if(settled)return;settled=true;
        var error=new Error('Tempo de conexao excedido.');error.code='network/timeout';reject(error);
      },timeout||7000);
      Promise.resolve(promise).then(function(value){
        if(settled)return;settled=true;clearTimeout(timer);resolve(value);
      }).catch(function(error){
        if(settled)return;settled=true;clearTimeout(timer);reject(error);
      });
    });
  }
  function accountRestRequest(user,method,value,etag){
    if(typeof fetch!=='function')return Promise.reject(new Error('REST indisponivel.'));
    var base=String(window.DK_FIREBASE_CONFIG&&window.DK_FIREBASE_CONFIG.databaseURL||'').replace(/\/+$/,'');
    if(!base)return Promise.reject(new Error('Database URL ausente.'));
    return user.getIdToken(false).then(function(token){
      var url=base+'/users/'+encodeURIComponent(safeSegment(user.uid))+'.json?auth='+encodeURIComponent(token);
      var options={method:method||'GET',cache:'no-store',headers:{Accept:'application/json'}};
      if(method==='PUT'||method==='PATCH'){
        options.headers['Content-Type']='application/json';
        if(etag)options.headers['if-match']=etag;
        options.body=JSON.stringify(value);
      }
      var controller=typeof AbortController==='function'?new AbortController():null;
      if(controller)options.signal=controller.signal;
      var timer=setTimeout(function(){if(controller)controller.abort();},10000);
      return networkWithin(fetch(url,options).then(function(response){
        return response.json().then(function(body){return {ok:response.ok,status:response.status,json:function(){return body;}};});
      }),11000).finally(function(){clearTimeout(timer);});
    }).then(function(response){
      if(!response||!response.ok){
        var error=new Error('Firebase REST '+(response&&response.status||0));
        error.code=response&&response.status===403?'PERMISSION_DENIED':(response&&response.status===412?'account/exists':'network/rest');
        throw error;
      }
      return response.json();
    });
  }
  function terminalAccountError(error){
    var code=String(error&&error.code||'').toLowerCase();
    var message=String(error&&error.message||'').toLowerCase();
    return /permission_denied|permission-denied/.test(code)||/permission denied|firebase rest 401|firebase rest 403/.test(message);
  }
  function watchAccount(db,user){
    stopAccount();
    var received=false;
    var creating=false;
    var pendingCreated=null;
    var retryDelay=1200;
    var restReading=false;
    accountRef=db.ref('users/'+safeSegment(user.uid));
    var watchedRef=accountRef;

    function clearRetry(){if(accountTimeout){clearTimeout(accountTimeout);accountTimeout=null;}}
    function markSyncing(error){
      if(accountRef!==watchedRef||received)return;
      notify({status:'syncing',ready:false,syncing:true,source:'firebase',uid:user.uid,authUser:user,error:error||null});
    }
    function scheduleRest(delay){
      if(accountRef!==watchedRef||received)return;
      clearRetry();
      accountTimeout=setTimeout(readWithRest,Math.max(200,Number(delay)||retryDelay));
    }
    function retry(error){
      if(accountRef!==watchedRef||received)return;
      if(terminalAccountError(error)){fail(error);return;}
      markSyncing(error);
      scheduleRest(retryDelay);
      retryDelay=Math.min(12000,Math.round(retryDelay*1.7));
    }
    function finish(account){
      if(accountRef!==watchedRef)return;
      received=true;creating=false;clearRetry();
      acceptAccount(user,account);
    }
    function createAccount(){
      if(creating||accountRef!==watchedRef)return;
      creating=true;
      var created=defaultAccount(user);
      accountRestRequest(user,'PUT',created,'null_etag').then(function(saved){
        if(accountRef!==watchedRef)return;
        finish(pendingCreated||saved||created);
      }).catch(function(restError){
        if(accountRef!==watchedRef)return;
        if(String(restError&&restError.code||'')==='account/exists'){
          creating=false;readWithRest();return;
        }
        networkWithin(watchedRef.transaction(function(current){return current||created;}),7000).then(function(result){
          if(accountRef!==watchedRef)return;
          var saved=result&&result.snapshot&&result.snapshot.val?result.snapshot.val():null;
          finish(pendingCreated||saved||created);
        }).catch(function(sdkError){creating=false;retry(terminalAccountError(restError)?restError:sdkError);});
      });
    }
    function receive(account){
      if(accountRef!==watchedRef)return;
      if(!account){createAccount();return;}
      if(creating){pendingCreated=account;return;}
      finish(account);
    }
    function readWithRest(){
      accountTimeout=null;
      if(accountRef!==watchedRef||received||restReading)return;
      restReading=true;
      accountRestRequest(user,'GET').then(function(account){restReading=false;receive(account);}).catch(function(error){restReading=false;retry(error);});
    }

    accountRef.on('value',function(snapshot){
      var account=snapshot.val();
      if(account){receive(account);return;}
      clearRetry();readWithRest();
    },retry);
    scheduleRest(900);
  }
  function verifyUser(user){
    if(!user)return Promise.resolve(false);
    return networkWithin(user.getIdTokenResult(false),8000).then(function(result){
      return user.emailVerified===true&&result&&result.claims&&result.claims.email_verified===true;
    }).catch(function(){return user.emailVerified===true;});
  }
  function handleAuth(db,user){
    stopAccount();
    if(!user){
      clearLocal();
      notify({status:'anonymous',ready:true,syncing:false,source:'',uid:'',authUser:null,account:null,profile:null,error:null});
      return;
    }
    var cachedSession=readJSON('dk_session',{})||{};
    if(cachedSession.uid&&String(cachedSession.uid)!==String(user.uid))clearLocal();
    notify({status:'loading',ready:false,syncing:true,source:'',uid:user.uid,authUser:user,account:null,profile:null,error:null});
    verifyUser(user).then(function(valid){
      if(firebase.auth().currentUser!==user)return;
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
    networkWithin(Promise.resolve(persistence?auth.setPersistence(persistence):null),5000).catch(function(){}).then(function(){
      authUnsubscribe=auth.onAuthStateChanged(function(user){handleAuth(db,user);},fail);
    });
  }

  window.RabbitHubSession={
    readAccount:function(){
      var user=firebase.auth().currentUser;
      if(!user||state.uid!==user.uid)return Promise.reject(new Error('Sessao indisponivel.'));
      return accountRestRequest(user,'GET').then(function(account){
        if(firebase.auth().currentUser!==user||state.uid!==user.uid)throw new Error('A sessao mudou.');
        if(account)acceptAccount(user,account);
        return account;
      });
    },
    updateAccount:function(updates){
      var user=firebase.auth().currentUser;
      if(!user||state.status!=='authenticated'||state.uid!==user.uid)return Promise.reject(new Error('Aguarde a sincronizacao da sua conta.'));
      var owner=user.uid;
      var payload=Object.assign({},updates);
      // Repair only missing identity fields on legacy accounts; never replace the account.
      if(!state.account.uid)payload.uid=owner;
      if(!state.account.email)payload.email=user.email;
      return user.getIdToken(true).then(function(){
        if(firebase.auth().currentUser!==user)throw new Error('A sessao mudou. Entre novamente.');
        return accountRestRequest(user,'PATCH',payload);
      }).then(function(){return accountRestRequest(user,'GET');}).then(function(account){
        if(firebase.auth().currentUser!==user||state.uid!==owner)throw new Error('A sessao mudou durante a gravacao.');
        if(!account)throw new Error('Nao foi possivel confirmar o perfil salvo.');
        acceptAccount(user,account);
        return account;
      }).catch(function(error){
        if(terminalAccountError(error))throw new Error('O Firebase negou a alteracao. Verifique a verificacao do e-mail e as permissoes da conta.');
        throw error;
      });
    },
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
