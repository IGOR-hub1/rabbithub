/* RabbitHub • comentários por anime vinculados ao UID e ao perfil ativo. */
(function(){
  'use strict';

  var configRef = null;
  var messagesRef = null;
  var messageQuery = null;
  var messageHandler = null;
  var enabled = false;
  var opened = false;
  var previousOverflow = '';
  var animeKey = '';
  var animeSlug = '';
  var animeTitle = '';
  var animeCover = '';
  var autoOpenRequested = false;
  var focusMessageId = '';
  var replyTarget = null;
  var spoilerActive = false;
  var reportTarget = null;
  var lastMessageSnapshot = null;
  var expandedThreads = {};
  var hasRenderedMessages = false;
  var newestFirst = true;
  var publicProfileOpen = false;
  var publicProfileTrigger = null;
  var publicProfileRequest = 0;
  var els = {};

  function readJSON(key,fallback){
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch(e) { return fallback; }
  }

  function safeSegment(value){
    if (window.RabbitHubUid && window.RabbitHubUid.safeSegment) return window.RabbitHubUid.safeSegment(value);
    return String(value || 'item').replace(/[.#$\[\]\/]/g,'_').slice(0,180);
  }

  function socialRef(path){
    try { return window.RabbitHubSocial && window.RabbitHubSocial.ref ? window.RabbitHubSocial.ref(path) : null; }
    catch(e) { return null; }
  }

  function timestamp(){
    try { return window.RabbitHubSocial && window.RabbitHubSocial.timestamp ? window.RabbitHubSocial.timestamp() : firebase.database.ServerValue.TIMESTAMP; }
    catch(e) { return Date.now(); }
  }

  function primaryDatabase(){
    try {
      if (window.RabbitHubSocial && window.RabbitHubSocial.primaryDatabase) return window.RabbitHubSocial.primaryDatabase();
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      return firebase.database();
    } catch(e) { return null; }
  }

  function context(){
    var session = readJSON('dk_session',{}) || {};
    var profile = readJSON('dk_active_profile',{}) || {};
    var access = window.RabbitHubPlans && window.RabbitHubPlans.get ? window.RabbitHubPlans.get() : {};
    var uidKey = String(session.uid || 'visitante').replace(/[^a-z0-9_-]/gi,'_').slice(0,100);
    var profileKey = String(profile.id || 'principal').replace(/[^a-z0-9_-]/gi,'_').slice(0,80);
    var visual = readJSON('rh_profile_visual_v1_' + uidKey + '_' + profileKey,null) ||
      readJSON('rh_profile_visual_v1_' + profileKey,{}) || {};
    var profileName = String(profile.name || session.displayName || '').trim().slice(0,40);
    var profileId = String(profile.id || 'principal').trim().slice(0,100);
    var profileBanner = String(visual.banner || profile.banner || 'default').trim().slice(0,80);
    var theme = String(window.DK_getTheme ? window.DK_getTheme() : (visual.theme || profile.theme || 'blue')).trim().slice(0,30);
    return {
      uid:String(session.uid || '').trim().slice(0,120),
      profileId:profileId || 'principal',
      profileName:profileName || 'Usuário RabbitHub',
      profileAvatar:String(profile.avatar || '').trim().slice(0,600),
      profileBio:String(profile.bio || session.bio || '').trim().slice(0,280),
      profileBanner:profileBanner || 'default',
      theme:theme || 'blue',
      plan:access.isVip === true ? 'VIP' : 'Free'
    };
  }

  function blockStorageKey(){var user=context();return 'rh_chat_blocks_v1_'+safeSegment(user.uid)+'_'+safeSegment(user.profileId);}
  function blockedUsers(){var value=readJSON(blockStorageKey(),[]);return Array.isArray(value)?value:[];}
  function userBlockKey(message){return safeSegment(String(message&&message.uid||'')+'__'+String(message&&message.profileId||''));}
  function isBlocked(message){var key=userBlockKey(message);return blockedUsers().some(function(item){return item&&item.key===key;});}
  function blockUser(message){
    var list=blockedUsers(),key=userBlockKey(message);
    if(!key||list.some(function(item){return item.key===key;}))return;
    list.push({key:key,uid:String(message.uid||''),profileId:String(message.profileId||''),name:String(message.profileName||'Usuário').slice(0,40),createdAt:Date.now()});
    try{localStorage.setItem(blockStorageKey(),JSON.stringify(list.slice(-100)));}catch(e){}
    if(lastMessageSnapshot)renderMessages(lastMessageSnapshot);
  }
  function clearBlocks(){try{localStorage.removeItem(blockStorageKey());}catch(e){}if(lastMessageSnapshot)renderMessages(lastMessageSnapshot);}

  function hasSpoilerAccess(){
    try { return window.RabbitHubPlans && window.RabbitHubPlans.can && window.RabbitHubPlans.can('spoilerComments') === true; }
    catch(e){ return false; }
  }

  function syncSpoilerToggle(){
    if(!els.spoiler)return;
    var allowed=hasSpoilerAccess();
    if(!allowed)spoilerActive=false;
    els.spoiler.classList.toggle('is-locked',!allowed);
    els.spoiler.setAttribute('aria-pressed',spoilerActive?'true':'false');
    els.spoiler.title=allowed?'Ocultar o texto até o leitor confirmar':'Recurso disponível no plano VIP';
  }

  function validImage(value){
    value = String(value || '').trim();
    if (!value) return '';
    try {
      var parsed = new URL(value,location.href);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
    } catch(e){}
    return '';
  }

  function publicBanner(value){
    value=String(value||'default').trim();
    var list=[];
    try{list=window.RabbitHubProfileBanners&&window.RabbitHubProfileBanners.get?window.RabbitHubProfileBanners.get():[];}catch(e){}
    var match=list.filter(function(item){return item&&String(item.key)===value;})[0];
    if(!match&&list.length)match=list[0];
    var direct=validImage(value);
    return match||{key:'custom',url:direct,media:/\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(direct)?'video':'image'};
  }

  function setPublicProfileBanner(value){
    if(!els.publicProfileCover)return;
    var banner=publicBanner(value),url=validImage(banner&&banner.url);
    els.publicProfileCover.innerHTML='';
    els.publicProfileCover.style.backgroundImage='';
    if(!url){els.publicProfileCover.classList.add('is-fallback');return;}
    els.publicProfileCover.classList.remove('is-fallback');
    if(banner.media==='video'){
      var video=document.createElement('video');video.src=url;video.autoplay=true;video.loop=true;video.muted=true;video.playsInline=true;video.preload='metadata';
      els.publicProfileCover.appendChild(video);
    }else{
      els.publicProfileCover.style.backgroundImage='linear-gradient(90deg,rgba(5,7,11,.08),rgba(5,7,11,.32)),url("'+url.replace(/"/g,'%22')+'")';
    }
  }

  function formatDate(value){
    var dateValue = Number(value) || 0;
    if (!dateValue) return 'agora';
    var elapsed = Math.max(0,Date.now() - dateValue);
    if (elapsed < 60000) return 'agora';
    if (elapsed < 3600000) return 'há ' + Math.max(1,Math.floor(elapsed / 60000)) + ' min';
    if (elapsed < 86400000) {
      var hours = Math.max(1,Math.floor(elapsed / 3600000));
      return 'há ' + hours + (hours === 1 ? ' hora' : ' horas');
    }
    if (elapsed < 604800000) {
      var days = Math.max(1,Math.floor(elapsed / 86400000));
      return 'há ' + days + (days === 1 ? ' dia' : ' dias');
    }
    try {
      return new Date(dateValue).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
    } catch(e) { return 'agora'; }
  }

  function exactDate(value){
    if (!value || !isFinite(Number(value))) return '';
    try { return new Date(Number(value)).toLocaleString('pt-BR'); }
    catch(e) { return ''; }
  }

  function emptyState(title,text){
    els.messages.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'rh-chat-empty';
    var copy = document.createElement('div');
    var strong = document.createElement('strong');
    var span = document.createElement('span');
    strong.textContent = title;
    span.textContent = text;
    copy.appendChild(strong); copy.appendChild(span); wrap.appendChild(copy);
    els.messages.appendChild(wrap);
  }

  function avatarNode(message){
    var avatar = document.createElement('button');
    avatar.type = 'button';
    avatar.className = 'rh-chat-avatar';
    avatar.setAttribute('aria-label','Ver perfil de ' + String(message.profileName || 'usuário RabbitHub'));
    avatar.title = 'Ver perfil';
    var imageUrl = validImage(message.profileAvatar);
    if (imageUrl) {
      var image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.onerror = function(){
        avatar.innerHTML = '';
        avatar.textContent = String(message.profileName || 'R').charAt(0).toUpperCase();
      };
      avatar.appendChild(image);
    } else {
      avatar.textContent = String(message.profileName || 'R').charAt(0).toUpperCase();
    }
    avatar.addEventListener('click',function(){ openPublicProfile(message,avatar); });
    return avatar;
  }

  function setProfileAvatar(container,url,name){
    if (!container) return;
    container.innerHTML = '';
    var imageUrl = validImage(url);
    if (!imageUrl) {
      container.textContent = String(name || 'R').charAt(0).toUpperCase();
      return;
    }
    var image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.onerror = function(){
      container.innerHTML = '';
      container.textContent = String(name || 'R').charAt(0).toUpperCase();
    };
    container.appendChild(image);
  }

  function profileFallback(message){
    message = message || {};
    return {
      profileName:String(message.profileName || 'Usuário RabbitHub').trim().slice(0,40) || 'Usuário RabbitHub',
      profileAvatar:String(message.profileAvatar || '').trim().slice(0,600),
      bio:String(message.profileBio || '').trim().slice(0,280),
      banner:String(message.profileBanner || 'default').trim().slice(0,80) || 'default',
      theme:String(message.theme || 'blue').trim().slice(0,30) || 'blue',
      plan:String(message.plan || 'Free').trim().slice(0,30) || 'Free'
    };
  }

  function renderPublicProfile(profile){
    profile = profile || {};
    var name = String(profile.profileName || 'Usuário RabbitHub').trim().slice(0,40) || 'Usuário RabbitHub';
    setProfileAvatar(els.publicProfileAvatar,profile.profileAvatar,name);
    els.publicProfileName.textContent = name;
    els.publicProfilePlan.textContent = String(profile.plan || 'Free').toUpperCase() === 'VIP' ? 'VIP' : 'FREE';
    els.publicProfilePlan.classList.toggle('is-vip',String(profile.plan || '').toUpperCase() === 'VIP');
    els.publicProfileBio.textContent = String(profile.bio || '').trim().slice(0,280) || 'Este usuário ainda não adicionou uma descrição.';
    setPublicProfileBanner(profile.banner);
    els.publicProfilePanel.dataset.banner = String(profile.banner || 'default').replace(/[^a-z0-9_-]/gi,'').slice(0,80) || 'default';
    els.publicProfilePanel.dataset.theme = String(profile.theme || 'blue').replace(/[^a-z0-9_-]/gi,'').slice(0,30) || 'blue';
  }

  function renderPublicProfileComments(entries){
    els.publicProfileComments.innerHTML = '';
    entries = Array.isArray(entries) ? entries : [];
    els.publicProfileCommentsCount.textContent = String(entries.length);
    if (!entries.length) {
      var empty = document.createElement('div');
      empty.className = 'rh-public-profile-empty';
      empty.textContent = 'Nenhum comentário público recente.';
      els.publicProfileComments.appendChild(empty);
      return;
    }
    entries.forEach(function(entry){
      var link = document.createElement('a');
      link.className = 'rh-public-comment';
      link.href = 'detalhes.html?anime=' + encodeURIComponent(String(entry.animeSlug || ''));
      link.setAttribute('aria-label','Abrir ' + String(entry.animeTitle || 'anime'));
      var cover = document.createElement('span');
      cover.className = 'rh-public-comment-cover';
      var coverUrl = validImage(entry.animeCover);
      if (coverUrl) {
        var image = document.createElement('img');
        image.src = coverUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.onerror = function(){ cover.classList.add('is-fallback'); image.remove(); };
        cover.appendChild(image);
      } else {
        cover.classList.add('is-fallback');
      }
      var copy = document.createElement('span');
      copy.className = 'rh-public-comment-copy';
      var heading = document.createElement('span');
      heading.className = 'rh-public-comment-heading';
      var title = document.createElement('strong');
      title.textContent = String(entry.animeTitle || 'Anime').slice(0,160);
      var time = document.createElement('time');
      time.textContent = formatDate(entry.createdAt);
      heading.appendChild(title); heading.appendChild(time);
      var episode = document.createElement('small');
      episode.textContent = String(entry.episodeName || 'Episódio').slice(0,100);
      var text = document.createElement('span');
      text.className = 'rh-public-comment-text';
      text.textContent = String(entry.text || '').slice(0,500);
      copy.appendChild(heading); copy.appendChild(episode); copy.appendChild(text);
      var arrow = document.createElement('span');
      arrow.className = 'rh-public-comment-arrow';
      arrow.setAttribute('aria-hidden','true');
      arrow.textContent = '›';
      link.appendChild(cover); link.appendChild(copy); link.appendChild(arrow);
      els.publicProfileComments.appendChild(link);
    });
  }

  function publicCommentsFromSnapshot(snapshot){
    var result = [];
    if (snapshot) snapshot.forEach(function(child){
      var value = child.val() || {};
      value.messageId = String(value.messageId || child.key || '');
      result.push(value);
    });
    return result.sort(function(a,b){ return Number(b.createdAt || 0) - Number(a.createdAt || 0); }).slice(0,20);
  }

  function openPublicProfile(message,trigger){
    if (!els.publicProfileOverlay || !message || !message.uid || !message.profileId) return;
    publicProfileOpen = true;
    publicProfileTrigger = trigger || null;
    publicProfileRequest += 1;
    var requestId = publicProfileRequest;
    renderPublicProfile(profileFallback(message));
    els.publicProfileCommentsCount.textContent = '…';
    els.publicProfileComments.innerHTML = '<div class="rh-public-profile-empty is-loading">Carregando comentários recentes…</div>';
    els.publicProfileOverlay.hidden = false;
    els.publicProfileOverlay.setAttribute('aria-hidden','false');
    window.requestAnimationFrame(function(){ els.publicProfileOverlay.classList.add('open'); });
    window.setTimeout(function(){ if (publicProfileOpen) els.publicProfileBack.focus(); },180);

    var root = 'publicProfiles/' + safeSegment(message.uid) + '/' + safeSegment(message.profileId);
    var profileRef = socialRef(root);
    var commentsRef = socialRef('userComments/' + safeSegment(message.uid) + '/' + safeSegment(message.profileId));
    var profileJob = profileRef ? profileRef.once('value').then(function(snapshot){ return snapshot.val() || null; }).catch(function(){ return null; }) : Promise.resolve(null);
    var commentsJob = commentsRef ? commentsRef.orderByChild('createdAt').limitToLast(20).once('value').then(function(snapshot){
      return {items:publicCommentsFromSnapshot(snapshot),failed:false};
    }).catch(function(error){ return {items:[],failed:true,error:error}; }) : Promise.resolve({items:[],failed:true});
    Promise.all([profileJob,commentsJob]).then(function(results){
      if (!publicProfileOpen || requestId !== publicProfileRequest) return;
      var merged = profileFallback(message);
      Object.keys(results[0] || {}).forEach(function(key){ merged[key] = results[0][key]; });
      renderPublicProfile(merged);
      renderPublicProfileComments(results[1].items);
      if (results[1].failed) {
        els.publicProfileComments.innerHTML = '<div class="rh-public-profile-empty">Não foi possível carregar os comentários recentes agora.</div>';
        els.publicProfileCommentsCount.textContent = '0';
      }
    });
  }

  function closePublicProfile(){
    if (!publicProfileOpen || !els.publicProfileOverlay) return;
    publicProfileOpen = false;
    publicProfileRequest += 1;
    els.publicProfileOverlay.classList.remove('open');
    els.publicProfileOverlay.setAttribute('aria-hidden','true');
    var trigger = publicProfileTrigger;
    publicProfileTrigger = null;
    window.setTimeout(function(){
      if (!publicProfileOpen) els.publicProfileOverlay.hidden = true;
      if (trigger && document.contains(trigger)) trigger.focus();
    },220);
  }

  function syncCommentCount(value){
    var count = String(Math.max(0,Number(value) || 0));
    if (els.count) els.count.textContent = count;
    if (els.panelCount) els.panelCount.textContent = count;
  }

  function renderComposerAvatar(){
    if (!els.composeAvatar) return;
    var user = context();
    var imageUrl = validImage(user.profileAvatar);
    els.composeAvatar.innerHTML = '';
    if (imageUrl) {
      var image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.onerror = function(){
        els.composeAvatar.innerHTML = '';
        els.composeAvatar.textContent = String(user.profileName || 'R').charAt(0).toUpperCase();
      };
      els.composeAvatar.appendChild(image);
    } else {
      els.composeAvatar.textContent = String(user.profileName || 'R').charAt(0).toUpperCase();
    }
  }

  function setReply(message,threadRootId){
    replyTarget = message || null;
    if (replyTarget) replyTarget._threadRootId = threadRootId || replyTarget.id || '';
    if (!els.replying) return;
    els.replying.hidden = !replyTarget;
    if (replyTarget) {
      els.replyName.textContent = String(replyTarget.profileName || 'Usuário');
      els.input.placeholder = 'Escreva sua resposta...';
      els.input.focus();
    } else {
      els.replyName.textContent = '';
      els.input.placeholder = 'Escreva um comentário...';
    }
  }

  function buildThreads(list){
    var byId = {};
    var byRoot = {};
    list.forEach(function(message){ byId[message.id] = message; });

    function findRoot(message){
      var current = message;
      var seen = {};
      while (current && current.replyToId && byId[current.replyToId] && !seen[current.replyToId]) {
        seen[current.id] = true;
        current = byId[current.replyToId];
      }
      return current || message;
    }

    list.forEach(function(message){
      var root = findRoot(message);
      if (!byRoot[root.id]) byRoot[root.id] = {root:root,replies:[]};
      if (message.id !== root.id) byRoot[root.id].replies.push(message);
    });

    return Object.keys(byRoot).map(function(id){
      byRoot[id].replies.sort(function(a,b){ return Number(a.createdAt || 0) - Number(b.createdAt || 0); });
      return byRoot[id];
    }).sort(function(a,b){
      var delta = Number(b.root.createdAt || 0) - Number(a.root.createdAt || 0);
      return newestFirst ? delta : -delta;
    });
  }

  function messageNode(message,isReply,threadRootId,currentUser){
    var article = document.createElement('article');
    article.className = 'rh-chat-message' + (isReply ? ' rh-chat-message--reply' : '');
    if (message.uid === currentUser.uid && message.profileId === currentUser.profileId) {
      article.classList.add('is-own');
    }
    article.dataset.messageId = message.id;
    article.setAttribute('aria-label',(isReply ? 'Resposta de ' : 'Comentário de ') + String(message.profileName || 'Usuário RabbitHub'));

    var bubble = document.createElement('div');
    bubble.className = 'rh-chat-bubble';
    var meta = document.createElement('div');
    meta.className = 'rh-chat-meta';
    var name = document.createElement('strong');
    name.textContent = String(message.profileName || 'Usuário RabbitHub');
    var plan = document.createElement('span');
    plan.className = 'rh-chat-plan';
    plan.textContent = String(message.plan || 'Free');
    var time = document.createElement('time');
    time.textContent = formatDate(message.createdAt);
    if (message.createdAt && isFinite(Number(message.createdAt))) {
      time.dateTime = new Date(Number(message.createdAt)).toISOString();
    }
    time.title = [exactDate(message.createdAt),String(message.episodeName || '')].filter(Boolean).join(' • ');
    meta.appendChild(name); meta.appendChild(plan); meta.appendChild(time);
    bubble.appendChild(meta);

    if (!isReply && message.replyToText) {
      var quote = document.createElement('div');
      quote.className = 'rh-chat-quote';
      var quoteName = document.createElement('strong');
      quoteName.textContent = String(message.replyToName || 'Comentário original');
      var quoteText = document.createElement('span');
      quoteText.textContent = String(message.replyToText).slice(0,180);
      quote.appendChild(quoteName); quote.appendChild(quoteText); bubble.appendChild(quote);
    }

    var commentText = document.createElement('div');
    commentText.className = 'rh-chat-text' + (message.spoiler === true ? ' is-spoiler' : '');
    var commentContent = document.createElement('span');
    commentContent.className = 'rh-chat-spoiler-content';
    if (isReply && message.replyToName) {
      var mention = document.createElement('span');
      mention.className = 'rh-chat-mention';
      mention.textContent = '@' + String(message.replyToName).trim() + ' ';
      commentContent.appendChild(mention);
    }
    commentContent.appendChild(document.createTextNode(String(message.text || '')));
    commentText.appendChild(commentContent);
    if(message.spoiler===true){
      commentContent.setAttribute('aria-hidden','true');
      var reveal=document.createElement('button');
      reveal.type='button';reveal.className='rh-chat-spoiler-reveal';reveal.textContent='Exibir spoiler';reveal.setAttribute('aria-expanded','false');
      reveal.addEventListener('click',function(){commentText.classList.add('is-revealed');commentContent.setAttribute('aria-hidden','false');reveal.setAttribute('aria-expanded','true');});
      commentText.appendChild(reveal);
    }
    bubble.appendChild(commentText);

    var actions = document.createElement('div');
    actions.className = 'rh-chat-message-actions';
    var reply = document.createElement('button');
    reply.type = 'button';
    reply.className = 'rh-chat-reply';
    reply.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg><span>Responder</span>';
    reply.setAttribute('aria-label','Responder a ' + String(message.profileName || 'este comentário'));
    reply.addEventListener('click',function(){
      expandedThreads[threadRootId] = true;
      setReply(message,threadRootId);
    });
    actions.appendChild(reply);
    if(message.uid!==currentUser.uid||message.profileId!==currentUser.profileId){
      var report=document.createElement('button');report.type='button';report.className='rh-chat-report';report.textContent='Denunciar';
      report.addEventListener('click',function(){openReportDialog(message);});
      var block=document.createElement('button');block.type='button';block.className='rh-chat-block';block.textContent='Bloquear';
      block.addEventListener('click',function(){if(confirm('Bloquear '+String(message.profileName||'este usuário')+' neste perfil?'))blockUser(message);});
      actions.appendChild(report);actions.appendChild(block);
    }
    bubble.appendChild(actions);
    article.appendChild(avatarNode(message)); article.appendChild(bubble);
    return article;
  }

  function threadNode(thread,currentUser){
    var rootId = thread.root.id;
    var section = document.createElement('section');
    section.className = 'rh-chat-thread';
    section.dataset.threadId = rootId;
    section.appendChild(messageNode(thread.root,false,rootId,currentUser));
    if (!thread.replies.length) return section;

    var containsFocus = thread.replies.some(function(message){ return message.id === focusMessageId; });
    if (containsFocus || thread.root.id === focusMessageId) expandedThreads[rootId] = true;
    var repliesId = 'rh-chat-replies-' + safeSegment(rootId);
    var replies = document.createElement('div');
    replies.className = 'rh-chat-thread-replies';
    replies.id = repliesId;
    replies.hidden = !expandedThreads[rootId];
    thread.replies.forEach(function(message){
      replies.appendChild(messageNode(message,true,rootId,currentUser));
    });

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rh-chat-thread-toggle' + (expandedThreads[rootId] ? ' is-open' : '');
    toggle.setAttribute('aria-controls',repliesId);
    toggle.setAttribute('aria-expanded',expandedThreads[rootId] ? 'true' : 'false');
    var icon = document.createElement('span');
    icon.className = 'rh-chat-thread-chevron';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    var label = document.createElement('span');
    var replyLabel = thread.replies.length === 1 ? '1 resposta' : thread.replies.length + ' respostas';
    label.textContent = expandedThreads[rootId] ? 'Ocultar ' + replyLabel : 'Ver ' + replyLabel;
    toggle.appendChild(icon); toggle.appendChild(label);
    toggle.addEventListener('click',function(){
      expandedThreads[rootId] = !expandedThreads[rootId];
      replies.hidden = !expandedThreads[rootId];
      toggle.classList.toggle('is-open',expandedThreads[rootId]);
      toggle.setAttribute('aria-expanded',expandedThreads[rootId] ? 'true' : 'false');
      label.textContent = expandedThreads[rootId] ? 'Ocultar ' + replyLabel : 'Ver ' + replyLabel;
    });
    section.appendChild(toggle);
    section.appendChild(replies);
    return section;
  }

  function renderMessages(snapshot){
    lastMessageSnapshot=snapshot;
    var list = [];
    snapshot.forEach(function(child){
      var value = child.val() || {};
      value.id = child.key;
      if(!isBlocked(value))list.push(value);
    });
    syncCommentCount(list.length);
    if (!list.length) {
      emptyState('Comece a conversa','Seja a primeira pessoa a comentar sobre este anime.');
      if(blockedUsers().length){
        var release=document.createElement('button');release.type='button';release.className='rh-chat-blocked-manage';release.textContent='Gerenciar usuários bloqueados';
        release.addEventListener('click',function(){if(confirm('Liberar todos os usuários bloqueados neste perfil?'))clearBlocks();});
        els.messages.appendChild(release);
      }
      return;
    }
    var previousScroll = els.messages.scrollTop;
    var firstRender = !hasRenderedMessages;
    var currentUser = context();
    els.messages.innerHTML = '';
    buildThreads(list).forEach(function(thread){
      els.messages.appendChild(threadNode(thread,currentUser));
    });
    var blocks=blockedUsers();
    if(blocks.length){
      var manage=document.createElement('button');manage.type='button';manage.className='rh-chat-blocked-manage';manage.textContent=blocks.length+(blocks.length===1?' usuário bloqueado • liberar':' usuários bloqueados • liberar todos');
      manage.addEventListener('click',function(){if(confirm('Liberar todos os usuários bloqueados neste perfil?'))clearBlocks();});
      els.messages.appendChild(manage);
    }
    hasRenderedMessages = true;
    window.requestAnimationFrame(function(){
      var focused = null;
      if (focusMessageId) {
        Array.prototype.some.call(els.messages.querySelectorAll('[data-message-id]'),function(node){
          if (node.dataset.messageId === focusMessageId) { focused = node; return true; }
          return false;
        });
      }
      if (focused) {
        focused.classList.add('rh-chat-message--highlight');
        focused.scrollIntoView({block:'center',behavior:'smooth'});
      } else if (firstRender) {
        els.messages.scrollTop = 0;
      } else {
        els.messages.scrollTop = Math.min(previousScroll,Math.max(0,els.messages.scrollHeight - els.messages.clientHeight));
      }
    });
  }

  function stopMessages(){
    if (messageQuery && messageHandler) {
      try { messageQuery.off('value',messageHandler); } catch(e){}
    }
    messageQuery = null; messageHandler = null;
  }

  function startMessages(){
    stopMessages();
    if (!messagesRef) return;
    hasRenderedMessages = false;
    emptyState('Carregando comentários','Sincronizando a conversa deste anime...');
    messageQuery = messagesRef.limitToLast(100);
    messageHandler = renderMessages;
    messageQuery.on('value',messageHandler,function(){
      emptyState('Não foi possível carregar','Confira sua conexão e tente abrir o chat novamente.');
    });
  }

  function openChat(){
    if (!enabled || opened) return;
    opened = true;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    els.overlay.classList.add('open');
    els.overlay.setAttribute('aria-hidden','false');
    renderComposerAvatar();
    startMessages();
    window.setTimeout(function(){ els.input.focus(); },260);
  }

  function closeChat(){
    if (!opened) return;
    if (publicProfileOpen) closePublicProfile();
    opened = false;
    els.overlay.classList.remove('open');
    els.overlay.setAttribute('aria-hidden','true');
    document.body.style.overflow = previousOverflow;
    stopMessages();
    setReply(null);
    els.button.focus();
  }

  function updateCounter(){
    els.chars.textContent = String(els.input.value.length) + '/500';
    els.status.textContent = '';
  }

  function reportLedgerKey(){var user=context();return 'rh_chat_reports_v1_'+safeSegment(user.uid)+'_'+safeSegment(user.profileId);}
  function recentLocalReports(){
    var cutoff=Date.now()-3*24*60*60*1000,list=readJSON(reportLedgerKey(),[]);
    list=(Array.isArray(list)?list:[]).map(Number).filter(function(value){return value>=cutoff;});
    try{localStorage.setItem(reportLedgerKey(),JSON.stringify(list));}catch(e){}
    return list;
  }
  function ensureReportDialog(){
    var overlay=document.getElementById('rh-chat-report-overlay');if(overlay)return overlay;
    overlay=document.createElement('div');overlay.id='rh-chat-report-overlay';overlay.className='rh-chat-report-overlay';overlay.hidden=true;
    overlay.innerHTML='<form class="rh-chat-report-card" id="rh-chat-report-form"><div class="rh-chat-report-head"><div><span>MODERAÇÃO</span><strong>Denunciar comentário</strong></div><button type="button" data-report-close aria-label="Fechar">×</button></div><p id="rh-chat-report-copy">Escolha o motivo da denúncia.</p><label><input type="radio" name="chat-report-reason" value="spam" required><span>Spam ou propaganda</span></label><label><input type="radio" name="chat-report-reason" value="ofensa"><span>Ofensa ou assédio</span></label><label><input type="radio" name="chat-report-reason" value="spoiler"><span>Spoiler sem aviso</span></label><label><input type="radio" name="chat-report-reason" value="conteudo"><span>Conteúdo inadequado</span></label><textarea id="rh-chat-report-details" maxlength="240" placeholder="Explique brevemente (opcional)"></textarea><small>Limite: 2 denúncias a cada 3 dias.</small><p class="rh-chat-report-status" id="rh-chat-report-status" role="status"></p><button class="rh-chat-report-submit" type="submit">Enviar denúncia</button></form>';
    document.body.appendChild(overlay);
    function close(){overlay.hidden=true;reportTarget=null;}
    overlay.querySelector('[data-report-close]').addEventListener('click',close);
    overlay.addEventListener('click',function(event){if(event.target===overlay)close();});
    overlay.querySelector('form').addEventListener('submit',function(event){
      event.preventDefault();if(!reportTarget)return;
      var form=event.currentTarget,reason=form.querySelector('input[name="chat-report-reason"]:checked'),status=form.querySelector('#rh-chat-report-status'),submit=form.querySelector('.rh-chat-report-submit');
      if(!reason){status.textContent='Escolha um motivo.';return;}
      var user=context(),reports=socialRef('reports/'+safeSegment(user.uid)+'/'+safeSegment(user.profileId));
      var limitRef=socialRef('reportLimits/'+safeSegment(user.uid)+'/'+safeSegment(user.profileId));
      if(!reports||!limitRef){status.textContent='Denúncias indisponíveis agora.';return;}
      var cutoff=Date.now()-3*24*60*60*1000,localRecent=recentLocalReports();submit.disabled=true;status.textContent='Verificando seu limite...';
      if(localRecent.length>=2){status.textContent='Você já usou as 2 denúncias permitidas nestes 3 dias.';submit.disabled=false;return;}
      var limitExceeded=false,selectedSlot='',selectedTimestamp=0;
      limitRef.transaction(function(current){
        current=current&&typeof current==='object'?current:{};
        var stored=current.timestamps&&typeof current.timestamps==='object'?current.timestamps:{};
        var values=Object.keys(stored).map(function(key){return Number(stored[key]);}).filter(function(value){return value>=cutoff;}).sort();
        if(values.length>=2){limitExceeded=true;return;}
        var slots={};
        ['slot0','slot1'].forEach(function(key){var value=Number(stored[key]);if(value>=cutoff)slots[key]=value;});
        Object.keys(stored).filter(function(key){return key!=='slot0'&&key!=='slot1'&&Number(stored[key])>=cutoff;}).forEach(function(key){
          var target=slots.slot0==null?'slot0':(slots.slot1==null?'slot1':'');if(target)slots[target]=Number(stored[key]);
        });
        var freeSlot=slots.slot0==null?'slot0':'slot1',reservedAt=Date.now();
        selectedSlot=freeSlot;selectedTimestamp=reservedAt;slots[freeSlot]=reservedAt;
        return {timestamps:slots,updatedAt:Date.now()};
      }).then(function(result){
        if(limitExceeded||!result.committed)throw new Error('Você já usou as 2 denúncias permitidas nestes 3 dias.');
        if(!selectedSlot)throw new Error('Não foi possível reservar o limite da denúncia.');
        var target=reportTarget,entry=reports.child(selectedSlot);
        var payload={reporterUid:user.uid,reporterProfileId:user.profileId,reporterName:user.profileName,targetUid:String(target.uid||''),targetProfileId:String(target.profileId||''),targetName:String(target.profileName||'Usuário').slice(0,40),messageId:String(target.id||''),messageText:String(target.text||'').slice(0,500),animeSlug:animeSlug,animeKey:animeKey,animeTitle:animeTitle,reason:reason.value,details:String(form.querySelector('#rh-chat-report-details').value||'').trim().slice(0,240),status:'new',createdAt:selectedTimestamp};
        return entry.set(payload).then(function(){
          var primary=primaryDatabase();
          if(primary)return primary.ref('chatReports/'+safeSegment(user.uid)+'/'+safeSegment(entry.key)).set(payload).catch(function(){});
        });
      }).then(function(){
        localRecent.push(Date.now());localStorage.setItem(reportLedgerKey(),JSON.stringify(localRecent));status.textContent='Denúncia enviada para a moderação.';form.reset();setTimeout(close,1100);
      }).catch(function(error){status.textContent=error&&error.message||'Não foi possível enviar.';}).then(function(){submit.disabled=false;});
    });
    return overlay;
  }
  function openReportDialog(message){
    reportTarget=message;var overlay=ensureReportDialog(),copy=overlay.querySelector('#rh-chat-report-copy'),status=overlay.querySelector('#rh-chat-report-status');
    copy.textContent='Denunciar o comentário de '+String(message.profileName||'Usuário')+'.';status.textContent='';overlay.hidden=false;
    var first=overlay.querySelector('input');if(first)first.focus();
  }

  function saveCommentIndexes(message,id,user,target){
    var jobs = [];
    var indexRef = socialRef('userComments/' + safeSegment(user.uid) + '/' + safeSegment(user.profileId) + '/' + safeSegment(id));
    if (indexRef) jobs.push(indexRef.set({
      messageId:id,animeSlug:animeSlug,animeTitle:animeTitle,text:message.spoiler ? 'Comentário marcado como spoiler' : message.text,
      animeCover:animeCover,episodeIndex:message.episodeIndex,episodeName:message.episodeName,createdAt:message.createdAt
    }));
    if (target && target.uid && (target.uid !== user.uid || target.profileId !== user.profileId)) {
      var notificationsRef = socialRef('notifications/' + safeSegment(target.uid) + '/' + safeSegment(target.profileId));
      if (notificationsRef) {
        var notification = notificationsRef.push();
        jobs.push(notification.set({
          authorUid:user.uid,
          authorProfileId:user.profileId,
          authorName:user.profileName,
          authorAvatar:user.profileAvatar,
          replyText:message.spoiler ? 'Resposta marcada como spoiler' : message.text,
          commentText:target.spoiler ? 'Comentário marcado como spoiler' : String(target.text || '').slice(0,300),
          animeSlug:animeSlug,
          animeKey:animeKey,
          animeTitle:animeTitle,
          episodeIndex:message.episodeIndex,
          episodeName:message.episodeName,
          messageId:id,
          targetMessageId:target.id || '',
          read:false,
          createdAt:message.createdAt
        }));
      }
    }
    return Promise.all(jobs.map(function(job){ return job.catch(function(){}); }));
  }

  function sendMessage(event){
    if (event) event.preventDefault();
    if (!enabled || !messagesRef) return;
    var text = String(els.input.value || '').trim();
    if (text.length < 2) {
      els.status.textContent = 'Escreva ao menos 2 caracteres.';
      els.input.focus();
      return;
    }
    if (text.length > 500) return;
    var user = context();
    if (!user.uid || !user.profileId) {
      els.status.textContent = 'Escolha um perfil antes de comentar.';
      return;
    }
    var throttleKey = 'rh_chat_last_' + safeSegment(user.uid) + '_' + animeKey;
    var last = Number(localStorage.getItem(throttleKey) || 0);
    if (Date.now() - last < 4000) {
      els.status.textContent = 'Aguarde alguns segundos antes de enviar novamente.';
      return;
    }
    els.send.disabled = true;
    els.status.textContent = 'Enviando...';
    var target = replyTarget;
    var messageRef = messagesRef.push();
    var episodeIndex = parseInt(new URLSearchParams(location.search).get('idx') || '0',10);
    if (!isFinite(episodeIndex) || episodeIndex < 0) episodeIndex = 0;
    var episodeName = String(new URLSearchParams(location.search).get('nome') || '').trim().slice(0,100) || 'Episódio';
    var message = {
      uid:user.uid,
      profileId:user.profileId,
      profileName:user.profileName,
      profileAvatar:user.profileAvatar,
      profileBio:user.profileBio,
      profileBanner:user.profileBanner,
      theme:user.theme,
      plan:user.plan,
      spoiler:spoilerActive && hasSpoilerAccess(),
      text:text,
      animeSlug:animeSlug,
      animeTitle:animeTitle,
      episodeIndex:episodeIndex,
      episodeName:episodeName,
      replyToId:target ? String(target.id || '') : '',
      replyToUid:target ? String(target.uid || '') : '',
      replyToProfileId:target ? String(target.profileId || '') : '',
      replyToName:target ? String(target.profileName || 'Usuário').slice(0,40) : '',
      replyToText:target ? (target.spoiler ? 'Comentário marcado como spoiler' : String(target.text || '').slice(0,180)) : '',
      createdAt:timestamp()
    };
    messageRef.set(message).then(function(){
      localStorage.setItem(throttleKey,String(Date.now()));
      if (window.RabbitHubProfileData && window.RabbitHubProfileData.syncPublicProfile) {
        window.RabbitHubProfileData.syncPublicProfile({
          profileName:user.profileName,
          profileAvatar:user.profileAvatar,
          bio:user.profileBio,
          banner:user.profileBanner,
          theme:user.theme,
          plan:user.plan
        });
      }
      return saveCommentIndexes(message,messageRef.key,user,target);
    }).then(function(){
      els.input.value = '';
      spoilerActive = false;
      syncSpoilerToggle();
      setReply(null);
      updateCounter();
    }).catch(function(error){
      try { console.error('[RabbitHub comentários] Falha ao enviar:',error); } catch(ignore){}
      var code = String(error && error.code || '').toLowerCase();
      if (code.indexOf('permission') !== -1) {
        els.status.textContent = 'O serviço de comentários recusou o envio. Tente novamente em instantes.';
      } else if (code.indexOf('network') !== -1 || code.indexOf('disconnected') !== -1) {
        els.status.textContent = 'Sem conexão com os comentários. Verifique sua internet.';
      } else {
        els.status.textContent = 'Não foi possível enviar. Tente novamente.';
      }
    }).then(function(){ els.send.disabled = false; });
  }

  function setEnabled(value){
    enabled = value === true;
    els.button.hidden = !enabled;
    if (!enabled) closeChat();
    if (enabled && messagesRef) {
      messagesRef.limitToLast(100).once('value').then(function(snapshot){
        syncCommentCount(snapshot.numChildren());
      }).catch(function(){ syncCommentCount(0); });
      if (autoOpenRequested) {
        autoOpenRequested = false;
        openChat();
      }
    }
  }

  function bind(){
    els.button.addEventListener('click',openChat);
    els.close.addEventListener('click',closeChat);
    els.overlay.addEventListener('click',function(event){ if (event.target === els.overlay) closeChat(); });
    if (els.publicProfileBack) els.publicProfileBack.addEventListener('click',closePublicProfile);
    if (els.publicProfileOverlay) els.publicProfileOverlay.addEventListener('click',function(event){
      if (event.target === els.publicProfileOverlay) closePublicProfile();
    });
    els.form.addEventListener('submit',sendMessage);
    els.input.addEventListener('input',updateCounter);
    els.input.addEventListener('keydown',function(event){
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendMessage(event);
    });
    if(els.spoiler)els.spoiler.addEventListener('click',function(){
      if(!hasSpoilerAccess()){
        els.status.textContent='Marcar comentários como spoiler é um recurso VIP.';
        return;
      }
      spoilerActive=!spoilerActive;syncSpoilerToggle();
    });
    if (els.replyCancel) els.replyCancel.addEventListener('click',function(){ setReply(null); });
    if (els.sort) els.sort.addEventListener('click',function(){
      newestFirst = !newestFirst;
      els.sort.classList.toggle('is-oldest',!newestFirst);
      els.sort.setAttribute('aria-pressed',newestFirst ? 'false' : 'true');
      els.sort.setAttribute('aria-label',newestFirst ? 'Ordenar do mais antigo' : 'Ordenar do mais recente');
      els.sort.title = newestFirst ? 'Mais recentes primeiro' : 'Mais antigos primeiro';
      hasRenderedMessages = false;
      if (lastMessageSnapshot) renderMessages(lastMessageSnapshot);
    });
    document.addEventListener('keydown',function(event){
      if (event.key !== 'Escape') return;
      if (publicProfileOpen) closePublicProfile();
      else if (opened) closeChat();
    });
    document.addEventListener('rh:planchange',syncSpoilerToggle);
    document.addEventListener('dk:profilechange',renderComposerAvatar);
  }

  function boot(){
    els = {
      button:document.getElementById('rh-chat-open'),
      count:document.getElementById('rh-chat-count'),
      panelCount:document.getElementById('rh-chat-panel-count'),
      overlay:document.getElementById('rh-chat-overlay'),
      close:document.getElementById('rh-chat-close'),
      sort:document.getElementById('rh-chat-sort'),
      title:document.getElementById('rh-chat-title'),
      messages:document.getElementById('rh-chat-messages'),
      form:document.getElementById('rh-chat-form'),
      input:document.getElementById('rh-chat-input'),
      send:document.getElementById('rh-chat-send'),
      chars:document.getElementById('rh-chat-chars'),
      status:document.getElementById('rh-chat-status'),
      composeAvatar:document.getElementById('rh-chat-compose-avatar'),
      spoiler:document.getElementById('rh-chat-spoiler'),
      replying:document.getElementById('rh-chat-replying'),
      replyName:document.getElementById('rh-chat-reply-name'),
      replyCancel:document.getElementById('rh-chat-reply-cancel'),
      publicProfileOverlay:document.getElementById('rh-public-profile-overlay'),
      publicProfilePanel:document.getElementById('rh-public-profile-panel'),
      publicProfileBack:document.getElementById('rh-public-profile-back'),
      publicProfileAvatar:document.getElementById('rh-public-profile-avatar'),
      publicProfileCover:document.getElementById('rh-public-profile-cover'),
      publicProfileName:document.getElementById('rh-public-profile-name'),
      publicProfilePlan:document.getElementById('rh-public-profile-plan'),
      publicProfileBio:document.getElementById('rh-public-profile-bio'),
      publicProfileComments:document.getElementById('rh-public-profile-comments'),
      publicProfileCommentsCount:document.getElementById('rh-public-profile-comments-count')
    };
    if (!els.button || !els.overlay) return;
    var params = new URLSearchParams(location.search);
    animeSlug = String(params.get('anime') || 'anime').trim().slice(0,180) || 'anime';
    animeKey = safeSegment(animeSlug);
    animeTitle = String(params.get('titulo') || animeSlug || 'Anime').trim().slice(0,160) || 'Anime';
    animeCover = String(params.get('capa') || '').trim().slice(0,600);
    autoOpenRequested = params.get('chat') === '1';
    focusMessageId = String(params.get('comentario') || '').slice(0,100);
    els.title.textContent = animeTitle;
    messagesRef = socialRef('animeChats/' + animeKey + '/messages');
    if (!messagesRef) {
      els.button.hidden = false;
      els.button.disabled = true;
      var socialStatus = window.RabbitHubSocial && window.RabbitHubSocial.status
        ? window.RabbitHubSocial.status() : {};
      els.button.title = socialStatus.error || 'Configure o Firebase social para habilitar os comentários.';
      return;
    }
    bind();
    renderComposerAvatar();
    syncSpoilerToggle();
    updateCounter();
    var primary = primaryDatabase();
    configRef = primary ? primary.ref('dk_broadcast/config/playerChatEnabled') : null;
    if (!configRef) { setEnabled(true); return; }
    configRef.on('value',function(snapshot){ setEnabled(snapshot.val() !== false); },function(){ setEnabled(true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
