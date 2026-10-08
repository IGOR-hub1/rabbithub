/* RabbitHub Animes • melhorias de navegação e acabamento compartilhado. */
(function(){
  'use strict';

  var DRAWER_MODE_KEY='rh_drawer_mode';
  var viewportFrame=0;

  function storedValue(key){
    try { return localStorage.getItem(key); }
    catch(e){ return null; }
  }

  function drawerMode(){
    return storedValue(DRAWER_MODE_KEY)==='overlay'?'overlay':'fixed';
  }

  function desktopViewport(){
    return !!(window.matchMedia&&window.matchMedia('(min-width: 1100px)').matches);
  }

  function fixedDrawer(){
    return desktopViewport()&&drawerMode()==='fixed';
  }

  /*
   * Usa a área realmente visível, não apenas 100vh. No Android isso muda
   * quando a barra do navegador, o teclado ou a rotação alteram o WebView.
   * A largura continua em CSS pixels: o próprio Chromium converte a densidade
   * física do aparelho, evitando layouts diferentes só porque o DPI é maior.
   */
  function syncViewportProfile(){
    var root=document.documentElement;
    var visual=window.visualViewport;
    var width=Math.round((visual&&visual.width)||root.clientWidth||window.innerWidth||0);
    var height=Math.round((visual&&visual.height)||root.clientHeight||window.innerHeight||0);
    var layoutHeight=Math.round(window.innerHeight||root.clientHeight||height);
    var offsetTop=Math.round((visual&&visual.offsetTop)||0);
    var keyboardInset=Math.max(0,layoutHeight-height-offsetTop);
    var dpr=Math.max(1,Number(window.devicePixelRatio)||1);

    if(width>0) root.style.setProperty('--rh-viewport-width',width+'px');
    if(height>0){
      root.style.setProperty('--rh-viewport-height',height+'px');
      root.style.setProperty('--rh-hero-height',Math.round(height*.58)+'px');
    }
    root.style.setProperty('--rh-keyboard-inset',keyboardInset+'px');
    root.setAttribute('data-rh-size',width<=360?'compact':width<=760?'phone':width<1100?'tablet':'desktop');
    root.setAttribute('data-rh-density',dpr>=3?'high':dpr>=2?'medium':'standard');
    root.setAttribute('data-rh-native',window.__RABBITHUB_WEBVIEW__?'true':'false');
    root.setAttribute('data-rh-server',window.__RABBITHUB_PROXY_BASE__?'embedded':'web');
  }

  function scheduleViewportProfile(){
    if(viewportFrame) return;
    viewportFrame=window.requestAnimationFrame(function(){
      viewportFrame=0;
      syncViewportProfile();
    });
  }

  function syncPerformanceProfile(){
    var connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection||{};
    var compact=!!(window.matchMedia&&window.matchMedia('(max-width: 760px), (pointer: coarse)').matches);
    var reduced=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var lowMemory=Number(navigator.deviceMemory||0)>0&&Number(navigator.deviceMemory)<=4;
    var fewCores=Number(navigator.hardwareConcurrency||0)>0&&Number(navigator.hardwareConcurrency)<=4;
    var lite=!!(connection.saveData||reduced||compact||lowMemory||fewCores);
    document.documentElement.setAttribute('data-rh-performance',lite?'lite':'full');
  }

  document.documentElement.setAttribute('data-rh-drawer-mode',drawerMode());
  syncViewportProfile();
  syncPerformanceProfile();

  function pageName(){
    var file=(location.pathname.split('/').pop()||'index.html').toLowerCase();
    if(file==='index.html'||file==='') return 'home';
    if(file==='detalhes.html') return 'details';
    if(file==='player-animes.html') return 'player';
    if(file==='chat.html') return 'chat';
    if(file==='login.html') return 'login';
    if(file==='perfis.html') return 'profiles';
    if(file==='admin.html') return 'admin';
    return 'other';
  }

  function setPageIdentity(){
    var page=pageName();
    document.body.setAttribute('data-page',page);
    document.documentElement.setAttribute('data-app','rabbithub');
  }

  function syncMotionPreferences(){
    var transitions=localStorage.getItem('rh_transitions') !== '0';
    var reducedMotion=localStorage.getItem('rh_reduce_motion') === '1';
    document.documentElement.setAttribute('data-rh-transitions',transitions?'on':'off');
    document.documentElement.setAttribute('data-rh-reduced-motion',reducedMotion?'on':'off');
  }

  var navigationPrefetched=Object.create(null);
  function navigationTarget(node){
    var anchor=node&&node.closest?node.closest('a[href]'):null;
    if(!anchor||anchor.hasAttribute('download')||anchor.target==='_blank'||anchor.getAttribute('rel')==='external')return null;
    var raw=String(anchor.getAttribute('href')||'').trim();
    if(!raw||raw.charAt(0)==='#'||/^(?:javascript|mailto|tel|intent):/i.test(raw))return null;
    try{
      var url=new URL(raw,location.href);
      if(url.origin!==location.origin||!/^https?:$/.test(url.protocol))return null;
      var path=String(url.pathname||'/'),last=path.split('/').pop();
      if(!(/\/$/.test(path)||/\.html$/i.test(path)||last.indexOf('.')===-1))return null;
      return {anchor:anchor,url:url};
    }catch(e){return null;}
  }

  function prefetchNavigation(target){
    if(!target||navigationPrefetched[target.url.href])return;
    navigationPrefetched[target.url.href]=true;
    try{
      if(window.RabbitHubApp&&typeof window.RabbitHubApp.prefetchPage==='function'){
        window.RabbitHubApp.prefetchPage(target.url.href);
        return;
      }
    }catch(e){}
    var connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection||{};
    if(connection.saveData)return;
    var link=document.createElement('link');
    link.rel='prefetch';link.as='document';link.href=target.url.href;
    document.head.appendChild(link);
  }

  function prefetchLikelyNativePage(){
    if(!(window.RabbitHubApp&&typeof window.RabbitHubApp.prefetchPage==='function'))return;
    var name=pageName();
    var path=name==='home'?'detalhes.html':name==='details'?'player-animes.html':'index.html';
    try{prefetchNavigation({url:new URL(path,location.href)});}catch(e){}
  }

  function initFastNavigation(){
    document.addEventListener('pointerover',function(event){
      var target=navigationTarget(event.target);if(target)prefetchNavigation(target);
    },{passive:true});
    document.addEventListener('focusin',function(event){
      var target=navigationTarget(event.target);if(target)prefetchNavigation(target);
    });
    document.addEventListener('touchstart',function(event){
      var target=navigationTarget(event.target);
      if(target){target.anchor.setAttribute('data-rh-nav-pressed','');prefetchNavigation(target);}
    },{passive:true});
    document.addEventListener('pointerdown',function(event){
      var target=navigationTarget(event.target);if(target)target.anchor.setAttribute('data-rh-nav-pressed','');
    },{passive:true});
    ['pointerup','pointercancel','touchend'].forEach(function(name){
      document.addEventListener(name,function(){
        document.querySelectorAll('[data-rh-nav-pressed]').forEach(function(node){node.removeAttribute('data-rh-nav-pressed');});
      },{passive:true});
    });
    document.addEventListener('click',function(event){
      if(event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      if(navigationTarget(event.target))document.documentElement.classList.add('rh-navigating');
    },true);
    window.addEventListener('pageshow',function(){document.documentElement.classList.remove('rh-navigating');});
    if('requestIdleCallback'in window)window.requestIdleCallback(prefetchLikelyNativePage,{timeout:1400});
    else window.setTimeout(prefetchLikelyNativePage,650);
  }

  function polishImages(root){
    root=root||document;
    var images=[];
    if(root.matches&&root.matches('img:not([data-rh-image])')) images.push(root);
    if(root.querySelectorAll) images=images.concat(Array.prototype.slice.call(root.querySelectorAll('img:not([data-rh-image])')));
    images.forEach(function(img){
      img.setAttribute('data-rh-image','');
      img.decoding='async';
      img.draggable=false;
      function markReady(){ img.classList.add('rh-loaded'); }
      if(img.hasAttribute('data-dk-logo')){
        markReady();
        img.loading='eager';
        img.fetchPriority='high';
      } else if(!img.getAttribute('loading')&&!img.closest('.hero-section,.hero-area')) img.loading='lazy';
      if(img.closest('.hero-section,.hero-area')) img.fetchPriority='high';
      img.addEventListener('load',markReady,{once:true});
      /* Imagens criadas com src já definido podem terminar antes de o
         MutationObserver registrar o listener. Sem esta checagem elas
         permaneciam quase transparentes e as capas pareciam pretas. */
      if(img.complete && img.naturalWidth > 0) markReady();
    });
  }

  function normalizeBrand(){
    var selectors=['.drawer-brand-title','.header-title','.title','.head-title','.brand-name'];
    selectors.forEach(function(selector){
      document.querySelectorAll(selector).forEach(function(el){
        var text=(el.textContent||'').trim();
        if(/^DRAKSYON$/i.test(text)) el.textContent='RABBITHUB ANIMES';
        else if(/Painel Admin\s*[—-]\s*DRAKSYON/i.test(text)) el.textContent='Painel Admin — RABBITHUB';
      });
    });
  }

  function normalizeControls(root){
    root=root||document;
    var buttons=Array.prototype.slice.call(root.querySelectorAll('button:not([type])'));
    if(root.matches&&root.matches('button:not([type])')) buttons.unshift(root);
    buttons.forEach(function(button){
      button.type='button';
    });
    var switches=Array.prototype.slice.call(root.querySelectorAll('[role="switch"]:not([data-rh-keyboard])'));
    if(root.matches&&root.matches('[role="switch"]:not([data-rh-keyboard])')) switches.unshift(root);
    switches.forEach(function(control){
      control.setAttribute('data-rh-keyboard','');
      if(!control.hasAttribute('tabindex')) control.tabIndex=0;
      control.addEventListener('keydown',function(event){
        if(event.key!=='Enter'&&event.key!==' ') return;
        event.preventDefault();
        control.click();
      });
    });
  }

  function readJSON(key){
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch(e){ return null; }
  }

  function safeImageUrl(value){
    value=String(value||'').trim();
    if(!value) return '';
    try {
      var url=new URL(value,location.href);
      if(url.protocol==='https:'||url.protocol==='http:'||url.protocol==='data:'){
        if(url.protocol!=='data:'||/^data:image\//i.test(value)) return url.href;
      }
    } catch(e){}
    return '';
  }

  function accountIdentity(){
    var session=readJSON('dk_session')||{};
    var profile=readJSON('dk_active_profile')||{};
    var live=window.DK_USER||{};
    var access=window.RabbitHubPlans&&window.RabbitHubPlans.get?window.RabbitHubPlans.get():null;
    var storedPlan=readJSON('dk_current_plan');
    if(!storedPlan) storedPlan=localStorage.getItem('dk_current_plan')||localStorage.getItem('dk_plan')||'';
    var name=live.displayName||session.displayName||'';
    if(!name&&session.email) name=String(session.email).split('@')[0];
    if(!name) name=profile.name||'Usuário';
    var plan=(access&&access.ready?access.name:'')||live.plan||session.plan||
      (typeof storedPlan==='object'&&storedPlan ? (storedPlan.name||storedPlan.label) : storedPlan)||
      profile.plan||'Free';
    return {
      name:String(name),
      plan:String(plan),
      avatar:safeImageUrl(profile.avatar||session.avatar||live.avatar||''),
      initial:String(name).trim().charAt(0).toUpperCase()||'U'
    };
  }

  function syncAccountIdentity(){
    var identity=accountIdentity();
    document.querySelectorAll('.drawer-user-name').forEach(function(el){el.textContent=identity.name;});
    document.querySelectorAll('.drawer-user-role').forEach(function(el){el.textContent=identity.plan;});
    document.querySelectorAll('.drawer-avatar').forEach(function(el){
      el.textContent='';
      el.style.backgroundImage=identity.avatar?'url("'+identity.avatar.replace(/"/g,'%22')+'")':'none';
      el.classList.toggle('has-image',!!identity.avatar);
      if(!identity.avatar){
        var initial=document.createElement('span');
        initial.className='drawer-avatar-initial';
        initial.textContent=identity.initial;
        el.appendChild(initial);
      }
      el.setAttribute('aria-label','Foto de '+identity.name);
    });
    window.RabbitHubAccount={
      getIdentity:accountIdentity,
      refresh:syncAccountIdentity
    };
  }

  function syncShellLayout(){
    var desktop=desktopViewport();
    var fixed=desktop&&drawerMode()==='fixed';
    document.documentElement.setAttribute('data-rh-drawer-mode',drawerMode());
    document.body.classList.toggle('rh-desktop-shell',fixed);
    document.querySelectorAll('.drawer').forEach(function(drawer){
      if(fixed){
        drawer.classList.remove('open');
        if(drawer.getAttribute('aria-hidden')!=='false') drawer.setAttribute('aria-hidden','false');
      }else{
        var isOpen=drawer.classList.contains('open');
        var next=isOpen?'false':'true';
        if(drawer.getAttribute('aria-hidden')!==next) drawer.setAttribute('aria-hidden',next);
      }
    });
    document.querySelectorAll('.drawer-overlay').forEach(function(overlay){
      if(fixed){
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden','true');
      }else{
        overlay.setAttribute('aria-hidden',overlay.classList.contains('open')?'false':'true');
      }
    });
    document.querySelectorAll('#open-drawer,#menu-btn').forEach(function(button){
      button.setAttribute('aria-expanded',fixed?'true':String(!!document.querySelector('.drawer.open')));
    });
    if(!fixed&&!document.querySelector('.drawer.open')) document.documentElement.classList.remove('rh-scroll-lock');
  }

  function setDrawerMode(mode){
    var normalized=mode==='overlay'?'overlay':'fixed';
    try { localStorage.setItem(DRAWER_MODE_KEY,normalized); } catch(e){}
    document.documentElement.setAttribute('data-rh-drawer-mode',normalized);
    syncShellLayout();
    document.dispatchEvent(new CustomEvent('rh:drawermodechange',{detail:{mode:normalized,fixed:normalized==='fixed'}}));
    return normalized;
  }

  window.RabbitHubDrawer={
    getMode:drawerMode,
    setMode:setDrawerMode,
    isFixed:fixedDrawer,
    sync:syncShellLayout
  };

  function init(){
    setPageIdentity();
    syncViewportProfile();
    syncMotionPreferences();
    normalizeBrand();
    normalizeControls();
    syncAccountIdentity();
    syncShellLayout();
    polishImages();
    initFastNavigation();
    if(window.MutationObserver){
      new MutationObserver(function(records){
        records.forEach(function(record){
          record.addedNodes.forEach(function(node){
            if(node.nodeType===1){
              normalizeControls(node);
              polishImages(node);
            }
          });
        });
      }).observe(document.body,{childList:true,subtree:true});
    }
  }

  window.addEventListener('storage',function(e){
    if(!e||['dk_session','dk_active_profile','dk_current_plan','dk_plan','rh_plan_access_v1'].indexOf(e.key)!==-1) syncAccountIdentity();
    if(!e||['rh_transitions','rh_reduce_motion'].indexOf(e.key)!==-1) syncMotionPreferences();
    if(!e||e.key===DRAWER_MODE_KEY) syncShellLayout();
  });
  document.addEventListener('dk:userready',syncAccountIdentity);
  document.addEventListener('dk:profilechange',syncAccountIdentity);
  document.addEventListener('rh:planchange',syncAccountIdentity);
  document.addEventListener('rh:uidchange',syncAccountIdentity);
  var layoutFrame=0;
  window.addEventListener('resize',function(){
    scheduleViewportProfile();
    if(layoutFrame) return;
    layoutFrame=window.requestAnimationFrame(function(){
      layoutFrame=0;
      syncPerformanceProfile();
      syncShellLayout();
    });
  },{passive:true});
  window.addEventListener('orientationchange',scheduleViewportProfile,{passive:true});
  window.addEventListener('rh:nativeviewportchange',scheduleViewportProfile);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',scheduleViewportProfile,{passive:true});
    window.visualViewport.addEventListener('scroll',scheduleViewportProfile,{passive:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
