/* RabbitHub Animes • melhorias de navegação e acabamento compartilhado. */
(function(){
  'use strict';

  function pageName(){
    var file=(location.pathname.split('/').pop()||'index.html').toLowerCase();
    if(file==='index.html'||file==='') return 'home';
    if(file==='detalhes.html') return 'details';
    if(file==='player-animes.html') return 'player';
    if(file==='login.html') return 'login';
    if(file==='perfis.html') return 'profiles';
    if(file==='admin.html') return 'admin';
    if(file==='enviar-mensagem.html') return 'messages';
    return 'other';
  }

  function setPageIdentity(){
    var page=pageName();
    document.body.setAttribute('data-page',page);
    document.documentElement.setAttribute('data-app','rabbithub');
  }

  function icon(path){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';
  }

  function activateTab(tab){
    var target=document.querySelector('.drawer-nav-item[data-tab="'+tab+'"],.drawer-subnav-item[data-tab="'+tab+'"]');
    if(target){ target.click(); return; }
    location.href='index.html?tab='+encodeURIComponent(tab);
  }

  function makeDiscovery(){
    var hero=document.getElementById('hero-section');
    if(!hero||document.querySelector('.rh-discovery')) return;
    var box=document.createElement('section');
    box.className='rh-discovery';
    box.setAttribute('aria-label','Atalhos do catálogo');
    box.innerHTML='<div class="rh-discovery-inner">'+
      '<button class="rh-quick rh-quick-primary" data-rh-tab="lancamentos">'+
        '<span class="rh-quick-icon">'+icon('<path d="M13 2L4.5 12.2a1 1 0 00.77 1.64H11L10 22l8.5-10.2a1 1 0 00-.77-1.64H12L13 2z"/>')+'</span>'+
        '<span class="rh-quick-copy"><strong>Novos episódios</strong><small>Veja o que acabou de chegar</small></span>'+
      '</button>'+
      '<button class="rh-quick" data-rh-tab="dublados">'+
        '<span class="rh-quick-icon">'+icon('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/>')+'</span>'+
        '<span class="rh-quick-copy"><strong>Dublados</strong><small>Anime em português</small></span>'+
      '</button>'+
      '<button class="rh-quick" data-rh-tab="legendados">'+
        '<span class="rh-quick-icon">'+icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 14h5M14 14h4"/>')+'</span>'+
        '<span class="rh-quick-copy"><strong>Legendados</strong><small>Áudio original</small></span>'+
      '</button>'+
      '<button class="rh-quick" data-rh-tab="categoria">'+
        '<span class="rh-quick-icon">'+icon('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>')+'</span>'+
        '<span class="rh-quick-copy"><strong>Categorias</strong><small>Encontre seu próximo anime</small></span>'+
      '</button>'+
    '</div>';
    hero.insertAdjacentElement('afterend',box);
    box.addEventListener('click',function(e){
      var btn=e.target.closest('[data-rh-tab]');
      if(btn) activateTab(btn.getAttribute('data-rh-tab'));
    });
  }

  function makeBottomNav(){
    if(pageName()!=='home'||document.querySelector('.rh-bottom-nav')) return;
    var nav=document.createElement('nav');
    nav.className='rh-bottom-nav';
    nav.setAttribute('aria-label','Navegação principal');
    nav.innerHTML=
      '<button class="rh-bottom-item active" data-rh-tab="home">'+icon('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>')+'<span>Início</span></button>'+
      '<button class="rh-bottom-item" data-rh-tab="lancamentos">'+icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')+'<span>Recentes</span></button>'+
      '<button class="rh-bottom-item" data-rh-tab="dublados">'+icon('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M16 9a4 4 0 010 6"/>')+'<span>Dublados</span></button>'+
      '<button class="rh-bottom-item" data-rh-tab="perfil">'+icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>')+'<span>Perfil</span></button>';
    document.body.appendChild(nav);
    nav.addEventListener('click',function(e){
      var btn=e.target.closest('[data-rh-tab]');
      if(!btn) return;
      nav.querySelectorAll('.rh-bottom-item').forEach(function(item){item.classList.toggle('active',item===btn);});
      activateTab(btn.getAttribute('data-rh-tab'));
    });
    document.querySelectorAll('[data-tab]').forEach(function(item){
      item.addEventListener('click',function(){
        var tab=item.getAttribute('data-tab');
        nav.querySelectorAll('.rh-bottom-item').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-rh-tab')===tab);});
      });
    });
  }

  function syncDiscovery(){
    var hero=document.getElementById('hero-section');
    var discovery=document.querySelector('.rh-discovery');
    if(!hero||!discovery) return;
    var visible=hero.style.display!=='none';
    discovery.style.display=visible?'':'none';
  }

  function polishImages(){
    document.querySelectorAll('img:not([data-rh-image])').forEach(function(img){
      img.setAttribute('data-rh-image','');
      img.decoding='async';
      img.draggable=false;
      if(!img.getAttribute('loading')&&!img.closest('.hero-section,.hero-area,.welcome-overlay')) img.loading='lazy';
      if(img.closest('.hero-section,.hero-area')) img.fetchPriority='high';
      img.addEventListener('load',function(){img.classList.add('rh-loaded');},{once:true});
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
    var storedPlan=readJSON('dk_current_plan');
    if(!storedPlan) storedPlan=localStorage.getItem('dk_current_plan')||localStorage.getItem('dk_plan')||'';
    var name=live.displayName||session.displayName||'';
    if(!name&&session.email) name=String(session.email).split('@')[0];
    if(!name) name=profile.name||'Usuário';
    var plan=live.plan||session.plan||
      (typeof storedPlan==='object'&&storedPlan ? (storedPlan.name||storedPlan.label) : storedPlan)||
      profile.plan||'Plano gratuito';
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

  function init(){
    setPageIdentity();
    normalizeBrand();
    syncAccountIdentity();
    makeDiscovery();
    makeBottomNav();
    syncDiscovery();
    polishImages();
    var hero=document.getElementById('hero-section');
    if(hero&&window.MutationObserver){
      new MutationObserver(syncDiscovery).observe(hero,{attributes:true,attributeFilter:['style']});
    }
    if(window.MutationObserver){
      new MutationObserver(function(){polishImages();}).observe(document.body,{childList:true,subtree:true});
    }
  }

  window.addEventListener('storage',function(e){
    if(!e||['dk_session','dk_active_profile','dk_current_plan','dk_plan'].indexOf(e.key)!==-1) syncAccountIdentity();
  });
  document.addEventListener('dk:userready',syncAccountIdentity);
  document.addEventListener('dk:profilechange',syncAccountIdentity);

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
