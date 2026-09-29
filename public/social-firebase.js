/* RabbitHub • conexão isolada para a camada social. */
(function(){
  'use strict';

  var APP_NAME = 'rabbithub-social';
  var ROOT_PATH = 'rhSocialV1';
  var cachedDatabase = null;
  var currentMode = 'unavailable';
  var lastError = '';

  function configurationError(config){
    config = config || {};
    var required = ['apiKey','databaseURL','projectId','appId'];
    for (var i=0;i<required.length;i++) {
      if (!String(config[required[i]] || '').trim()) {
        return 'Preencha ' + required[i] + ' em social-firebase-config.js.';
      }
    }
    var projectId = String(config.projectId || '').trim();
    var expected = String(window.DK_SOCIAL_FIREBASE_PROJECT_ID || '').trim();
    if (expected && projectId !== expected) {
      return 'O Firebase social deve usar o projeto ' + expected + '.';
    }
    var primaryId = String((window.DK_FIREBASE_CONFIG || {}).projectId || '').trim();
    if (primaryId && projectId === primaryId) {
      return 'O Firebase social não pode ser o mesmo projeto do site principal.';
    }
    try {
      var databaseUrl = new URL(String(config.databaseURL));
      if (databaseUrl.protocol !== 'https:') return 'databaseURL precisa usar HTTPS.';
      var databaseHost = databaseUrl.hostname.toLowerCase();
      if (!/\.(firebaseio\.com|firebasedatabase\.app)$/.test(databaseHost)) {
        return 'databaseURL não é uma URL válida do Realtime Database.';
      }
    } catch(e) {
      return 'databaseURL não é uma URL válida.';
    }
    return '';
  }

  function configured(config){
    return !configurationError(config);
  }

  function namedApp(){
    if (!window.firebase || !firebase.initializeApp) return null;
    var config = window.DK_SOCIAL_FIREBASE_CONFIG || {};
    lastError = configurationError(config);
    if (lastError) return null;
    try {
      for (var i=0;i<(firebase.apps || []).length;i++) {
        if (firebase.apps[i] && firebase.apps[i].name === APP_NAME) return firebase.apps[i];
      }
      return firebase.initializeApp(config,APP_NAME);
    } catch(e) {
      try { return firebase.app(APP_NAME); }
      catch(ignore) {
        lastError = e && e.message ? String(e.message) : 'Falha ao iniciar o Firebase social.';
        return null;
      }
    }
  }

  function primaryDatabase(){
    try {
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      window.__DK_FB_INIT__ = true;
      return firebase.database();
    } catch(e) { return null; }
  }

  function database(){
    if (cachedDatabase) return cachedDatabase;
    try {
      var app = namedApp();
      if (app && typeof app.database === 'function') {
        cachedDatabase = app.database();
        currentMode = 'secondary';
        lastError = '';
        return cachedDatabase;
      }
    } catch(e) {}
    if (window.DK_SOCIAL_TEST_FALLBACK !== false) {
      cachedDatabase = primaryDatabase();
      if (cachedDatabase) {
        currentMode = 'primary-test';
        lastError = '';
      }
    }
    if (!cachedDatabase && !lastError) {
      lastError = 'Firebase social indisponível.';
    }
    return cachedDatabase;
  }

  function cleanPath(path){
    return String(path || '').replace(/^\/+|\/+$/g,'');
  }

  function ref(path){
    var db = database();
    if (!db) return null;
    return db.ref(ROOT_PATH + (cleanPath(path) ? '/' + cleanPath(path) : ''));
  }

  function timestamp(){
    try { return firebase.database.ServerValue.TIMESTAMP; }
    catch(e) { return Date.now(); }
  }

  function status(){
    database();
    return {
      available:!!cachedDatabase,
      mode:currentMode,
      separateProject:currentMode === 'secondary',
      root:ROOT_PATH,
      projectId:String((window.DK_SOCIAL_FIREBASE_CONFIG || {}).projectId || ''),
      error:lastError
    };
  }

  window.RabbitHubSocial = {
    database:database,
    primaryDatabase:primaryDatabase,
    ref:ref,
    timestamp:timestamp,
    status:status,
    isConfigured:function(){ return configured(window.DK_SOCIAL_FIREBASE_CONFIG); },
    configurationError:function(){ return configurationError(window.DK_SOCIAL_FIREBASE_CONFIG); }
  };
})();
