/* X-Bunny Animes • permissões reais dos planos Free e VIP (VIP = Pro). */
(function(){
  'use strict';

  var CACHE_KEY = 'rh_plan_access_v1';
  var listeners = [];
  var readyCallbacks = [];
  var remoteStarted = false;
  var remoteRef = null;
  var remoteAttempts = 0;
  var remoteRetryTimer = null;
  var MAX_REMOTE_ATTEMPTS = 10;
  var state = {
    uid:'',
    key:'free',
    name:'Free',
    isVip:false,
    customAvatar:true,
    customTheme:false,
    cloudProgress:false,
    smartFallback:false,
    skipSegments:false,
    nextCountdown:false,
    searchAssist:false,
    spoilerComments:false,
    connectedDevices:false,
    releaseAlerts:false,
    aiRecommendations:false,
    playerGestures:false,
    cloudBackup:false,
    ready:false,
    source:'default'
  };

  function readJSON(key, fallback){
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch(e) {
      return fallback;
    }
  }

  function session(){
    return readJSON('dk_session', {}) || {};
  }

  function normalizedPlan(user, source){
    user = user || {};
    var raw = String(user.plan || user.currentPlan || user.planName || '').trim();
    var premiumUntil = Number(user.premiumUntil || 0);
    var expired = premiumUntil > 0 && premiumUntil < Date.now();
    var paid = !expired && (
      user.premium === true ||
      user.vip === true ||
      /(?:^|\s)(vip|pro|premium)(?:\s|$)/i.test(raw)
    );
    return {
      uid:String(user.uid || session().uid || ''),
      key:paid ? 'vip' : 'free',
      name:paid ? 'VIP' : 'Free',
      isVip:paid,
      customAvatar:true,
      customTheme:paid,
      cloudProgress:paid,
      smartFallback:paid,
      skipSegments:paid,
      nextCountdown:paid,
      searchAssist:paid,
      spoilerComments:paid,
      connectedDevices:paid,
      releaseAlerts:paid,
      aiRecommendations:paid,
      playerGestures:paid,
      cloudBackup:paid,
      premiumUntil:paid && premiumUntil > 0 ? premiumUntil : 0,
      ready:true,
      source:source || 'firebase'
    };
  }

  function sameAccess(a,b){
    return a.uid === b.uid && a.key === b.key &&
      Number(a.premiumUntil || 0) === Number(b.premiumUntil || 0) &&
      a.ready === b.ready;
  }

  function saveCache(next){
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        uid:next.uid,
        key:next.key,
        name:next.name,
        isVip:next.isVip,
        customAvatar:next.customAvatar,
        customTheme:next.customTheme,
        cloudProgress:next.cloudProgress,
        smartFallback:next.smartFallback,
        skipSegments:next.skipSegments,
        nextCountdown:next.nextCountdown,
        searchAssist:next.searchAssist,
        spoilerComments:next.spoilerComments,
        connectedDevices:next.connectedDevices,
        releaseAlerts:next.releaseAlerts,
        aiRecommendations:next.aiRecommendations,
        playerGestures:next.playerGestures,
        cloudBackup:next.cloudBackup,
        premiumUntil:next.premiumUntil || 0,
        ready:next.ready,
        savedAt:Date.now()
      }));
      localStorage.setItem('dk_current_plan', next.name);
      localStorage.setItem('dk_plan', next.name);
      var currentSession = session();
      if (currentSession && currentSession.uid) {
        currentSession.plan = next.name;
        currentSession.currentPlan = next.name;
        currentSession.premium = next.isVip;
        localStorage.setItem('dk_session', JSON.stringify(currentSession));
      }
    } catch(e){}
  }

  function enforceFreeTheme(next){
    if (!next.ready || next.isVip) return;
    try {
      if (window.DK_getTheme && window.DK_getTheme() !== 'blue' && window.DK_setTheme) {
        window.DK_setTheme('blue', false, {system:true});
      }
    } catch(e){}
  }

  function publish(next){
    var changed = !sameAccess(state,next);
    state = next;
    saveCache(next);
    document.documentElement.setAttribute('data-rh-plan',next.key);
    document.documentElement.setAttribute('data-rh-vip',next.isVip ? '1' : '0');
    enforceFreeTheme(next);
    if (changed) {
      listeners.slice().forEach(function(callback){
        try { callback(copyState()); } catch(e){}
      });
      try {
        document.dispatchEvent(new CustomEvent('rh:planchange',{detail:copyState()}));
        document.dispatchEvent(new CustomEvent('dk:planchange',{detail:copyState()}));
      } catch(e){}
    }
    if (next.ready && readyCallbacks.length) {
      var pending = readyCallbacks.splice(0);
      pending.forEach(function(resolve){ resolve(copyState()); });
    }
  }

  function copyState(){
    var result = {};
    Object.keys(state).forEach(function(key){ result[key] = state[key]; });
    return result;
  }

  function hydrate(){
    var currentSession = session();
    var cached = readJSON(CACHE_KEY, null);
    if (cached && String(cached.uid || '') === String(currentSession.uid || '') && cached.ready === true) {
      publish(normalizedPlan({
        uid:currentSession.uid,
        plan:cached.key === 'vip' ? 'VIP' : 'Free',
        premium:cached.key === 'vip',
        premiumUntil:cached.premiumUntil || 0
      },'cache'));
      return;
    }
    var hasPlan = currentSession.plan || currentSession.currentPlan ||
      currentSession.premium === true || currentSession.vip === true;
    if (hasPlan) publish(normalizedPlan(currentSession,'session'));
  }

  function database(){
    try {
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      window.__DK_FB_INIT__ = true;
      return firebase.database();
    } catch(e) {
      return null;
    }
  }

  function startRemote(){
    if (remoteStarted) return;
    var currentSession = session();
    if (!currentSession.uid) {
      publish(normalizedPlan({uid:'',plan:'Free',premium:false},'anonymous'));
      return;
    }
    var db = database();
    if (!db) {
      remoteAttempts += 1;
      if (remoteAttempts >= MAX_REMOTE_ATTEMPTS) {
        if (!state.ready) publish(normalizedPlan(currentSession,'fallback'));
        return;
      }
      window.clearTimeout(remoteRetryTimer);
      remoteRetryTimer = window.setTimeout(
        startRemote,
        Math.min(2000, 100 * Math.pow(2, remoteAttempts - 1))
      );
      return;
    }
    remoteAttempts = 0;
    window.clearTimeout(remoteRetryTimer);
    remoteRetryTimer = null;
    remoteStarted = true;
    if (remoteRef) {
      try { remoteRef.off(); } catch(e){}
    }
    remoteRef = db.ref('users/' + String(currentSession.uid).replace(/[.#$\[\]\/]/g,'_'));
    remoteRef.on('value',function(snapshot){
      var user = snapshot.val() || currentSession;
      user.uid = currentSession.uid;
      publish(normalizedPlan(user,'firebase'));
    },function(){
      if (!state.ready) publish(normalizedPlan(currentSession,'fallback'));
    });
  }

  hydrate();

  window.RabbitHubPlans = {
    get:copyState,
    isVip:function(){ return state.isVip === true; },
    can:function(feature){
      if (feature === 'customAvatar') return state.customAvatar === true;
      if (feature === 'customTheme') return state.customTheme === true;
      if (feature === 'fiveProfiles') return state.isVip === true;
      if (feature === 'cloudProgress') return state.cloudProgress === true;
      if (feature === 'smartFallback') return state.smartFallback === true;
      if (feature === 'skipSegments') return state.skipSegments === true;
      if (feature === 'nextCountdown') return state.nextCountdown === true;
      if (feature === 'searchAssist') return state.searchAssist === true;
      if (feature === 'spoilerComments') return state.spoilerComments === true;
      if (feature === 'connectedDevices') return state.connectedDevices === true;
      if (feature === 'releaseAlerts') return state.releaseAlerts === true;
      if (feature === 'aiRecommendations') return state.aiRecommendations === true;
      if (feature === 'playerGestures') return state.playerGestures === true;
      if (feature === 'cloudBackup') return state.cloudBackup === true;
      return false;
    },
    ready:function(){
      if (state.ready) return Promise.resolve(copyState());
      return new Promise(function(resolve){ readyCallbacks.push(resolve); });
    },
    refresh:function(){
      remoteStarted = false;
      remoteAttempts = 0;
      window.clearTimeout(remoteRetryTimer);
      remoteRetryTimer = null;
      startRemote();
    },
    subscribe:function(callback){
      if (typeof callback !== 'function') return function(){};
      listeners.push(callback);
      callback(copyState());
      return function(){
        listeners = listeners.filter(function(item){ return item !== callback; });
      };
    },
    normalize:normalizedPlan
  };

  document.addEventListener('rh:uidchange',function(){
    remoteStarted = false;
    remoteAttempts = 0;
    window.clearTimeout(remoteRetryTimer);
    remoteRetryTimer = null;
    if (remoteRef) {
      try { remoteRef.off(); } catch(e){}
      remoteRef = null;
    }
    startRemote();
  });

  startRemote();
})();
