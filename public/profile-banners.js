/* RabbitHub • catálogo online de banners do perfil. */
(function(){
  'use strict';

  var CONFIG_PATH = 'dk_broadcast/config/profileBanners';
  var EXAMPLE_URL = 'https://i.pinimg.com/originals/8c/b8/73/8cb8736ff5cac067127561dbca459dae.gif';
  var DEFAULTS = [
    {key:'default',name:'Gato animado',type:'animated',media:'image',url:EXAMPLE_URL},
    {key:'midnight',name:'Noite estrelada',type:'static',media:'image',url:'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1600&q=85'},
    {key:'aurora',name:'Aurora boreal',type:'static',media:'image',url:'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?auto=format&fit=crop&w=1600&q=85'},
    {key:'ocean',name:'Oceano',type:'static',media:'image',url:'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=85'},
    {key:'forest',name:'Floresta',type:'static',media:'image',url:'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1600&q=85'},
    {key:'sunset',name:'Pôr do sol',type:'static',media:'image',url:'https://images.unsplash.com/photo-1472120435266-53107fd0c44a?auto=format&fit=crop&w=1600&q=85'}
  ];

  var banners = cloneList(DEFAULTS);
  var started = false;
  var remoteLoaded = false;
  var subscribers = [];

  function clone(value){
    var copy = {};
    Object.keys(value || {}).forEach(function(key){ copy[key] = value[key]; });
    return copy;
  }
  function cloneList(list){ return (list || []).map(clone); }

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
    var requestedType = String(raw.type || '').toLowerCase();
    var type = media === 'video' ? 'video' :
      (requestedType === 'animated' || /\.gif(?:[?#]|$)/i.test(url) ? 'animated' : 'static');
    return {
      key:normalizeKey(raw.key || raw.id || fallbackKey,index),
      name:String(raw.name || raw.title || 'Banner do perfil').trim().slice(0,60) || 'Banner do perfil',
      type:type,
      media:media,
      url:url,
      order:Number.isFinite(Number(raw.order)) ? Number(raw.order) : index
    };
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
    banners = snapshot && snapshot.exists() ? normalizeCollection(snapshot.val()) : cloneList(DEFAULTS);
    var current = cloneList(banners);
    subscribers.slice().forEach(function(callback){
      try { callback(current); } catch(e){}
    });
    try {
      document.dispatchEvent(new CustomEvent('rh:profilebannerschanged',{detail:{banners:current}}));
    } catch(e){}
  }

  function start(){
    if (started) return;
    started = true;
    var db = database();
    if (!db) return;
    try {
      db.ref(CONFIG_PATH).on('value',snapshotValue,function(){
        remoteLoaded = true;
        banners = cloneList(DEFAULTS);
      });
    } catch(e){}
  }

  window.RabbitHubProfileBanners = {
    path:CONFIG_PATH,
    exampleUrl:EXAMPLE_URL,
    defaults:function(){ return cloneList(DEFAULTS); },
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
