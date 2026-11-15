'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/profile-data.js'),'utf8');
function client(account,storage=new Map()){
  const events={},writes=[];
  let fail=false;
  const state={status:'authenticated',uid:'owner',account,profile:{id:'one'}};
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const document={readyState:'loading',addEventListener(name,fn){(events[name]||(events[name]=[])).push(fn);},dispatchEvent(event){(events[event.type]||[]).forEach(fn=>fn(event));}};
  const db={ref:()=>({toString:()=>'/history'})};
  function database(){return db;}database.ServerValue={TIMESTAMP:123};
  const firebase={database,app:()=>({database:()=>db})};
  const window={firebase,DK_FIREBASE_CONFIG:{},setTimeout:()=>1,clearTimeout(){},addEventListener:document.addEventListener,
    RabbitHubPlans:{get:()=>({name:'VIP'}),can:()=>true},
    RabbitHubSession:{get:()=>state,readAccount:async()=>account,
      async updateAccount(patch){
        if(fail)throw new Error('offline');
        writes.push(patch);
        for(const [key,value] of Object.entries(patch)){
          const parts=key.split('/');let node=account;
          for(const part of parts.slice(0,-1))node=node[part]||(node[part]={});
          if(value===null)delete node[parts.at(-1)];else node[parts.at(-1)]=JSON.parse(JSON.stringify(value));
        }
        return account;
      }
    }};
  vm.runInNewContext(source,{window,document,localStorage,firebase,console,CustomEvent:function(type,init){this.type=type;this.detail=init&&init.detail;}});
  async function sync(){
    await new Promise(resolve=>setImmediate(resolve));
    (events.online||[]).forEach(fn=>fn());
    await new Promise(resolve=>setImmediate(resolve));
  }
  return {service:window.RabbitHubProfileData,state,storage,writes,events,window,sync,fail:value=>fail=value};
}
const episode={slug:'anime',number:1,season:1,epIdx:0,epLink:'episode-link',duration:1200,forceSync:true};
test('historico e posicao gravam juntos e outro dispositivo recupera tempo exato',async()=>{
  const account={},first=client(account);
  await first.service.saveHistory({...episode,seconds:300.375,progresso:5,ts:1000});
  assert.equal(first.writes.length,1);
  const keys=Object.keys(first.writes[0]);
  assert.equal(keys.length,2);
  assert.equal(first.writes[0][keys[0]].seconds,300.375);
  assert.equal(first.writes[0][keys[1]].seconds,300.375);
  const other=client(account);
  const history=await other.service.refreshHistory();
  assert.equal(history.length,1);
  assert.equal(history[0].seconds,300.375);
  assert.equal(history[0].progresso,25);
  assert.equal((await other.service.getEpisodeProgress(episode)).seconds,300.375);
  await first.service.saveHistory({...episode,seconds:600,ts:2000});
  assert.equal((await other.service.refreshHistory()).length,1);
  assert.equal(other.service.getHistory()[0].progresso,50);
  first.state.profile={id:'two'};
  await first.service.saveHistory({...episode,seconds:90,ts:3000});
  assert.equal(first.service.getHistory()[0].seconds,90);
  assert.equal((await other.service.getEpisodeProgress(episode)).seconds,600);
});
test('reinicio e falha de rede preservam o perfil e a fila sobrevive a reabertura',async()=>{
  const account={},first=client(account);
  await first.service.saveHistory({...episode,seconds:600,ts:1000});
  await first.sync();
  await first.service.saveHistory({...episode,seconds:0,resetPlayback:true,ts:2000});
  await first.sync();
  assert.equal((await client(account).service.getEpisodeProgress(episode)).seconds,0);
  first.fail(true);
  await first.service.saveHistory({...episode,seconds:36.625,ts:3000});
  await first.sync();
  assert.equal(first.service.getHistory()[0].seconds,36.625);
  assert.equal((await client(account).service.getEpisodeProgress(episode)).seconds,0);
  const reopened=client(account,first.storage);
  (reopened.events.online||[]).forEach(fn=>fn());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await client(account).service.getEpisodeProgress(episode)).seconds,36.625);
  reopened.state.uid='different-owner';
  (reopened.events.online||[]).forEach(fn=>fn());
  assert.equal(reopened.writes.length,1);
});
test('abertura nao fabrica 5% e registros antigos sem tempo nao inventam posicao',async()=>{
  const details=fs.readFileSync(path.join(__dirname,'../public/detalhes.html'),'utf8');
  assert.doesNotMatch(details,/progresso:\s*5\b/);
  const instance=client({});
  await instance.service.saveHistory({...episode,seconds:300,ts:1000});
  await instance.service.saveHistory({...episode,seconds:0,duration:0,progresso:5,ts:2000});
  assert.equal(instance.service.getHistory()[0].seconds,300);
  assert.equal(instance.service.getHistory()[0].progresso,25);
});

test('migracao elimina duplicata do mesmo episodio sem misturar temporadas',async()=>{
  const old={...episode,number:0,seconds:100,ts:100};
  const special={...episode,season:0,seconds:20,ts:150};
  const account={profileHistory:{one:{old,special}},profileProgress:{one:{old,special}}};
  const instance=client(account);
  await instance.service.refreshHistory();
  await instance.service.saveHistory({...episode,seconds:200,ts:200});
  assert.equal(account.profileHistory.one.old,undefined);
  assert.equal(account.profileProgress.one.old,undefined);
  assert.equal(account.profileHistory.one.special.seconds,20);
  assert.equal(instance.service.getHistory().length,2);
});

test('pagina de historico calcula progresso real e envia a posicao e o perfil ao player',()=>{
  const home=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const start=home.indexOf('    function historyPlayerHref('),end=home.indexOf('    function getFavorites()',start);
  assert.ok(start>=0&&end>start);
  const context={window:{RabbitHubProfileData:{getContext:()=>({uid:'owner',profileId:'two'})}}};
  vm.runInNewContext(home.slice(start,end),context);
  const item={...episode,seconds:300.375,progresso:5};
  assert.equal(context.historyProgress(item),25.03125);
  assert.equal(context.historyProgress({progresso:5}),0);
  const url=new URL(context.historyPlayerHref(item),'https://example.com');
  assert.equal(url.searchParams.get('resumeSeconds'),'300.375');
  assert.equal(url.searchParams.get('resumeProfile'),'two');
  assert.equal(url.searchParams.get('resumeUid'),'owner');
  assert.equal(url.searchParams.get('resume'),'1');
});

test('salvamento local resolve mesmo com escrita Firebase permanentemente pendente',async()=>{
  const instance=client({});
  instance.window.RabbitHubSession.updateAccount=()=>new Promise(()=>{});
  const saved=await Promise.race([
    instance.service.saveHistory({...episode,seconds:31.125}),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('salvamento bloqueado pela nuvem')),100))
  ]);
  assert.equal(saved.seconds,31.125);
  assert.equal(instance.service.getHistory()[0].seconds,31.125);
  const reopened=client({},instance.storage);
  assert.equal(reopened.service.getHistory()[0].seconds,31.125);
  await reopened.sync();
  assert.equal((await client(reopened.state.account).service.getEpisodeProgress(episode)).seconds,31.125);
});

test('conta Free sincroniza historico e progresso sem depender de SDK para salvar localmente',async()=>{
  const account={},instance=client(account);
  instance.window.RabbitHubPlans.can=()=>false;
  await instance.service.saveEpisodeProgress({...episode,seconds:32.875},true);
  await instance.sync();
  assert.equal(Object.values(account.profileProgress.one)[0].seconds,32.875);
  const standalone=client({});
  standalone.storage.set('dk_session',JSON.stringify({uid:'owner'}));
  standalone.storage.set('dk_active_profile',JSON.stringify({id:'one'}));
  delete standalone.window.RabbitHubSession;
  delete standalone.window.firebase;
  await standalone.service.saveEpisodeProgress({...episode,seconds:15.5},true);
  assert.equal(standalone.service.getHistory()[0].seconds,15.5);
});

test('posicao depois de reiniciar nao e substituida por zero com resetAt antigo',async()=>{
  const instance=client({});
  await instance.service.saveHistory({...episode,seconds:0,resetPlayback:true,ts:1000});
  await instance.service.saveHistory({...episode,seconds:30,resetAt:1000,ts:2000});
  await instance.service.saveHistory({...episode,seconds:0,resetAt:1000,ts:3000});
  assert.equal(instance.service.getHistory()[0].seconds,30);
  assert.equal(instance.service.getHistory().length,1);
});

test('chaves nao colidem entre pares UID/perfil e a fila recupera cache ausente',async()=>{
  const instance=client({});instance.fail(true);
  instance.state.uid='a_b';instance.state.profile={id:'c'};
  await instance.service.saveHistory({...episode,seconds:31});
  instance.state.uid='a';instance.state.profile={id:'b_c'};
  assert.equal(instance.service.getHistory().length,0);
  await instance.service.saveHistory({...episode,seconds:12});
  instance.state.uid='a_b';instance.state.profile={id:'c'};
  assert.equal(instance.service.getHistory()[0].seconds,31);
  for(const key of instance.storage.keys())if(key.startsWith('rh_profile_history_'))instance.storage.delete(key);
  assert.equal(instance.service.getHistory()[0].seconds,31);
});

test('troca de conta entre salvar e enviar nao grava dados no novo UID',async()=>{
  const instance=client({});
  const saved=instance.service.saveHistory({...episode,seconds:31});
  instance.state.uid='another-owner';
  await saved;await instance.sync();
  assert.equal(instance.writes.length,0);
  assert.equal(instance.service.getHistory().length,0);
  instance.state.uid='owner';await instance.sync();
  assert.equal(instance.writes.length,1);
});

test('migracao conserva cache e fila antigos somente no perfil correspondente',async()=>{
  const storage=new Map([
    ['rh_profile_history_v2_owner_one',JSON.stringify([{...episode,seconds:30,ts:1000}])],
    ['rh_playback_pending_v1_owner_one',JSON.stringify({episode:{...episode,seconds:35,ts:2000}})]
  ]);
  const instance=client({},storage);instance.fail(true);
  assert.equal(instance.service.getHistory()[0].seconds,35);
  instance.state.profile={id:'two'};assert.equal(instance.service.getHistory().length,0);
});
