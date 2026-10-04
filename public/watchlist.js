/* RabbitHub • Minha Lista local e separada por perfil. */
(function(){
  'use strict';

  var LEGACY_KEY = 'draksyon_favs_v1';
  var PREFIX = 'rh_watchlist_v1_';
  var STATUS = {
    'quero-assistir':'Quero assistir',
    'assistindo':'Assistindo',
    'aguardando':'Aguardando episódios',
    'concluido':'Concluído',
    'abandonado':'Abandonado'
  };

  function readJSON(key,fallback){
    try {
      var value=JSON.parse(localStorage.getItem(key)||'null');
      return value==null?fallback:value;
    } catch(e){ return fallback; }
  }
  function safe(value){ return String(value||'visitante').replace(/[^a-z0-9_-]/gi,'_').slice(0,100); }
  function storageKey(){
    var session=readJSON('dk_session',{})||{};
    var profile=readJSON('dk_active_profile',{})||{};
    return PREFIX+safe(session.uid||'visitante')+'_'+safe(profile.id||'principal');
  }
  function animeKey(value){
    value=String(value||'').trim();
    try { value=new URL(value,'https://meusanimes.blog/').pathname; } catch(e){}
    return value.replace(/[?#].*$/,'').replace(/^\/+|\/+$/g,'').replace(/^(?:a|anime|animes)\//i,'').replace(/-todos-os-episodios$/i,'').toLowerCase();
  }
  function normalize(raw){
    if(typeof raw==='string') raw={slug:raw,titulo:raw};
    raw=raw||{};
    var status=STATUS[raw.status]?raw.status:'quero-assistir';
    return {
      slug:String(raw.slug||''),titulo:String(raw.titulo||raw.slug||'Sem título'),capa:String(raw.capa||''),
      status:status,ts:Number(raw.ts)||Date.now(),updatedAt:Number(raw.updatedAt)||Number(raw.ts)||Date.now()
    };
  }
  function unique(items){
    var seen={};
    return (Array.isArray(items)?items:[]).map(normalize).filter(function(item){
      var key=animeKey(item.slug);
      if(!key||seen[key]) return false;
      seen[key]=true;return true;
    }).slice(0,200);
  }
  function get(){
    var scoped=readJSON(storageKey(),null);
    if(Array.isArray(scoped)) return unique(scoped);
    var migrated=unique(readJSON(LEGACY_KEY,[]));
    try {
      localStorage.setItem(storageKey(),JSON.stringify(migrated));
      localStorage.setItem(LEGACY_KEY,'[]');
    } catch(e){}
    return migrated;
  }
  function emit(items){
    try { document.dispatchEvent(new CustomEvent('rh:watchlistchange',{detail:{items:items}})); } catch(e){}
  }
  function save(items){
    items=unique(items);
    try {
      localStorage.setItem(storageKey(),JSON.stringify(items));
    } catch(e){}
    emit(items);
    return items;
  }
  function find(slug){
    var key=animeKey(slug);
    return get().filter(function(item){ return animeKey(item.slug)===key; })[0]||null;
  }
  function add(raw,status){
    raw=normalize(raw);
    raw.status=STATUS[status]?status:raw.status;
    raw.updatedAt=Date.now();
    var key=animeKey(raw.slug);
    var items=get().filter(function(item){ return animeKey(item.slug)!==key; });
    items.unshift(raw);save(items);return raw;
  }
  function remove(slug){
    var key=animeKey(slug);
    return save(get().filter(function(item){ return animeKey(item.slug)!==key; }));
  }
  function updateStatus(slug,status){
    if(!STATUS[status]) return get();
    var key=animeKey(slug);
    var items=get();
    items.forEach(function(item){ if(animeKey(item.slug)===key){item.status=status;item.updatedAt=Date.now();} });
    return save(items);
  }

  window.RabbitHubWatchlist={get:get,save:save,find:find,has:function(slug){return !!find(slug);},add:add,remove:remove,updateStatus:updateStatus,statuses:STATUS,key:storageKey};
})();
