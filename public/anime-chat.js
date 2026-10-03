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
  var autoOpenRequested = false;
  var focusMessageId = '';
  var replyTarget = null;
  var spoilerActive = false;
  var reportTarget = null;
  var lastMessageSnapshot = null;
  var expandedThreads = {};
  var hasRenderedMessages = false;
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
    return {
      uid:String(session.uid || ''),
      profileId:String(profile.id || 'principal'),
      profileName:String(profile.name || session.displayName || 'Usuário RabbitHub').trim().slice(0,40),
      profileAvatar:String(profile.avatar || '').trim().slice(0,600),
      profileBio:String(profile.bio || session.bio || '').trim().slice(0,280),
      profileBanner:String(visual.banner || 'default').slice(0,80),
      theme:String(window.DK_getTheme ? window.DK_getTheme() : 'blue').slice(0,30),
      plan:String(access.name || session.plan || session.currentPlan || 'Free').slice(0,30)
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
    var avatar = document.createElement('div');
    avatar.className = 'rh-chat-avatar';
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
    return avatar;
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
      return Number(b.root.createdAt || 0) - Number(a.root.createdAt || 0);
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
    reply.textContent = 'Responder';
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
    els.count.textContent = String(list.length);
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
    startMessages();
    window.setTimeout(function(){ els.input.focus(); },260);
  }

  function closeChat(){
    if (!opened) return;
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
      var limitExceeded=false;
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
        var freeSlot=slots.slot0==null?'slot0':'slot1';slots[freeSlot]=Date.now();
        return {timestamps:slots,updatedAt:Date.now()};
      }).then(function(result){
        if(limitExceeded||!result.committed)throw new Error('Você já usou as 2 denúncias permitidas nestes 3 dias.');
        var target=reportTarget,entry=reports.push();
        var payload={reporterUid:user.uid,reporterProfileId:user.profileId,reporterName:user.profileName,targetUid:String(target.uid||''),targetProfileId:String(target.profileId||''),targetName:String(target.profileName||'Usuário').slice(0,40),messageId:String(target.id||''),messageText:String(target.text||'').slice(0,500),animeSlug:animeSlug,animeTitle:animeTitle,reason:reason.value,details:String(form.querySelector('#rh-chat-report-details').value||'').trim().slice(0,240),status:'new',createdAt:timestamp()};
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
      episodeIndex:message.episodeIndex,episodeName:message.episodeName,createdAt:message.createdAt
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
      episodeIndex:Number(new URLSearchParams(location.search).get('idx') || 0),
      episodeName:String(new URLSearchParams(location.search).get('nome') || 'Episódio').slice(0,100),
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
        window.RabbitHubProfileData.syncPublicProfile(user);
      }
      return saveCommentIndexes(message,messageRef.key,user,target);
    }).then(function(){
      els.input.value = '';
      spoilerActive = false;
      syncSpoilerToggle();
      setReply(null);
      updateCounter();
    }).catch(function(){
      els.status.textContent = 'Não foi possível enviar. Tente novamente.';
    }).then(function(){ els.send.disabled = false; });
  }

  function setEnabled(value){
    enabled = value === true;
    els.button.hidden = !enabled;
    if (!enabled) closeChat();
    if (enabled && messagesRef) {
      messagesRef.limitToLast(100).once('value').then(function(snapshot){
        els.count.textContent = String(snapshot.numChildren());
      }).catch(function(){ els.count.textContent = '0'; });
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
    document.addEventListener('keydown',function(event){ if (event.key === 'Escape' && opened) closeChat(); });
    document.addEventListener('rh:planchange',syncSpoilerToggle);
  }

  function boot(){
    els = {
      button:document.getElementById('rh-chat-open'),
      count:document.getElementById('rh-chat-count'),
      overlay:document.getElementById('rh-chat-overlay'),
      close:document.getElementById('rh-chat-close'),
      title:document.getElementById('rh-chat-title'),
      messages:document.getElementById('rh-chat-messages'),
      form:document.getElementById('rh-chat-form'),
      input:document.getElementById('rh-chat-input'),
      send:document.getElementById('rh-chat-send'),
      chars:document.getElementById('rh-chat-chars'),
      status:document.getElementById('rh-chat-status'),
      spoiler:document.getElementById('rh-chat-spoiler'),
      replying:document.getElementById('rh-chat-replying'),
      replyName:document.getElementById('rh-chat-reply-name'),
      replyCancel:document.getElementById('rh-chat-reply-cancel')
    };
    if (!els.button || !els.overlay) return;
    var params = new URLSearchParams(location.search);
    animeSlug = String(params.get('anime') || 'anime');
    animeKey = safeSegment(animeSlug);
    animeTitle = String(params.get('titulo') || animeSlug || 'Anime');
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
