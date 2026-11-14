/* RabbitHub - permissoes derivadas da conta Firebase centralizada. */
(function(){
  'use strict';

  var releasePlanBoot=window.RabbitHubBoot&&window.RabbitHubBoot.hold
    ? window.RabbitHubBoot.hold('plan') : function(){};
  var CACHE_KEY='rh_plan_access_v1';
  var listeners=[];
  var readyCallbacks=[];
  var authoritative=false;
  var subscribed=false;
  var expiryTimer=null;
  var state=accessFor(false,'','loading',0,false);

  function readJSON(key,fallback){
    try{var value=JSON.parse(localStorage.getItem(key)||'null');return value==null?fallback:value;}
    catch(e){return fallback;}
  }
  function accessFor(vip,uid,source,expiresAt,ready){
    vip=vip===true;
    return {
      uid:String(uid||''),key:vip?'vip':'free',name:vip?'VIP':'Free',isVip:vip,
      customAvatar:true,customTheme:vip,cloudProgress:vip,smartFallback:vip,
      skipSegments:vip,nextCountdown:vip,searchAssist:vip,spoilerComments:vip,
      connectedDevices:vip,releaseAlerts:vip,aiRecommendations:vip,
      playerGestures:vip,cloudBackup:vip,premiumUntil:vip?Number(expiresAt||0):0,
      ready:ready===true,source:source||'loading'
    };
  }
  function normalize(user,source,ready){
    user=user&&typeof user==='object'?user:{};
    var normalized=window.RabbitHubAccountPlan&&window.RabbitHubAccountPlan.normalize
      ? window.RabbitHubAccountPlan.normalize(user) : null;
    var raw=String(user.plan||user.currentPlan||user.planName||'');
    var expiry=Number(user.premiumUntil||user.vipUntil||user.planExpiresAt||0);
    if(expiry>0&&expiry<100000000000)expiry*=1000;
    var vip=normalized?normalized.isVip:(
      !(expiry>0&&expiry<Date.now())&&(user.premium===true||user.vip===true||user.isPremium===true||/(?:vip|pro|premium)/i.test(raw))
    );
    if(normalized)expiry=normalized.expiresAt||0;
    return accessFor(vip,user.uid,source,expiry,ready);
  }
  function copy(){var result={};Object.keys(state).forEach(function(key){result[key]=state[key];});return result;}
  function changed(a,b){
    return a.uid!==b.uid||a.key!==b.key||a.ready!==b.ready||
      Number(a.premiumUntil||0)!==Number(b.premiumUntil||0)||a.source!==b.source;
  }
  function persist(next){
    try{
      localStorage.setItem(CACHE_KEY,JSON.stringify(Object.assign({},next,{savedAt:Date.now()})));
      if(next.ready&&next.source==='firebase'){
        localStorage.setItem('dk_current_plan',next.name);
        localStorage.setItem('dk_plan',next.name);
        var session=readJSON('dk_session',{})||{};
        if(String(session.uid||'')===next.uid){
          session.plan=next.name;session.currentPlan=next.name;
          session.planName=next.name;session.premium=next.isVip;session.vip=next.isVip;
          session.premiumUntil=next.premiumUntil||0;session.vipUntil=next.premiumUntil||0;
          session.planExpiresAt=next.premiumUntil||0;
          localStorage.setItem('dk_session',JSON.stringify(session));
        }
      }
    }catch(e){}
  }
  function enforceTheme(next){
    if(!next.ready||next.source!=='firebase'||next.isVip)return;
    try{if(window.DK_verifyTheme)window.DK_verifyTheme();}catch(e){}
  }
  function publish(next){
    var didChange=changed(state,next);
    state=next;
    if(next.source==='firebase')authoritative=true;
    persist(next);
    document.documentElement.setAttribute('data-rh-plan',next.key);
    document.documentElement.setAttribute('data-rh-vip',next.isVip?'1':'0');
    enforceTheme(next);
    if(didChange){
      listeners.slice().forEach(function(callback){try{callback(copy());}catch(e){}});
      try{
        document.dispatchEvent(new CustomEvent('rh:planchange',{detail:copy()}));
        document.dispatchEvent(new CustomEvent('dk:planchange',{detail:copy()}));
      }catch(e){}
    }
    if(next.ready&&authoritative){
      var pending=readyCallbacks.splice(0);
      pending.forEach(function(resolve){resolve(copy());});
      releasePlanBoot();
    }
  }
  function hydrate(){
    var session=readJSON('dk_session',{})||{};
    var cached=readJSON(CACHE_KEY,null);
    if(!session.uid||!cached||String(cached.uid||'')!==String(session.uid))return;
    publish(accessFor(cached.isVip===true||cached.key==='vip',session.uid,'cache',cached.premiumUntil||0,false));
  }
  function onSession(value){
    if(!value)return;
    if(value.status==='anonymous'){
      publish(accessFor(false,'','firebase',0,true));
      return;
    }
    if(value.status!=='authenticated'||value.ready!==true||!value.account)return;
    var account=Object.assign({},value.account,{uid:value.uid});
    publish(normalize(account,'firebase',true));
    if(expiryTimer){clearTimeout(expiryTimer);expiryTimer=null;}
    if(state.isVip&&state.premiumUntil>Date.now())expiryTimer=setTimeout(function(){
      onSession(window.RabbitHubSession.get());
    },Math.min(2147483647,state.premiumUntil-Date.now()+1));
  }
  function connect(){
    if(subscribed)return;
    if(!window.RabbitHubSession){setTimeout(connect,40);return;}
    subscribed=true;
    window.RabbitHubSession.subscribe(onSession);
  }

  hydrate();
  window.RabbitHubPlans={
    get:function(){
      if(state.isVip&&state.premiumUntil>0&&state.premiumUntil<=Date.now())onSession(window.RabbitHubSession.get());
      return copy();
    },
    isVip:function(){return state.ready===true&&state.isVip===true;},
    can:function(feature){
      if(state.isVip&&state.premiumUntil>0&&state.premiumUntil<=Date.now())onSession(window.RabbitHubSession.get());
      if(feature==='customAvatar')return state.ready===true&&state.customAvatar===true;
      if(feature==='fiveProfiles')return state.ready===true&&state.isVip===true;
      return state.ready===true&&state[feature]===true;
    },
    ready:function(){
      if(state.ready&&authoritative)return Promise.resolve(copy());
      return new Promise(function(resolve){readyCallbacks.push(resolve);});
    },
    refresh:function(){
      authoritative=false;
      return window.RabbitHubSession&&window.RabbitHubSession.refresh
        ? window.RabbitHubSession.refresh() : Promise.reject(new Error('Sessao indisponivel.'));
    },
    subscribe:function(callback){
      if(typeof callback!=='function')return function(){};
      listeners.push(callback);callback(copy());
      return function(){listeners=listeners.filter(function(item){return item!==callback;});};
    },
    normalize:function(user,source){return normalize(user,source||'manual',true);}
  };
  connect();
})();
