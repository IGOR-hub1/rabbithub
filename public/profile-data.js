/* X-Bunny Animes • dados do perfil sincronizados com o Firebase. */
(function(){
  'use strict';

  var releaseProfileBoot=window.RabbitHubBoot&&window.RabbitHubBoot.hold
    ? window.RabbitHubBoot.hold('profile') : function(){};

  var CACHE_PREFIX = 'rh_profile_history_v2_';
  var LEGACY_HISTORY_KEY = 'draksyon_history_v1';
  var MIGRATION_PREFIX = 'rh_history_migrated_v2_';
  var BIO_CACHE_PREFIX = 'rh_account_bio_v1_';
  var VISUAL_CACHE_PREFIX = 'rh_profile_visual_v1_';
  var remoteWrites = {};
  var historyRefreshJobs = Object.create(null);
  var progressJobs=Object.create(null);
  var OUTBOX_PREFIX='rh_playback_pending_v1_';

  function playbackOutboxKey(ctx){return OUTBOX_PREFIX+safeSegment(ctx.uid)+'_'+safeSegment(ctx.profileId);}
  function flushPlayback(ctx,force){
    var service=window.RabbitHubSession;
    if(!service||!service.updateAccount)return Promise.resolve();
    var current=context(),key=playbackOutboxKey(ctx);
    if(current.uid!==ctx.uid||current.profileId!==ctx.profileId)return Promise.resolve();
    var state=service.get();
    if(!state||state.status!=='authenticated'||state.uid!==ctx.uid)return Promise.resolve();
    var job=progressJobs[key]||(progressJobs[key]={last:0,busy:false,timer:null});
    if(job.busy)return Promise.resolve();
    if(job.timer){window.clearTimeout(job.timer);job.timer=null;}
    var pending=readJSON(key,{}),entries=Object.keys(pending);
    if(!entries.length)return Promise.resolve();
    if(!force&&Date.now()-job.last<5000){
      job.timer=window.setTimeout(function(){flushPlayback(ctx,true);},5000-(Date.now()-job.last));
      return Promise.resolve();
    }
    var updates={},profile=safeSegment(ctx.profileId);
    entries.forEach(function(id){
      var item=pending[id];
      var remote=state.account&&state.account.profileHistory&&state.account.profileHistory[profile]&&state.account.profileHistory[profile][id];
      if(remote&&Number(remote.ts)>Number(item.ts))return;
      var payload=Object.assign({},item,{profileId:ctx.profileId,updatedAt:firebase.database.ServerValue.TIMESTAMP});
      updates['profileHistory/'+profile+'/'+id]=payload;
      updates['profileProgress/'+profile+'/'+id]=payload;
      ['profileHistory','profileProgress'].forEach(function(group){
        var records=state.account&&state.account[group]&&state.account[group][profile]||{};
        Object.keys(records).forEach(function(oldKey){
          if(oldKey!==id&&sameEpisode(records[oldKey],item)&&Number(records[oldKey].ts)<=Number(item.ts))updates[group+'/'+profile+'/'+oldKey]=null;
        });
      });
    });
    job.busy=true;
    return (Object.keys(updates).length?service.updateAccount(updates):Promise.resolve()).then(function(){
      var latest=readJSON(key,{});
      entries.forEach(function(id){if(JSON.stringify(latest[id])===JSON.stringify(pending[id]))delete latest[id];});
      try{localStorage.setItem(key,JSON.stringify(latest));}catch(e){}
      job.last=Date.now();
      try{document.dispatchEvent(new CustomEvent('rh:progresssync',{detail:{synced:true,uid:ctx.uid,profileId:ctx.profileId}}));}catch(e){}
    }).catch(function(error){
      try{document.dispatchEvent(new CustomEvent('rh:progresssync',{detail:{synced:false,error:error.message,uid:ctx.uid,profileId:ctx.profileId}}));}catch(e){}
      job.last=Date.now()+10000;
    }).then(function(){
      job.busy=false;
      if(Object.keys(readJSON(key,{})).length)job.timer=window.setTimeout(function(){flushPlayback(ctx,true);},Math.max(5000,job.last-Date.now()+5000));
    });
  }

  function queuePlayback(item,force){
    var ctx=context(),key=playbackOutboxKey(ctx),pending=readJSON(key,{});
    Object.keys(pending).forEach(function(id){if(id!==episodeProgressKey(item)&&sameEpisode(pending[id],item))delete pending[id];});
    pending[episodeProgressKey(item)]=item;
    try{localStorage.setItem(key,JSON.stringify(pending));}catch(e){}
    return flushPlayback(ctx,force);
  }

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
    var central = window.RabbitHubSession && window.RabbitHubSession.get ? window.RabbitHubSession.get() : null;
    if (central && central.status === 'authenticated' && central.uid) {
      session = Object.assign({},session,{
        uid:central.uid,
        email:central.authUser && central.authUser.email || central.account && central.account.email || session.email,
        displayName:central.profile && central.profile.name || session.displayName,
        bio:central.profile && central.profile.bio || ''
      });
      profile = central.profile || profile;
    }
    var access = window.RabbitHubPlans && window.RabbitHubPlans.get ? window.RabbitHubPlans.get() : {};
    return {
      uid:String(session.uid || ''),
      email:String(session.email || ''),
      displayName:String(session.displayName || ''),
      profileId:String(profile.id || 'principal'),
      profileName:String(profile.name || 'Perfil principal'),
      profileAvatar:String(profile.avatar || ''),
      bio:String(profile.bio || session.bio || '').trim().slice(0,280),
      plan:String(access.name || session.plan || session.currentPlan || 'Free')
    };
  }

  function safeSegment(value){
    return String(value || 'item').replace(/[.#$\[\]\/]/g,function(character){
      return '_' + character.charCodeAt(0).toString(16) + '_';
    });
  }

  function writeAccount(updates){
    var central=window.RabbitHubSession;
    if(central&&central.updateAccount)return central.updateAccount(updates);
    var state=central&&central.get();
    var db=firebaseDatabase();
    if(!state||state.status!=='authenticated'||!db)return Promise.reject(new Error('Aguarde a sincronizacao da conta.'));
    return db.ref('users/'+safeSegment(state.uid)).update(updates);
  }

  function profileUpdates(fields){
    var central=window.RabbitHubSession&&window.RabbitHubSession.get();
    if(!central||central.status!=='authenticated')throw new Error('Aguarde a sincronizacao da conta.');
    var entry=accountProfileEntry(central.account,context().profileId);
    var updates={};
    Object.keys(fields).forEach(function(key){
      updates['profile/'+key]=fields[key];
      if(entry)updates['profiles/'+entry.key+'/'+key]=fields[key];
    });
    if(!entry)updates['profiles/0']=Object.assign({},central.profile,fields);
    return updates;
  }

  function saveProfileAvatar(url){
    return Promise.resolve().then(function(){
      var updates=profileUpdates({avatar:url});
      updates.profileAvatar=url;
      return writeAccount(updates);
    }).then(function(){return syncPublicProfile({profileAvatar:url});});
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
    seconds = isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) / 1000 : 0;
    duration = isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : 0;
    if (duration > 0) {
      seconds=Math.min(seconds,duration);
      progress = (seconds / duration) * 100;
    }else{progress=0;}
    progress = isFinite(progress) ? Math.max(0,Math.min(100,Math.round(progress * 10) / 10)) : 0;
    return {
      slug:String(raw.slug || ''),
      titulo:String(raw.titulo || raw.epNome || 'Sem título'),
      capa:String(raw.capa || ''),
      epNome:String(raw.epNome || 'Episódio'),
      epIdx:isFinite(epIdx) && epIdx >= 0 ? Math.floor(epIdx) : 0,
      epLink:String(raw.epLink || ''),
      season:raw.season !== null && raw.season !== undefined && raw.season !== '' && Number(raw.season) >= 0 ? Number(raw.season) : null,
      number:Number(raw.number) > 0 ? Number(raw.number) : 0,
      seasonTotal:Number(raw.seasonTotal) > 0 ? Number(raw.seasonTotal) : 0,
      ts:Number(raw.ts) || Date.now(),
      resetAt:Number(raw.resetAt) > 0 ? Number(raw.resetAt) : 0,
      progresso:progress,
      seconds:seconds,
      duration:duration
    };
  }

  function sortHistory(list){
    return list.sort(function(a,b){ return (Number(b.ts) || 0) - (Number(a.ts) || 0); });
  }

  function saveLocal(list){
    try { localStorage.setItem(cacheKey(),JSON.stringify(sortHistory(list.slice()))); } catch(e){}
  }

  function getHistory(){
    var ctx = context();
    if (!ctx.uid) return [];
    var list = readJSON(cacheKey(), null);
    if (Array.isArray(list)) return mergeHistory([],list);
    // Apenas recupera o cache antigo se ele já havia sido atribuído a este usuário.
    var migratedProfile = '';
    try { migratedProfile = localStorage.getItem(MIGRATION_PREFIX + safeSegment(ctx.uid)) || ''; } catch(e){}
    if (migratedProfile === ctx.profileId) {
      var legacy = readJSON(LEGACY_HISTORY_KEY, []);
      if (Array.isArray(legacy) && legacy.length) {
        list = sortHistory(legacy.map(normalizeHistoryItem));
        saveLocal(list);
        return list;
      }
    }
    return [];
  }

  function firebaseDatabase(){
    try {
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      var app;
      try { app = firebase.app(); }
      catch(e) { app = firebase.initializeApp(window.DK_FIREBASE_CONFIG); }
      window.__DK_FB_INIT__ = true;
      return app.database();
    } catch(e) {
      return null;
    }
  }

  function socialRef(path){
    try {
      return window.RabbitHubSocial && window.RabbitHubSocial.ref
        ? window.RabbitHubSocial.ref(path) : null;
    } catch(e) { return null; }
  }

  function visualCacheKey(profileId){
    var uid = context().uid.replace(/[^a-z0-9_-]/gi,'_').slice(0,100) || 'visitante';
    var id = String(profileId || context().profileId || 'principal')
      .replace(/[^a-z0-9_-]/gi,'_').slice(0,80);
    return VISUAL_CACHE_PREFIX + uid + '_' + (id || 'principal');
  }

  function readVisualCache(profileId){
    var value = readJSON(visualCacheKey(profileId), null);
    var ctx = context();
    var uid = ctx.uid.replace(/[^a-z0-9_-]/gi,'_').slice(0,100) || 'visitante';
    var legacyId = String(profileId || ctx.profileId || 'principal').replace(/[^a-z0-9_-]/gi,'_').slice(0,80) || 'principal';
    if (!value) {
      /* Versões anteriores acrescentavam um sublinhado mesmo com o prefixo já
         terminado em "_". Lemos uma vez e migramos sem perder o tema/banner. */
      value = readJSON(VISUAL_CACHE_PREFIX + '_' + uid + '_' + legacyId, null) ||
        readJSON(VISUAL_CACHE_PREFIX + legacyId, null) ||
        readJSON(VISUAL_CACHE_PREFIX + '_' + legacyId, {}) || {};
      if (value && (value.banner || value.theme)) {
        try { localStorage.setItem(visualCacheKey(profileId),JSON.stringify(value)); } catch(e){}
      }
    }
    return {
      banner:String(value.banner || 'default').replace(/[^a-z0-9_-]/gi,'').slice(0,80) || 'default',
      theme:String(value.theme || (window.DK_getTheme ? window.DK_getTheme() : 'blue')).replace(/[^a-z0-9_-]/gi,'').slice(0,30) || 'blue',
      updatedAt:Number(value.updatedAt) || 0
    };
  }

  function cacheCustomization(value,profileId){
    value = value || {};
    var current = readVisualCache(profileId);
    var requestedTheme=String(value.theme || current.theme || 'blue').replace(/[^a-z0-9_-]/gi,'').slice(0,30) || 'blue';
    var next = {
      banner:String(value.banner || current.banner || 'default').replace(/[^a-z0-9_-]/gi,'').slice(0,80) || 'default',
      theme:requestedTheme,
      updatedAt:Number(value.updatedAt) || current.updatedAt || 0
    };
    try { localStorage.setItem(visualCacheKey(profileId),JSON.stringify(next)); } catch(e){}
    cacheCustomizationInProfile(next,profileId);
    try {
      var uid = context().uid.replace(/[^a-z0-9_-]/gi,'_').slice(0,100);
      if (uid) localStorage.setItem('dk_theme_color_' + uid,next.theme);
    } catch(e){}
    return next;
  }

  function cacheCustomizationInProfile(value,profileId){
    var ctx = context();
    var id = String(profileId || ctx.profileId || 'principal');
    var session = readJSON('dk_session', {}) || {};
    var active = readJSON('dk_active_profile', null);
    if (active && String(active.id || 'principal') === id) {
      active.banner = value.banner;
      active.theme = value.theme;
      try { localStorage.setItem('dk_active_profile',JSON.stringify(active)); } catch(e){}
    }
    var profilesKey = 'dk_profiles_' + String(session.uid || ctx.uid || 'anon');
    var profiles = readJSON(profilesKey, []);
    if (!Array.isArray(profiles)) return;
    var changed = false;
    profiles.forEach(function(profile){
      if (!profile || String(profile.id || 'principal') !== id) return;
      profile.banner = value.banner;
      profile.theme = value.theme;
      changed = true;
    });
    if (changed) {
      try { localStorage.setItem(profilesKey,JSON.stringify(profiles)); } catch(e){}
    }
  }

  function findProfileSnapshot(snapshot,profileId){
    var match = null;
    if (!snapshot) return match;
    snapshot.forEach(function(child){
      if (match) return;
      var value = child.val() || {};
      if (String(value.id || child.key || '') === String(profileId)) {
        match = {key:String(child.key),value:value};
      }
    });
    return match;
  }

  function accountCustomizationUpdates(ctx,next,profileKey){
    var profileId = safeSegment(ctx.profileId);
    var updatedAt = firebase.database.ServerValue.TIMESTAMP;
    var updates = {};
    updates['profileCustomization/' + profileId + '/banner'] = next.banner;
    updates['profileCustomization/' + profileId + '/theme'] = next.theme;
    updates['profileCustomization/' + profileId + '/updatedAt'] = updatedAt;
    if (profileKey !== null && profileKey !== undefined && profileKey !== '') {
      updates['profiles/' + safeSegment(profileKey) + '/banner'] = next.banner;
      updates['profiles/' + safeSegment(profileKey) + '/theme'] = next.theme;
      updates['profiles/' + safeSegment(profileKey) + '/customizationUpdatedAt'] = updatedAt;
    }
    return updates;
  }

  function saveAccountCustomization(db,ctx,next,knownProfile,fields){
    var accountRef = db.ref('users/' + safeSegment(ctx.uid));
    var central=window.RabbitHubSession&&window.RabbitHubSession.get?window.RabbitHubSession.get():null;
    var account=central&&central.status==='authenticated'&&central.uid===ctx.uid?central.account:null;
    var profiles=account&&account.profiles;
    var matching=null;
    if(Array.isArray(profiles)){
      profiles.some(function(value,index){
        if(value&&String(value.id||value.profileId||'')===String(ctx.profileId)){
          matching={key:String(index),value:value};return true;
        }
        return false;
      });
    }else if(profiles&&typeof profiles==='object'){
      Object.keys(profiles).some(function(key){
        var value=profiles[key];
        if(value&&String(value.id||value.profileId||key)===String(ctx.profileId)){
          matching={key:key,value:value};return true;
        }
        return false;
      });
    }
    var profileLookup = knownProfile !== undefined
      ? Promise.resolve(knownProfile)
      : account ? Promise.resolve(matching) : accountRef.child('profiles').once('value').then(function(snapshot){
          return findProfileSnapshot(snapshot,ctx.profileId);
        }).catch(function(){ return null; });
    return profileLookup.then(function(profile){
      var updates=accountCustomizationUpdates(ctx,next,profile ? profile.key : null);
      if(fields)Object.keys(updates).forEach(function(path){
        var field=path.split('/').pop();
        if((field==='theme'||field==='banner')&&fields[field]===undefined)delete updates[path];
      });
      return writeAccount(updates);
    });
  }

  function publicProfilePayload(overrides){
    overrides = overrides || {};
    var ctx = context();
    var visual = cacheCustomization(overrides,ctx.profileId);
    var publicAvatar=String(overrides.profileAvatar || ctx.profileAvatar || '').trim();
    /* Fotos embutidas ficam na conta do dono; o perfil social usa um avatar curto
       para respeitar o limite das regras do Firebase e nunca publicar base64 truncado. */
    if (/^data:image\//i.test(publicAvatar) || publicAvatar.length > 600) publicAvatar='img/logo-blue.jpg';
    return {
      accountUid:ctx.uid,
      profileId:ctx.profileId,
      profileName:String(overrides.profileName || ctx.profileName || 'Perfil principal').trim().slice(0,40),
      profileAvatar:publicAvatar.slice(0,600),
      bio:String(overrides.bio !== undefined ? overrides.bio : ctx.bio).trim().slice(0,280),
      banner:visual.banner,
      theme:visual.theme,
      plan:String(overrides.plan || ctx.plan || 'Free').slice(0,30),
      updatedAt:window.RabbitHubSocial && window.RabbitHubSocial.timestamp
        ? window.RabbitHubSocial.timestamp() : Date.now()
    };
  }

  function syncPublicProfile(overrides){
    var ctx = context();
    if (!ctx.uid || !ctx.profileId) return Promise.resolve({synced:false,reason:'missing-profile'});
    var ref = socialRef('publicProfiles/' + safeSegment(ctx.uid) + '/' + safeSegment(ctx.profileId));
    if (!ref) return Promise.resolve({synced:false,reason:'social-unavailable'});
    var payload = publicProfilePayload(overrides);
    return settleWithTimeout(ref.update(payload).then(function(){ return {synced:true,profile:payload}; }),{synced:false,profile:payload},6000);
  }

  function getProfileCustomization(){
    var ctx = context();
    var local = readVisualCache(ctx.profileId);
    var db = firebaseDatabase();
    if (!db || !ctx.uid) return Promise.resolve(local);
    var accountRef = db.ref('users/' + safeSegment(ctx.uid));
    var central=window.RabbitHubSession&&window.RabbitHubSession.get?window.RabbitHubSession.get():null;
    var account=central&&central.status==='authenticated'&&central.uid===ctx.uid?central.account||{}:{};
    var customizationValue=account.profileCustomization&&account.profileCustomization[safeSegment(ctx.profileId)]||{};
    var sourceProfiles=account.profiles;
    var profileValues=Array.isArray(sourceProfiles)?sourceProfiles.map(function(item,index){return Object.assign({_key:String(index)},item||{});}):(sourceProfiles&&typeof sourceProfiles==='object'?Object.keys(sourceProfiles).map(function(key){return Object.assign({_key:key,id:key},sourceProfiles[key]||{});}):[]);
    var matchedProfile=profileValues.filter(function(item){return String(item.id||item.profileId||'')===String(ctx.profileId);})[0]||null;
    var customizationRead=Promise.resolve({exists:Object.keys(customizationValue).length>0,value:customizationValue});
    var profileRead=Promise.resolve(matchedProfile?{key:matchedProfile._key,value:matchedProfile}:null);
    var request = Promise.all([customizationRead,profileRead]).then(function(results){
        var customization = results[0];
        var profile = results[1];
        var remote = {};
        if (profile && profile.value) {
          if (profile.value.banner) remote.banner = profile.value.banner;
          if (profile.value.theme) remote.theme = profile.value.theme;
          if (profile.value.customizationUpdatedAt) remote.updatedAt = profile.value.customizationUpdatedAt;
        }
        Object.keys(customization.value || {}).forEach(function(key){ remote[key] = customization.value[key]; });
        var remotePresent = customization.exists || !!(profile && profile.value &&
          (profile.value.banner !== undefined || profile.value.theme !== undefined));
        /* Firebase e a fonte oficial; a leitura nunca grava o cache na conta. */
        var merged = cacheCustomization(remotePresent ? remote : local,ctx.profileId);
        if(window.DK_verifyTheme)window.DK_verifyTheme();
        try {
          document.dispatchEvent(new CustomEvent('rh:profilecustomization',{detail:merged}));
        } catch(e){}
        syncPublicProfile(merged);
        // Reading a page must never promote a stale cache to Firebase.
        return merged;
      });
    return settleWithTimeout(request,local,5000);
  }

  function saveProfileCustomization(value){
    var ctx = context();
    var previous = readVisualCache(ctx.profileId);
    value=value||{};
    var planAccess=window.RabbitHubPlans&&window.RabbitHubPlans.get?window.RabbitHubPlans.get():null;
    if(value.theme!==undefined&&(!planAccess||!planAccess.ready||!planAccess.customTheme))return Promise.reject(new Error('O tema personalizado precisa do plano VIP.'));
    if(value.theme!==undefined&&(!window.DK_THEMES||!window.DK_THEMES[value.theme]))return Promise.reject(new Error('Tema invalido.'));
    var next=Object.assign({},previous,value);
    function restoreOnFailure(result){
      if(result && result.synced)return result;
      return Object.assign({},result||{},{value:previous,synced:false});
    }
    var db = firebaseDatabase();
    if (!db || !ctx.uid) return Promise.resolve(restoreOnFailure({reason:'account-unavailable'}));
    var request = saveAccountCustomization(db,ctx,next,undefined,value).then(function(){
        cacheCustomization(next,ctx.profileId);
        if(window.DK_verifyTheme)window.DK_verifyTheme();
        syncPublicProfile(next);
        return {value:next,synced:true};
      }).catch(function(error){
        return {value:next,synced:false,reason:error && error.message ? error.message : 'firebase-write-failed'};
      });
    return request.then(restoreOnFailure);
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
    if (!vipFeature('cloudProgress')) return null;
    var db = firebaseDatabase();
    if (!db || !ctx.uid || !ctx.profileId) return null;
    return db.ref('users/' + safeSegment(ctx.uid) + '/profileHistory/' + safeSegment(ctx.profileId));
  }

  function vipFeature(name){
    try {
      return window.RabbitHubPlans && window.RabbitHubPlans.can
        ? window.RabbitHubPlans.can(name) === true
        : false;
    } catch(e){ return false; }
  }

  function episodeProgressKey(raw){
    raw = raw || {};
    var season = raw.season !== null && raw.season !== undefined && raw.season !== ''
      ? Number(raw.season) : null;
    var number = Number(raw.number) || 0;
    var index = Number(raw.epIdx);
    var episode = number > 0
      ? 'season_' + (season !== null && isFinite(season) ? season : 1) + '_number_' + number
      : 'index_' + (isFinite(index) && index >= 0 ? Math.floor(index) : 0);
    return safeSegment(String(raw.slug || 'anime') + '__' + episode).slice(0,700);
  }

  function legacyEpisodeProgressKey(raw){
    raw = raw || {};
    var episode = String(raw.epLink || ('index_' + (Number(raw.epIdx) || 0)));
    return safeSegment(String(raw.slug || 'anime') + '__' + episode).slice(0,700);
  }

  function episodeProgressRef(raw){
    var ctx = context();
    if (!vipFeature('cloudProgress')) return null;
    var db = firebaseDatabase();
    if (!db || !ctx.uid || !ctx.profileId || !raw || !raw.slug) return null;
    return db.ref('users/' + safeSegment(ctx.uid) + '/profileProgress/' + safeSegment(ctx.profileId) + '/' + episodeProgressKey(raw));
  }

  function saveEpisodeProgress(raw,force){
    if(window.RabbitHubSession&&window.RabbitHubSession.updateAccount){
      return saveHistory(Object.assign({},raw,{forceSync:force===true})).then(function(item){return {item:item};});
    }
    var item = normalizeHistoryItem(raw);
    var ref = episodeProgressRef(item);
    if (!ref) return Promise.resolve({synced:false,item:item});
    var pathKey = ref.toString();
    var now = Date.now();
    if (!force && item.progresso < 100 && remoteWrites[pathKey] && now - remoteWrites[pathKey] < 12000) {
      return Promise.resolve({synced:false,throttled:true,item:item});
    }
    remoteWrites[pathKey] = now;
    var payload = {};
    Object.keys(item).forEach(function(field){ payload[field] = item[field]; });
    payload.profileId = context().profileId;
    payload.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    return ref.set(payload).then(function(){ return {synced:true,item:item}; })
      .catch(function(){ return {synced:false,item:item}; });
  }

  function getEpisodeProgress(raw){
    if(window.RabbitHubSession&&window.RabbitHubSession.readAccount&&vipFeature('cloudProgress')){
      var owner=context();
      return window.RabbitHubSession.readAccount().then(function(account){
        if(context().uid!==owner.uid||context().profileId!==owner.profileId)return null;
        var records=account&&account.profileProgress&&account.profileProgress[safeSegment(owner.profileId)]||{};
        var value=records[episodeProgressKey(raw)]||records[legacyEpisodeProgressKey(raw)];
        return value?normalizeHistoryItem(value):null;
      }).catch(function(){return null;});
    }
    var ref = episodeProgressRef(raw);
    if (!ref) return Promise.resolve(null);
    var request = ref.once('value').then(function(snapshot){
      if (snapshot && snapshot.exists()) return normalizeHistoryItem(snapshot.val() || {});
      var legacyKey = legacyEpisodeProgressKey(raw);
      if (legacyKey === episodeProgressKey(raw)) return null;
      return ref.parent.child(legacyKey).once('value').then(function(legacySnapshot){
        if (!legacySnapshot || !legacySnapshot.exists()) return null;
        var migrated = normalizeHistoryItem(legacySnapshot.val() || {});
        ref.set(migrated).catch(function(){});
        return migrated;
      });
    }).catch(function(){ return null; });
    return settleWithTimeout(request,null,5000);
  }

  function clearEpisodeProgress(raw){
    var ref = episodeProgressRef(raw);
    if (!ref) return Promise.resolve({synced:false});
    var jobs = [ref.remove()];
    var legacyKey = legacyEpisodeProgressKey(raw);
    if (legacyKey !== episodeProgressKey(raw)) jobs.push(ref.parent.child(legacyKey).remove());
    return Promise.all(jobs).then(function(){ return {synced:true}; }).catch(function(){ return {synced:false}; });
  }

  function sameEpisode(left,right){
    if (!left || !right || String(left.slug || '') !== String(right.slug || '')) return false;
    var leftNumber = Number(left.number) || 0;
    var rightNumber = Number(right.number) || 0;
    if (leftNumber > 0 && rightNumber > 0) {
      return leftNumber === rightNumber && Number(left.season == null ? 1 : left.season) === Number(right.season == null ? 1 : right.season);
    }
    // Match old index/link records to their newer canonical season/episode identity.
    if(left.season!=null&&right.season!=null&&Number(left.season)!==Number(right.season))return false;
    if(left.epIdx!=null&&right.epIdx!=null&&Number(left.epIdx)!==Number(right.epIdx))return false;
    if (left.epLink && right.epLink) return String(left.epLink) === String(right.epLink);
    return Number(left.epIdx) === Number(right.epIdx);
  }

  function preservePlayback(previous,next,resetPlayback){
    if (!sameEpisode(previous,next)) return next;
    if (!resetPlayback && !next.resetAt && Number(previous.seconds) > 0 && !(Number(next.seconds) > 0)) {
      next.seconds = previous.seconds;
      next.duration = Number(next.duration) > 0 ? next.duration : previous.duration;
      next.progresso = next.duration>0?Math.min(100,next.seconds/next.duration*100):0;
      next.ts=previous.ts;
    }
    if (!next.epLink && previous.epLink) next.epLink = previous.epLink;
    return next;
  }

  function historyItemKey(item){
    return episodeProgressKey(item);
  }

  function emitHistoryChange(source){
    try {
      document.dispatchEvent(new CustomEvent('rh:historychange',{
        detail:{source:source || 'local',history:getHistory(),profile:context()}
      }));
    } catch(e){}
  }

  function saveHistory(raw){
    var resetPlayback = raw && raw.resetPlayback === true;
    var forceSync = raw && raw.forceSync === true;
    var item = normalizeHistoryItem(raw);
    if (!item.slug || !context().uid) return Promise.resolve(item);
    if(resetPlayback)item.resetAt=item.ts;

    var currentList = getHistory();
    var previous = currentList.filter(function(entry){ return sameEpisode(entry,item); })[0] || null;
    if(previous&&previous.number&&!item.number){item.number=previous.number;item.season=previous.season;}
    item = preservePlayback(previous,item,resetPlayback);
    var list = currentList.filter(function(entry){ return !sameEpisode(entry,item); });
    list.unshift(item);
    saveLocal(list);
    emitHistoryChange('local');

    if(vipFeature('cloudProgress')&&window.RabbitHubSession&&window.RabbitHubSession.updateAccount){
      return queuePlayback(item,forceSync||resetPlayback).then(function(){return item;});
    }

    var ref = historyRef();
    if (!ref) return Promise.resolve(item);
    var key = historyItemKey(item);
    var pathKey = ref.toString() + '/' + key;
    var now = Date.now();
    if (!forceSync && item.progresso < 100 && remoteWrites[pathKey] && now - remoteWrites[pathKey] < 12000) {
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
    var byEpisode = Object.create(null);
    remote.concat(local).forEach(function(raw){
      var item = normalizeHistoryItem(raw);
      if (!item.slug) return;
      var key = historyItemKey(item);
      var alias=Object.keys(byEpisode).filter(function(id){return sameEpisode(byEpisode[id],item);})[0];
      if(alias&&alias!==key){
        var previous=byEpisode[alias];
        if(!item.number&&previous.number){item.number=previous.number;item.season=previous.season;key=historyItemKey(item);}
        byEpisode[key]=previous;
        if(alias!==key)delete byEpisode[alias];
      }
      if (!byEpisode[key]) byEpisode[key] = item;
      else if (item.ts > byEpisode[key].ts) byEpisode[key] = preservePlayback(byEpisode[key],item);
      else byEpisode[key] = preservePlayback(item,byEpisode[key]);
    });
    return sortHistory(Object.keys(byEpisode).map(function(key){ return byEpisode[key]; }));
  }

  function refreshHistory(){
    var ref = historyRef();
    var local = getHistory();
    if (!ref) return Promise.resolve(local);
    var ownerCacheKey = cacheKey();
    var jobKey = ref.toString();
    if (historyRefreshJobs[jobKey]) return historyRefreshJobs[jobKey];
    var central=typeof window!=='undefined'&&window.RabbitHubSession;
    var owner=context();
    var read=central&&central.readAccount?central.readAccount().then(function(account){
      return {val:function(){return account&&account.profileHistory&&account.profileHistory[safeSegment(owner.profileId)]||{};}};
    }):ref.once('value');
    var request = read.then(function(snapshot){
      if (cacheKey() !== ownerCacheKey) return local;
      var value = snapshot.val() || {};
      var remote = Object.keys(value).map(function(key){ return value[key]; });
      var merged = mergeHistory(remote,getHistory());
      saveLocal(merged);
      emitHistoryChange('firebase');
      return merged;
    });
    var job = settleWithTimeout(request,local,6000);
    historyRefreshJobs[jobKey] = job;
    job.then(function(){ delete historyRefreshJobs[jobKey]; },function(){ delete historyRefreshJobs[jobKey]; });
    return job;
  }

  function clearHistory(){
    if(window.RabbitHubSession&&window.RabbitHubSession.updateAccount&&vipFeature('cloudProgress')){
      var owner=context(),updates={};
      updates['profileHistory/'+safeSegment(owner.profileId)]=null;
      updates['profileProgress/'+safeSegment(owner.profileId)]=null;
      var job=progressJobs[playbackOutboxKey(owner)];
      if(job&&job.busy)return Promise.reject(new Error('Aguarde a sincronizacao do episodio antes de limpar.'));
      return window.RabbitHubSession.updateAccount(updates).then(function(){
        try{localStorage.removeItem(playbackOutboxKey(owner));}catch(e){}
        if(context().uid===owner.uid&&context().profileId===owner.profileId){saveLocal([]);emitHistoryChange('firebase');}
      });
    }
    saveLocal([]);
    emitHistoryChange('local');
    var ref = historyRef();
    if (!ref) return Promise.resolve();
    return ref.remove().catch(function(){});
  }

  function bioCacheKey(){
    var ctx = context();
    return BIO_CACHE_PREFIX + safeSegment(ctx.uid || 'visitante') + '_' + safeSegment(ctx.profileId || 'principal');
  }

  function getCachedBio(){
    var cached = null;
    try { cached = localStorage.getItem(bioCacheKey()); } catch(e){}
    if (cached !== null) return String(cached).trim().slice(0,280);
    return context().bio;
  }

  function cacheBio(value){
    var bio = String(value || '').trim().slice(0,280);
    try { localStorage.setItem(bioCacheKey(),bio); } catch(e){}

    var session = readJSON('dk_session', {}) || {};
    if (session.uid) {
      session.bio = bio;
      try { localStorage.setItem('dk_session',JSON.stringify(session)); } catch(e){}
    }

    var active = readJSON('dk_active_profile', null);
    if (active) {
      active.bio = bio;
      try { localStorage.setItem('dk_active_profile',JSON.stringify(active)); } catch(e){}
      var profilesKey = 'dk_profiles_' + String(session.uid || 'anon');
      var profiles = readJSON(profilesKey, []);
      if (Array.isArray(profiles)) {
        profiles.forEach(function(profile){
          if (profile && profile.id === active.id) profile.bio = bio;
        });
        try { localStorage.setItem(profilesKey,JSON.stringify(profiles)); } catch(e){}
      }
    }

    var legacy = readJSON('draksyon_profile_v1', null);
    if (legacy) {
      legacy.bio = bio;
      try { localStorage.setItem('draksyon_profile_v1',JSON.stringify(legacy)); } catch(e){}
    }
    return bio;
  }

  function getBio(){
    var ctx = context();
    var local = getCachedBio();
    var db = firebaseDatabase();
    if (!db || !ctx.uid) return Promise.resolve(local);

    var accountRef = db.ref('users/' + safeSegment(ctx.uid));
    var central=window.RabbitHubSession&&window.RabbitHubSession.get?window.RabbitHubSession.get():null;
    var account=central&&central.status==='authenticated'&&central.uid===ctx.uid?central.account||{}:{};
    var customization=account.profileCustomization&&account.profileCustomization[safeSegment(ctx.profileId)]||{};
    var entry=accountProfileEntry(account,ctx.profileId);
    var canonical=entry&&entry.value||account.profile||{};
    var hasRemoteBio=Object.prototype.hasOwnProperty.call(canonical,'bio')||Object.prototype.hasOwnProperty.call(customization,'bio')||
      Object.prototype.hasOwnProperty.call(account,'bio');
    var remoteBio=Object.prototype.hasOwnProperty.call(customization,'bio')?customization.bio:(Object.prototype.hasOwnProperty.call(canonical,'bio')?canonical.bio:account.bio);
    var request = Promise.resolve(remoteBio).then(function(value){
      if(hasRemoteBio)return cacheBio(value == null ? '' : value);
      if (!local) return '';
      var updates = {bio:local,bioUpdatedAt:firebase.database.ServerValue.TIMESTAMP};
      updates['profileCustomization/' + safeSegment(ctx.profileId) + '/bio'] = local;
      return local;
    });
    return settleWithTimeout(request,local,6000);
  }

  function saveBio(value){
    var bio = String(value||'').trim().slice(0,280);
    var ctx = context();
    var db = firebaseDatabase();
    if (!db || !ctx.uid) {
      return Promise.reject(new Error('Aguarde a sincronizacao da conta.'));
    }

    var updates;
    try{updates=profileUpdates({bio:bio});}catch(error){return Promise.reject(error);}
    updates.bio= bio;
    updates.bioUpdatedAt=firebase.database.ServerValue.TIMESTAMP;
    updates['profileCustomization/' + safeSegment(ctx.profileId) + '/bio'] = bio;
    updates['profileCustomization/' + safeSegment(ctx.profileId) + '/updatedAt'] = firebase.database.ServerValue.TIMESTAMP;
    return writeAccount(updates).then(function(){
      cacheBio(bio);
      return syncPublicProfile({bio:bio}).then(function(){ return {bio:bio,synced:true}; });
    });
  }

  function accountProfileEntry(account,profileId){
    account=account||{};
    var source=account.profiles;
    if(Array.isArray(source)){
      var index=source.findIndex(function(item){
        return item&&String(item.id||item.profileId||String(source.indexOf(item)))===String(profileId||'');
      });
      if(index<0&&source.some(Boolean))throw new Error('Perfil nao encontrado. Atualize a pagina.');
      return index>=0?{key:String(index),value:source[index]||{},exists:true}:null;
    }
    if(source&&typeof source==='object'){
      var keys=Object.keys(source);
      var key=keys.filter(function(candidate){
        var item=source[candidate]||{};
        return String(candidate)===String(profileId||'')||
          String(item.id||item.profileId||'')===String(profileId||'');
      })[0];
      if(key===undefined&&keys.length)throw new Error('Perfil nao encontrado. Atualize a pagina.');
      return key!==undefined?{key:String(key),value:source[key]||{},exists:true}:null;
    }
    return null;
  }

  function cacheProfileName(value){
    var name=String(value||'').trim().replace(/\s+/g,' ').slice(0,24);
    var ctx=context();
    var session=readJSON('dk_session',{})||{};
    session.displayName=name;
    session.profileName=name;
    try{localStorage.setItem('dk_session',JSON.stringify(session));}catch(e){}

    var active=readJSON('dk_active_profile',null);
    if(active){
      active.name=name;active.profileName=name;
      try{localStorage.setItem('dk_active_profile',JSON.stringify(active));}catch(e){}
    }
    var profilesKey='dk_profiles_'+String(ctx.uid||session.uid||'anon');
    var profiles=readJSON(profilesKey,[]);
    if(Array.isArray(profiles)){
      profiles.forEach(function(profile,index){
        if(!profile)return;
        var matches=active&&String(profile.id||profile.profileId||'')===String(active.id||active.profileId||'');
        if(matches||(!active&&index===0)){profile.name=name;profile.profileName=name;}
      });
      try{localStorage.setItem(profilesKey,JSON.stringify(profiles));}catch(e){}
    }
    var legacy=readJSON('draksyon_profile_v1',null);
    if(legacy){legacy.nome=name;legacy.name=name;try{localStorage.setItem('draksyon_profile_v1',JSON.stringify(legacy));}catch(e){}}
    if(window.DK_USER){window.DK_USER.displayName=name;window.DK_USER.profileName=name;}
    try{document.dispatchEvent(new CustomEvent('rh:profileidentitychange',{detail:{name:name,profileId:ctx.profileId}}));}catch(e){}
    return name;
  }

  function saveProfileName(value){
    var name=String(value||'').trim().replace(/\s+/g,' ').slice(0,24);
    if(!name)return Promise.reject(new Error('Digite um nome para o perfil.'));
    var ctx=context();
    var central=window.RabbitHubSession&&window.RabbitHubSession.get?window.RabbitHubSession.get():null;
    var db=firebaseDatabase();
    if(!db||!ctx.uid||!central||central.status!=='authenticated'||!central.account){
      return Promise.reject(new Error('Sua conta ainda não terminou de sincronizar. Tente novamente.'));
    }
    var entry;
    try{entry=accountProfileEntry(central.account,ctx.profileId);}catch(error){return Promise.reject(error);}
    var accountRef=db.ref('users/'+safeSegment(ctx.uid));
    var timestamp=firebase.database.ServerValue.TIMESTAMP;
    var updates={displayName:name,profileName:name,profileUpdatedAt:timestamp};
    updates['profile/name']=name;
    updates['profile/profileName']=name;
    if(entry&&entry.exists){
      updates['profiles/'+safeSegment(entry.key)+'/name']=name;
      updates['profiles/'+safeSegment(entry.key)+'/profileName']=name;
      updates['profiles/'+safeSegment(entry.key)+'/updatedAt']=timestamp;
    }else{
      updates['profiles/0']=Object.assign({},central.profile||{}, {
        id:ctx.profileId||'principal',name:name,profileName:name,updatedAt:timestamp
      });
    }
    return writeAccount(updates).then(function(){
      var authUser=central.authUser||(window.firebase&&firebase.auth&&firebase.auth().currentUser);
      var authWrite=authUser&&authUser.updateProfile
        ? settleWithTimeout(authUser.updateProfile({displayName:name}).then(function(){return true;}),false,6000)
        : Promise.resolve(false);
      cacheProfileName(name);
      return Promise.all([authWrite,syncPublicProfile({profileName:name})]);
    }).then(function(results){
      return {name:name,synced:true,authSynced:results[0]===true,publicSynced:!!(results[1]&&results[1].synced)};
    });
  }

  function getAccount(){
    var ctx = context();
    var fallback = {session:ctx,user:{},profile:ctx};
    var central=window.RabbitHubSession&&window.RabbitHubSession.get?window.RabbitHubSession.get():null;
    if(!central||central.status!=='authenticated'||!central.account)return Promise.resolve(fallback);
    var user={};
    Object.keys(central.account).forEach(function(key){
      if(!/^(?:password|passwordHash|senha|secret|token)$/i.test(key))user[key]=central.account[key];
    });
    return Promise.resolve({session:ctx,user:user,profile:ctx});
  }

  function validWhatsappUrl(value){
    return /^https:\/\/(?:chat\.whatsapp\.com\/|wa\.me\/|www\.whatsapp\.com\/channel\/)/i.test(String(value || '').trim());
  }

  function validInstagramUrl(value){
    return /^https:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+\/?(?:[?#].*)?$/i.test(String(value || '').trim());
  }

  function contactLabel(url,type){
    try {
      var parsed = new URL(url);
      var path = parsed.pathname.replace(/^\/+|\/+$/g,'');
      if (type === 'instagram') return path ? '@' + path.split('/')[0] : 'Instagram X-Bunny Animes';
      if (/^wa\.me$/i.test(parsed.hostname)) return '+' + path.replace(/\D/g,'');
    } catch(e){}
    return type === 'instagram' ? 'Instagram X-Bunny Animes' : 'WhatsApp X-Bunny Animes';
  }

  function getSupportContacts(){
    var defaults = window.DK_SUPPORT_CONTACTS || {};
    var fallbackInstagram = validInstagramUrl(defaults.instagramUrl) ? String(defaults.instagramUrl).trim() : '';
    var fallbackWhatsapp = validWhatsappUrl(defaults.whatsappUrl) ? String(defaults.whatsappUrl).trim() : '';
    var fallback = {
      instagramUrl:fallbackInstagram,
      instagramLabel:contactLabel(fallbackInstagram,'instagram'),
      whatsappUrl:fallbackWhatsapp,
      whatsappLabel:contactLabel(fallbackWhatsapp,'whatsapp')
    };
    var db = firebaseDatabase();
    if (!db) return Promise.resolve(fallback);
    var request = db.ref('dk_broadcast/config').once('value').then(function(snapshot){
      var config = snapshot.val() || {};
      var instagram = validInstagramUrl(config.supportInstagramUrl) ? String(config.supportInstagramUrl).trim() : fallbackInstagram;
      var whatsappCandidate = config.supportWhatsappUrl || config.whatsappGroupUrl || fallbackWhatsapp;
      var whatsapp = validWhatsappUrl(whatsappCandidate) ? String(whatsappCandidate).trim() : fallbackWhatsapp;
      return {
        instagramUrl:instagram,
        instagramLabel:contactLabel(instagram,'instagram'),
        whatsappUrl:whatsapp,
        whatsappLabel:contactLabel(whatsapp,'whatsapp')
      };
    });
    return settleWithTimeout(request,fallback,5000);
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

  function submitSupportRequest(payload){
    payload = payload || {};
    var ctx = context();
    var db = firebaseDatabase();
    if (!db || !ctx.uid) {
      return Promise.reject(new Error('Não foi possível conectar ao suporte.'));
    }

    var type = String(payload.type || 'outro').trim().slice(0,60);
    var subject = String(payload.subject || '').trim().slice(0,120);
    var message = String(payload.message || '').trim().slice(0,1200);
    var contact = String(payload.contact || ctx.email || '').trim().slice(0,160);
    if (!message) return Promise.reject(new Error('Escreva uma mensagem antes de enviar.'));

    var ref = db.ref('users/' + safeSegment(ctx.uid) + '/supportRequests').push();
    return ref.set({
      type:type,
      subject:subject,
      message:message,
      contact:contact,
      uid:ctx.uid,
      email:ctx.email,
      displayName:ctx.displayName,
      profileId:ctx.profileId,
      profileName:ctx.profileName,
      status:'new',
      createdAt:firebase.database.ServerValue.TIMESTAMP
    }).then(function(){
      return {id:ref.key, type:type, subject:subject, message:message};
    });
  }

  window.RabbitHubProfileData = {
    requestPasswordReset:function(){
      var user=window.firebase&&firebase.auth&&firebase.auth().currentUser;
      if(!user||!user.email)return Promise.reject(new Error('Entre novamente para redefinir sua senha.'));
      return firebase.auth().sendPasswordResetEmail(user.email);
    },
    getContext:context,
    getHistory:getHistory,
    saveHistory:saveHistory,
    refreshHistory:refreshHistory,
    clearHistory:clearHistory,
    saveEpisodeProgress:saveEpisodeProgress,
    getEpisodeProgress:getEpisodeProgress,
    clearEpisodeProgress:clearEpisodeProgress,
    getCachedBio:getCachedBio,
    getBio:getBio,
    saveBio:saveBio,
    saveProfileAvatar:saveProfileAvatar,
    saveProfileName:saveProfileName,
    getProfileCustomization:getProfileCustomization,
    saveProfileCustomization:saveProfileCustomization,
    syncPublicProfile:syncPublicProfile,
    getAccount:getAccount,
    getSupportContacts:getSupportContacts,
    getWhatsappGroupUrl:getWhatsappGroupUrl,
    submitSupportRequest:submitSupportRequest,
    validWhatsappUrl:validWhatsappUrl,
    validInstagramUrl:validInstagramUrl
  };

  var hydrationPromise=null;
  var hydrationKey='';
  function hydrateProfileState(){
    var authenticated=window.RabbitHubSession&&window.RabbitHubSession.get&&window.RabbitHubSession.get();
    // The profile/theme already came from the authenticated account snapshot.
    // Background history/public-profile synchronization must not hide the page.
    if(authenticated&&authenticated.status==='authenticated'&&authenticated.profile)releaseProfileBoot();
    var ctx=context();
    var key=ctx.uid+'|'+ctx.profileId;
    if(hydrationPromise&&hydrationKey===key)return hydrationPromise;
    hydrationKey=key;
    var pending=Promise.all([
      refreshHistory(),
      getProfileCustomization(),
      getBio()
    ]).then(function(){
      return syncPublicProfile();
    }).catch(function(){
      return {synced:false};
    }).then(function(result){
      releaseProfileBoot();
      try{document.dispatchEvent(new CustomEvent('rh:profilehydrated',{detail:{profile:context()}}));}catch(e){}
      return result;
    });
    hydrationPromise=pending;
    pending.then(function(){if(hydrationPromise===pending)hydrationPromise=null;});
    return pending;
  }
  function start(){
    if(document.documentElement.getAttribute('data-dk-ready')==='1'){
      hydrateProfileState();
      return;
    }
    window.setTimeout(function(){
      if(!hydrationPromise)hydrateProfileState();
    },9000);
  }
  document.addEventListener('dk:userready',hydrateProfileState);
  document.addEventListener('dk:userready',function(){flushPlayback(context(),true);});
  if(window.addEventListener)window.addEventListener('online',function(){flushPlayback(context(),true);});
  document.addEventListener('rh:sessionchange',function(event){
    var state=event&&event.detail;
    if(!state||state.status!=='authenticated'||!state.account||!state.profile)return;
    var ctx=context();
    if(ctx.uid!==state.uid||ctx.profileId!==state.profile.id)return;
    var records=state.account.profileHistory&&state.account.profileHistory[safeSegment(ctx.profileId)];
    if(!records)return;
    var current=getHistory();
    var merged=mergeHistory(Object.keys(records).map(function(key){return records[key];}),current);
    if(JSON.stringify(merged)===JSON.stringify(current))return;
    saveLocal(merged);emitHistoryChange('firebase');
  });
  document.addEventListener('rh:uidchange',function(){
    remoteWrites = {};
    hydrateProfileState();
  });
  document.addEventListener('dk:profilechange',function(){
    hydrateProfileState();
    flushPlayback(context(),true);
  });
  document.addEventListener('rh:planchange',function(event){
    var plan = event && event.detail ? event.detail.name : '';
    syncPublicProfile({plan:plan || context().plan});
    refreshHistory();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
