/* X-Bunny Animes • catálogo online de banners do perfil. */
(function(){
  'use strict';

  var CONFIG_PATH = 'dk_broadcast/config/profileBanners';
  var CACHE_KEY = 'rh_profile_banners_cache_v1';
  // O seletor mostra exclusivamente o que foi publicado no painel. Não
  // misture exemplos externos com o catálogo real do administrador.
  var DEFAULTS = [];

  var banners = readCachedBanners();
  var started = false;
  var remoteLoaded = false;
  var subscribers = [];
  var startAttempts = 0;

  function clone(value){
    var copy = {};
    Object.keys(value || {}).forEach(function(key){ copy[key] = value[key]; });
    return copy;
  }
  function cloneList(list){ return (list || []).map(clone); }

  function readCachedBanners(){
    try {
      var saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      var list = saved && Array.isArray(saved.items) ? normalizeCollection(saved.items) : [];
      return list.length ? list : cloneList(DEFAULTS);
    } catch(e){ return cloneList(DEFAULTS); }
  }

  function cacheBanners(){
    try { localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),items:banners})); }
    catch(e){ /* cache local é apenas aceleração e fallback */ }
  }

  function notify(){
    var current = cloneList(banners);
    subscribers.slice().forEach(function(callback){
      try { callback(current); } catch(e){}
    });
    try { document.dispatchEvent(new CustomEvent('rh:profilebannerschanged',{detail:{banners:current}})); }
    catch(e){}
  }

  function normalizeUrl(value){
    value = String(value || '').trim();
    if (!/^https?:\/\//i.test(value)) return '';
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch(e){ return ''; }
  }

  function inferMedia(url, requested){
    requested = String(requested || '').toLowerCase();
    if (requested === 'video') return 'video';
    return /\.(?:mp4|webm|ogg|mov|m3u8)(?:[?#]|$)/i.test(String(url || '')) ? 'video' : 'image';
  }

  function inferCategory(raw,url,media){
    var requested = String(raw && (raw.category || raw.type) || '').toLowerCase();
    if (requested === 'video' || media === 'video') return 'video';
    if (requested === 'gif' || requested === 'animated' || /\.gif(?:[?#]|$)/i.test(String(url || ''))) return 'gif';
    return 'image';
  }

  function normalizeKey(value, index){
    var key = String(value || '').trim().replace(/[^a-z0-9_-]/gi,'-').replace(/^-+|-+$/g,'').slice(0,80);
    if (!key || key === 'custom') key = 'banner-' + (index + 1);
    return key;
  }

  function normalizeBanner(raw, fallbackKey, index){
    if (typeof raw === 'string') raw = {url:raw};
    raw = raw && typeof raw === 'object' ? raw : {};
    var url = normalizeUrl(raw.url || raw.link || raw.src);
    if (!url) return null;
    var media = inferMedia(url,raw.media);
    var category = inferCategory(raw,url,media);
    var type = category === 'video' ? 'video' : (category === 'gif' ? 'animated' : 'static');
    var normalized = {
      key:normalizeKey(raw.key || raw.id || fallbackKey,index),
      name:String(raw.name || raw.title || 'Banner do perfil').trim().slice(0,60) || 'Banner do perfil',
      category:category,
      type:type,
      media:media,
      url:url,
      order:Number.isFinite(Number(raw.order)) ? Number(raw.order) : index
    };
    if (typeof raw.storagePath === 'string' && raw.storagePath.indexOf('profile-banners/') === 0) {
      normalized.storagePath = raw.storagePath.slice(0,240);
    }
    return normalized;
  }

  function normalizeCollection(value){
    if (value && typeof value === 'object' && value.items !== undefined) value = value.items;
    var entries = [];
    if (Array.isArray(value)) {
      entries = value.map(function(item,index){ return {raw:item,key:'banner-' + (index + 1),index:index}; });
    } else if (value && typeof value === 'object') {
      entries = Object.keys(value).map(function(key,index){ return {raw:value[key],key:key,index:index}; });
    }
    var used = {};
    var list = entries.map(function(entry){
      var item = normalizeBanner(entry.raw,entry.key,entry.index);
      if (!item) return null;
      var base = item.key;
      var suffix = 2;
      while (used[item.key]) item.key = base + '-' + suffix++;
      used[item.key] = true;
      return item;
    }).filter(Boolean);
    list.sort(function(a,b){ return (a.order - b.order); });
    return list;
  }

  function database(){
    try {
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      window.__DK_FB_INIT__ = true;
      return firebase.database();
    } catch(e){ return null; }
  }

  function snapshotValue(snapshot){
    remoteLoaded = true;
    if (snapshot && snapshot.exists()) {
      banners = normalizeCollection(snapshot.val());
    } else {
      banners = [];
    }
    cacheBanners();
    notify();
  }

  function start(){
    if (started) return;
    var db = database();
    if (!db) {
      startAttempts++;
      if (startAttempts < 80) window.setTimeout(start,100);
      return;
    }
    started = true;
    try {
      db.ref(CONFIG_PATH).on('value',snapshotValue,function(){
        remoteLoaded = true;
        /* Uma falha temporária do Firebase não apaga o catálogo que já estava
           visível. Mantemos o cache e tentamos de novo no próximo carregamento. */
        notify();
      });
    } catch(e){ remoteLoaded=true;notify(); }
  }

  window.RabbitHubProfileBanners = {
    path:CONFIG_PATH,
    defaults:function(){ return cloneList(DEFAULTS); },
    categories:function(){ return ['image','gif','video']; },
    get:function(){ return cloneList(banners); },
    isRemoteLoaded:function(){ return remoteLoaded; },
    normalize:normalizeCollection,
    subscribe:function(callback){
      if (typeof callback !== 'function') return function(){};
      subscribers.push(callback);
      callback(cloneList(banners));
      return function(){ subscribers = subscribers.filter(function(item){ return item !== callback; }); };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
