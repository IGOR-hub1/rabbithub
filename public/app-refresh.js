/* X-Bunny Animes • melhorias de navegação e acabamento compartilhado. */
(function(){
  'use strict';

  var DRAWER_MODE_KEY='rh_drawer_mode';
  var viewportFrame=0;
  var nativeShell=!!window.__RABBITHUB_WEBVIEW__||/\bX-BunnyApp\//i.test(String(navigator.userAgent||''));

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
    root.setAttribute('data-rh-native',nativeShell?'true':'false');
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

  function allowsSpeculativeLoading(){
    var connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection||{};
    var type=String(connection.effectiveType||'').toLowerCase();
    return !document.hidden&&!connection.saveData&&type!=='slow-2g'&&type!=='2g';
  }

  function prefetchNavigation(target){
    if(!target||navigationPrefetched[target.url.href])return;
    if(!allowsSpeculativeLoading())return;
    navigationPrefetched[target.url.href]=true;
    try{
      if(window.RabbitHubApp&&typeof window.RabbitHubApp.prefetchPage==='function'){
        window.RabbitHubApp.prefetchPage(target.url.href);
        return;
      }
    }catch(e){}
    var link=document.createElement('link');
    link.rel='prefetch';link.as='document';link.href=target.url.href;
    document.head.appendChild(link);
  }

  function prefetchLikelyNativePage(){
    var name=pageName();
    var routes={
      home:['detalhes.html'],
      details:['player-animes.html','index.html'],
      player:['detalhes.html','index.html'],
      chat:['index.html'],
      login:['perfis.html','index.html'],
      profiles:['index.html'],
      admin:['index.html']
    };
    (routes[name]||['index.html']).forEach(function(path){
      try{prefetchNavigation({url:new URL(path,location.href)});}catch(e){}
    });
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
        if(/^DRAKSYON$/i.test(text)) el.textContent='X-BUNNY ANIMES';
        else if(/Painel Admin\s*[—-]\s*DRAKSYON/i.test(text)) el.textContent='Painel Admin — X-BUNNY ANIMES';
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

  function addDesktopRailControls(row){
    if(!row.classList.contains('scraper-scroll'))return;
    var section=row.closest('.anime-section');
    var header=section&&section.querySelector('.section-header');
    if(!header||header.querySelector('.rh-rail-controls'))return;
    var controls=document.createElement('div');
    controls.className='rh-rail-controls';
    controls.setAttribute('aria-label','Navegacao da lista');
    controls.innerHTML=
      '<button type="button" class="rh-rail-button rh-rail-prev" aria-label="Itens anteriores"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>'+
      '<button type="button" class="rh-rail-button rh-rail-next" aria-label="Proximos itens"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>';
    header.appendChild(controls);
    var previous=controls.querySelector('.rh-rail-prev');
    var next=controls.querySelector('.rh-rail-next');
    var updateFrame=0;
    function update(){
      updateFrame=0;
      var max=Math.max(0,row.scrollWidth-row.clientWidth);
      previous.disabled=row.scrollLeft<=2;
      next.disabled=max<=2||row.scrollLeft>=max-2;
      controls.hidden=max<=2;
    }
    function scheduleUpdate(){
      if(updateFrame)return;
      updateFrame=window.requestAnimationFrame(update);
    }
    function move(direction){
      row.scrollBy({left:direction*Math.max(240,Math.round(row.clientWidth*.78)),behavior:'smooth'});
    }
    previous.addEventListener('click',function(){move(-1);});
    next.addEventListener('click',function(){move(1);});
    row.addEventListener('scroll',scheduleUpdate,{passive:true});
    window.addEventListener('resize',scheduleUpdate,{passive:true});
    if(window.ResizeObserver){
      var observer=new ResizeObserver(scheduleUpdate);
      observer.observe(row);
    }
    window.requestAnimationFrame(update);
  }

  function initHorizontalScroll(root){
    root=root||document;
    var selector='.scraper-scroll,.watchlist-filters,.profile-tabs,.season-options';
    var rows=[];
    if(root.matches&&root.matches(selector)) rows.push(root);
    if(root.querySelectorAll) rows=rows.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    rows.forEach(function(row){
      if(row.hasAttribute('data-rh-horizontal-scroll')) return;
      row.setAttribute('data-rh-horizontal-scroll','');
      addDesktopRailControls(row);
      if(!row.hasAttribute('tabindex')) row.tabIndex=0;
      if(!row.hasAttribute('role')) row.setAttribute('role','region');
      if(!row.hasAttribute('aria-label')) row.setAttribute('aria-label','Lista horizontal; use os controles ou as setas para navegar');

      /* Mantido apenas como referencia de compatibilidade; desativado porque
         capturar o ponteiro fazia um clique simples parecer um arrasto. */
      var enablePointerDrag=false;
      if(enablePointerDrag){
      var pointerId=null,startX=0,startLeft=0,moved=false,suppressClick=false;
      row.addEventListener('pointerdown',function(event){
        /* No computador o clique deve continuar sendo clique. A navegacao
           lateral usa botoes, roda/trackpad e teclado, sem capturar o mouse. */
        if(event.pointerType!=='touch') return;
        if(event.button!==0||event.pointerType==='touch'||row.scrollWidth<=row.clientWidth) return;
        /* A faixa pode conter filtros/selects; capturar o ponteiro nesses
           controles impede o click nativo e deixa o dropdown sem resposta. */
        if(event.target.closest('button,a,input,select,textarea,[role="button"],.rh-select,.rh-select__menu')) return;
        pointerId=event.pointerId;startX=event.clientX;startLeft=row.scrollLeft;moved=false;
        row.classList.add('is-dragging');
        try{row.setPointerCapture(pointerId);}catch(e){}
      });
      row.addEventListener('pointermove',function(event){
        if(pointerId!==event.pointerId) return;
        var distance=event.clientX-startX;
        if(!moved&&Math.abs(distance)<5) return;
        moved=true;suppressClick=true;event.preventDefault();
        row.scrollLeft=startLeft-distance;
      },{passive:false});
      function finishDrag(event){
        if(pointerId===null||(event&&event.pointerId!==pointerId)) return;
        try{row.releasePointerCapture(pointerId);}catch(e){}
        pointerId=null;row.classList.remove('is-dragging');
        if(moved) window.setTimeout(function(){suppressClick=false;},0);
      }
      row.addEventListener('pointerup',finishDrag);
      row.addEventListener('pointercancel',finishDrag);
      row.addEventListener('lostpointercapture',finishDrag);
      row.addEventListener('click',function(event){
        if(!suppressClick) return;
        event.preventDefault();event.stopImmediatePropagation();suppressClick=false;
      },true);
      }
      row.addEventListener('keydown',function(event){
        if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
        event.preventDefault();
        row.scrollBy({left:(event.key==='ArrowRight'?1:-1)*Math.max(180,row.clientWidth*.72),behavior:'smooth'});
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
      avatar:safeImageUrl(
        profile.avatar||profile.profileAvatar||
        session.profileAvatar||session.avatar||
        live.profileAvatar||live.avatar||''
      ),
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

  var decorativeMediaObserver=null;
  function decorativeVideos(root){
    root=root||document;
    var items=[];
    if(root.matches&&root.matches('video[autoplay],video[data-visible-autoplay]'))items.push(root);
    if(root.querySelectorAll)items=items.concat(Array.prototype.slice.call(root.querySelectorAll('video[autoplay],video[data-visible-autoplay]')));
    return items.filter(function(video){return video.id!=='main-video'&&!video.closest('#dk-player,.video-wrapper');});
  }

  function syncDecorativeVideo(video){
    if(!video||!video.isConnected)return;
    var shouldPlay=video.getAttribute('data-rh-visible')==='1'&&!document.hidden;
    if(!shouldPlay){try{video.pause();}catch(e){}return;}
    video.muted=true;
    video.playsInline=true;
    var request=video.play();
    if(request&&typeof request.catch==='function')request.catch(function(){});
  }

  function manageDecorativeMedia(root){
    decorativeVideos(root).forEach(function(video){
      if(video.hasAttribute('data-rh-media-observed'))return;
      video.setAttribute('data-rh-media-observed','');
      video.muted=true;
      video.playsInline=true;
      if(decorativeMediaObserver)decorativeMediaObserver.observe(video);
      else{video.setAttribute('data-rh-visible','1');syncDecorativeVideo(video);}
    });
  }

  function initDecorativeMedia(){
    if('IntersectionObserver'in window){
      decorativeMediaObserver=new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          entry.target.setAttribute('data-rh-visible',entry.isIntersecting?'1':'0');
          syncDecorativeVideo(entry.target);
        });
      },{rootMargin:'160px 0px',threshold:.01});
    }
    manageDecorativeMedia(document);
    document.addEventListener('visibilitychange',function(){
      decorativeVideos(document).forEach(syncDecorativeVideo);
    });
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

  function visible(node){
    if(!node||node.hidden||node.getAttribute('aria-hidden')==='true')return false;
    var style=window.getComputedStyle?getComputedStyle(node):null;
    return !style||style.display!=='none'&&style.visibility!=='hidden';
  }

  function clickNode(node){
    if(!node||typeof node.click!=='function')return false;
    node.click();return true;
  }

  function handleNativeBack(){
    var detail={handled:false};
    try{
      var event=new CustomEvent('rabbithub:nativeback',{cancelable:true,detail:detail});
      document.dispatchEvent(event);
      if(event.defaultPrevented||detail.handled===true)return true;
    }catch(error){}

    if(document.fullscreenElement&&document.exitFullscreen){
      document.exitFullscreen().catch(function(){});return true;
    }
    var report=document.getElementById('rh-chat-report-overlay');
    if(visible(report)&&clickNode(report.querySelector('[data-report-close]')))return true;
    var next=document.getElementById('dk-next-overlay');
    if(visible(next)&&clickNode(document.getElementById('dk-next-cancel')))return true;
    var publicProfile=document.getElementById('rh-public-profile-overlay');
    if(visible(publicProfile)&&publicProfile.classList.contains('open')&&clickNode(document.getElementById('rh-public-profile-back')))return true;
    var chat=document.getElementById('rh-chat-overlay');
    if(visible(chat)&&chat.classList.contains('open')&&clickNode(document.getElementById('rh-chat-close')))return true;
    var episodeModal=document.getElementById('ep-modal-overlay');
    if(visible(episodeModal)&&episodeModal.classList.contains('open')&&clickNode(document.getElementById('ep-modal-close')))return true;
    var profileOverlay=document.querySelector('body[data-page="profiles"] .overlay.open');
    if(profileOverlay){
      var profileClose=profileOverlay.querySelector('[data-close],.modal-close,.close-btn,button[aria-label*="Fechar"]');
      if(clickNode(profileClose)||clickNode(profileOverlay))return true;
    }
    var sheet=document.querySelector('.yc-sheet.open');
    if(sheet&&clickNode(sheet.querySelector('.yc-sheet-back,#yc-sheet-back')))return true;
    var drawer=document.querySelector('.drawer.open');
    if(drawer&&!fixedDrawer()){
      var drawerClose=document.querySelector('#drawer-close,.drawer-close-btn');
      if(clickNode(drawerClose))return true;
    }
    var search=document.getElementById('search-box');
    if(search&&search.classList.contains('show')&&clickNode(document.getElementById('open-search')))return true;
    return false;
  }

  function initNativeNavigation(){
    window.RabbitHubNavigation={handleBack:handleNativeBack,isNative:function(){return nativeShell;}};
    if(!nativeShell)return;
    document.addEventListener('click',function(event){
      if(event.defaultPrevented||event.button>0)return;
      var anchor=event.target&&event.target.closest?event.target.closest('a[href][target="_blank"]'):null;
      if(!anchor)return;
      try{
        var target=new URL(anchor.href,location.href);
        if(target.origin===location.origin)return;
        event.preventDefault();
        location.href=target.href;
      }catch(error){}
    },true);
  }

  function init(){
    setPageIdentity();
    syncViewportProfile();
    syncMotionPreferences();
    normalizeBrand();
    normalizeControls();
    initHorizontalScroll();
    syncAccountIdentity();
    syncShellLayout();
    initNativeNavigation();
    polishImages();
    initFastNavigation();
    initDecorativeMedia();
    if(window.MutationObserver){
      new MutationObserver(function(records){
        records.forEach(function(record){
          record.addedNodes.forEach(function(node){
            if(node.nodeType===1){
              normalizeControls(node);
              initHorizontalScroll(node);
              polishImages(node);
              manageDecorativeMedia(node);
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
