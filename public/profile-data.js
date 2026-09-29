/* RabbitHub • dados do perfil sincronizados com o Firebase. */
(function(){
  'use strict';

  var LEGACY_HISTORY_KEY = 'draksyon_history_v1';
  var CACHE_PREFIX = 'rh_profile_history_v2_';
  var MIGRATION_PREFIX = 'rh_history_migrated_v2_';
  var BIO_CACHE_PREFIX = 'rh_account_bio_v1_';
  var VISUAL_CACHE_PREFIX = 'rh_profile_visual_v1_';
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
    return VISUAL_CACHE_PREFIX + '_' + uid + '_' + (id || 'principal');
  }

  function readVisualCache(profileId){
    var value = readJSON(visualCacheKey(profileId), null);
    if (!value) {
      var legacyId = String(profileId || context().profileId || 'principal').replace(/[^a-z0-9_-]/gi,'_').slice(0,80);
      value = readJSON(VISUAL_CACHE_PREFIX + '_' + (legacyId || 'principal'), {}) || {};
    }
    return {
      banner:String(value.banner || 'default').replace(/[^a-z0-9_-]/gi,'').slice(0,80) || 'default',
      theme:String(value.theme || (window.DK_getTheme ? window.DK_getTheme() : 'blue')).replace(/[^a-z0-9_-]/gi,'').slice(0,30) || 'blue'
    };
  }

  function cacheCustomization(value,profileId){
    value = value || {};
    var current = readVisualCache(profileId);
    var next = {
      banner:String(value.banner || current.banner || 'default').replace(/[^a-z0-9_-]/gi,'').slice(0,80) || 'default',
      theme:String(value.theme || current.theme || 'blue').replace(/[^a-z0-9_-]/gi,'').slice(0,30) || 'blue'
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

  function saveAccountCustomization(db,ctx,next,knownProfile){
    var accountRef = db.ref('users/' + safeSegment(ctx.uid));
    var profileLookup = knownProfile !== undefined
      ? Promise.resolve(knownProfile)
      : accountRef.child('profiles').once('value').then(function(snapshot){
          return findProfileSnapshot(snapshot,ctx.profileId);
        }).catch(function(){ return null; });
    return profileLookup.then(function(profile){
      return accountRef.update(accountCustomizationUpdates(ctx,next,profile ? profile.key : null));
    });
  }

  function publicProfilePayload(overrides){
    overrides = overrides || {};
    var ctx = context();
    var visual = cacheCustomization(overrides,ctx.profileId);
    return {
      accountUid:ctx.uid,
      profileId:ctx.profileId,
      profileName:String(overrides.profileName || ctx.profileName || 'Perfil principal').trim().slice(0,40),
      profileAvatar:String(overrides.profileAvatar || ctx.profileAvatar || '').trim().slice(0,600),
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
    return ref.update(payload).then(function(){ return {synced:true,profile:payload}; })
      .catch(function(){ return {synced:false,profile:payload}; });
  }

  function getProfileCustomization(){
    var ctx = context();
    var local = readVisualCache(ctx.profileId);
    var db = firebaseDatabase();
    if (!db || !ctx.uid) return Promise.resolve(local);
    var accountRef = db.ref('users/' + safeSegment(ctx.uid));
    var customizationRef = accountRef.child('profileCustomization/' + safeSegment(ctx.profileId));
    var customizationRead = customizationRef.once('value').then(function(snapshot){
      return {exists:snapshot.exists(),value:snapshot.val() || {}};
    }).catch(function(){ return {exists:false,value:{}}; });
    var profileRead = accountRef.child('profiles').once('value').then(function(snapshot){
      return findProfileSnapshot(snapshot,ctx.profileId);
    }).catch(function(){ return null; });
    var request = Promise.all([customizationRead,profileRead]).then(function(results){
        var customization = results[0];
        var profile = results[1];
        var remote = {};
        if (profile && profile.value) {
          if (profile.value.banner) remote.banner = profile.value.banner;
          if (profile.value.theme) remote.theme = profile.value.theme;
        }
        Object.keys(customization.value || {}).forEach(function(key){ remote[key] = customization.value[key]; });
        var previousTheme = window.DK_getTheme ? window.DK_getTheme() : 'blue';
        var merged = cacheCustomization(remote,ctx.profileId);
        if (merged.theme !== previousTheme && window.DK_setTheme) {
          window.DK_setTheme(merged.theme,false,{system:true});
        }
        try {
          document.dispatchEvent(new CustomEvent('rh:profilecustomization',{detail:merged}));
        } catch(e){}
        syncPublicProfile(merged);
        var mirrored = customization.exists && profile &&
          String(profile.value.banner || '') === merged.banner &&
          String(profile.value.theme || '') === merged.theme;
        if (mirrored) return merged;
        return saveAccountCustomization(db,ctx,merged,profile)
          .then(function(){ return merged; }).catch(function(){ return merged; });
      });
    return settleWithTimeout(request,local,5000);
  }

  function saveProfileCustomization(value){
    var ctx = context();
    var next = cacheCustomization(value,ctx.profileId);
    var db = firebaseDatabase();
    if (!db || !ctx.uid) return syncPublicProfile(next).then(function(){ return {value:next,synced:false,reason:'account-unavailable'}; });
    var request = saveAccountCustomization(db,ctx,next).then(function(){
        return syncPublicProfile(next).then(function(){ return {value:next,synced:true}; });
      }).catch(function(error){
        return {value:next,synced:false,reason:error && error.message ? error.message : 'firebase-write-failed'};
      });
    return settleWithTimeout(request,{value:next,synced:false},6000);
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
    var profileBioRef = accountRef.child('profileCustomization/' + safeSegment(ctx.profileId) + '/bio');
    var request = profileBioRef.once('value').then(function(snapshot){
      if (snapshot.exists()) return cacheBio(snapshot.val());
      return accountRef.child('bio').once('value');
    }).then(function(value){
      if (value && typeof value.exists === 'function' && value.exists()) return cacheBio(value.val());
      if (typeof value === 'string') return value;
      if (!local) return '';
      var updates = {bio:local,bioUpdatedAt:firebase.database.ServerValue.TIMESTAMP};
      updates['profileCustomization/' + safeSegment(ctx.profileId) + '/bio'] = local;
      return accountRef.update(updates).then(function(){ return cacheBio(local); }).catch(function(){ return local; });
    });
    return settleWithTimeout(request,local,6000);
  }

  function saveBio(value){
    var bio = cacheBio(value);
    var ctx = context();
    var db = firebaseDatabase();
    if (!db || !ctx.uid) {
      return syncPublicProfile({bio:bio}).then(function(){ return {bio:bio,synced:false}; });
    }

    var updates = {bio:bio,bioUpdatedAt:firebase.database.ServerValue.TIMESTAMP};
    updates['profileCustomization/' + safeSegment(ctx.profileId) + '/bio'] = bio;
    updates['profileCustomization/' + safeSegment(ctx.profileId) + '/updatedAt'] = firebase.database.ServerValue.TIMESTAMP;
    var request = db.ref('users/' + safeSegment(ctx.uid)).update(updates).then(function(){
      return syncPublicProfile({bio:bio}).then(function(){ return {bio:bio,synced:true}; });
    }).catch(function(){
      return {bio:bio,synced:false};
    });
    return settleWithTimeout(request,{bio:bio,synced:false},6000);
  }

  function getAccount(){
    var ctx = context();
    var db = firebaseDatabase();
    var fallback = {session:ctx,user:{},profile:ctx};
    if (!db || !ctx.uid) return Promise.resolve(fallback);
    var request = db.ref('users/' + safeSegment(ctx.uid)).once('value').then(function(snapshot){
      var source = snapshot.val() || {};
      var user = {};
      Object.keys(source).forEach(function(key){
        if (!/^(?:password|passwordHash|senha|secret|token)$/i.test(key)) user[key] = source[key];
      });
      return {session:ctx,user:user,profile:ctx};
    });
    return settleWithTimeout(request,fallback,5000);
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
      if (type === 'instagram') return path ? '@' + path.split('/')[0] : 'Instagram RabbitHub';
      if (/^wa\.me$/i.test(parsed.hostname)) return '+' + path.replace(/\D/g,'');
    } catch(e){}
    return type === 'instagram' ? 'Instagram RabbitHub' : 'WhatsApp RabbitHub';
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
    getContext:context,
    getHistory:getHistory,
    saveHistory:saveHistory,
    refreshHistory:refreshHistory,
    clearHistory:clearHistory,
    getCachedBio:getCachedBio,
    getBio:getBio,
    saveBio:saveBio,
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

  function start(){
    refreshHistory();
    getProfileCustomization();
    syncPublicProfile();
  }
  document.addEventListener('rh:uidchange',function(){
    remoteWrites = {};
    refreshHistory();
    getProfileCustomization();
    syncPublicProfile();
  });
  document.addEventListener('dk:profilechange',function(){
    getProfileCustomization();
    syncPublicProfile();
  });
  document.addEventListener('dk:themechange',function(event){
    var theme = event && event.detail ? event.detail.key : '';
    saveProfileCustomization({theme:theme || 'blue'});
  });
  document.addEventListener('rh:planchange',function(event){
    var plan = event && event.detail ? event.detail.name : '';
    syncPublicProfile({plan:plan || context().plan});
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
