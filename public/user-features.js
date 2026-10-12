/* X-Bunny Animes • preferências por perfil, alertas de lançamentos e backup VIP. */
(function(){
  'use strict';

  var PREF_PREFIX='rh_profile_preferences_v1_';
  var ALERT_PREFIX='rh_release_alerts_v1_';
  var ALERT_CHECK_PREFIX='rh_release_check_v1_';
  var SETTING_KEYS=['rh_transitions','rh_reduce_motion','rh_drawer_mode','rh_ai_fillers','rh_ai_skip'];
  var ADULT_WORDS=/\b(?:hentai|ecchi|adulto|adult|18\+|expl[ií]cito|er[oó]tico)\b/i;
  var DEFAULT_PREFS={blockAdult:false,hiddenGenres:[],aiFillers:false,aiSkip:false,updatedAt:0};

  function readJSON(key,fallback){
    try{var value=JSON.parse(localStorage.getItem(key)||'null');return value==null?fallback:value;}
    catch(e){return fallback;}
  }
  function safe(value){return String(value||'item').replace(/[.#$\[\]\/]/g,'_').slice(0,180);}
  function context(){
    var session=readJSON('dk_session',{})||{};
    var profile=readJSON('dk_active_profile',{})||{};
    return {uid:String(session.uid||''),profileId:String(profile.id||'principal')};
  }
  function database(){
    try{
      if(!window.firebase||!firebase.database||!window.DK_FIREBASE_CONFIG)return null;
      if(!firebase.apps||!firebase.apps.length)firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      return firebase.database();
    }catch(e){return null;}
  }
  function hasVip(feature){
    try{return !!(window.RabbitHubPlans&&window.RabbitHubPlans.can&&window.RabbitHubPlans.can(feature));}
    catch(e){return false;}
  }
  function scoped(prefix){var ctx=context();return prefix+safe(ctx.uid||'visitante')+'_'+safe(ctx.profileId);}
  function normalizePreferences(raw){
    raw=raw&&typeof raw==='object'?raw:{};
    var hidden=Array.isArray(raw.hiddenGenres)?raw.hiddenGenres:[];
    return {
      blockAdult:raw.blockAdult===true,
      hiddenGenres:hidden.map(function(item){return String(item||'').trim().toLocaleLowerCase('pt-BR');}).filter(Boolean).slice(0,30),
      aiFillers:raw.aiFillers===true,
      aiSkip:raw.aiSkip===true,
      updatedAt:Number(raw.updatedAt)||0
    };
  }
  function getPreferences(){return normalizePreferences(readJSON(scoped(PREF_PREFIX),DEFAULT_PREFS));}
  function emitPreferences(value){
    try{document.dispatchEvent(new CustomEvent('rh:preferenceschange',{detail:value}));}catch(e){}
  }
  function savePreferences(patch,options){
    var current=getPreferences();
    patch=patch&&typeof patch==='object'?patch:{};
    var next=normalizePreferences(Object.assign({},current,patch,{updatedAt:Date.now()}));
    try{localStorage.setItem(scoped(PREF_PREFIX),JSON.stringify(next));}catch(e){}
    try{
      localStorage.setItem('rh_ai_fillers',next.aiFillers?'1':'0');
      localStorage.setItem('rh_ai_skip',next.aiSkip?'1':'0');
    }catch(e){}
    emitPreferences(next);
    var ctx=context(),db=database();
    if(options&&options.localOnly||!db||!ctx.uid)return Promise.resolve({synced:false,preferences:next});
    var payload=Object.assign({},next,{updatedAt:firebase.database.ServerValue.TIMESTAMP});
    return db.ref('users/'+safe(ctx.uid)+'/profilePreferences/'+safe(ctx.profileId)).set(payload)
      .then(function(){return {synced:true,preferences:next};})
      .catch(function(){return {synced:false,preferences:next};});
  }
  function hydratePreferences(){
    var ctx=context(),db=database(),local=getPreferences();
    if(!db||!ctx.uid)return Promise.resolve(local);
    return db.ref('users/'+safe(ctx.uid)+'/profilePreferences/'+safe(ctx.profileId)).once('value').then(function(snapshot){
      var remote=snapshot&&snapshot.val?snapshot.val():null;
      if(!remote)return local;
      var next=Number(remote.updatedAt||0)>=Number(local.updatedAt||0)?normalizePreferences(remote):local;
      return savePreferences(next,{localOnly:true}).then(function(){return next;});
    }).catch(function(){return local;});
  }
  function animeSearchText(anime){
    anime=anime||{};
    var genres=anime.generos||anime.genres||anime.categorias||anime.categories||[];
    if(!Array.isArray(genres))genres=String(genres||'').split(/[,|/]/);
    return [anime.titulo,anime.title,anime.nome,anime.info,anime.descricao,anime.sinopse,anime.classificacao,genres.join(' ')]
      .join(' ').toLocaleLowerCase('pt-BR');
  }
  function allowsAnime(anime){
    var prefs=getPreferences(),text=animeSearchText(anime);
    if(prefs.blockAdult&&ADULT_WORDS.test(text))return false;
    return !prefs.hiddenGenres.some(function(genre){return genre&&text.indexOf(genre)!==-1;});
  }
  function filterAnimeList(items){return (Array.isArray(items)?items:[]).filter(allowsAnime);}

  function normalizeAlert(raw){
    raw=raw||{};
    return {slug:String(raw.slug||''),title:String(raw.title||raw.titulo||raw.slug||'Anime').slice(0,180),cover:String(raw.cover||raw.capa||'').slice(0,1200),lastCount:Math.max(0,Number(raw.lastCount)||0),updatedAt:Number(raw.updatedAt)||Date.now()};
  }
  function getAlerts(){return (readJSON(scoped(ALERT_PREFIX),[])||[]).map(normalizeAlert).filter(function(item){return item.slug;}).slice(0,50);}
  function saveAlerts(items){
    items=(items||[]).map(normalizeAlert).filter(function(item,index,list){return item.slug&&list.findIndex(function(other){return safe(other.slug)===safe(item.slug);})===index;}).slice(0,50);
    try{localStorage.setItem(scoped(ALERT_PREFIX),JSON.stringify(items));}catch(e){}
    try{document.dispatchEvent(new CustomEvent('rh:releasealertschange',{detail:{items:items}}));}catch(e){}
    return items;
  }
  function hydrateAlerts(){
    var ctx=context(),db=database(),local=getAlerts();
    if(!db||!ctx.uid)return Promise.resolve(local);
    return db.ref('users/'+safe(ctx.uid)+'/animeAlerts').once('value').then(function(snapshot){
      var remote=snapshot&&snapshot.val?snapshot.val():null;
      var items=remote&&typeof remote==='object'?Object.keys(remote).map(function(key){return normalizeAlert(remote[key]);}):[];
      return saveAlerts(items);
    }).catch(function(){return local;});
  }
  function findAlert(slug){var key=safe(slug);return getAlerts().filter(function(item){return safe(item.slug)===key;})[0]||null;}
  function setAlert(raw,enabled){
    if(!hasVip('releaseAlerts'))return Promise.resolve({ok:false,reason:'vip'});
    raw=normalizeAlert(raw);var items=getAlerts().filter(function(item){return safe(item.slug)!==safe(raw.slug);});
    if(enabled)items.unshift(raw);
    items=saveAlerts(items);
    var ctx=context(),db=database();
    if(!db||!ctx.uid)return Promise.resolve({ok:true,synced:false,enabled:enabled});
    var ref=db.ref('users/'+safe(ctx.uid)+'/animeAlerts/'+safe(raw.slug));
    return (enabled?ref.set(Object.assign({},raw,{updatedAt:firebase.database.ServerValue.TIMESTAMP})):ref.remove())
      .then(function(){return {ok:true,synced:true,enabled:enabled};})
      .catch(function(){return {ok:true,synced:false,enabled:enabled};});
  }
  function notifyRelease(ctx,item,newCount){
    var db=database();if(!db||!ctx.uid)return Promise.resolve();
    var difference=Math.max(1,newCount-item.lastCount);
    return db.ref('notifications/user/'+safe(ctx.uid)).push().set({
      type:'release',category:'release',title:'Novo episódio disponível',
      body:item.title+' recebeu '+difference+(difference===1?' episódio novo.':' episódios novos.'),
      buttonUrl:'detalhes.html?anime='+encodeURIComponent(item.slug),animeSlug:item.slug,
      createdAt:firebase.database.ServerValue.TIMESTAMP,updatedAt:firebase.database.ServerValue.TIMESTAMP
    }).catch(function(){});
  }
  function checkReleaseAlerts(force){
    if(!hasVip('releaseAlerts')||!window.AF||typeof AF.detalhes!=='function')return Promise.resolve([]);
    var throttleKey=scoped(ALERT_CHECK_PREFIX),last=Number(localStorage.getItem(throttleKey)||0);
    if(!force&&Date.now()-last<4*60*60*1000)return Promise.resolve([]);
    try{localStorage.setItem(throttleKey,String(Date.now()));}catch(e){}
    var ctx=context(),items=getAlerts().slice(0,10),notices=[];
    var chain=Promise.resolve();
    items.forEach(function(item){
      chain=chain.then(function(){return AF.detalhes(item.slug).then(function(details){
        var count=Array.isArray(details&&details.episodios)?details.episodios.length:0;
        if(item.lastCount>0&&count>item.lastCount){notices.push(item);notifyRelease(ctx,item,count);}
        if(count>0)item.lastCount=count;item.updatedAt=Date.now();
      }).catch(function(){});});
    });
    return chain.then(function(){
      saveAlerts(items.concat(getAlerts().slice(10)));
      var db=database();
      if(db&&ctx.uid){var updates={};items.forEach(function(item){updates[safe(item.slug)]=item;});db.ref('users/'+safe(ctx.uid)+'/animeAlerts').update(updates).catch(function(){});}
      return notices;
    });
  }

  function snapshot(){
    var ctx=context(),settings={};
    SETTING_KEYS.forEach(function(key){var value=localStorage.getItem(key);if(value!==null)settings[key]=value;});
    return {
      version:1,createdAt:Date.now(),profileId:ctx.profileId,
      history:window.RabbitHubProfileData&&window.RabbitHubProfileData.getHistory?window.RabbitHubProfileData.getHistory().slice(0,100):[],
      watchlist:window.RabbitHubWatchlist&&window.RabbitHubWatchlist.get?window.RabbitHubWatchlist.get().slice(0,200):[],
      preferences:getPreferences(),releaseAlerts:getAlerts(),settings:settings
    };
  }
  function validBackup(raw){return raw&&Number(raw.version)===1&&Array.isArray(raw.history)&&Array.isArray(raw.watchlist)&&raw.preferences&&typeof raw.preferences==='object';}
  function restore(raw){
    if(!hasVip('cloudBackup'))return Promise.reject(new Error('O backup está disponível somente no plano VIP.'));
    if(!validBackup(raw))return Promise.reject(new Error('Arquivo de backup inválido.'));
    if(window.RabbitHubWatchlist&&window.RabbitHubWatchlist.save)window.RabbitHubWatchlist.save(raw.watchlist.slice(0,200));
    saveAlerts(Array.isArray(raw.releaseAlerts)?raw.releaseAlerts:[]);
    Object.keys(raw.settings||{}).forEach(function(key){if(SETTING_KEYS.indexOf(key)!==-1)localStorage.setItem(key,String(raw.settings[key]));});
    var jobs=[savePreferences(raw.preferences)];
    if(window.RabbitHubProfileData){
      jobs.push(window.RabbitHubProfileData.clearHistory().then(function(){
        return Promise.all(raw.history.slice().reverse().slice(0,100).map(function(item){return window.RabbitHubProfileData.saveHistory(item);}));
      }));
    }
    return Promise.all(jobs).then(function(){return {ok:true};});
  }
  function saveCloudBackup(){
    if(!hasVip('cloudBackup'))return Promise.reject(new Error('O backup na nuvem está disponível somente no plano VIP.'));
    var ctx=context(),db=database();if(!db||!ctx.uid)return Promise.reject(new Error('Banco de dados indisponível.'));
    var data=snapshot();data.updatedAt=firebase.database.ServerValue.TIMESTAMP;
    return db.ref('users/'+safe(ctx.uid)+'/backups/'+safe(ctx.profileId)).set(data).then(function(){return data;});
  }
  function restoreCloudBackup(){
    if(!hasVip('cloudBackup'))return Promise.reject(new Error('O backup na nuvem está disponível somente no plano VIP.'));
    var ctx=context(),db=database();if(!db||!ctx.uid)return Promise.reject(new Error('Banco de dados indisponível.'));
    return db.ref('users/'+safe(ctx.uid)+'/backups/'+safe(ctx.profileId)).once('value').then(function(snap){
      var value=snap.val();if(!value)throw new Error('Nenhum backup foi encontrado para este perfil.');return restore(value);
    });
  }
  function downloadBackup(){
    if(!hasVip('cloudBackup'))throw new Error('A exportação está disponível somente no plano VIP.');
    var data=JSON.stringify(snapshot(),null,2),fileName='x-bunny-animes-backup-'+new Date().toISOString().slice(0,10)+'.json';
    if(window.RabbitHubApp&&typeof window.RabbitHubApp.saveTextFile==='function'){
      window.RabbitHubApp.saveTextFile(fileName,data);return {native:true,fileName:fileName};
    }
    var blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
    return {native:false,fileName:fileName};
  }
  function readBackupFile(file){
    return new Promise(function(resolve,reject){
      if(!file||file.size>2*1024*1024){reject(new Error('Escolha um backup JSON de até 2 MB.'));return;}
      var reader=new FileReader();reader.onload=function(){try{resolve(JSON.parse(String(reader.result||'')));}catch(e){reject(new Error('O arquivo não é um backup JSON válido.'));}};reader.onerror=function(){reject(new Error('Não foi possível ler o arquivo.'));};reader.readAsText(file);
    });
  }

  window.RabbitHubFeatures={
    getPreferences:getPreferences,savePreferences:savePreferences,hydratePreferences:hydratePreferences,
    allowsAnime:allowsAnime,filterAnimeList:filterAnimeList,
    getAlerts:getAlerts,hydrateAlerts:hydrateAlerts,findAlert:findAlert,setAlert:setAlert,checkReleaseAlerts:checkReleaseAlerts,
    createBackup:snapshot,saveCloudBackup:saveCloudBackup,restoreCloudBackup:restoreCloudBackup,
    downloadBackup:downloadBackup,readBackupFile:readBackupFile,restoreBackup:restore
  };
  function start(){
    Promise.resolve(hydratePreferences()).then(hydrateAlerts).then(function(){window.setTimeout(function(){checkReleaseAlerts(false);},3500);});
  }
  document.addEventListener('dk:profilechange',start);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
