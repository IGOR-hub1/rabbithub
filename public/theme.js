/* =====================================================================
 * DRAKSYON • Sistema de tema (cor principal)
 * ---------------------------------------------------------------------
 * - Mantém o tema escuro e permite trocar apenas a cor de destaque.
 * - Salva a escolha em localStorage ("dk_theme_color").
 * - Aplica imediatamente e pode reiniciar a interface quando solicitado.
 * - Troca a logo em TODOS os locais marcados com data-dk-logo, mesmo
 *   os inseridos dinamicamente (via MutationObserver).
 * ===================================================================== */
(function(){
  /* A tela de inicializacao nasce no primeiro script do <head>. Assim o
     navegador nunca pinta a interface padrao antes de descobrir o tema. */
  var bootStartedAt = Date.now();
  var bootFinished = false;
  var root = document.documentElement;
  root.classList.add('rh-app-booting');
  try {
    var bootStyle = document.createElement('style');
    bootStyle.id = 'rh-app-boot-style';
    bootStyle.textContent =
      'html.rh-app-booting body{visibility:hidden!important}' +
      'html.rh-app-booting::before{content:"";position:fixed;inset:0;z-index:2147483646;background:#0d0d0f}' +
      'html.rh-app-booting::after{content:"";position:fixed;z-index:2147483647;left:50%;top:50%;width:34px;height:34px;margin:-19px 0 0 -19px;border:3px solid rgba(255,255,255,.12);border-top-color:var(--brand,#254BFF);border-radius:50%;box-shadow:0 0 24px rgba(var(--brand-rgb,37,75,255),.18);animation:rhAppBootSpin .72s linear infinite}' +
      '@keyframes rhAppBootSpin{to{transform:rotate(360deg)}}' +
      '@media(prefers-reduced-motion:reduce){html.rh-app-booting::after{animation-duration:1.4s}}';
    (document.head || root).appendChild(bootStyle);
  } catch(e){}

  function finishAppBoot(){
    if (bootFinished) return;
    var elapsed = Date.now() - bootStartedAt;
    if (elapsed < 120) {
      window.setTimeout(finishAppBoot,120-elapsed);
      return;
    }
    bootFinished = true;
    root.classList.remove('rh-app-booting');
    root.setAttribute('data-rh-boot','ready');
  }
  function scheduleAppBootFinish(){
    window.requestAnimationFrame(function(){ window.requestAnimationFrame(finishAppBoot); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',scheduleAppBootFinish,{once:true});
  else scheduleAppBootFinish();
  window.addEventListener('pageshow',finishAppBoot,{once:true});
  window.setTimeout(finishAppBoot,3200);
  window.RabbitHubBoot = { finish:finishAppBoot };
  /*
   * O layout do drawer precisa ser conhecido antes do primeiro paint. Deixar
   * essa marcação para um script defer fazia o botão mobile aparecer por um
   * instante no desktop e a barra lateral surgir somente depois.
   */
  try {
    document.documentElement.setAttribute(
      'data-rh-drawer-mode',
      localStorage.getItem('rh_drawer_mode') === 'overlay' ? 'overlay' : 'fixed'
    );
  } catch(e) {
    document.documentElement.setAttribute('data-rh-drawer-mode','fixed');
  }

  var THEMES = {
    blue:   { name:'Azul',    brand:'#254BFF', brand2:'#3A56F6', light:'#5B7FFF', rgb:'37,75,255',  logo:'img/logo-blue.jpg'   },
    purple: { name:'Roxo',    brand:'#7C3AED', brand2:'#8B5CF6', light:'#A78BFA', rgb:'124,58,237', logo:'img/logo-purple.jpg' },
    red:    { name:'Vermelho',brand:'#DC2626', brand2:'#EF4444', light:'#F87171', rgb:'220,38,38',  logo:'img/logo-red.jpg'    },
    green:  { name:'Verde',   brand:'#16A34A', brand2:'#22C55E', light:'#4ADE80', rgb:'22,163,74',  logo:'img/logo-green.jpg'  },
    orange: { name:'Laranja', brand:'#EA580C', brand2:'#F97316', light:'#FB923C', rgb:'234,88,12',  logo:'img/logo-orange.jpg' },
    pink:   { name:'Rosa',    brand:'#DB2777', brand2:'#EC4899', light:'#F472B6', rgb:'219,39,119', logo:'img/logo-pink.jpg'   },
    cyan:   { name:'Ciano',   brand:'#0891B2', brand2:'#06B6D4', light:'#22D3EE', rgb:'8,145,178',  logo:'img/logo-cyan.jpg'   },
    yellow: { name:'Amarelo', brand:'#CA8A04', brand2:'#EAB308', light:'#FACC15', rgb:'202,138,4',  logo:'img/logo-yellow.jpg' }
  };

  var currentKey = 'blue';
  var STORAGE_KEY = 'dk_theme_color';

  function userThemeStorageKey(){
    try {
      var session = JSON.parse(localStorage.getItem('dk_session') || 'null');
      var uid = session && String(session.uid || '').replace(/[^a-z0-9_-]/gi,'_').slice(0,100);
      if (uid) return STORAGE_KEY + '_' + uid;
    } catch(e){}
    return STORAGE_KEY;
  }

  function readJSONStorage(key){
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch(e){ return null; }
  }

  function safeThemeSegment(value, fallback){
    var normalized = String(value || fallback || '').replace(/[^a-z0-9_-]/gi,'_').slice(0,100);
    return normalized || String(fallback || '');
  }

  function cachedThemeAccess(){
    try {
      var session = readJSONStorage('dk_session') || {};
      var uid = String(session.uid || '');
      var cached = readJSONStorage('rh_plan_access_v1');
      if (cached && cached.ready === true && String(cached.uid || '') === uid) {
        return cached.customTheme === true || cached.isVip === true || String(cached.key || '').toLowerCase() === 'vip';
      }
      var plan = String(session.plan || session.currentPlan || '').toLowerCase();
      if (session.premium === true || session.vip === true || /vip|pro|premium/.test(plan)) return true;
      if (uid && plan) return false;
    } catch(e){}
    return null;
  }

  function activeProfileTheme(){
    try {
      var session = readJSONStorage('dk_session') || {};
      var profile = readJSONStorage('dk_active_profile') || {};
      var uid = safeThemeSegment(session.uid,'');
      var profileId = safeThemeSegment(profile.id,'principal');
      var visual = uid ? readJSONStorage('rh_profile_visual_v1_' + uid + '_' + profileId) : null;
      var selected = visual && visual.theme ? visual.theme : profile.theme;
      return THEMES[selected] ? selected : '';
    } catch(e){ return ''; }
  }

  function rememberActiveProfileTheme(theme){
    try {
      var session = readJSONStorage('dk_session') || {};
      var profile = readJSONStorage('dk_active_profile') || {};
      var uid = safeThemeSegment(session.uid,'');
      if (!uid || !THEMES[theme]) return;
      var profileId = safeThemeSegment(profile.id,'principal');
      profile.theme = theme;
      localStorage.setItem('dk_active_profile',JSON.stringify(profile));
      var key = 'rh_profile_visual_v1_' + uid + '_' + profileId;
      var visual = readJSONStorage(key) || {};
      visual.theme = theme;
      if (!visual.banner) visual.banner = profile.banner || 'default';
      visual.updatedAt = Date.now();
      localStorage.setItem(key,JSON.stringify(visual));
    } catch(e){}
  }

  function applyVars(t){
    var r = document.documentElement.style;
    r.setProperty('--brand', t.brand);
    r.setProperty('--brand-2', t.brand2);
    r.setProperty('--brand-light', t.light);
    r.setProperty('--brand-soft',   'rgba(' + t.rgb + ',0.12)');
    r.setProperty('--brand-soft-2', 'rgba(' + t.rgb + ',0.20)');
    r.setProperty('--brand-glow',   'rgba(' + t.rgb + ',0.35)');
    r.setProperty('--brand-rgb', t.rgb);
    r.setProperty('--grad-brand',      'linear-gradient(90deg,' + t.brand + ',' + t.brand2 + ')');
    r.setProperty('--grad-brand-135',  'linear-gradient(135deg,'+ t.brand + ',' + t.brand2 + ')');
    r.setProperty('--grad-brand-anim', 'linear-gradient(90deg,' + t.brand + ',' + t.brand2 + ',' + t.light + ',' + t.brand2 + ',' + t.brand + ')');
    r.setProperty('--shadow-brand',        '0 8px 24px rgba(' + t.rgb + ',0.35)');
    r.setProperty('--shadow-brand-strong', '0 12px 32px rgba(' + t.rgb + ',0.55)');
    r.setProperty('--dk-logo-url', 'url("' + t.logo + '")');
    r.setProperty('--theme-accent', t.brand);
    r.setProperty('--theme-accent-hover', t.brand2);
    r.setProperty('--theme-accent-rgb', t.rgb);
  }

  function swapLogos(t){
    try {
      // <img data-dk-logo>
      var imgs = document.querySelectorAll('img[data-dk-logo]');
      for (var i=0;i<imgs.length;i++){
        (function(img){
          var loadedForTheme = img.getAttribute('data-dk-theme') === currentKey &&
            img.complete && img.naturalWidth > 0;
          img.onerror = function(){
            if (img.getAttribute('data-dk-logo-retry') === currentKey) return;
            img.setAttribute('data-dk-logo-retry',currentKey);
            var separator = t.logo.indexOf('?') === -1 ? '?' : '&';
            window.setTimeout(function(){
              img.src = t.logo + separator + 'rh_logo_retry=' + Date.now();
            },80);
          };
          img.onload = function(){
            img.setAttribute('data-dk-theme',currentKey);
            img.classList.add('dk-logo-loaded');
          };
          if (!loadedForTheme) {
            img.setAttribute('data-dk-theme',currentKey);
            img.removeAttribute('data-dk-logo-retry');
            if (img.getAttribute('src') !== t.logo || (img.complete && img.naturalWidth === 0)) {
              img.setAttribute('src',t.logo);
            }
            if (img.complete && img.naturalWidth === 0 && typeof img.onerror === 'function') img.onerror();
          }
        })(imgs[i]);
      }
      // Elementos que usam background-image via data-dk-logo-bg
      var bgs = document.querySelectorAll('[data-dk-logo-bg]');
      for (var j=0;j<bgs.length;j++){
        bgs[j].style.backgroundImage = 'url("' + t.logo + '")';
      }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (!meta && document.head) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
      }
      if (meta) meta.content = t.brand;
    } catch(e){}
  }

  function apply(key,change){
    change = change || {};
    var t = THEMES[key] || THEMES.blue;
    currentKey = THEMES[key] ? key : 'blue';
    document.documentElement.setAttribute('data-theme', currentKey);
    document.documentElement.style.colorScheme = 'dark';
    applyVars(t);
    try {
      if (document.head && !document.querySelector('link[data-rh-theme-logo="' + currentKey + '"]')) {
        var preload = document.createElement('link');
        preload.rel = 'preload';
        preload.as = 'image';
        preload.href = t.logo;
        preload.setAttribute('data-rh-theme-logo',currentKey);
        document.head.appendChild(preload);
      }
    } catch(e){}
    swapLogos(t);
    try {
      document.dispatchEvent(new CustomEvent('dk:themechange', { detail: {
        key: currentKey,
        theme: t,
        persist: change.persist === true,
        system: change.system === true
      } }));
    } catch(e){}
  }

  window.DK_THEMES = THEMES;
  function readTheme(){
    try {
      var liveAccess = window.RabbitHubPlans && window.RabbitHubPlans.get ? window.RabbitHubPlans.get() : null;
      var cachedAccess = cachedThemeAccess();
      if ((liveAccess && liveAccess.ready === true && liveAccess.customTheme !== true) || cachedAccess === false) {
        return 'blue';
      }
      var profileTheme = activeProfileTheme();
      if (profileTheme) return profileTheme;
      var key = userThemeStorageKey();
      var saved = localStorage.getItem(key);
      /* Compatibilidade com a preferência das versões anteriores. */
      if (!saved && key !== STORAGE_KEY) saved = localStorage.getItem(STORAGE_KEY);
      if (saved && THEMES[saved]) return saved;
      if (saved && key === STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
      if (saved && key !== STORAGE_KEY) localStorage.removeItem(key);
    } catch(e){}
    return 'blue';
  }
  window.DK_getTheme = readTheme;
  window.DK_getLogoUrl = function(key){
    var t = THEMES[key || window.DK_getTheme()] || THEMES.blue;
    return t.logo;
  };
  function restartInterface(t){
    function performRestart(){
      try {
        if (window.RabbitHubApp && typeof window.RabbitHubApp.reloadApp === 'function') {
          window.RabbitHubApp.reloadApp();
          return;
        }
      } catch(e){}
      try {
        var next = new URL(window.location.href);
        next.searchParams.set('theme_applied',Date.now().toString());
        window.location.replace(next.href);
      } catch(e) {
        window.location.reload();
      }
    }
    if (!document.body) {
      performRestart();
      return;
    }
    var overlay = document.createElement('div');
    overlay.className = 'theme-restart-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML =
      '<div class="theme-restart-card">' +
        '<img class="theme-restart-logo" src="' + t.logo + '" alt="">' +
        '<strong>Aplicando seu novo tema</strong>' +
        '<span>A interface será reiniciada automaticamente.</span>' +
        '<div class="theme-restart-loader"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    window.setTimeout(performRestart,700);
  }
  window.DK_setTheme = function(key, restart, options){
    options = options || {};
    if (!THEMES[key]) key = 'blue';
    var access = window.RabbitHubPlans && window.RabbitHubPlans.get ? window.RabbitHubPlans.get() : null;
    if (!options.system && key !== 'blue' && access && access.ready === true && access.customTheme !== true) {
      try {
        document.dispatchEvent(new CustomEvent('rh:planlocked',{
          detail:{feature:'customTheme',requiredPlan:'VIP'}
        }));
      } catch(e){}
      return false;
    }
    if (!options.system) {
      try { localStorage.setItem(userThemeStorageKey(), key); } catch(e){}
      rememberActiveProfileTheme(key);
    }
    apply(key,{persist:!options.system,system:options.system === true});
    if (restart === true) restartInterface(THEMES[key]);
    return true;
  };
  // Força reaplicar logos (útil após injetar HTML dinamicamente)
  window.DK_refreshLogos = function(){
    swapLogos(THEMES[currentKey] || THEMES.blue);
  };

  // Aplica imediatamente
  apply(readTheme());

  // Reaplica ao DOM pronto (para <img data-dk-logo> renderizados depois do <head>)
  document.addEventListener('DOMContentLoaded', function(){ apply(readTheme()); });

  // Observa novas inserções no DOM e troca a logo automaticamente.
  // O observer começa ainda no <head>, para a logo correta ser aplicada no
  // mesmo ciclo em que o parser cria a imagem e nunca piscar na cor azul.
  function startObserver(){
    if (!window.MutationObserver || !document.documentElement) return;
    var mo = new MutationObserver(function(muts){
      var needs = false;
      for (var i=0;i<muts.length && !needs;i++){
        var m = muts[i];
        for (var j=0;m.addedNodes && j<m.addedNodes.length;j++){
          var node = m.addedNodes[j];
          if (node.nodeType !== 1) continue;
          if ((node.matches && node.matches('img[data-dk-logo],[data-dk-logo-bg]')) ||
              (node.querySelector && node.querySelector('img[data-dk-logo],[data-dk-logo-bg]'))) {
            needs = true;
            break;
          }
        }
      }
      if (needs) {
        var selected = readTheme();
        if (selected !== currentKey) apply(selected);
        else {
          applyVars(THEMES[currentKey] || THEMES.blue);
          swapLogos(THEMES[currentKey] || THEMES.blue);
        }
      }
    });
    try { mo.observe(document.documentElement, { childList:true, subtree:true }); } catch(e){}
  }
  startObserver();

  // Sincroniza entre abas
  window.addEventListener('storage', function(e){
    if (e.key === STORAGE_KEY || e.key === userThemeStorageKey() || e.key === 'dk_session' || e.key === 'dk_active_profile' || e.key === 'rh_plan_access_v1' || /^rh_profile_visual_v1_/.test(String(e.key || ''))) apply(readTheme());
  });

  /* Verificador central: páginas restauradas do cache e scripts carregados
     depois não podem devolver apenas alguns componentes à cor padrão. */
  function verifyTheme(){
    var selected = readTheme();
    var expected = THEMES[selected] || THEMES.blue;
    var styles = getComputedStyle(document.documentElement);
    var applied = styles.getPropertyValue('--brand').trim().toLowerCase();
    var marker = document.documentElement.getAttribute('data-theme');
    if (applied !== expected.brand.toLowerCase() || marker !== selected || currentKey !== selected) {
      apply(selected);
    } else {
      swapLogos(expected);
    }
  }
  window.DK_verifyTheme = verifyTheme;
  window.addEventListener('pageshow', verifyTheme);
  window.addEventListener('focus', verifyTheme);
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) verifyTheme();
  });
  document.addEventListener('rh:planchange', verifyTheme);
  document.addEventListener('rh:uidchange', function(){ apply(readTheme()); });
  document.addEventListener('dk:profilechange', function(){ apply(readTheme()); });
  document.addEventListener('rh:profilecustomization', function(){ apply(readTheme()); });
})();
