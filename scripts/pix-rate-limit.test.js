'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createLimiter,clientIp,_test}=require('../lib/pix-rate-limit');
const {createStore}=require('../lib/firestore-payment-orders');

function memoryStore(){
  const records=new Map();let version=0;
  return {records,
    async getRateLimit(id){return records.get(id)||null;},
    async commitRateLimits(entries){
      if(entries.some(entry=>{
        const current=records.get(entry.id);
        return entry.updateTime?current?.updateTime!==entry.updateTime:!!current;
      }))return {conflict:true};
      for(const entry of entries)records.set(entry.id,{value:entry.value,updateTime:'v'+(++version)});
      return {ok:true};
    }
  };
}
const policies={windowMs:600000,create:{uid:5,ip:20},lookup:{uid:120,ip:600},
  status:{uid:120,ip:3000},webhookInvalid:{ip:3}};
const request=(ip='203.0.113.10')=>({socket:{remoteAddress:ip},headers:{'x-forwarded-for':'198.51.100.99'}});

test('cinco criacoes em dez minutos por UID; recuperacao e status nao gastam criacao',async()=>{
  const store=memoryStore();let clock=2000000000000;
  const limiter=createLimiter({store,config:policies,now:()=>clock,vercel:false});
  for(let count=0;count<5;count++)await limiter.consume('create','buyer',request());
  for(let count=0;count<60;count++)await limiter.consume('status','buyer',request());
  await limiter.consume('lookup','buyer',request());
  await assert.rejects(limiter.consume('create','buyer',request()),error=>{
    assert.equal(error.statusCode,429);assert.equal(error.retryAfter,'600');return true;
  });
  clock+=600001;
  await limiter.consume('create','buyer',request());
  assert.equal(store.records.size,6);
});

test('limite por IP vale entre UIDs e ignora X-Forwarded-For nao confiavel',async()=>{
  const store=memoryStore(),config={...policies,create:{uid:5,ip:2}};
  const limiter=createLimiter({store,config,now:()=>2000000000000,vercel:false});
  await limiter.consume('create','buyer-a',request());
  await limiter.consume('create','buyer-b',request());
  await assert.rejects(limiter.consume('create','buyer-c',request()),{statusCode:429});
  await limiter.consume('create','buyer-c',request('203.0.113.11'));
  assert.equal(clientIp(request(),false),'203.0.113.10');
  assert.equal(clientIp({headers:{'x-vercel-forwarded-for':'203.0.113.20',
    'x-forwarded-for':'198.51.100.99'}},true),'203.0.113.20');
  assert.equal(clientIp({headers:{'x-vercel-forwarded-for':'invalid',
    'x-forwarded-for':'198.51.100.99'}},true),'unknown');
});

test('concorrencia atomica nao permite ultrapassar cota compartilhada',async()=>{
  const store=memoryStore();
  const limiter=createLimiter({store,config:policies,now:()=>2000000000000,vercel:false});
  const outcomes=await Promise.allSettled(Array.from({length:12},()=>limiter.consume('create','buyer',request())));
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,5);
  assert.equal(outcomes.filter(item=>item.status==='rejected'&&item.reason.statusCode===429).length,7);
  assert.equal([...store.records.values()].every(item=>JSON.parse(item.value.hits).length===5),true);
});

test('limite de assinaturas invalidas e isolado; configuracao rejeita valores incorretos',async()=>{
  const store=memoryStore(),limiter=createLimiter({store,config:policies,now:()=>2000000000000,vercel:false});
  for(let count=0;count<3;count++)await limiter.consume('webhookInvalid',null,request());
  await assert.rejects(limiter.consume('webhookInvalid',null,request()),{statusCode:429});
  await limiter.consume('status','buyer',request());
  const previous=process.env.PIX_CREATE_LIMIT_PER_UID;
  try{process.env.PIX_CREATE_LIMIT_PER_UID='0';assert.throws(()=>_test.config(),{statusCode:503});}
  finally{if(previous===undefined)delete process.env.PIX_CREATE_LIMIT_PER_UID;else process.env.PIX_CREATE_LIMIT_PER_UID=previous;}
});

test('Firestore grava limites de UID e IP no mesmo commit com precondicoes',async()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const account={project_id:'animes-64408',client_email:'test@animes-64408.iam.gserviceaccount.com',
    private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  const calls=[];
  const store=createStore({account,fetch:async(url,init)=>{
    calls.push({url,init});
    if(url.includes('oauth2.googleapis.com'))return {ok:true,json:async()=>({access_token:'google-token',expires_in:3600})};
    if(init.method==='GET')return {ok:true,json:async()=>({fields:{hits:{stringValue:'[1]'}},updateTime:'2026-11-22T00:00:00Z'})};
    return {ok:true,json:async()=>({writeResults:[{updateTime:'2026-11-22T00:01:00Z'},
      {updateTime:'2026-11-22T00:01:00Z'}]})};
  }});
  const first='a'.repeat(64),second='b'.repeat(64);
  assert.equal((await store.getRateLimit(first)).value.hits,'[1]');
  await store.commitRateLimits([{id:first,updateTime:'2026-11-22T00:00:00Z',value:{hits:'[1,2]',updatedAt:2}},
    {id:second,updateTime:null,value:{hits:'[2]',updatedAt:2}}]);
  const getCall=calls.find(call=>call.init.method==='GET');
  assert.match(getCall.url,/\/paymentRateLimits\/a{64}$/);
  const commitCall=calls.find(call=>call.url.endsWith(':commit'));
  const writes=JSON.parse(commitCall.init.body).writes;
  assert.equal(writes.length,2);
  assert.equal(writes[0].currentDocument.updateTime,'2026-11-22T00:00:00Z');
  assert.equal(writes[1].currentDocument.exists,false);
  assert.equal(writes[0].update.fields.hits.stringValue,'[1,2]');
});
