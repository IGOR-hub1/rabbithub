/* RabbitHub • dados do perfil sincronizados com o Firebase. */
(function(){
  'use strict';

  var LEGACY_HISTORY_KEY = 'draksyon_history_v1';
  var CACHE_PREFIX = 'rh_profile_history_v2_';
  var MIGRATION_PREFIX = 'rh_history_migrated_v2_';
  var remoteWrites = {};

  function readJSON(key, fallback){
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch(e) {
      return fallback;
    }
  }

  function context(){
    var session = readJSON('dk_session', {}) || {};
    var profile = readJSON('dk_active_profile', {}) || {};
    return {
      uid:String(session.uid || ''),
      email:String(session.email || ''),
      displayName:String(session.displayName || ''),
      profileId:String(profile.id || 'principal'),
      profileName:String(profile.name || 'Perfil principal'),
      profileAvatar:String(profile.avatar || '')
    };
  }

  function safeSegment(value){
    return String(value || 'item').replace(/[.#$\[\]\/]/g,function(character){
      return '_' + character.charCodeAt(0).toString(16) + '_';
    });
  }

  function cacheKey(){
    var ctx = context();
    return CACHE_PREFIX + safeSegment(ctx.uid || 'visitante') + '_' + safeSegment(ctx.profileId);
  }

  function normalizeHistoryItem(raw){
    raw = raw || {};
    var epIdx = Number(raw.epIdx);
    var progress = Number(raw.progresso);
    var seconds = Number(raw.seconds);
    var duration = Number(raw.duration);
    return {
      slug:String(raw.slug || ''),
      titulo:String(raw.titulo || raw.epNome || 'Sem título'),
      capa:String(raw.capa || ''),
      epNome:String(raw.epNome || 'Episódio'),
      epIdx:isFinite(epIdx) && epIdx >= 0 ? Math.floor(epIdx) : 0,
      ts:Number(raw.ts) || Date.now(),
      progresso:isFinite(progress) ? Math.max(1,Math.min(100,Math.round(progress))) : 5,
      seconds:isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0,
      duration:isFinite(duration) && duration > 0 ? Math.round(duration) : 0
    };
  }

  function sortHistory(list){
    return list.sort(function(a,b){ return (Number(b.ts) || 0) - (Number(a.ts) || 0); }).slice(0,50);
  }

  function saveLocal(list){
    try { localStorage.setItem(cacheKey(),JSON.stringify(sortHistory(list.slice()))); } catch(e){}
  }

  function getHistory(){
    var ctx = context();
    var list = readJSON(cacheKey(), null);
    if (Array.isArray(list)) return sortHistory(list.map(normalizeHistoryItem));

    var migrationKey = MIGRATION_PREFIX + safeSegment(ctx.uid || 'visitante');
    var migrated = '';
    try { migrated = localStorage.getItem(migrationKey) || ''; } catch(e){}
    if (!migrated) {
      var legacy = readJSON(LEGACY_HISTORY_KEY, []);
      list = Array.isArray(legacy) ? legacy.map(normalizeHistoryItem) : [];
      saveLocal(list);
      try { localStorage.setItem(migrationKey,ctx.profileId); } catch(e){}
      return sortHistory(list);
    }
    return [];
  }

  function firebaseDatabase(){
    try {
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      window.__DK_FB_INIT__ = true;
      return firebase.database();
    } catch(e) {
      return null;
    }
  }

  function settleWithTimeout(promise,fallback,timeout){
    return new Promise(function(resolve){
      var settled = false;
      var timer = window.setTimeout(function(){
        if (settled) return;
        settled = true;
        resolve(fallback);
      },timeout || 5000);
      promise.then(function(value){
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      }).catch(function(){
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallback);
      });
    });
  }

  function historyRef(){
    var ctx = context();
    var db = firebaseDatabase();
    if (!db || !ctx.uid || !ctx.profileId) return null;
    return db.ref('users/' + safeSegment(ctx.uid) + '/profileHistory/' + safeSegment(ctx.profileId));
  }

  function historyItemKey(item){
    return safeSegment(item.slug || ('episodio_' + item.epIdx));
  }

  function emitHistoryChange(source){
    try {
      document.dispatchEvent(new CustomEvent('rh:historychange',{
        detail:{source:source || 'local',history:getHistory(),profile:context()}
      }));
    } catch(e){}
  }

  function saveHistory(raw){
    var item = normalizeHistoryItem(raw);
    if (!item.slug) return Promise.resolve(item);

    var list = getHistory().filter(function(entry){ return entry.slug !== item.slug; });
    list.unshift(item);
    saveLocal(list);
    emitHistoryChange('local');

    var ref = historyRef();
    if (!ref) return Promise.resolve(item);
    var key = historyItemKey(item);
    var pathKey = ref.toString() + '/' + key;
    var now = Date.now();
    if (item.progresso < 100 && remoteWrites[pathKey] && now - remoteWrites[pathKey] < 12000) {
      return Promise.resolve(item);
    }
    remoteWrites[pathKey] = now;
    var payload = {};
    Object.keys(item).forEach(function(field){ payload[field] = item[field]; });
    payload.profileId = context().profileId;
    payload.profileName = context().profileName;
    return ref.child(key).set(payload).then(function(){ return item; }).catch(function(){ return item; });
  }

  function mergeHistory(remote,local){
    var bySlug = {};
    remote.concat(local).forEach(function(raw){
      var item = normalizeHistoryItem(raw);
      if (!item.slug) return;
      if (!bySlug[item.slug] || item.ts > bySlug[item.slug].ts) bySlug[item.slug] = item;
    });
    return sortHistory(Object.keys(bySlug).map(function(slug){ return bySlug[slug]; }));
  }

  function refreshHistory(){
    var ref = historyRef();
    var local = getHistory();
    if (!ref) return Promise.resolve(local);
    var request = ref.once('value').then(function(snapshot){
      var value = snapshot.val() || {};
      var remote = Object.keys(value).map(function(key){ return value[key]; });
      var merged = mergeHistory(remote,local);
      saveLocal(merged);
      emitHistoryChange('firebase');
      return merged;
    });
    return settleWithTimeout(request,local,6000);
  }

  function clearHistory(){
    saveLocal([]);
    emitHistoryChange('local');
    var ref = historyRef();
    if (!ref) return Promise.resolve();
    return ref.remove().catch(function(){});
  }

  function getAccount(){
    var ctx = context();
    var db = firebaseDatabase();
    var fallback = {session:ctx,user:{},profile:ctx};
    if (!db || !ctx.uid) return Promise.resolve(fallback);
    var request = db.ref('users/' + safeSegment(ctx.uid)).once('value').then(function(snapshot){
      return {session:ctx,user:snapshot.val() || {},profile:ctx};
    });
    return settleWithTimeout(request,fallback,5000);
  }

  function validWhatsappUrl(value){
    return /^https:\/\/(?:chat\.whatsapp\.com\/|wa\.me\/|www\.whatsapp\.com\/channel\/)/i.test(String(value || '').trim());
  }

  function getWhatsappGroupUrl(){
    var db = firebaseDatabase();
    if (!db) return Promise.resolve('');
    var request = db.ref('dk_broadcast/config/whatsappGroupUrl').once('value').then(function(snapshot){
      var value = String(snapshot.val() || '').trim();
      return validWhatsappUrl(value) ? value : '';
    });
    return settleWithTimeout(request,'',5000);
  }

  window.RabbitHubProfileData = {
    getContext:context,
    getHistory:getHistory,
    saveHistory:saveHistory,
    refreshHistory:refreshHistory,
    clearHistory:clearHistory,
    getAccount:getAccount,
    getWhatsappGroupUrl:getWhatsappGroupUrl,
    validWhatsappUrl:validWhatsappUrl
  };

  function start(){
    refreshHistory();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
