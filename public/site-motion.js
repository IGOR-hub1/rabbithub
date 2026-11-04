(function(){
  'use strict';
  if(window.__RH_SITE_MOTION__)return;
  window.__RH_SITE_MOTION__=true;

  var root=document.documentElement;
  var reduceQuery=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduceMotion=!!(reduceQuery&&reduceQuery.matches);
  root.classList.add('rh-motion-enabled');
  if(reduceMotion)root.classList.add('rh-motion-reduced');

  var revealSelector=[
    'main > section',
    '.section-header',
    '.hero-content',
    '.scraper-card',
    '.anime-card',
    '.card',
    '[class*="-card"]',
    '.chat-inbox',
    '.episode-item',
    '.yc-tile',
    '[data-motion-reveal]'
  ].join(',');
  var interactiveSelector='button:not([disabled]),a[href],[role="button"],.scraper-card,.anime-card,.yc-tile,.episode-item';
  var revealObserver=null;
  var revealCount=0;
  var mutationFrame=0;
  var pendingNodes=[];

  function canReveal(element){
    if(!element||element.nodeType!==1||element.dataset.rhMotionReveal)return false;
    if(element.closest('[aria-hidden="true"],template'))return false;
    return true;
  }

  function bindReveal(element){
    if(!canReveal(element))return;
    element.dataset.rhMotionReveal='1';
    element.classList.add('rh-reveal');
    element.style.setProperty('--rh-reveal-delay',Math.min(revealCount++%5,4)*34+'ms');
    if(reduceMotion||!revealObserver){
      element.classList.add('rh-reveal-visible');
      return;
    }
    revealObserver.observe(element);
  }

  function scan(container){
    if(!container||container.nodeType!==1)return;
    if(container.matches&&container.matches(revealSelector))bindReveal(container);
    if(container.querySelectorAll)container.querySelectorAll(revealSelector).forEach(bindReveal);
    if(container.matches&&container.matches(interactiveSelector))container.classList.add('rh-motion-interactive');
    if(container.querySelectorAll)container.querySelectorAll(interactiveSelector).forEach(function(element){
      element.classList.add('rh-motion-interactive');
    });
  }

  if(!reduceMotion&&'IntersectionObserver' in window){
    revealObserver=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting)return;
        entry.target.classList.add('rh-reveal-visible');
        revealObserver.unobserve(entry.target);
      });
    },{rootMargin:'0px 0px -7% 0px',threshold:.08});
  }

  function clickPoint(event,target){
    if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&(event.clientX||event.clientY))return [event.clientX,event.clientY];
    var rect=target.getBoundingClientRect();
    return [rect.left+rect.width/2,rect.top+rect.height/2];
  }

  function showClickFeedback(event){
    if(reduceMotion||event.defaultPrevented)return;
    var target=event.target&&event.target.closest?event.target.closest(interactiveSelector):null;
    if(!target||target.matches('[disabled],[aria-disabled="true"]'))return;
    var point=clickPoint(event,target);
    var wave=document.createElement('span');
    wave.className='rh-click-wave';
    wave.style.left=point[0]+'px';
    wave.style.top=point[1]+'px';
    document.body.appendChild(wave);
    wave.addEventListener('animationend',function(){wave.remove();},{once:true});
    if(typeof target.animate==='function'){
      target.animate([{scale:'1'},{scale:'.975'},{scale:'1'}],{duration:220,easing:'cubic-bezier(.22,.8,.28,1)'});
    }
  }

  function createScrollProgress(){
    if(reduceMotion)return;
    var progress=document.createElement('div');
    progress.className='rh-scroll-progress';
    progress.setAttribute('aria-hidden','true');
    document.body.appendChild(progress);
    var scheduled=false;
    function paint(){
      scheduled=false;
      var doc=document.documentElement;
      var max=Math.max(0,doc.scrollHeight-window.innerHeight);
      var value=max>0?Math.min(1,Math.max(0,window.scrollY/max)):0;
      progress.style.transform='scaleX('+value+')';
      progress.style.opacity=document.fullscreenElement?'0':(max>24?'1':'0');
    }
    function schedule(){
      if(scheduled)return;
      scheduled=true;
      window.requestAnimationFrame(paint);
    }
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule,{passive:true});
    document.addEventListener('fullscreenchange',schedule);
    schedule();
  }

  function init(){
    scan(document.body);
    document.addEventListener('click',showClickFeedback,true);
    createScrollProgress();
    if('MutationObserver' in window){
      new MutationObserver(function(records){
        records.forEach(function(record){
          record.addedNodes.forEach(function(node){if(node.nodeType===1)pendingNodes.push(node);});
        });
        if(mutationFrame)return;
        mutationFrame=window.requestAnimationFrame(function(){
          mutationFrame=0;
          var nodes=pendingNodes.splice(0,pendingNodes.length);
          nodes.forEach(scan);
        });
      }).observe(document.body,{childList:true,subtree:true});
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
