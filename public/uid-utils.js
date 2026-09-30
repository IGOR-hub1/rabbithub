/* RabbitHub • UID numérico e compatibilidade com contas antigas. */
(function(){
  'use strict';

  var NUMERIC_UID_PATTERN = /^\d{6,20}$/;

  function text(value){ return String(value == null ? '' : value); }
  function normalizeEmail(value){ return text(value).trim().toLowerCase(); }
  function safeSegment(value){ return text(value || 'item').replace(/[.#$\[\]\/]/g,'_'); }

  function legacyUid(email){
    return normalizeEmail(email)
      .replace(/[^a-z0-9]/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,100);
  }

  function isNumericUid(value){ return NUMERIC_UID_PATTERN.test(text(value).trim()); }

  function generateNumericUid(){
    var stamp = text(Date.now());
    var entropy = text(Math.floor(Math.random() * 1000)).padStart(3,'0');
    return (stamp + entropy).slice(-16);
  }

  function clone(value){
    var result = {};
    Object.keys(value || {}).forEach(function(key){ result[key] = value[key]; });
    return result;
  }

  function accountFromValue(uid,value,ref){
    return {uid:text(uid),data:value || {},ref:ref};
  }

  function findInQueryValue(value,email){
    var wanted = normalizeEmail(email);
    var source = value || {};
    var keys = Object.keys(source);
    for (var i=0;i<keys.length;i++){
      var uid = keys[i];
      var data = source[uid] || {};
      if (normalizeEmail(data.email) === wanted) return accountFromValue(uid,data,null);
    }
    return null;
  }

  function findByEmail(db,email){
    var typed = text(email).trim();
    var legacy = legacyUid(typed);
    if (!db || !typed) return Promise.resolve(null);

    var legacyRef = db.ref('users/' + safeSegment(legacy));
    return legacyRef.once('value').then(function(snapshot){
      var value = snapshot.val();
      if (snapshot.exists() && (!value.email || normalizeEmail(value.email) === normalizeEmail(typed))) {
        return accountFromValue(legacy,value,legacyRef);
      }
      return db.ref('users').orderByChild('email').equalTo(typed).once('value');
    }).then(function(result){
      if (!result) return null;
      if (result.uid) return result;
      var found = findInQueryValue(result.val(),typed);
      if (found) {
        found.ref = db.ref('users/' + safeSegment(found.uid));
        return found;
      }
      if (typed !== normalizeEmail(typed)) {
        return db.ref('users').orderByChild('email').equalTo(normalizeEmail(typed)).once('value').then(function(snapshot){
          var normalized = findInQueryValue(snapshot.val(),typed);
          if (normalized) normalized.ref = db.ref('users/' + safeSegment(normalized.uid));
          return normalized;
        });
      }
      return null;
    });
  }

  function allocateNumericUid(db,attempt){
    attempt = attempt || 0;
    if (attempt > 8) return Promise.reject(new Error('Não foi possível gerar um UID numérico disponível.'));
    var uid = generateNumericUid();
    return db.ref('users/' + uid).once('value').then(function(snapshot){
      return snapshot.exists() ? allocateNumericUid(db,attempt + 1) : uid;
    });
  }

  function migrateUser(db,sourceUid,sourceData){
    var source = text(sourceUid).trim();
    var data = clone(sourceData || {});
    if (!db || !source || !sourceData) return Promise.resolve({uid:source,data:data});
    var sourceRef = db.ref('users/' + safeSegment(source));

    if (isNumericUid(source)) {
      if (text(data.uid) === source) return Promise.resolve({uid:source,data:data});
      data.uid = source;
      return sourceRef.update({uid:source}).then(function(){ return {uid:source,data:data}; });
    }

    return allocateNumericUid(db).then(function(numericUid){
      data.uid = numericUid;
      return db.ref('users/' + numericUid).set(data).then(function(){
        return sourceRef.remove();
      }).then(function(){
        return {uid:numericUid,data:data};
      });
    });
  }

  function publishSession(next,previousUid){
    try {
      localStorage.setItem('dk_session',JSON.stringify(next));
      document.dispatchEvent(new CustomEvent('rh:uidchange',{detail:{previousUid:previousUid || '',uid:next.uid}}));
    } catch(e){}
  }

  function migrateSession(db,session){
    var current = clone(session || {});
    var currentUid = text(current.uid).trim();
    if (!currentUid || isNumericUid(currentUid)) return Promise.resolve({session:current,data:null,migrated:false});

    var sourceRef = db && db.ref ? db.ref('users/' + safeSegment(currentUid)) : null;
    var lookup = sourceRef ? sourceRef.once('value').then(function(snapshot){
      if (snapshot.exists()) return accountFromValue(currentUid,snapshot.val(),sourceRef);
      return findByEmail(db,current.email);
    }) : Promise.resolve(null);

    return lookup.then(function(account){
      if (!account) return {session:current,data:null,migrated:false};
      if (isNumericUid(account.uid)) {
        var numericSession = Object.assign({},current,{uid:account.uid});
        if (account.data.email) numericSession.email = account.data.email;
        if (account.data.displayName !== undefined) numericSession.displayName = account.data.displayName || '';
        publishSession(numericSession,currentUid);
        return {session:numericSession,data:account.data,migrated:numericSession.uid !== currentUid};
      }
      return migrateUser(db,account.uid,account.data).then(function(result){
        var next = Object.assign({},current,{uid:result.uid});
        if (result.data.email) next.email = result.data.email;
        if (result.data.displayName !== undefined) next.displayName = result.data.displayName || '';
        publishSession(next,currentUid);
        return {session:next,data:result.data,migrated:true};
      });
    });
  }

  window.RabbitHubUid = {
    legacyUid:legacyUid,
    isNumericUid:isNumericUid,
    safeSegment:safeSegment,
    create:function(db){ return allocateNumericUid(db); },
    findByEmail:findByEmail,
    migrateUser:migrateUser,
    migrateSession:migrateSession
  };
})();
