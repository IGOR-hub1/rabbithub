'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const home=read('public/index.html');

test('Perfil/Home atualizam URL, preservam parâmetros e respeitam voltar/avançar',()=>{
  let url=new URL('https://site.test/index.html?tab=perfil&source=player#anchor');
  const events={},renders=[];
  const context={URL,URLSearchParams,location:{get href(){return url.href;},get search(){return url.search;}},
    history:{pushState(_state,_title,value){url=new URL(value);}},window:{addEventListener(name,fn){events[name]=fn;}},
    activeTab:'perfil',initialViewStarted:true,renderMain(tab){renders.push(tab);context.activeTab=tab;context.initialViewStarted=true;}};
  vm.runInNewContext(section(home,'    function requestedTab()','    async function renderMain('),context);
  context.navigateTab('home');
  assert.equal(url.search,'?source=player');assert.equal(url.hash,'#anchor');
  assert.equal(context.requestedTab(),'home');
  context.navigateTab('perfil');assert.equal(url.searchParams.get('tab'),'perfil');
  context.navigateTab('home');assert.equal(context.requestedTab(),'home');
  url.searchParams.set('tab','perfil');events.popstate();assert.equal(context.activeTab,'perfil');
  events.popstate();assert.deepEqual(renders,['home','perfil','home','perfil']);
});

test('preferências tardias não restauram Perfil depois de navegação manual',()=>{
  const calls=[];
  const context={initialViewStarted:true,_initialTab:'perfil',requestedTab:()=> 'home',subscribeHomeFeatured(){},renderMain:tab=>calls.push(tab)};
  vm.runInNewContext(section(home,'    function startInitialView(){','    if (window.RabbitHubFeatures &&'),context);
  context.startInitialView();assert.deepEqual(calls,[]);
  context.initialViewStarted=false;context.startInitialView();assert.deepEqual(calls,['home']);
  context.startInitialView();assert.deepEqual(calls,['home']);
  // A queued profile repaint must also be harmless after leaving the tab.
  const early=section(home,'    function renderPerfil(){','        var profile = getProfile();')+'}';
  vm.runInNewContext(early+'\nrenderPerfil();',{activeTab:'home',document:{getElementById(){throw Error('must not repaint');}}});
});

test('timestamp do animationFrame não libera tela antes da sessão e preferências',()=>{
  const frames=[],timers=[],classes=new Set(),attributes={},elements={};
  const root={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},setAttribute:(k,v)=>attributes[k]=v,getAttribute:k=>attributes[k],removeAttribute:k=>delete attributes[k],appendChild(){}};
  const document={readyState:'complete',documentElement:root,head:{appendChild(){}},body:{appendChild(node){elements[node.id]=node;}},
    createElement:()=>({style:{},remove(){delete elements[this.id];}}),getElementById:id=>elements[id],dispatchEvent(){}};
  const window={requestAnimationFrame:fn=>frames.push(fn),setTimeout:(fn,ms)=>{timers.push({fn,ms});},addEventListener(){}};
  const context={window,document,location:{pathname:'/index.html'},Date,CustomEvent:function(){}};
  vm.runInNewContext(read('public/theme.js').split('  /*\n   * O layout do drawer')[0]+'})();',context);
  const auth=window.RabbitHubBoot.hold('auth'),prefs=window.RabbitHubBoot.hold('preferences');
  const drain=()=>{while(frames.length)frames.shift()(12345);};
  drain();assert.equal(classes.has('rh-app-booting'),true);
  auth();drain();assert.equal(classes.has('rh-app-booting'),true);
  timers.find(item=>item.ms===25000).fn();assert.ok(elements['rh-boot-error']);
  prefs();drain();assert.equal(classes.has('rh-app-booting'),false);assert.equal(elements['rh-boot-error'],undefined);
});

function adminHarness(){
  const writes=[];let marker=true,account={uid:'admin-user'},denied=false;
  const user={uid:'admin-user',emailVerified:true,email:'admin@example.com',reload:async()=>{},getIdTokenResult:async(force)=>{
    assert.equal(force,true);return {token:'fresh-token',claims:{email_verified:user.emailVerified}};
  }};
  const context={Promise,Error,AbortController,setTimeout,clearTimeout,encodeURIComponent,window:{DK_FIREBASE_CONFIG:{databaseURL:'https://db.test'}},
    firebase:{auth:()=>({currentUser:user})},safeDatabaseSegment:x=>x,isOwnerAdmin:u=>u.email==='owner@example.com',
    fetch:async(url,options)=>{assert.equal(new URL(url).searchParams.get('auth'),'fresh-token');
      if(options.method==='PUT'){writes.push(new URL(url).pathname);marker=JSON.parse(options.body);}
      return {ok:!denied,status:denied?403:200,json:async()=>url.includes('/admins/')?marker:account};
    }};
  vm.runInNewContext(section(read('public/admin.html'),'  function adminRequest(','  function verifyAdmin(){'),context);
  return {context,user,writes,setMarker:x=>{marker=x;},setAccount:x=>{account=x;},deny:()=>{denied=true;}};
}
test('admin existente entra sem gravar perfil, proprietário repara somente marcador',async()=>{
  const h=adminHarness();let result=await h.context.inspectAdminAccount(h.user);
  await h.context.ensureAdminMarker(h.user,result);assert.deepEqual(h.writes,[]);
  h.setMarker(false);h.user.email='owner@example.com';
  result=await h.context.inspectAdminAccount(h.user);await h.context.ensureAdminMarker(h.user,result);
  assert.deepEqual(h.writes,['/admins/admin-user.json']);
});
test('admin rejeita usuário comum, verificação ausente, bloqueio e banco sem permissão',async()=>{
  const h=adminHarness();h.setMarker(false);
  let result=await h.context.inspectAdminAccount(h.user);assert.equal(result.authorized,false);
  await assert.rejects(h.context.ensureAdminMarker(h.user,result));
  h.setAccount({isAdmin:true});result=await h.context.inspectAdminAccount(h.user);
  await assert.rejects(h.context.ensureAdminMarker(h.user,result),/Cadastro administrativo antigo/);
  h.user.emailVerified=false;await assert.rejects(h.context.inspectAdminAccount(h.user),/Confirme/);
  h.user.emailVerified=true;h.setAccount({blocked:true});await assert.rejects(h.context.inspectAdminAccount(h.user),/bloqueada/);
  h.user.email='owner@example.com';h.deny();await assert.rejects(h.context.inspectAdminAccount(h.user),/recusou/);
  assert.deepEqual(h.writes,[]);
});

test('resposta antiga de autenticação não derruba a nova sessão',async()=>{
  let rejectOld;const oldUser={uid:'old'},newUser={uid:'new'},watched=[],failures=[];
  const auth={currentUser:oldUser};
  const context={authGeneration:0,stopAccount(){},readJSON:()=>({}),notify(){},clearLocal(){},firebase:{auth:()=>auth},
    verifyUser:user=>user===oldUser?new Promise((_,reject)=>{rejectOld=reject;}):Promise.resolve(true),
    watchAccount:(_db,user)=>watched.push(user.uid),fail:error=>failures.push(error),Error};
  vm.runInNewContext(section(read('public/user-session.js'),'  function handleAuth(','  function start(){'),context);
  context.handleAuth({},oldUser);auth.currentUser=newUser;context.handleAuth({},newUser);
  await new Promise(resolve=>setImmediate(resolve));rejectOld(new Error('network late'));
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(watched,['new']);assert.deepEqual(failures,[]);
});

test('verificação administrativa tardia não reabre painel depois do logout',async()=>{
  let listener,finishRead;const opened=[],gates=[];
  const user={uid:'admin'};const auth={currentUser:user,onAuthStateChanged(fn){listener=fn;}};
  const context={initializeFirebase(){},firebase:{auth:()=>auth},setTimeout:()=>1,clearTimeout(){},currentAdmin:null,
    inspectAdminAccount:()=>new Promise(resolve=>{finishRead=resolve;}),ensureAdminMarker:async(_user,result)=>result,
    promiseWithTimeout:value=>value,openVerifiedAdmin:user=>opened.push(user.uid),failGate:title=>gates.push(title),firebaseConnectionError:e=>e.message,Error};
  vm.runInNewContext(section(read('public/admin.html'),'  function verifyAdminSafe(){','  function openApplication(){'),context);
  context.verifyAdminSafe();listener(user);auth.currentUser=null;listener(null);
  finishRead({authorized:true,account:{}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(opened,[]);assert.ok(gates.includes('Acesso restrito'));
});

test('heartbeat da conta não redesenha histórico sem mudança de progresso',()=>{
  let listener,events=0;let current=[{seconds:10,duration:100}];
  const context={document:{addEventListener:(_name,fn)=>{listener=fn;}},context:()=>({uid:'u',profileId:'p'}),
    safeSegment:x=>x,getHistory:()=>current,mergeHistory:remote=>remote,saveLocal:value=>{current=value;},emitHistoryChange:()=>events++};
  vm.runInNewContext(section(read('public/profile-data.js'),"  document.addEventListener('rh:sessionchange',function(event){","  document.addEventListener('rh:uidchange'"),context);
  const update=seconds=>listener({detail:{status:'authenticated',uid:'u',profile:{id:'p'},account:{profileHistory:{p:{episode:{seconds,duration:100}}}}}});
  update(10);update(10);assert.equal(events,0);
  update(20);assert.equal(events,1);assert.equal(current[0].seconds,20);
});

test('sessao pronta nao desmonta a tela de historico ja aberta',()=>{
  let ready,refreshed=0,rendered=0;
  const context={activeTab:'perfil',refreshOpenHistory:()=>refreshed++,renderPerfil:()=>rendered++,
    document:{querySelector:()=>({}),addEventListener:(_name,fn)=>{ready=fn;}}};
  const html=read('public/index.html');
  vm.runInNewContext(section(html,"    document.addEventListener('dk:userready', function(){",'    playFeaturedBtn.addEventListener'),context);
  ready();assert.equal(refreshed,1);assert.equal(rendered,0);
});
