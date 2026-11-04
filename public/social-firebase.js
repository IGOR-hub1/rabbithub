/* X-Bunny Animes • dados sociais no Firebase principal autenticado. */
(function(){
  'use strict';

  var ROOT_PATH='rhSocialV1';
  var cachedDatabase=null;
  var lastError='';

  function primaryDatabase(){
    try{
      if(!window.firebase||!firebase.database||!window.DK_FIREBASE_CONFIG)return null;
      if(!firebase.apps||!firebase.apps.length)firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      window.__DK_FB_INIT__=true;
      return firebase.database();
    }catch(error){
      lastError=error&&error.message?String(error.message):'Firebase principal indisponível.';
      return null;
    }
  }
  function database(){
    if(cachedDatabase)return cachedDatabase;
    cachedDatabase=primaryDatabase();
    if(cachedDatabase)lastError='';
    return cachedDatabase;
  }
  function cleanPath(path){return String(path||'').replace(/^\/+|\/+$/g,'');}
  function ref(path){
    var db=database();
    if(!db)return null;
    var child=cleanPath(path);
    return db.ref(ROOT_PATH+(child?'/'+child:''));
  }
  function timestamp(){
    try{return firebase.database.ServerValue.TIMESTAMP;}
    catch(e){return Date.now();}
  }
  function status(){
    database();
    return {
      available:!!cachedDatabase,
      mode:'primary-authenticated',
      separateProject:false,
      root:ROOT_PATH,
      projectId:String((window.DK_FIREBASE_CONFIG||{}).projectId||''),
      error:lastError
    };
  }

  window.RabbitHubSocial={
    database:database,
    primaryDatabase:primaryDatabase,
    ref:ref,
    timestamp:timestamp,
    status:status,
    isConfigured:function(){return !!(window.DK_FIREBASE_CONFIG&&window.DK_FIREBASE_CONFIG.projectId);},
    configurationError:function(){return lastError;}
  };
})();
