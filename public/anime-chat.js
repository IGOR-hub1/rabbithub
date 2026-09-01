/* RabbitHub • chat de comentários por anime, aberto somente pelo botão do player. */
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
  var animeTitle = '';
  var els = {};

  function readJSON(key, fallback){
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch(e) {
      return fallback;
    }
  }

  function safeSegment(value){
    return String(value || 'anime').replace(/[.#$\[\]\/]/g,function(character){
      return '_' + character.charCodeAt(0).toString(16) + '_';
    }).slice(0,180);
  }

  function database(){
    try {
      if (!window.firebase || !firebase.database || !window.DK_FIREBASE_CONFIG) return null;
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.DK_FIREBASE_CONFIG);
      window.__DK_FB_INIT__ = true;
      return firebase.database();
    } catch(e) {
      return null;
    }
  }

  function context(){
    var session = readJSON('dk_session', {}) || {};
    var profile = readJSON('dk_active_profile', {}) || {};
    return {
      uid:String(session.uid || ''),
      profileId:String(profile.id || 'principal'),
      profileName:String(profile.name || session.displayName || 'Usuário RabbitHub').slice(0,40),
      profileAvatar:String(profile.avatar || '')
    };
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
    if (!value || !isFinite(Number(value))) return 'agora';
    try {
      return new Date(Number(value)).toLocaleString('pt-BR',{
        day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
      });
    } catch(e) {
      return 'agora';
    }
  }

  function emptyState(title, text){
    els.messages.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'rh-chat-empty';
    var copy = document.createElement('div');
    var strong = document.createElement('strong');
    var span = document.createElement('span');
    strong.textContent = title;
    span.textContent = text;
    copy.appendChild(strong);
    copy.appendChild(span);
    wrap.appendChild(copy);
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

  function renderMessages(snapshot){
    var list = [];
    snapshot.forEach(function(child){
      var value = child.val() || {};
      value.id = child.key;
      list.push(value);
    });
    list.sort(function(a,b){ return Number(a.createdAt || 0) - Number(b.createdAt || 0); });
    els.count.textContent = String(list.length);
    if (!list.length) {
      emptyState('Comece a conversa','Seja a primeira pessoa a comentar sobre este anime.');
      return;
    }
    els.messages.innerHTML = '';
    list.forEach(function(message){
      var article = document.createElement('article');
      article.className = 'rh-chat-message';
      var bubble = document.createElement('div');
      bubble.className = 'rh-chat-bubble';
      var meta = document.createElement('div');
      meta.className = 'rh-chat-meta';
      var name = document.createElement('strong');
      name.textContent = String(message.profileName || 'Usuário RabbitHub');
      var time = document.createElement('time');
      time.textContent = formatDate(message.createdAt);
      if (message.episodeName) time.title = String(message.episodeName);
      var text = document.createElement('div');
      text.className = 'rh-chat-text';
      text.textContent = String(message.text || '');
      meta.appendChild(name);
      meta.appendChild(time);
      bubble.appendChild(meta);
      bubble.appendChild(text);
      article.appendChild(avatarNode(message));
      article.appendChild(bubble);
      els.messages.appendChild(article);
    });
    window.requestAnimationFrame(function(){ els.messages.scrollTop = els.messages.scrollHeight; });
  }

  function stopMessages(){
    if (messageQuery && messageHandler) {
      try { messageQuery.off('value',messageHandler); } catch(e){}
    }
    messageQuery = null;
    messageHandler = null;
  }

  function startMessages(){
    stopMessages();
    if (!messagesRef) return;
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
    els.button.focus();
  }

  function updateCounter(){
    els.chars.textContent = String(els.input.value.length) + '/500';
    els.status.textContent = '';
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
    messagesRef.push().set({
      uid:user.uid,
      profileId:user.profileId,
      profileName:user.profileName,
      profileAvatar:user.profileAvatar,
      text:text,
      animeSlug:String(new URLSearchParams(location.search).get('anime') || ''),
      animeTitle:animeTitle,
      episodeIndex:Number(new URLSearchParams(location.search).get('idx') || 0),
      episodeName:String(new URLSearchParams(location.search).get('nome') || 'Episódio').slice(0,100),
      createdAt:firebase.database.ServerValue.TIMESTAMP
    }).then(function(){
      localStorage.setItem(throttleKey,String(Date.now()));
      els.input.value = '';
      updateCounter();
    }).catch(function(){
      els.status.textContent = 'Não foi possível enviar. Tente novamente.';
    }).then(function(){
      els.send.disabled = false;
    });
  }

  function setEnabled(value){
    enabled = value === true;
    els.button.hidden = !enabled;
    if (!enabled) closeChat();
    if (enabled && messagesRef) {
      messagesRef.limitToLast(100).once('value').then(function(snapshot){
        els.count.textContent = String(snapshot.numChildren());
      }).catch(function(){ els.count.textContent = '0'; });
    }
  }

  function bind(){
    els.button.addEventListener('click',openChat);
    els.close.addEventListener('click',closeChat);
    els.overlay.addEventListener('click',function(event){
      if (event.target === els.overlay) closeChat();
    });
    els.form.addEventListener('submit',sendMessage);
    els.input.addEventListener('input',updateCounter);
    els.input.addEventListener('keydown',function(event){
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendMessage(event);
    });
    document.addEventListener('keydown',function(event){
      if (event.key === 'Escape' && opened) closeChat();
    });
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
      status:document.getElementById('rh-chat-status')
    };
    if (!els.button || !els.overlay) return;
    var slug = new URLSearchParams(location.search).get('anime') || 'anime';
    animeKey = safeSegment(slug);
    animeTitle = String(new URLSearchParams(location.search).get('titulo') || slug || 'Anime');
    els.title.textContent = animeTitle;
    var db = database();
    if (!db) {
      window.setTimeout(boot,120);
      return;
    }
    messagesRef = db.ref('animeChats/' + animeKey + '/messages');
    configRef = db.ref('dk_broadcast/config/playerChatEnabled');
    bind();
    updateCounter();
    configRef.on('value',function(snapshot){
      setEnabled(snapshot.val() !== false);
    },function(){
      setEnabled(true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
