'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function validateInlineScripts(relative) {
  const html = read(relative);
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, relative + ' deve conter script inline');
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new Function(match[1]), relative + ' script ' + index);
  });
}

test('plano VIP ignora validade e status antigos quando o painel confirmou o acesso', () => {
  const context = { window:{} };
  vm.runInNewContext(read('public/account-plan.js'),context);
  const normalize = context.window.RabbitHubAccountPlan.normalize;
  const vip = normalize({
    plan:'VIP',currentPlan:'VIP',premium:true,vip:true,premiumUntil:null,
    vipUntil:Date.now()-86400000,planExpiresAt:Date.now()-86400000,subscriptionStatus:'expired'
  });
  assert.equal(vip.isVip,true);
  assert.equal(vip.name,'VIP');
  assert.equal(vip.expiresAt,0);
  const permanent = normalize({plan:'VIP',premium:true,premiumUntil:0});
  assert.equal(permanent.isVip,true);
  const expired = normalize({plan:'VIP',premium:true,premiumUntil:Date.now()-86400000});
  assert.equal(expired.isVip,false);
  const oldExpiry = Date.now()-86400000;
  const repaired = normalize({
    plan:'VIP',premium:true,vip:true,planUpdatedAt:Date.now(),
    subscription:{status:'expired',expiresAt:oldExpiry}
  });
  assert.equal(repaired.isVip,true);
});

test('tema, perfis e progresso não regridem durante sincronização', () => {
  const theme = read('public/theme.js');
  const access = read('public/plan-access.js');
  const profile = read('public/profile-data.js');
  const guard = read('public/auth-guard.js');
  const session = read('public/user-session.js');
  const login = read('public/login.html');
  const player = read('public/player-animes.html');
  assert.match(theme, /if \(!options\.system\) \{[\s\S]*localStorage\.setItem\(userThemeStorageKey\(\), key\)/);
  assert.match(access, /if\(!next\.ready\|\|next\.source!=='firebase'\|\|next\.isVip\)return/);
  assert.match(access, /RabbitHubSession\.subscribe\(onSession\)/);
  assert.match(profile, /cacheCustomization\(remotePresent \? remote : local/);
  assert.match(profile, /planAccess&&planAccess\.ready===true&&planAccess\.customTheme!==true/);
  assert.match(session, /accountRef\.on\('value'/);
  assert.doesNotMatch(guard, /profile:profile,profiles:\[profile\]/);
  assert.doesNotMatch(login, /profile:profile,profiles:\[profile\],passwordHash/);
  assert.match(player, /resumeRequested = params\.get\('resume'\) === '1'/);
  assert.match(profile, /return episodeProgressKey\(item\)/);
});

test('scripts inline das telas alteradas continuam válidos', () => {
  validateInlineScripts('public/admin.html');
  validateInlineScripts('public/login.html');
  validateInlineScripts('public/index.html');
  validateInlineScripts('public/detalhes.html');
  validateInlineScripts('public/player-animes.html');
});

test('telas aguardam usuario, plano, perfil e preferencias antes de aparecer', () => {
  const theme = read('public/theme.js');
  const access = read('public/plan-access.js');
  const profile = read('public/profile-data.js');
  const guard = read('public/auth-guard.js');
  const features = read('public/user-features.js');
  const home = read('public/index.html');
  const details = read('public/detalhes.html');
  const player = read('public/player-animes.html');

  assert.match(theme, /function holdAppBoot\(name\)/);
  assert.match(theme, /if \(!force && \(!bootDomReady \|\| pendingBootHolds\(\)\.length\)\) return/);
  assert.match(theme, /window\.RabbitHubBoot = \{[\s\S]*hold:holdAppBoot/);
  assert.match(theme, /privatePage&&\(document\.documentElement\.getAttribute\('data-dk-ready'\)!=='1'/);
  assert.doesNotMatch(theme, /location\.replace\('login\.html\?reason=timeout'\)/);
  assert.match(theme, /data-rh-boot-slow/);
  assert.match(theme, /session&&session\.authUser/);
  assert.match(guard, /RabbitHubBoot\.hold\('auth'\)/);
  assert.match(access, /RabbitHubBoot\.hold\('plan'\)/);
  assert.match(profile, /RabbitHubBoot\.hold\('profile'\)/);
  assert.match(features, /RabbitHubBoot\.hold\('preferences'\)/);
  assert.match(features, /ready:function\(\)\{return preferencesReady;\}/);
  assert.match(home, /RabbitHubFeatures\.ready\(\)\.then\(startInitialView\)/);
  assert.doesNotMatch(home, /rh:preferenceshydrated'[\s\S]{0,240}renderMain\(activeTab\)/);
  assert.match(details, /rh:preferenceshydrated/);
  assert.match(player, /RabbitHubFeatures\.ready\(\)/);
});

test('Firebase prevalece sobre caches antigos de perfil e preferencias', () => {
  const profile = read('public/profile-data.js');
  const features = read('public/user-features.js');
  assert.match(profile, /var merged = cacheCustomization\(remotePresent \? remote : local/);
  assert.match(profile, /if\(hasRemoteBio\)return cacheBio/);
  assert.doesNotMatch(profile, /local\.updatedAt > remoteUpdatedAt/);
  assert.match(features, /var next=normalizePreferences\(remote\)/);
  assert.doesNotMatch(features, /remote\.updatedAt\|\|0\)>=Number\(local\.updatedAt/);
});

test('editar o perfil visível preserva os demais perfis salvos na conta', () => {
  const profiles = read('public/perfis.html');
  assert.match(profiles, /var accountProfiles = \[\]/);
  assert.match(profiles, /profilesToSave\[selectedAccountIndex\]=Object\.assign/);
  assert.match(profiles, /profile:list\[0\],profiles:profilesToSave/);
  assert.doesNotMatch(profiles, /profile:list\[0\],profiles:list/);
});

test('nome alterado em Conta é confirmado no Firebase e persiste no perfil ativo', async () => {
  const storage = new Map([
    ['dk_session',JSON.stringify({uid:'uid-test',displayName:'Antigo'})],
    ['dk_active_profile',JSON.stringify({id:'segundo',name:'Antigo',avatar:'avatar-2'})],
    ['dk_profiles_uid-test',JSON.stringify([
      {id:'primeiro',name:'Primeiro',avatar:'avatar-1'},
      {id:'segundo',name:'Antigo',avatar:'avatar-2'}
    ])]
  ]);
  const accountUpdates = [];
  const publicUpdates = [];
  const authUpdates = [];
  const authUser = {
    email:'teste@example.com',
    async updateProfile(value){authUpdates.push(value);}
  };
  const central = {
    status:'authenticated',uid:'uid-test',authUser,
    profile:{id:'segundo',name:'Antigo',avatar:'avatar-2',bio:'',banner:'default',theme:'blue'},
    account:{uid:'uid-test',email:'teste@example.com',profiles:[
      {id:'primeiro',name:'Primeiro',avatar:'avatar-1'},
      {id:'segundo',name:'Antigo',avatar:'avatar-2'}
    ]}
  };
  const database = {ref(path){return {update(value){accountUpdates.push({path,value});return Promise.resolve();}};}};
  function databaseFactory(){return database;}
  databaseFactory.ServerValue = {TIMESTAMP:123456};
  const firebase = {
    app(){return {database(){return database;}};},
    initializeApp(){return this.app();},
    database:databaseFactory,
    auth(){return {currentUser:authUser};}
  };
  const document = {readyState:'loading',addEventListener(){},dispatchEvent(){}};
  const window = {
    firebase,DK_FIREBASE_CONFIG:{},RabbitHubSession:{get(){return central;}},
    RabbitHubSocial:{ref(path){return {update(value){publicUpdates.push({path,value});return Promise.resolve();}};}},
    localStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,String(value));}},
    document,setTimeout,clearTimeout,CustomEvent:function(type,init){this.type=type;this.detail=init&&init.detail;}
  };
  const context = vm.createContext({window,document,localStorage:window.localStorage,firebase,
    CustomEvent:window.CustomEvent,URL,Promise,Date,JSON,Object,Array,String,Number,RegExp,Math,setTimeout,clearTimeout,console});
  vm.runInContext(read('public/profile-data.js'),context,{filename:'profile-data.js'});
  const result = await window.RabbitHubProfileData.saveProfileName('  Nome   Permanente  ');

  assert.equal(result.name,'Nome Permanente');
  assert.equal(accountUpdates.length,1);
  assert.equal(accountUpdates[0].path,'users/uid-test');
  assert.equal(accountUpdates[0].value['profiles/1/name'],'Nome Permanente');
  assert.equal(accountUpdates[0].value['profiles/1/profileName'],'Nome Permanente');
  assert.equal(accountUpdates[0].value.profiles,undefined);
  assert.equal(authUpdates.length,1);
  assert.equal(authUpdates[0].displayName,'Nome Permanente');
  const cachedProfiles=JSON.parse(storage.get('dk_profiles_uid-test'));
  assert.equal(cachedProfiles.length,2);
  assert.equal(cachedProfiles[0].name,'Primeiro');
  assert.equal(cachedProfiles[1].name,'Nome Permanente');
  assert.equal(JSON.parse(storage.get('dk_active_profile')).name,'Nome Permanente');
  assert.equal(publicUpdates[0].value.profileName,'Nome Permanente');

  const home=read('public/index.html');
  assert.match(home,/RabbitHubProfileData[\s\S]*saveProfileName/);
  assert.doesNotMatch(home,/profiles:\[activeNick\]/);
});

test('histórico calcula porcentagem pelo tempo real e permite reiniciar o episódio', async () => {
  const storage = new Map([
    ['dk_session',JSON.stringify({uid:'uid-history',displayName:'Perfil'})],
    ['dk_active_profile',JSON.stringify({id:'principal',name:'Perfil'})]
  ]);
  const localStorage = {
    getItem(key){return storage.has(key)?storage.get(key):null;},
    setItem(key,value){storage.set(key,String(value));},
    removeItem(key){storage.delete(key);}
  };
  const document = {
    readyState:'loading',documentElement:{getAttribute(){return null;}},
    addEventListener(){},dispatchEvent(){}
  };
  const window = {
    localStorage,document,setTimeout,clearTimeout,
    RabbitHubPlans:{get(){return {name:'Free'};},can(){return false;}},
    CustomEvent:function(type,init){this.type=type;this.detail=init&&init.detail;}
  };
  const context = vm.createContext({window,document,localStorage,CustomEvent:window.CustomEvent,
    Promise,Date,JSON,Object,Array,String,Number,RegExp,Math,isFinite,setTimeout,clearTimeout,console});
  vm.runInContext(read('public/profile-data.js'),context,{filename:'profile-data.js'});

  const saved = await window.RabbitHubProfileData.saveHistory({
    slug:'anime-teste',titulo:'Anime teste',epIdx:2,seconds:300,duration:1200,progresso:5
  });
  assert.equal(saved.progresso,25);
  assert.equal(window.RabbitHubProfileData.getHistory()[0].progresso,25);

  const restarted = await window.RabbitHubProfileData.saveHistory({
    slug:'anime-teste',titulo:'Anime teste',epIdx:2,seconds:0,duration:1200,
    progresso:0,resetPlayback:true
  });
  assert.equal(restarted.seconds,0);
  assert.equal(restarted.progresso,0);

  await window.RabbitHubProfileData.saveHistory({
    slug:'anime-teste',titulo:'Anime teste',epIdx:3,seconds:45.375,duration:1200
  });
  const episodes = window.RabbitHubProfileData.getHistory();
  assert.equal(episodes.length,2);
  assert.equal(episodes.find(item=>item.epIdx===3).seconds,45.375);
  assert.equal(episodes.find(item=>item.epIdx===2).seconds,0);

  storage.set('dk_session',JSON.stringify({uid:'outro-usuario'}));
  assert.equal(window.RabbitHubProfileData.getHistory().length,0);
  storage.set('dk_session',JSON.stringify({uid:'uid-history'}));
  assert.equal(window.RabbitHubProfileData.getHistory().length,2);

  const remoteItem={slug:'anime-teste',titulo:'Anime teste',epIdx:2,
    seconds:300,duration:1200,ts:restarted.ts-1000};
  const database={ref(){return {once(){return Promise.resolve({val(){return {old:remoteItem};}});}};}};
  const firebase={app(){return {database(){return database;}};}};
  window.firebase=firebase;
  context.firebase=firebase;
  window.DK_FIREBASE_CONFIG={};
  window.RabbitHubPlans.can=()=>true;
  await window.RabbitHubProfileData.refreshHistory();
  assert.equal(window.RabbitHubProfileData.getHistory().find(item=>item.epIdx===2).seconds,0);
});

test('clique no histórico abre o player e sempre pede decisão antes de retomar', () => {
  const home = read('public/index.html');
  const player = read('public/player-animes.html');
  const profile = read('public/profile-data.js');
  for (const page of ['index.html','detalhes.html','player-animes.html','chat.html','perfis.html']) {
    assert.match(read('public/' + page), /profile-data\.js\?v=20261111-5/, page);
  }
  assert.match(home, /function historyProgress\(item\)/);
  assert.match(home, /duration > 0 \? \(seconds \/ duration\) \* 100/);
  assert.match(home, /'&titulo='[\s\S]*'&resume=1'/);
  assert.match(home, /'&resumeSeconds=' \+ encodeURIComponent/);
  assert.match(home, /'&resumeProgress=' \+ encodeURIComponent/);
  assert.match(player, /resumeHint\.uid === playbackContext\.uid/);
  assert.match(profile, /progress = seconds >= duration - 1 \? 100 : \(seconds \/ duration\) \* 100/);
  assert.match(player, /Continuar de onde você parou\?/);
  assert.doesNotMatch(player, /var LS_PROGRESS =/);
  assert.match(player, /duration \* Math\.min\(100,Number\(saved\.progress\)\) \/ 100/);
  assert.doesNotMatch(player, /if \(resumeRequested\) \{[\s\S]{0,500}video\.currentTime/);
  assert.match(player, /pushHistory\(0,0,video\.duration\|\|duration,\{resetPlayback:true\}\)/);
});

test('retomada espera metadados e seek antes de reproduzir', () => {
  const source=read('public/player-animes.html');
  const start=source.indexOf('    function offerResume(video,saved){');
  const end=source.indexOf('    function revelarTelaPlayer(){',start);
  assert.ok(start>0 && end>start);
  const events={};
  let played=0,cleared=0,reset=null;
  const box={hidden:true},continueButton={},restartButton={};
  const root={classList:{add(){},remove(){}}};
  const nodes={'dk-resume':box,'dk-resume-continue':continueButton,
    'dk-resume-restart':restartButton,'dk-player':root,
    'dk-resume-title':{textContent:''},'dk-resume-time':{textContent:''}};
  let time=0;
  const video={duration:100,seeking:false,pause(){},
    get currentTime(){return time;},set currentTime(value){time=value;this.seeking=true;},
    addEventListener(name,fn){events[name]=fn;},removeEventListener(name){delete events[name];}};
  const window={setTimeout(){return 1;}};
  const document={getElementById(id){return nodes[id];}};
  const context=vm.createContext({window,document,Number,Math,
    resumePromptShown:false,resumeDecisionPending:false,resumeRequested:false,
    formatPlayerTime(seconds){return String(seconds);},
    playWhenAllowed(){played++;},clearProgress(){cleared++;},
    pushHistory(...args){reset=args;}});
  vm.runInContext(source.slice(start,end),context);
  assert.equal(context.offerResume(video,{t:0,d:100}),false);
  assert.equal(context.offerResume(video,{t:30.375,d:100}),true);
  assert.equal(box.hidden,false);
  continueButton.onclick();
  assert.equal(time,30.375);
  assert.equal(played,0);
  video.seeking=false;events.seeked();
  assert.equal(played,1);
  assert.equal(cleared,0);

  context.resumePromptShown=false;
  assert.equal(context.offerResume(video,{t:30,d:100}),true);
  restartButton.onclick();
  assert.equal(time,0);
  assert.equal(cleared,1);
  assert.equal(reset[0],0);
  video.seeking=false;events.seeked();
  assert.equal(played,2);
});

test('iframe mantém o diálogo, espera a escolha e usa tempo confirmado pelo player', async () => {
  const source=read('public/player-animes.html');
  const start=source.indexOf('        function providerIframeMarkup(url){');
  const end=source.indexOf('        if (sources.length === 0)',start);
  assert.ok(start>0 && end>start);
  const url='https://embed.example/watch/ep1';
  const sent=[];
  const frameEvents={};
  const windowEvents={};
  const frame={contentWindow:{postMessage(value,origin){sent.push({value:JSON.parse(value),origin});}},
    addEventListener(name,fn){frameEvents[name]=fn;}};
  let frameSrc='';
  Object.defineProperty(frame,'src',{get(){return frameSrc;},set(value){frameSrc=value;}});
  const resumeBox={hidden:true};
  const note={hidden:true,textContent:''};
  const continueButton={},restartButton={};
  const shell={children:[],classList:{add(){},remove(){}},appendChild(child){this.children.push(child);}};
  const wrapper={querySelector(selector){return selector==='.dk-external-player'?shell:frame;},
    set innerHTML(value){this.markup=value;}};
  const nodes={'video-wrapper':wrapper,'dk-resume':resumeBox,'dk-resume-note':note,
    'dk-resume-title':{textContent:''},'dk-resume-time':{textContent:''},
    'dk-resume-continue':continueButton,'dk-resume-restart':restartButton};
  const document={getElementById(id){return nodes[id];}};
  const window={addEventListener(name,fn){windowEvents[name]=fn;},
    removeEventListener(){},setTimeout(){return 1;},clearTimeout(){}};
  const savedTimes=[];
  const context=vm.createContext({window,document,URL,Number,Math,JSON,Promise,
    resumePromptShown:false,resumeDecisionPending:false,
    samePlaybackContext(){return true;},
    resolveResumeProgress(){return Promise.resolve({t:42,d:100,progress:42});},
    pushHistory(){},saveProgress(t,d){savedTimes.push([t,d]);},clearProgress(){},
    playbackPercent(t,d){return t/d*100;},formatPlayerTime(t){return String(t);},
    escapeAnimeHtml(value){return value;}});
  vm.runInContext(source.slice(start,end),context);
  assert.equal(context.mountProviderIframe(url),true);
  await Promise.resolve();await Promise.resolve();
  assert.equal(shell.children.includes(resumeBox),true);
  assert.equal(resumeBox.hidden,false);
  assert.equal(frameSrc,'');
  continueButton.onclick();
  assert.equal(frameSrc,url);
  frameEvents.load();
  assert.equal(sent.some(item=>item.value.method==='setCurrentTime'&&item.value.value===42),true);
  windowEvents.message({source:frame.contentWindow,origin:'https://embed.example',
    data:{context:'player.js',event:'timeupdate',value:{seconds:42,duration:100}}});
  assert.equal(context.resumeDecisionPending,false);
  assert.equal(savedTimes.length,1);
});

test('progresso VIP remoto não é encoberto por visita vazia e respeita recomeço', async () => {
  const source=read('public/player-animes.html');
  const start=source.indexOf('    function resolveResumeProgress(){');
  const end=source.indexOf('    function formatPlayerTime(value){',start);
  assert.ok(start>0 && end>start);
  let local={t:0,d:0,ts:2000};
  let remote={seconds:90,duration:1200,ts:1000};
  let refreshed=0;
  const window={RabbitHubPlans:{get(){return {ready:true,cloudProgress:true};}},
    RabbitHubProfileData:{refreshHistory(){refreshed++;return Promise.resolve([]);},
      getEpisodeProgress(){return Promise.resolve(remote);}}};
  const context=vm.createContext({window,Promise,Number,
    loadProgress(){return local;},samePlaybackContext(){return true;},
    progressIdentity(){return {};}});
  vm.runInContext(source.slice(start,end),context);
  assert.equal((await context.resolveResumeProgress()).t,90);
  assert.equal(refreshed,1);
  local={t:0,d:1200,ts:2000,resetAt:2000};
  assert.equal((await context.resolveResumeProgress()).t,0);
  remote=null;
  local={t:0,d:0,ts:2000};
  window.RabbitHubProfileData.refreshHistory=()=>{local={t:120,d:1200,ts:2500};return Promise.resolve([]);};
  assert.equal((await context.resolveResumeProgress()).t,120);
});

test('login autentica uma vez e entrega a sincronizacao para a sessao central', () => {
  const html = read('public/login.html');
  const session = read('public/user-session.js');
  assert.match(html, /function waitForFirebase\(timeoutMs\)/);
  assert.match(html, /function settleWithin\(promise,timeoutMs\)/);
  assert.match(html, /settleWithin\(auth\.setPersistence\(persistence\),5000\)/);
  assert.match(html, /function rememberAuthHandoff\(user\)/);
  assert.match(html, /function destinationAfterLogin\(\)/);
  assert.match(html, /target\.origin!==window\.location\.origin/);
  assert.match(html, /window\.location\.replace\(destinationAfterLogin\(\)\)/);
  assert.doesNotMatch(html, /syncSignedInAccount/);
  assert.doesNotMatch(html, /firebase\.database\(\)\.ref\('users\/'/);
  assert.doesNotMatch(html, /Firebase demorou para sincronizar sua conta/);
  assert.match(session, /OWNER_ADMIN_EMAIL='krabelodesouza52@gmail\.com'/);
  assert.match(session, /function accountRestRequest\(user,method,value,etag\)/);
  assert.match(session, /accountRef\.on\('value'/);
});

test('acesso exige e-mail confirmado antes de criar a sessão local', () => {
  const login = read('public/login.html');
  const guard = read('public/auth-guard.js');
  const session = read('public/user-session.js');
  assert.match(login, /sendEmailVerification\(\)/);
  assert.match(login, /getIdTokenResult\(true\)/);
  assert.match(login, /claims\.email_verified===true/);
  assert.match(login, /auth\/email-not-verified/);
  assert.match(login, /await auth\.signOut\(\)/);
  assert.match(session, /function verifyUser\(user\)/);
  assert.match(session, /getIdTokenResult\(false\)/);
  assert.match(guard, /go\('unverified'\)/);
});

test('site e WebView compartilham retorno nativo sem embutir as páginas no APK', () => {
  const refresh = read('public/app-refresh.js');
  const activity = read('PROJETO AIDE/app/src/main/java/com/x/bunny/MainActivity.java');
  assert.match(refresh, /X-BunnyApp/);
  assert.match(refresh, /RabbitHubNavigation=\{handleBack:handleNativeBack/);
  assert.match(activity, /window\.RabbitHubNavigation&&RabbitHubNavigation\.handleBack/);
  assert.match(activity, /X-BunnyApp\/1\.2 AndroidWebView/);
  assert.match(activity, /webView\.onPause\(\)/);
  assert.match(activity, /webView\.onResume\(\)/);
  assert.doesNotMatch(activity, /file:\/\/\/android_asset\/(?:index|detalhes|player-animes)\.html/);
});

test('guardiao de sessao recupera conexao lenta sem recarregar ou invalidar o login', () => {
  const guard = read('public/auth-guard.js');
  const session = read('public/user-session.js');
  assert.match(session, /function scheduleRest\(delay\)/);
  assert.match(session, /function retry\(error\)/);
  assert.match(session, /retryDelay=Math\.min\(12000/);
  assert.doesNotMatch(session, /O Firebase demorou para sincronizar sua conta/);
  assert.match(session, /accountRef\.on\('value'/);
  assert.match(guard, /RabbitHubSession\.subscribe\(handle\)/);
  assert.doesNotMatch(guard, /location\.reload\(\)/);
});

test('navegacao confirma anonimo silenciosamente e usa apenas o guardiao central', () => {
  const guard = read('public/auth-guard.js');
  const profiles = read('public/perfis.html');
  for (const page of ['index.html','detalhes.html','player-animes.html','chat.html','perfis.html']) {
    assert.match(read('public/' + page), /auth-guard\.js\?v=20261111-5/, page);
  }
  assert.match(guard, /function confirmAnonymous\(\)/);
  assert.match(guard, /function recoverSession\(\)/);
  assert.match(guard, /current=auth\.currentUser/);
  assert.match(guard, /setTimeout\(function\(\)[\s\S]*go\('auth'\);[\s\S]*,1800\)/);
  assert.match(guard, /if\(value\.status==='anonymous'\)\{confirmAnonymous\(\);return;\}/);
  assert.match(guard, /else recoverSession\(\)/);
  assert.match(guard, /target\.searchParams\.set\('next',current\)/);
  assert.doesNotMatch(profiles, /central&&central\.status==='anonymous'\)\{location\.replace/);
});

test('perfil mostra o nome publico sem derivar identidade do email', () => {
  const home = read('public/index.html');
  assert.match(home, /function siteProfileName\(value\)/);
  assert.match(home, /centralProfile && centralProfile\.profile && centralProfile\.profile\.name/);
  assert.doesNotMatch(home, /_accountSession\.email\) userId/);
  assert.doesNotMatch(home, /_u\.email\) userId/);
  assert.doesNotMatch(home, /Perfil vinculado a/);
  assert.match(home, /Nome público: ' \+ escapeHtml\(primaryProfile\.name\)/);
});

test('sair da conta encerra Firebase e limpa os dados salvos do navegador', () => {
  const guard = read('public/auth-guard.js');
  const home = read('public/index.html');
  const profiles = read('public/perfis.html');
  assert.match(guard, /firebase\.auth\(\)\.signOut\(\)/);
  assert.match(guard, /function clearSavedBrowserData\(\)/);
  assert.match(guard, /localStorage\.clear\(\)/);
  assert.match(guard, /sessionStorage\.clear\(\)/);
  assert.match(guard, /window\.caches\.delete\(name\)/);
  assert.match(home, /id="account-logout"/);
  assert.match(home, /<span>Sair da conta<\/span>/);
  assert.doesNotMatch(home, /id="account-edit-profile"/);
  assert.match(profiles, /id="btn-edit" type="button">Sair da conta/);
  assert.doesNotMatch(profiles, /id="btn-logout"/);
});

test('admin cadastra links e filtra as três categorias de banner sem Storage', () => {
  const html = read('public/admin.html');
  assert.match(html, /id="profileBannerLinkCategory"/);
  assert.match(html, /id="profileBannerAdminFilter"/);
  assert.match(html, /category:category/);
  assert.doesNotMatch(html, /firebase-storage-compat/);
  assert.doesNotMatch(html, /profileBannerUploadForm/);
  assert.doesNotMatch(html, /firebase\.storage/);
});

test('catálogo do usuário oferece categoria e vídeo sem atalhos artificiais', () => {
  const html = read('public/index.html');
  assert.match(html, /data-banner-category/);
  assert.match(html, /<video src=/);
  assert.doesNotMatch(html, /settings-quick-nav/);
  assert.doesNotMatch(html, /data-config-jump/);
  assert.doesNotMatch(html, /id="cfg-backup-download" disabled/);
  assert.doesNotMatch(html, /id="cfg-backup-import" disabled/);
});

test('seletor usa apenas banners publicados pelo administrador', () => {
  const catalog = read('public/profile-banners.js');
  const home = read('public/index.html');
  assert.match(catalog, /var DEFAULTS = \[\]/);
  assert.doesNotMatch(catalog, /images\.unsplash\.com/);
  assert.doesNotMatch(catalog, /i\.pinimg\.com/);
  assert.match(catalog, /banners = normalizeCollection\(snapshot\.val\(\)\)/);
  assert.match(catalog, /CACHE_KEY = 'rh_profile_banners_cache_v1'/);
  assert.match(catalog, /if \(startAttempts < 80\) window\.setTimeout\(start,100\)/);
  assert.match(catalog, /function readPublicCatalog\(\)/);
  assert.match(home, /refreshOpenProfileBannerSheet/);
  assert.match(home, /openSheetElement\.classList\.contains\('yc-config-dialog'\)/);
  assert.match(home, /profile-banners\.js\?v=20261111-5/);
});

test('chat mostra e persiste o número do episódio', () => {
  const chat = read('public/anime-chat.js');
  assert.match(chat, /function episodeLabel/);
  assert.match(chat, /className = 'rh-chat-episode'/);
  assert.match(chat, /episodeNumber:currentEpisodeNumber/);
  assert.match(chat, /seasonNumber:currentSeasonNumber/);
});

test('comentarios hidratam foto e nome atuais uma vez por perfil publico', () => {
  const chat = read('public/anime-chat.js');
  const player = read('public/player-animes.html');
  assert.match(player, /anime-chat\.js\?v=20261111-1/);
  assert.match(chat, /function publicProfileKey\(message\)/);
  assert.match(chat, /socialRef\('publicProfiles\/' \+ key\)/);
  assert.match(chat, /if \(publicProfileJobs\[key\]\) return publicProfileJobs\[key\]/);
  assert.match(chat, /message\.profileAvatar = currentAvatar/);
  assert.match(chat, /message\.profileName = currentName/);
  assert.match(chat, /hydrateMessageProfiles\(list,snapshot\)/);
  assert.match(chat, /renderMessages\(snapshot,true\)/);
});

test('pré-carregamento do episódio sobrevive à navegação sem cache permanente', () => {
  const adapter = read('public/meusanimes.js');
  assert.match(adapter, /EPISODE_CACHE_PREFIX = 'ma_episode_v1_'/);
  assert.match(adapter, /root\.sessionStorage\.setItem/);
  assert.match(adapter, /episodeCacheRecord\(key\)/);
  assert.doesNotMatch(adapter, /localStorage\.setItem\(EPISODE_CACHE_PREFIX/);
  assert.match(adapter, /type !== 'slow-2g' && type !== '2g'/);
});

test('player automático adapta qualidade e recupera travamento com fonte menor', () => {
  const player = read('public/player-animes.html');
  assert.match(player, /function networkProfile\(\)/);
  assert.match(player, /type==='3g'\)ceiling=480/);
  assert.match(player, /capLevelToPlayerSize: true/);
  assert.match(player, /abrEwmaDefaultEstimate: networkProfile\(\)\.bandwidth/);
  assert.match(player, /var lower=qualityPreference==='auto'/);
  assert.match(player, /data-next-episode-prefetch/);
});

test('player preserva controles inferiores e remove sobreposição superior no iframe', () => {
  const player = read('public/player-animes.html');
  const styles = read('public/app-refresh.css');
  assert.match(player, /function mountProviderIframe\(url\)/);
  assert.match(player, /class="dk-external-player"/);
  assert.doesNotMatch(player, /data-external-action="reload"/);
  assert.doesNotMatch(player, /data-external-action="fullscreen"/);
  assert.doesNotMatch(player, /class="dk-external-identity"/);
  assert.match(player, /mountProviderIframe\(finalProviderIframe\)/);
  assert.match(player, /id="dk-btn-play"[^>]*title="Reproduzir\/Pausar"/);
  assert.doesNotMatch(player, /id="dk-btn-comments"/);
  assert.doesNotMatch(player, /id="dk-btn-episodes-player"/);
  assert.doesNotMatch(player, /id="dk-btn-next-ep"/);
  assert.doesNotMatch(player, /data-external-action="(?:episodes|comments)"/);
  assert.doesNotMatch(player, /video-wrapper'\)\.innerHTML = providerIframeMarkup/);
  assert.match(player, /id="dk-btn-fs"/);
  assert.match(player, /app-refresh\.css\?v=20261111-3/);
});

test('temporadas usam inventário canônico no detalhe, player e histórico', () => {
  const adapter = read('public/meusanimes.js');
  const details = read('public/detalhes.html');
  const player = read('public/player-animes.html');
  assert.match(adapter, /function sortEpisodes\(list\)/);
  assert.match(adapter, /return sortEpisodes\(deduplicated\)/);
  assert.match(details, /allEpisodes = orderedEpisodes\(episodes\)/);
  assert.match(details, /if \(a === 0\) return 1/);
  assert.match(player, /function currentEpisodeInventoryIndex\(\)/);
  assert.match(player, /allEpisodes = orderedEpisodeInventory\(details\.episodios \|\| \[\]\)/);
  assert.match(player, /if \(!allEpisodes\.length\) aplicarNavegacao/);
  assert.doesNotMatch(player, /aplicarNavegacao\(fastData && fastData\.previousEpisode/);
});

test('mídia decorativa fora da tela pausa e respeita economia de dados', () => {
  const refresh = read('public/app-refresh.js');
  const home = read('public/index.html');
  assert.match(refresh, /function allowsSpeculativeLoading\(\)/);
  assert.match(refresh, /type!=='slow-2g'&&type!=='2g'/);
  assert.match(refresh, /IntersectionObserver/);
  assert.match(refresh, /syncDecorativeVideo/);
  assert.match(home, /preload="none" data-visible-autoplay/);
});

test('layout responsivo mantém carrosséis arrastáveis, dropdowns em uma linha e retorno da pesquisa', () => {
  const refresh = read('public/app-refresh.js');
  const styles = read('public/app-refresh.css');
  const dropdownStyles = read('public/rh-dropdowns.css');
  const dropdownScript = read('public/rh-dropdowns.js');
  const details = read('public/detalhes.html');
  const home = read('public/index.html');
  assert.match(refresh, /function initHorizontalScroll\(root\)/);
  assert.match(refresh, /row\.scrollLeft=startLeft-distance/);
  assert.match(styles, /scraper-scroll\{\s*display:flex!important/);
  assert.doesNotMatch(styles, /scraper-scroll:not\(\.rh-resume-scroll\)[^{]*\{[^}]*display:grid!important/);
  assert.match(dropdownStyles, /rh-select__option[^{]*\{[^}]*white-space:nowrap/);
  assert.match(dropdownScript, /instance\.menu\.style\.width = 'max-content'/);
  assert.match(details, /id="detail-back"/);
  assert.doesNotMatch(details, /id="menu-btn"/);
  assert.match(styles, /body\[data-page="details"\] > \.drawer,[\s\S]*?display:none!important/);
  assert.match(styles, /body\[data-page="details"\]\{padding-left:0!important\}/);
  assert.match(details, /window\.history\.back\(\)/);
  assert.match(home, /rh_detail_return_v1/);
  assert.match(home, /category-result-header/);
  assert.match(home, /id="header-context-back"/);
  assert.match(home, /showCategoryBack\(true\)/);
  assert.match(styles, /grid-template-columns:minmax\(44px,1fr\) minmax\(0,auto\) minmax\(44px,1fr\)/);
  assert.match(styles, /body\.rh-category-detail #open-drawer\{display:none!important\}/);
  assert.match(home, /<span>Voltar<\/span>/);
  assert.doesNotMatch(home, /Voltar às categorias/);
});

test('subtelas comuns não colidem com o cabeçalho e Configurações/Conta permanecem em diálogo', () => {
  const home = read('public/index.html');
  const styles = read('public/app-refresh.css');
  assert.match(home, /document\.body\.appendChild\(sheet\)/);
  assert.match(home, /document\.body\.classList\.add\('rh-sheet-open'\)/);
  assert.match(styles, /body\[data-page="home"\] > \.yc-sheet\{[\s\S]*?z-index:32000!important/);
  assert.match(styles, /body\.rh-sheet-open:not\(\.rh-dialog-open\) > \.otk-header-fixed/);
  assert.match(home, /classList\.toggle\('rh-dialog-open',kind === 'config' \|\| kind === 'conta'\)/);
  assert.match(styles, /> \.yc-sheet\.yc-config-dialog[\s\S]*?align-items:center!important/);
  assert.match(styles, /> \.yc-config-dialog \.yc-sheet-body[\s\S]*?width:min\(640px,100%\)!important/);
  assert.match(styles, /> \.yc-config-dialog \.yc-sheet-header,[\s\S]*?display:none!important/);
  assert.doesNotMatch(styles, /Configurações e Conta deixam de ser modais flutuantes/);
  assert.match(styles, /\.profile-banner-heading\{align-items:stretch;flex-direction:column/);
});

test('shell desktop nasce pronto, permanece fixo e preserva logo e avatar', () => {
  const theme = read('public/theme.js');
  const refresh = read('public/app-refresh.js');
  const styles = read('public/app-refresh.css');
  const motionStyles = read('public/site-motion.css');
  assert.match(theme, /localStorage\.getItem\('rh_drawer_mode'\)/);
  assert.match(theme, /document\.documentElement\.setAttribute\(\s*'data-rh-drawer-mode'/);
  assert.match(theme, /mo\.observe\(document\.documentElement/);
  assert.match(refresh, /profile\.avatar\|\|profile\.profileAvatar\|\|\s*session\.profileAvatar/);
  assert.match(styles, /position:fixed!important;inset:0 auto 0 0!important;height:100dvh!important/);
  assert.match(motionStyles, /html\.rh-motion-enabled body > main/);
  assert.doesNotMatch(motionStyles, /html\.rh-motion-enabled body\s*\{/);
  assert.doesNotMatch(motionStyles, /@keyframes rhPageEnter\{[^}]*translate/s);
});

test('dropdown usa a altura real e não fecha ao rolar as próprias opções', () => {
  const dropdown = read('public/rh-dropdowns.js');
  assert.match(dropdown, /var menuHeight = Math\.min\(maxHeight/);
  assert.match(dropdown, /rect\.top - menuHeight - gap/);
  assert.match(dropdown, /event\.target === active\.menu \|\| active\.menu\.contains\(event\.target\)/);
});

test('movimento global anima páginas, rolagem e cliques com acessibilidade', () => {
  const motionScript = read('public/site-motion.js');
  const motionStyles = read('public/site-motion.css');
  const pages = ['index.html','login.html','detalhes.html','player-animes.html','chat.html','perfis.html','admin.html'];
  pages.forEach((page) => {
    const html = read('public/' + page);
    assert.match(html, /site-motion\.css\?v=20261102-2/, page + ' deve carregar o CSS de movimento');
    assert.match(html, /site-motion\.js\?v=20261102-2/, page + ' deve carregar o JS de movimento');
  });
  assert.match(motionScript, /IntersectionObserver/);
  assert.match(motionScript, /MutationObserver/);
  assert.match(motionScript, /showClickFeedback/);
  assert.match(motionScript, /createScrollProgress/);
  assert.match(motionStyles, /\.rh-reveal\.rh-reveal-visible/);
  assert.match(motionStyles, /@media\(prefers-reduced-motion:reduce\)/);
});

test('login permanece simples, direto e sem Discord', () => {
  const login = read('public/login.html');
  const styles = read('public/login-refresh.css');
  const server = read('server.js');
  assert.match(login, /<main class="auth-shell" id="acesso">/);
  assert.match(login, /class="auth-panel"/);
  assert.match(login, /Bem-vindo de volta/);
  assert.match(login, /class="auth-brand"/);
  assert.match(login, /login-refresh\.css\?v=20261111-2/);
  assert.match(login, /class="auth-close"/);
  assert.doesNotMatch(login, /<svg/);
  assert.doesNotMatch(login, /discord/i);
  assert.doesNotMatch(login, /auth-kicker/);
  assert.doesNotMatch(login, /auth-security/);
  assert.doesNotMatch(login, /class="auth-mode-tabs"/);
  assert.match(login, /id="switch-line"/);
  assert.doesNotMatch(login, /class="auth-showcase"/);
  assert.doesNotMatch(login, /id="landing-news-list"/);
  assert.doesNotMatch(login, /class="login-home login-showcase"/);
  assert.match(styles, /\.auth-shell\{[^}]*display:flex/);
  assert.match(styles, /\.auth-area\{[^}]*width:min\(100%,420px\)/);
  assert.match(styles, /border-radius:18px!important/);
  assert.doesNotMatch(styles, /login-anime-bg-v1\.png/);
  assert.doesNotMatch(styles, /backdrop-filter/);
  assert.match(styles, /\.auth-card \.switch-line\{[^}]*display:block/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.match(server, /cr-news-api-service\.prd\.crunchyrollsvc\.com\/v1\/pt-BR\/rss/);
  assert.match(server, /parsed\.pathname === '\/api\/anime-news'/);
  assert.match(server, /parsed\.pathname === '\/api\/anime-news-image'/);
  assert.match(server, /\['storyblok\.com','crunchyroll\.com'\]/);
});

test('painel preserva o cadastro administrativo de patrocinadores', () => {
  const admin = read('public/admin.html');
  const login = read('public/login.html');
  assert.match(admin, /id="sponsorForm"/);
  assert.match(admin, /SPONSORS_PATH = 'dk_broadcast\/config\/sponsors'/);
  assert.match(admin, /function addSponsor\(event\)/);
  assert.match(admin, /data-remove-sponsor/);
  assert.doesNotMatch(login, /id="landing-sponsor-grid"/);
});

test('Home mostra cache imediatamente, sincroniza a origem e atualiza a tela', () => {
  const adapter = read('public/meusanimes.js');
  const home = read('public/index.html');
  assert.match(adapter, /var visible = saved \|\| stale/);
  assert.match(adapter, /refreshCacheInBackground\(key/);
  assert.match(adapter, /refreshCacheInBackground\('home'/);
  assert.match(adapter, /noCache: true/);
  assert.match(adapter, /cacheEvent\('ma:cacheupdated'/);
  assert.match(home, /addEventListener\('ma:cacheupdated'/);
  assert.match(home, /keys\.home\) renderMain\('home'\)/);
  assert.match(home, /await loadMainCatalog\(\)\.catch/);
  assert.match(home, /requests\.slice\(0,2\)\.map\(loadGenre\)/);
});

test('catálogo em cache é renovado em segundo plano e publica o valor novo', async () => {
  const saved = new Map();
  const events = [];
  saved.set('ma_cache_v3_dub:1', JSON.stringify({
    ts: Date.now(), ttl: 10 * 60 * 1000,
    value: [{slug:'a/antigo',titulo:'Anime antigo',audio:'Dublado'}]
  }));
  const document = {
    dispatchEvent(event) { events.push(event); },
    createElement() {
      let html = '';
      return { set innerHTML(value) { html = String(value); }, get value() { return html; } };
    }
  };
  function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  let tokenCalls = 0;
  const authUser = {
    emailVerified:true,
    async getIdToken() { tokenCalls++; return 'token-que-nao-pode-sair-do-site'; }
  };
  const browser = {
    document, CustomEvent,
    localStorage: {
      getItem(key) { return saved.has(key) ? saved.get(key) : null; },
      setItem(key, value) { saved.set(key, String(value)); }
    },
    location: {hostname:'localhost'}, navigator: {},
    firebase: { auth() { return {currentUser:authUser}; } },
    RabbitHubSession: {
      async ready() { return {status:'authenticated',ready:true,authUser}; }
    }
  };
  const context = vm.createContext({
    window: browser, URL, URLSearchParams, Promise, Date, JSON, Object, Array,
    String, Number, RegExp, Math, Buffer, setTimeout, clearTimeout, console
  });
  vm.runInContext(read('public/meusanimes.js'), context, {filename:'meusanimes.js'});
  const adapter = browser.MA;
  let requestOptions;
  adapter._test.setFetch(async (_target, options) => {
    requestOptions = options;
    return '<article id="post-2" class="item tvshows"><a href="https://meusanimes.blog/a/novo/">' +
      '<img src="https://images.example/novo.jpg" alt="Anime novo dublado"></a>' +
      '<h3>Anime novo dublado</h3></article>';
  });

  const immediate = await adapter.dublados(1);
  assert.equal(immediate[0].titulo, 'Anime antigo');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requestOptions.noCache, true);
  const update = events.find(event => event.type === 'ma:cacheupdated');
  assert.equal(update.detail.key, 'dub:1');
  assert.equal(update.detail.value[0].titulo, 'Anime novo dublado');
  assert.equal((await adapter.dublados(1))[0].titulo, 'Anime novo dublado');

  let directRequest;
  browser.fetch = async (url, options) => {
    directRequest = {url,options};
    if (url.startsWith('/')) return {ok:false,status:404};
    return {ok:true,status:200,async text(){return '<html>catálogo público</html>';}};
  };
  await adapter._test.fetchTextUncached('https://meusanimes.blog/a/', {});
  assert.equal(directRequest.url, 'https://meusanimes.blog/a/');
  assert.equal(directRequest.options.credentials, 'omit');
  assert.equal(directRequest.options.mode, 'cors');
  assert.equal(directRequest.options.headers.Authorization, undefined);
  await adapter._test.fetchTextUncached(
    'https://serv01.meusdoramas.club/posts/get-video.php?episode_number=1&season_number=1&tmdb=828791',
    {referer:'https://serv01.meusdoramas.club/',headers:{
      'X-Requested-With':'XMLHttpRequest','Cache-Control':'no-cache','Pragma':'no-cache'
    }}
  );
  assert.match(directRequest.url, /^https:\/\/serv01\.meusdoramas\.club\/posts\/get-video\.php/);
  assert.equal(directRequest.options.credentials, 'omit');
  assert.equal(directRequest.options.headers.Authorization, undefined);
  assert.equal(directRequest.options.headers['Cache-Control'], undefined);
  assert.equal(directRequest.options.headers.Pragma, undefined);
  assert.equal(directRequest.options.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.ok(tokenCalls >= 2, 'o proxy próprio deve ser tentado antes da origem externa');
});

test('CSP permite apenas a origem pública usada pelo catálogo direto', () => {
  for (const page of ['index.html','detalhes.html','player-animes.html','admin.html']) {
    const html = read('public/' + page);
    assert.match(html, /connect-src[^;]*https:\/\/meusanimes\.blog/);
    assert.match(html, /connect-src[^;]*https:\/\/\*\.meusdoramas\.club/);
    assert.match(html, /meusanimes\.js\?v=4\.9\.7/);
  }
  const adapter = read('public/meusanimes.js');
  const player = read('public/player-animes.html');
  assert.match(adapter, /timeout: root && root\.__RABBITHUB_WEBVIEW__ === true \? 12000 : 15000/);
  assert.match(adapter, /parsed\.pathname === '\/posts\/get-video\.php'/);
  assert.match(player, /var intermediate = \(url\.hostname === 'meusdoramas\.club'/);
});

test('arquivos Firebase apontam para regras separadas e válidas', () => {
  const config = JSON.parse(read('firebase.json'));
  const databaseRules = JSON.parse(read('API ANIMES E CHAT/database.rules.json'));
  assert.equal(config.database.rules, 'API ANIMES E CHAT/database.rules.json');
  assert.equal(config.storage.rules, 'storage.rules');
  assert.equal(config.firestore.rules, 'firestore.rules');
  assert.ok(databaseRules.rules.rhSocialV1);
  assert.ok(databaseRules.rules.dk_broadcast);
  assert.match(read('storage.rules'), /allow read, write: if false/);
  assert.match(read('firestore.rules'), /allow read, write: if false/);
});
