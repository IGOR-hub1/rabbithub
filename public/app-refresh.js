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
    return 'other';
  }

  function setPageIdentity(){
    var page=pageName();
    document.body.setAttribute('data-page',page);
    document.documentElement.setAttribute('data-app','rabbithub');
  }

  function polishImages(){
    document.querySelectorAll('img:not([data-rh-image])').forEach(function(img){
      img.setAttribute('data-rh-image','');
      img.decoding='async';
      img.draggable=false;
      if(!img.getAttribute('loading')&&!img.closest('.hero-section,.hero-area')) img.loading='lazy';
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
    polishImages();
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
