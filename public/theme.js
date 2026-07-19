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

  function apply(key){
    var t = THEMES[key] || THEMES.blue;
    currentKey = THEMES[key] ? key : 'blue';
    document.documentElement.setAttribute('data-theme', currentKey);
    document.documentElement.style.colorScheme = 'dark';
    applyVars(t);
    swapLogos(t);
    try {
      document.dispatchEvent(new CustomEvent('dk:themechange', { detail: { key: currentKey, theme: t } }));
    } catch(e){}
  }

  window.DK_THEMES = THEMES;
  function readTheme(){
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && THEMES[saved]) return saved;
      if (saved) localStorage.removeItem(STORAGE_KEY);
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
  window.DK_setTheme = function(key, restart){
    if (!THEMES[key]) key = 'blue';
    try { localStorage.setItem(STORAGE_KEY, key); } catch(e){}
    apply(key);
    if (restart === true) restartInterface(THEMES[key]);
  };
  // Força reaplicar logos (útil após injetar HTML dinamicamente)
  window.DK_refreshLogos = function(){
    swapLogos(THEMES[currentKey] || THEMES.blue);
  };

  // Aplica imediatamente
  apply(readTheme());

  // Reaplica ao DOM pronto (para <img data-dk-logo> renderizados depois do <head>)
  document.addEventListener('DOMContentLoaded', function(){ apply(readTheme()); });

  // Observa novas inserções no DOM e troca a logo automaticamente
  function startObserver(){
    if (!window.MutationObserver || !document.body) return;
    var mo = new MutationObserver(function(muts){
      var needs = false;
      for (var i=0;i<muts.length && !needs;i++){
        var m = muts[i];
        if (m.addedNodes && m.addedNodes.length) needs = true;
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
    try { mo.observe(document.body, { childList:true, subtree:true }); } catch(e){}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  // Sincroniza entre abas
  window.addEventListener('storage', function(e){
    if (e.key === STORAGE_KEY) apply(readTheme());
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
})();
