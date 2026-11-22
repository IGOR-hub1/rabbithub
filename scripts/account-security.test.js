'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const backend=require('../lib/account-plan');
const rules=JSON.parse(read('API ANIMES E CHAT/database.rules.json')).rules;
const now=Date.now();
class Snapshot{
  constructor(value){this.value=value;}
  val(){return this.value===undefined?null:this.value;}
  exists(){return this.value!==undefined&&this.value!==null;}
  child(key){return new Snapshot(this.value&&this.value[key]);}
}
function evaluate(expression,{user={},authTime=123,revoked=false,verified=true,uid='u',target='u',admin=false,next=user}={}){
  const root=new Snapshot({users:{u:user},admins:{u:admin},revokedSessions:{u:revoked?{'123':true}:{}}});
  return Function('auth','root','data','newData','$uid','now','return ('+expression+');')(
    {uid,token:{email_verified:verified,email:'u@example.com',auth_time:authTime}},root,new Snapshot(user),new Snapshot(next),target,now);
}
test('frontend, API e regras concordam sobre VIP sem renovar datas vencidas',()=>{
  const context={window:{}};vm.runInNewContext(read('public/account-plan.js'),context);
  const cases=[
    [{premium:true,premiumUntil:now-1000,planUpdatedAt:now},false],
    [{premium:true,premiumUntil:0,vipUntil:now-1000},true],
    [{premium:true,premiumUntil:null,vipUntil:now-1000},false],
    [{plan:'VIP',subscription:{active:true}},false],
    [{premium:true,premiumUntil:'invalid'},false],
    [{premium:true,premiumUntil:now+60000},true],
    [{premium:true,premiumUntil:0,banned:true},false]
  ];
  for(const [user,expected] of cases){
    assert.equal(backend.normalize(user).isVip,expected);
    assert.equal(context.window.RabbitHubAccountPlan.normalize(user).isVip,expected);
    const readable=evaluate(rules.users.$uid['.read'],{user});
    const canUseTheme=readable&&evaluate(rules.users.$uid.profileCustomization.$profile.theme['.validate'],{user,next:'purple'});
    assert.equal(canUseTheme,expected);
  }
});
test('regras negam escalada, contas bloqueadas, sessoes revogadas e leitura de terceiros',()=>{
  const user={uid:'u',email:'u@example.com',plan:'Free',currentPlan:'Free',premium:false,vip:false};
  assert.equal(evaluate(rules.users.$uid['.write'],{user,next:{...user,displayName:'Novo'}}),true);
  for(const patch of [{premium:true},{isAdmin:true},{role:'admin'},{subscription:{active:true}},
    {planActivatedAt:now},{appliedPaymentOrders:{'123e4567-e89b-42d3-a456-426614174000':true}}]){
    assert.equal(evaluate(rules.users.$uid['.write'],{user,next:{...user,...patch}}),false);
  }
  assert.equal(evaluate(rules.users.$uid['.read'],{user,revoked:true}),false);
  assert.equal(evaluate(rules.users.$uid['.read'],{user,verified:false}),false);
  assert.equal(evaluate(rules.users.$uid['.read'],{user,target:'other'}),false);
  assert.equal(evaluate(rules.users['.read'],{user}),false);
  assert.equal(evaluate(rules.users['.read'],{user,admin:true}),true);
  assert.equal(evaluate(rules.users.$uid['.write'],{user:{...user,blocked:true}}),false);
});
test('API rejeita senha redefinida, revogacao remota e conta bloqueada',async()=>{
  const { _test:auth }=require('../lib/firebase-auth');
  const original=global.fetch;
  try{
    global.fetch=async()=>({ok:true,status:200,json:async()=>({users:[{localId:'u',emailVerified:true,validSince:'200'}]})});
    await assert.rejects(auth.verifyActiveAccount('token',{sub:'u',auth_time:123}),/revogada/);
    global.fetch=async url=>({ok:true,status:200,json:async()=>url.includes('revokedSessions')?true:{uid:'u'}});
    await assert.rejects(auth.verifySessionAccess('token',{sub:'u',auth_time:123}),/revogada/);
    global.fetch=async url=>({ok:true,status:200,json:async()=>url.includes('/blocked.json')?true:null});
    await assert.rejects(auth.verifySessionAccess('token',{sub:'u',auth_time:123}),/bloqueada/);
    const reads=[];
    global.fetch=async url=>{reads.push(new URL(url).pathname);return {ok:true,status:200,json:async()=>null};};
    await auth.verifySessionAccess('token',{sub:'u',auth_time:123});
    assert.deepEqual(reads.sort(),['/revokedSessions/u/123.json','/users/u/banned.json','/users/u/blocked.json']);
  }finally{global.fetch=original;}
});
test('encerrar dispositivo grava bloqueio autenticado e nao confirma falha de permissao',async()=>{
  const storage=new Map([['dk_session',JSON.stringify({uid:'u',sessionId:'current'})]]),patches=[];
  let rejected=false;
  const devices={target:{id:'wrong-legacy-id',authTime:123,active:true},legacy:{active:true,name:'Antigo'}};
  let signOutFails=false,redirect='';
  const user={uid:'u',getIdToken:async()=> 'token',getIdTokenResult:async()=>({claims:{auth_time:789}})};
  const document={documentElement:{setAttribute(){}},hidden:false};
  const window={firebase:{auth:()=>({currentUser:user,async signOut(){if(signOutFails)throw new Error('signout failed');}}),database:()=>({})},DK_FIREBASE_CONFIG:{databaseURL:'https://test.invalid'},
    addEventListener(){},RabbitHubSession:{get:()=>({status:'authenticated',uid:'u'}),subscribe(){}},RabbitHubPlans:{can:()=>true}};
  window.firebase.database.ServerValue={TIMESTAMP:456};
  const fetch=async(url,options)=>{
    if(options.method==='PATCH'){
      const patch=JSON.parse(options.body);patches.push(patch);
      if(!rejected)Object.keys(patch).forEach(key=>{const match=key.match(/^users\/u\/devices\/([^/]+)\/active$/);if(match&&devices[match[1]])devices[match[1]].active=patch[key];});
      return {ok:!rejected,status:rejected?403:200,json:async()=>({})};
    }
    return {ok:true,json:async()=>devices};
  };
  vm.runInNewContext(read('public/auth-guard.js'),{window,document,firebase:window.firebase,location:{pathname:'/index.html',replace:value=>redirect=value},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),clear:()=>storage.clear()},sessionStorage:{clear(){}},fetch,setTimeout,clearTimeout,console});
  await window.RabbitHubDevices.revoke('target');
  assert.equal(patches[0]['revokedSessions/u/123'],true);
  assert.equal(patches[0]['users/u/devices/target/active'],false);
  const legacyResult=await window.RabbitHubDevices.revoke('legacy');
  assert.equal(legacyResult.legacy,true);
  assert.equal(devices.legacy.active,false);
  assert.equal(Object.keys(patches[1]).some(key=>key.startsWith('revokedSessions/')),false);
  rejected=true;
  await assert.rejects(window.RabbitHubDevices.revoke('target'),/recusou/);
  rejected=false;signOutFails=true;
  await assert.rejects(window.DK_logout(),/signout failed/);
  assert.equal(redirect,'','falha de logout nao pode ser exibida como sucesso');
  signOutFails=false;await window.DK_logout();
  assert.equal(patches.at(-1)['revokedSessions/u/789'],true);
  assert.equal(redirect,'login.html');
  assert.equal(storage.size,0);
});
test('trocar senha usa e-mail autenticado e propaga falhas do Firebase',async()=>{
  let recipient='',fail=false;
  const firebase={auth:()=>({currentUser:{email:'real@example.com'},async sendPasswordResetEmail(email){recipient=email;if(fail)throw new Error('network');}})};
  const window={firebase};
  vm.runInNewContext(read('public/profile-data.js'),{window,firebase,document:{readyState:'loading',addEventListener(){}}});
  await window.RabbitHubProfileData.requestPasswordReset();assert.equal(recipient,'real@example.com');
  fail=true;await assert.rejects(window.RabbitHubProfileData.requestPasswordReset(),/network/);
});
