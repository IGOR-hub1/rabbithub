/* RabbitHub - protecao de rotas baseada exclusivamente na sessao Firebase central. */
(function(){
  'use strict';

  var page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  if(page==='admin.html'||page==='login.html')return;
  document.documentElement.setAttribute('data-rh-private','1');

  var releaseAuthBoot=window.RabbitHubBoot&&window.RabbitHubBoot.hold
    ? window.RabbitHubBoot.hold('auth') : function(){};
  var deviceRef=null;
  var deviceActiveRef=null;
  var heartbeat=null;
  var devicePoll=null;
  var registeredUid='';
  var leaving=false;
  var anonymousTimer=null;
  var recoveryTimer=null;
  var recoveryAttempts=0;

  function go(reason){
    if(leaving)return;
    if(anonymousTimer){clearTimeout(anonymousTimer);anonymousTimer=null;}
    if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=null;}
    leaving=true;
    var target=new URL('login.html',location.href);
    if(reason)target.searchParams.set('reason',reason);
    var current=location.pathname+location.search+location.hash;
    if(!/(?:^|\/)login(?:\.html)?\/?$/i.test(location.pathname))target.searchParams.set('next',current);
    location.replace(target.href);
  }
  function cancelAnonymousRedirect(){
    if(anonymousTimer){clearTimeout(anonymousTimer);anonymousTimer=null;}
  }
  function cancelRecovery(reset){
    if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=null;}
    if(reset)recoveryAttempts=0;
  }
  function clearSavedBrowserData(){
    try{localStorage.clear();}catch(e){}
    try{sessionStorage.clear();}catch(e){}
    if(!window.caches||typeof window.caches.keys!=='function')return Promise.resolve();
    return window.caches.keys().then(function(names){
      return Promise.all(names.map(function(name){return window.caches.delete(name);}));
    }).catch(function(){});
  }
  function recoverSession(){
    if(recoveryTimer||leaving)return;
    var current=null;
    try{current=firebase.auth().currentUser;}catch(e){}
    if(!current){confirmAnonymous();return;}
    var delays=[700,1600,3200];
    if(recoveryAttempts>=delays.length)return;
    var delay=delays[recoveryAttempts++];
    recoveryTimer=setTimeout(function(){
      recoveryTimer=null;
      if(!window.RabbitHubSession||!window.RabbitHubSession.refresh)return;
      window.RabbitHubSession.refresh().catch(recoverSession);
    },delay);
  }
  function confirmAnonymous(){
    cancelAnonymousRedirect();
    anonymousTimer=setTimeout(function(){
      anonymousTimer=null;
      var auth=null,current=null;
      try{auth=firebase.auth();current=auth.currentUser;}catch(e){}
      if(current){
        var central=window.RabbitHubSession&&window.RabbitHubSession.get?window.RabbitHubSession.get():null;
        if(central&&central.status==='authenticated'&&central.ready===true){markReady(central);return;}
        if(window.RabbitHubSession&&window.RabbitHubSession.refresh){
          window.RabbitHubSession.refresh().catch(function(){});
          return;
        }
      }
      go('auth');
    },1800);
  }
  function readSession(){try{return JSON.parse(localStorage.getItem('dk_session')||'{}')||{};}catch(e){return {};}}
  function writeSession(value){try{localStorage.setItem('dk_session',JSON.stringify(value));}catch(e){}}
  function safe(value){
    if(window.RabbitHubUid&&window.RabbitHubUid.safeSegment)return window.RabbitHubUid.safeSegment(value);
    return String(value||'').replace(/[.#$\[\]\/]/g,'_').slice(0,180);
  }
  function randomId(){
    try{if(crypto.randomUUID)return crypto.randomUUID().replace(/-/g,'');}catch(e){}
    return Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
  }
  function sessionId(){
    var session=readSession();
    if(!session.sessionId){session.sessionId=randomId();writeSession(session);}
    return String(session.sessionId);
  }
  function deviceName(){
    var ua=String(navigator.userAgent||'');
    var platform=/Android/i.test(ua)?'Android':(/iPhone|iPad|iPod/i.test(ua)?'iPhone / iPad':(/Windows/i.test(ua)?'Windows':(/Mac OS/i.test(ua)?'macOS':(/Linux/i.test(ua)?'Linux':'Dispositivo'))));
    var browser=/wv\)|; wv|Version\/\d+.*Chrome/i.test(ua)?'App RabbitHub':(/Edg\//i.test(ua)?'Edge':(/Firefox\//i.test(ua)?'Firefox':(/Chrome\//i.test(ua)?'Chrome':(/Safari\//i.test(ua)?'Safari':'Navegador'))));
    return platform+' - '+browser;
  }
  function cleanupDeviceListener(){
    if(deviceActiveRef){try{deviceActiveRef.off();}catch(e){}deviceActiveRef=null;}
    if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
    if(devicePoll){clearInterval(devicePoll);devicePoll=null;}
  }
  function within(promise,ms){
    return new Promise(function(resolve,reject){
      var done=false;
      var timer=setTimeout(function(){if(done)return;done=true;reject(new Error('A conexão com o Firebase demorou. Tente novamente.'));},ms);
      Promise.resolve(promise).then(function(value){if(done)return;done=true;clearTimeout(timer);resolve(value);},function(error){if(done)return;done=true;clearTimeout(timer);reject(error);});
    });
  }
  function deviceRestList(uid){
    var user=firebase.auth().currentUser;
    if(!user)return Promise.reject(new Error('Entre novamente.'));
    return user.getIdToken(false).then(function(token){
      var url=String(window.DK_FIREBASE_CONFIG.databaseURL||'').replace(/\/+$/,'')+'/users/'+encodeURIComponent(safe(uid))+'/devices.json?auth='+encodeURIComponent(token);
      return within(fetch(url,{cache:'no-store'}),7000);
    }).then(function(response){
      if(!response.ok)throw new Error('Não foi possível consultar os dispositivos ('+response.status+').');
      return response.json();
    }).then(function(value){
      return Object.keys(value||{}).map(function(id){var item=value[id]||{};item.id=item.id||id;return item;});
    });
  }
  function checkRemoteDevice(uid,id){
    if(leaving||document.hidden)return;
    deviceRestList(uid).then(function(items){
      var current=items.filter(function(item){return String(item.id||'')===String(id);})[0];
      if(current&&current.active===false)finishDeviceLogout('device');
    }).catch(function(){});
  }
  function finishDeviceLogout(reason){
    if(leaving)return Promise.resolve();
    leaving=true;cancelAnonymousRedirect();cancelRecovery(true);cleanupDeviceListener();
    return within(firebase.auth().signOut(),5000).catch(function(){}).then(clearSavedBrowserData).then(function(){
      location.replace('login.html?reason='+encodeURIComponent(reason||'device'));
    });
  }
  function registerDevice(uid){
    if(registeredUid===uid)return;
    registeredUid=uid;
    cleanupDeviceListener();
    var db=firebase.database(),id=sessionId();
    deviceRef=db.ref('users/'+safe(uid)+'/devices/'+safe(id));
    within(deviceRef.once('value'),5000).then(function(snapshot){
      var previous=snapshot.val()||{};
      if(previous.active===false){
        return finishDeviceLogout('device');
      }
      var now=firebase.database.ServerValue.TIMESTAMP;
      return deviceRef.update({
        id:id,name:deviceName(),platform:String(navigator.platform||'').slice(0,80),
        userAgent:String(navigator.userAgent||'').slice(0,300),active:true,
        createdAt:previous.createdAt||now,lastSeen:now
      }).then(function(){
        deviceActiveRef=deviceRef.child('active');
        deviceActiveRef.on('value',function(value){
          if(value.val()===false&&!leaving){
            finishDeviceLogout('device');
          }
        });
        devicePoll=setInterval(function(){checkRemoteDevice(uid,id);},60000);
        heartbeat=setInterval(function(){
          if(deviceRef&&!document.hidden)deviceRef.child('lastSeen').set(firebase.database.ServerValue.TIMESTAMP).catch(function(){});
        },5*60*1000);
      });
    }).catch(function(error){
      try{console.warn('[RabbitHub] dispositivo nao sincronizado:',error&&error.code||error);}catch(e){}
    });
  }
  function exposeDevices(){
    window.RabbitHubDevices={
      currentId:sessionId,
      list:function(){
        var current=window.RabbitHubSession&&window.RabbitHubSession.get();
        if(!current||current.status!=='authenticated')return Promise.reject(new Error('Entre novamente.'));
        return within(firebase.database().ref('users/'+safe(current.uid)+'/devices').once('value'),4500).then(function(snapshot){
          var list=[];snapshot.forEach(function(child){var value=child.val()||{};value.id=value.id||child.key;list.push(value);});
          return list;
        }).catch(function(){return deviceRestList(current.uid);}).then(function(list){
          return list.sort(function(a,b){return Number(b.lastSeen||0)-Number(a.lastSeen||0);});
        });
      },
      revoke:function(id){
        var current=window.RabbitHubSession&&window.RabbitHubSession.get();
        if(!current||current.status!=='authenticated')return Promise.reject(new Error('Entre novamente.'));
        if(!(window.RabbitHubPlans&&window.RabbitHubPlans.can&&window.RabbitHubPlans.can('connectedDevices'))){
          return Promise.reject(new Error('Gerenciar dispositivos e um recurso VIP.'));
        }
        return firebase.database().ref('users/'+safe(current.uid)+'/devices/'+safe(id)).update({
          active:false,revokedAt:firebase.database.ServerValue.TIMESTAMP
        });
      }
    };
  }
  function markReady(value){
    cancelAnonymousRedirect();
    cancelRecovery(true);
    if(document.documentElement.getAttribute('data-dk-ready')==='1')return;
    document.documentElement.setAttribute('data-dk-ready','1');
    registerDevice(value.uid);
    releaseAuthBoot();
  }
  function handle(value){
    if(!value)return;
    if(value.status==='anonymous'){confirmAnonymous();return;}
    cancelAnonymousRedirect();
    if(value.status==='error'){
      var code=String(value.error&&value.error.code||'sync');
      if(code==='account/blocked')go('blocked');
      else if(code==='auth/email-not-verified')go('unverified');
      else recoverSession();
      return;
    }
    if(value.status==='authenticated'&&value.ready===true)markReady(value);
  }
  function init(){
    if(!window.RabbitHubSession||!window.firebase||!firebase.database){setTimeout(init,40);return;}
    exposeDevices();
    window.RabbitHubSession.subscribe(handle);
    window.DK_logout=function(){
      leaving=true;cancelAnonymousRedirect();cancelRecovery(true);cleanupDeviceListener();
      var close=deviceRef?within(deviceRef.update({active:false,signedOutAt:firebase.database.ServerValue.TIMESTAMP}),3000).catch(function(){}):Promise.resolve();
      return close.then(function(){return within(firebase.auth().signOut(),5000);}).catch(function(){}).then(clearSavedBrowserData).then(function(){
        location.replace('login.html');
      });
    };
  }
  init();
})();
