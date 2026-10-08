/* X-Bunny Animes • central de notificações da conta e do perfil ativo. */
(function(){
  'use strict';

  var state = {
    items:[], filter:'all', reads:{},
    sources:{reply:[],broadcast:[],global:[],user:[]},
    refs:{social:null,reads:null}, ready:{}, errors:0
  };
  var els = {};

  function readJSON(key,fallback){
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch(e){ return fallback; }
  }

  function safeSegment(value){
    if (window.RabbitHubUid && window.RabbitHubUid.safeSegment) return window.RabbitHubUid.safeSegment(value);
    return String(value || 'item').replace(/[.#$\[\]\/]/g,'_').slice(0,180);
  }

  function socialRef(path){
    try { return window.RabbitHubSocial && window.RabbitHubSocial.ref ? window.RabbitHubSocial.ref(path) : null; }
    catch(e){ return null; }
  }

  function primaryDatabase(){
    try {
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      var app;
      try { app = firebase.app(); }
      catch(e) { app = firebase.initializeApp(window.DK_FIREBASE_CONFIG); }
      window.__DK_FB_INIT__ = true;
      return app.database();
    } catch(e){ return null; }
  }

  function socialTimestamp(){
    try { return window.RabbitHubSocial && window.RabbitHubSocial.timestamp ? window.RabbitHubSocial.timestamp() : firebase.database.ServerValue.TIMESTAMP; }
    catch(e){ return Date.now(); }
  }

  function primaryTimestamp(){
    try { return firebase.database.ServerValue.TIMESTAMP; }
    catch(e){ return Date.now(); }
  }

  function context(){
    var session = readJSON('dk_session',{}) || {};
    var profile = readJSON('dk_active_profile',{}) || {};
    return {
      uid:String(session.uid || ''),
      profileId:String(profile.id || 'principal'),
      name:String(profile.name || session.displayName || 'Perfil'),
      avatar:String(profile.avatar || '')
    };
  }

  function safeImage(value){
    value = String(value || '').trim();
    if (!value) return '';
    try {
      var url = new URL(value,location.href);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch(e){ return ''; }
  }

  function safeHref(value){
    value = String(value || '').trim();
    if (!value || /^javascript:/i.test(value)) return '';
    try {
      var url = new URL(value,location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.origin === location.origin ? url.pathname + url.search + url.hash : url.href;
    } catch(e){ return ''; }
  }

  function hydrateProfile(){
    var profile = context();
    if (!els.profileName || !els.profileAvatar) return;
    els.profileName.textContent = profile.name;
    var image = safeImage(profile.avatar);
    els.profileAvatar.textContent = profile.name.trim().charAt(0).toUpperCase() || 'R';
    els.profileAvatar.classList.toggle('has-image',!!image);
    els.profileAvatar.style.backgroundImage = image ? 'url("' + image.replace(/"/g,'%22') + '")' : 'none';
  }

  function formatDate(value){
    var stamp = Number(value) || 0;
    if (!stamp) return '';
    var elapsed = Math.max(0,Date.now() - stamp);
    if (elapsed < 60000) return 'agora';
    if (elapsed < 3600000) return 'há ' + Math.floor(elapsed / 60000) + ' min';
    if (elapsed < 86400000) return 'há ' + Math.floor(elapsed / 3600000) + ' h';
    if (elapsed < 604800000) return 'há ' + Math.floor(elapsed / 86400000) + ' d';
    try { return new Date(stamp).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}); }
    catch(e){ return ''; }
  }

  function playerUrl(item){
    if (!item.animeSlug) return 'index.html';
    var params = new URLSearchParams();
    params.set('anime',item.animeSlug);
    params.set('titulo',item.contextTitle || 'Anime');
    params.set('chat','1');
    if (item.messageId) params.set('comentario',item.messageId);
    if (isFinite(item.episodeIndex)) params.set('idx',String(Math.max(0,item.episodeIndex)));
    if (item.episodeName) params.set('nome',item.episodeName);
    return 'player-animes.html?' + params.toString();
  }

  function readKey(source,id){
    return safeSegment(source + '__' + String(id || 'item')).slice(0,220);
  }

  function normalizeReply(raw,id){
    raw = raw && typeof raw === 'object' ? raw : {};
    var item = {
      id:String(id || raw.id || ''), source:'reply', category:'reply',
      authorName:String(raw.authorName || raw.fromProfileName || raw.profileName || 'Usuário X-Bunny Animes').slice(0,50),
      authorAvatar:String(raw.authorAvatar || raw.fromProfileAvatar || raw.profileAvatar || ''),
      title:'respondeu ao seu comentário',
      message:String(raw.replyText || raw.text || raw.message || 'Abra para ver a resposta.').trim().slice(0,500),
      original:String(raw.commentText || raw.originalComment || '').trim().slice(0,300),
      animeSlug:String(raw.animeSlug || raw.slug || '').slice(0,180),
      contextTitle:String(raw.animeTitle || raw.title || 'Anime').slice(0,120),
      episodeIndex:Number(raw.episodeIndex), episodeName:String(raw.episodeName || '').slice(0,100),
      messageId:String(raw.messageId || '').slice(0,100),
      createdAt:Number(raw.createdAt || raw.timestamp || 0), read:raw.read === true
    };
    item.href = playerUrl(item);
    return item;
  }

  function noticeType(raw){
    return String(raw.category || raw.variant || raw.type || raw.kind || 'info').toLowerCase();
  }

  function normalizeMain(raw,id,source){
    raw = raw && typeof raw === 'object' ? raw : {};
    var kind = noticeType(raw);
    var warning = /warning|warn|danger|error|policy|violation|termos/.test(kind);
    var ownerMessage = source === 'broadcast' || source === 'global';
    var key = readKey(source,id || raw.id);
    return {
      id:String(id || raw.id || ''), source:source, category:'system', readKey:key,
      authorName:ownerMessage ? 'X-Bunny Animes' : (warning ? 'Equipe de segurança' : 'Sistema X-Bunny Animes'),
      authorAvatar:'img/logo-blue.jpg', warning:warning,
      title:String(raw.title || (warning ? 'Aviso importante sobre sua conta' : 'Mensagem para você')).trim().slice(0,120),
      message:String(raw.body || raw.message || raw.text || '').trim().slice(0,700),
      contextTitle:warning ? 'Termos e segurança da plataforma' : (ownerMessage ? 'Comunicado do dono do site' : 'Notificação do sistema'),
      createdAt:Number(raw.updatedAt || raw.createdAt || raw.timestamp || 0),
      href:safeHref(raw.buttonUrl || raw.url || raw.link || ''),
      read:!!state.reads[key]
    };
  }

  function rebuild(){
    var combined = [];
    Object.keys(state.sources).forEach(function(source){ combined = combined.concat(state.sources[source] || []); });
    combined.forEach(function(item){
      if (item.source !== 'reply' && item.readKey) item.read = !!state.reads[item.readKey];
    });
    combined.sort(function(a,b){ return b.createdAt - a.createdAt; });
    state.items = combined;
    render();
  }

  function stateMarkup(kind){
    var wrap = document.createElement('div');
    wrap.className = 'chat-state';
    var icon = document.createElement('span');
    icon.className = 'chat-state-icon';
    icon.innerHTML = '<img data-dk-logo src="img/logo-blue.jpg" alt="">';
    var title = document.createElement('strong');
    var text = document.createElement('p');
    if (kind === 'unread') {
      title.textContent = 'Tudo em dia';
      text.textContent = 'Você não tem notificações novas neste perfil.';
    } else if (kind === 'filtered') {
      title.textContent = 'Nada neste filtro';
      text.textContent = 'Quando houver uma nova atividade deste tipo, ela aparecerá aqui.';
    } else if (kind === 'error') {
      title.textContent = 'Não foi possível carregar';
      text.textContent = 'Confira sua conexão e tente novamente em instantes.';
    } else {
      title.textContent = 'Nenhuma notificação por aqui';
      text.textContent = 'Respostas, comunicados e avisos da sua conta aparecerão nesta tela.';
    }
    wrap.appendChild(icon); wrap.appendChild(title); wrap.appendChild(text);
    if (kind === 'error') {
      var retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = 'Tentar novamente';
      retry.addEventListener('click',function(){ location.reload(); });
      wrap.appendChild(retry);
    } else if (kind === 'empty') {
      var link = document.createElement('a');
      link.href = 'index.html'; link.textContent = 'Explorar animes';
      wrap.appendChild(link);
    }
    return wrap;
  }

  function avatarNode(item){
    var avatar = document.createElement('span');
    avatar.className = 'chat-item-avatar' + (item.source === 'reply' ? '' : (item.warning ? ' is-warning' : ' is-system'));
    var image = safeImage(item.authorAvatar);
    if (item.source !== 'reply') {
      if (item.warning) {
        var mark = document.createElement('span');
        mark.className = 'chat-item-avatar-mark';
        mark.textContent = '!';
        avatar.appendChild(mark);
      } else {
        var logo = document.createElement('img');
        logo.setAttribute('data-dk-logo','');
        logo.src = image || 'img/logo-blue.jpg';
        logo.alt = '';
        avatar.appendChild(logo);
      }
    } else {
      avatar.textContent = item.authorName.charAt(0).toUpperCase() || 'R';
      if (image) {
        avatar.style.backgroundImage = 'url("' + image.replace(/"/g,'%22') + '")';
        avatar.style.color = 'transparent';
      }
    }
    return avatar;
  }

  function markRead(item){
    if (!item || item.read) return Promise.resolve();
    item.read = true;
    render();
    if (item.source === 'reply') {
      if (!state.refs.social || !item.id) return Promise.resolve();
      return state.refs.social.child(item.id).update({read:true,readAt:socialTimestamp()}).catch(function(){});
    }
    if (!state.refs.reads || !item.readKey) return Promise.resolve();
    state.reads[item.readKey] = Date.now();
    return state.refs.reads.child(item.readKey).set(primaryTimestamp()).catch(function(){});
  }

  function itemNode(item){
    var row = document.createElement(item.href ? 'a' : 'button');
    row.className = 'chat-item' + (item.read ? '' : ' unread');
    if (item.href) row.href = item.href; else row.type = 'button';
    row.addEventListener('click',function(){ markRead(item); });
    row.appendChild(avatarNode(item));

    var copy = document.createElement('span');
    copy.className = 'chat-item-copy';
    var meta = document.createElement('span');
    meta.className = 'chat-item-meta';
    var author = document.createElement('strong');
    author.textContent = item.authorName;
    var time = document.createElement('time');
    time.textContent = formatDate(item.createdAt);
    if (item.createdAt) {
      time.dateTime = new Date(item.createdAt).toISOString();
      time.title = new Date(item.createdAt).toLocaleString('pt-BR');
    }
    meta.appendChild(author); meta.appendChild(time);
    var title = document.createElement('span');
    title.className = 'chat-item-title';
    title.textContent = item.title;
    var message = document.createElement('span');
    message.className = 'chat-item-message';
    message.textContent = item.source === 'reply' && item.original
      ? item.message + ' • Seu comentário: “' + item.original + '”'
      : (item.message || 'Toque para abrir esta notificação.');
    var contextLabel = document.createElement('span');
    contextLabel.className = 'chat-item-context';
    contextLabel.textContent = item.contextTitle + (item.episodeName ? ' • ' + item.episodeName : '');
    copy.appendChild(meta); copy.appendChild(title); copy.appendChild(message); copy.appendChild(contextLabel);
    row.appendChild(copy);

    var side = document.createElement('span');
    side.className = 'chat-item-side';
    if (!item.read) {
      var dot = document.createElement('span');
      dot.className = 'chat-unread-dot'; dot.setAttribute('aria-label','Não lida');
      side.appendChild(dot);
    }
    if (item.href) {
      var arrow = document.createElement('span');
      arrow.className = 'chat-item-arrow';
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>';
      side.appendChild(arrow);
    }
    row.appendChild(side);
    return row;
  }

  function filteredItems(){
    if (state.filter === 'unread') return state.items.filter(function(item){ return !item.read; });
    if (state.filter === 'reply') return state.items.filter(function(item){ return item.category === 'reply'; });
    if (state.filter === 'system') return state.items.filter(function(item){ return item.category === 'system'; });
    return state.items.slice();
  }

  function render(){
    var unread = state.items.filter(function(item){ return !item.read; }).length;
    var replies = state.items.filter(function(item){ return item.category === 'reply'; }).length;
    var system = state.items.filter(function(item){ return item.category === 'system'; }).length;
    els.totalBadge.textContent = String(state.items.length);
    els.unreadBadge.textContent = String(unread);
    els.replyBadge.textContent = String(replies);
    els.systemBadge.textContent = String(system);
    els.unreadCount.textContent = String(unread);
    var unreadLabel = els.unreadCount.nextElementSibling;
    if (unreadLabel) unreadLabel.textContent = unread === 1 ? 'não lida' : 'não lidas';
    els.markAll.hidden = unread === 0;

    var visible = filteredItems();
    els.list.innerHTML = '';
    els.list.setAttribute('aria-busy','false');
    if (!visible.length) {
      var kind = state.items.length ? (state.filter === 'unread' ? 'unread' : 'filtered') : (state.errors >= 4 ? 'error' : 'empty');
      els.list.appendChild(stateMarkup(kind));
      return;
    }
    var list = document.createElement('div');
    list.className = 'chat-items';
    visible.forEach(function(item){ list.appendChild(itemNode(item)); });
    els.list.appendChild(list);
  }

  function sourceError(name){
    state.ready[name] = true;
    state.errors++;
    rebuild();
  }

  function setSource(name,items){
    state.ready[name] = true;
    state.sources[name] = items;
    rebuild();
  }

  function bind(){
    document.querySelectorAll('[data-chat-filter]').forEach(function(button){
      button.addEventListener('click',function(){
        state.filter = button.getAttribute('data-chat-filter') || 'all';
        document.querySelectorAll('[data-chat-filter]').forEach(function(item){
          var active = item === button;
          item.classList.toggle('active',active);
          item.setAttribute('aria-selected',active ? 'true' : 'false');
        });
        render();
      });
    });
    els.markAll.addEventListener('click',function(){
      var socialUpdates = {};
      var accountUpdates = {};
      state.items.forEach(function(item){
        if (item.read) return;
        item.read = true;
        if (item.source === 'reply' && item.id) {
          socialUpdates[item.id + '/read'] = true;
          socialUpdates[item.id + '/readAt'] = socialTimestamp();
        } else if (item.readKey) {
          accountUpdates[item.readKey] = primaryTimestamp();
          state.reads[item.readKey] = Date.now();
        }
      });
      var jobs = [];
      if (state.refs.social && Object.keys(socialUpdates).length) jobs.push(state.refs.social.update(socialUpdates));
      if (state.refs.reads && Object.keys(accountUpdates).length) jobs.push(state.refs.reads.update(accountUpdates));
      if (!jobs.length) return;
      els.markAll.disabled = true;
      els.markAll.textContent = 'Marcando...';
      render();
      Promise.all(jobs).catch(function(){}).then(function(){
        els.markAll.disabled = false;
        els.markAll.textContent = 'Marcar todas como lidas';
      });
    });
  }

  function watchList(ref,name,normalizer,query){
    if (!ref) { sourceError(name); return; }
    var target = query ? query(ref) : ref;
    target.on('value',function(snapshot){
      var items = [];
      snapshot.forEach(function(child){ items.push(normalizer(child.val(),child.key,name)); });
      setSource(name,items);
    },function(){ sourceError(name); });
  }

  function boot(){
    els = {
      profileName:document.getElementById('chat-profile-name'),
      profileAvatar:document.getElementById('chat-profile-avatar'),
      unreadCount:document.getElementById('chat-unread-count'),
      totalBadge:document.getElementById('chat-total-badge'),
      unreadBadge:document.getElementById('chat-unread-badge'),
      replyBadge:document.getElementById('chat-reply-badge'),
      systemBadge:document.getElementById('chat-system-badge'),
      markAll:document.getElementById('chat-mark-all'),
      list:document.getElementById('chat-list')
    };
    hydrateProfile();
    bind();
    var user = context();
    if (!user.uid) { state.errors = 4; render(); return; }

    var uid = safeSegment(user.uid);
    var profileId = safeSegment(user.profileId);
    var primary = primaryDatabase();
    state.refs.social = socialRef('notifications/' + uid + '/' + profileId);
    state.refs.reads = primary ? primary.ref('users/' + uid + '/notificationReads') : null;

    if (state.refs.reads) {
      state.refs.reads.on('value',function(snapshot){
        state.reads = snapshot.val() || {};
        rebuild();
      },function(){ state.reads = {}; rebuild(); });
    }

    watchList(state.refs.social,'reply',normalizeReply,function(ref){ return ref.limitToLast(100); });
    watchList(primary && primary.ref('dk_broadcast/history'),'broadcast',normalizeMain,function(ref){ return ref.orderByChild('updatedAt').limitToLast(50); });
    watchList(primary && primary.ref('notifications/global'),'global',normalizeMain,function(ref){ return ref.limitToLast(30); });
    watchList(primary && primary.ref('notifications/user/' + uid),'user',normalizeMain,function(ref){ return ref.limitToLast(50); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
