'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createService}=require('../lib/pix-orders');
const {createStore}=require('../lib/firestore-payment-orders');

function memoryStore(){
  const records=new Map();
  return {
    records,
    async get(id){return records.get(id)||null;},
    async create(id,value){
      if(records.has(id))return {conflict:true};
      const result={value:{...value},updateTime:'v1'};records.set(id,result);return result;
    },
    async update(id,value,time){
      if(records.get(id)?.updateTime!==time)return {conflict:true};
      const result={value:{...value},updateTime:'v2'};records.set(id,result);return result;
    },
    async rotateOrder(id,oldValue,newValue,time){
      if(records.get(id)?.updateTime!==time)return {conflict:true};
      const archived=crypto.createHash('sha256').update('archive:'+oldValue.orderId).digest('hex');
      if(records.has(archived))return {conflict:true};
      records.set(archived,{value:{...oldValue},updateTime:'v3'});
      const result={value:{...newValue},updateTime:'v3'};records.set(id,result);return result;
    },
    async findByOrderId(orderId){
      for(const [id,record] of records)if(record.value.orderId===orderId)return {id,...record};
      return null;
    },
    async commitUpdate(id,value,time){
      if(records.get(id)?.updateTime!==time)return {conflict:true};
      const result={value:{...value},updateTime:'v'+crypto.randomUUID()};records.set(id,result);return result;
    }
  };
}
function mpOrder(body){
  return {id:'ORD0123456789ABCDEF',type:'online',country_code:'BRA',external_reference:body.external_reference,
    processing_mode:'automatic',total_amount:body.total_amount,status:'action_required',
    transactions:{payments:[{id:'PAY012345',amount:body.total_amount,status:'action_required',
      payment_method:{id:'pix',type:'bank_transfer',qr_code:'000201TESTPIX',qr_code_base64:''}}]}};
}

test('Pix Orders API usa preço do servidor e reutiliza pedido e chave em tentativas repetidas',async()=>{
  const store=memoryStore(),requests=[];
  const service=createService({store,accessToken:'APP_USR-1234567890',
    statusService:{reconcile:async()=>({status:'pending',paymentStatus:'action_required',qrCode:'000201TESTPIX'})},
    fetch:async(url,init)=>{
    requests.push({url,init});
    return {ok:true,json:async()=>mpOrder(JSON.parse(init.body))};
  }});
  const first=await service.create('uid-1','buyer@example.com','vip');
  assert.equal(first.status,'pending');
  assert.equal(first.planId,'vip');
  assert.equal(first.amountCents,100);
  assert.equal(first.pixCopyPaste,'000201TESTPIX');
  assert.equal(first.qrCodeBase64,null);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://api.mercadopago.com/v1/orders');
  const sent=JSON.parse(requests[0].init.body);
  assert.equal(sent.total_amount,'1.00');
  assert.equal(sent.transactions.payments[0].amount,'1.00');
  assert.deepEqual(sent.transactions.payments[0].payment_method,{id:'pix',type:'bank_transfer'});
  assert.equal(sent.transactions.payments[0].expiration_time,'P1D');
  assert.equal(sent.payer.email,'buyer@example.com');
  assert.equal(sent.external_reference,first.orderId);
  assert.equal(requests[0].init.headers['X-Idempotency-Key'],first.orderId);
  assert.equal((await service.create('uid-1','buyer@example.com','vip')).orderId,first.orderId);
  assert.equal(requests.length,1);
  const plus=await service.create('uid-1','buyer@example.com','plus');
  assert.notEqual(plus.orderId,first.orderId);
  assert.equal(JSON.parse(requests[1].init.body).total_amount,'19.90');
  await assert.rejects(service.create('uid-1','buyer@example.com','invalid'),{statusCode:400});
  assert.equal(store.records.size,2);
});

test('falha ou resposta inválida não libera QR nem cria segunda referência',async()=>{
  const store=memoryStore(),references=[];
  let mode='failure';
  let clock=Date.now();
  const service=createService({store,accessToken:'APP_USR-1234567890',now:()=>clock,fetch:async(_url,init)=>{
    const body=JSON.parse(init.body);references.push({reference:body.external_reference,key:init.headers['X-Idempotency-Key']});
    return mode==='failure'?{ok:false,status:503}:{ok:true,json:async()=>({...mpOrder(body),total_amount:'0.01'})};
  }});
  await assert.rejects(service.create('uid-2','buyer@example.com','vip'),{statusCode:502});
  mode='invalid';
  clock+=31000;
  await assert.rejects(service.create('uid-2','buyer@example.com','vip'),{statusCode:502});
  assert.equal(references.length,2);
  assert.deepEqual(references[0],references[1]);
  assert.equal([...store.records.values()][0].value.status,'creating');
  assert.throws(()=>createService({store,accessToken:''}),{statusCode:503});
});

test('Pix recusado pode ser substituido e permanece no historico',async()=>{
  const store=memoryStore(),service=createService({store,accessToken:'APP_USR-1234567890',
    fetch:async(_url,init)=>({ok:true,json:async()=>mpOrder(JSON.parse(init.body))})});
  const first=await service.create('buyer','buyer@example.com','vip');
  const current=[...store.records.entries()][0];
  store.records.set(current[0],{value:{...current[1].value,status:'rejected'},updateTime:'v3'});
  const second=await service.create('buyer','buyer@example.com','vip');
  assert.notEqual(first.orderId,second.orderId);
  assert.equal(store.records.size,2);
  assert.equal([...store.records.values()].filter(item=>item.value.status==='rejected').length,1);
});

test('Pix VIP legado de R$ 9,90 bloqueia nova cobranca ate o estado terminal',async()=>{
  const store=memoryStore(),uid='buyer',id=crypto.createHash('sha256').update(uid+'\0vip').digest('hex');
  const old={uid,planId:'vip',amountCents:990,currency:'BRL',status:'pending',
    orderId:crypto.randomUUID(),mercadoPagoOrderId:'ORD0123456789ABCDEF',paymentId:'PAY012345',
    pixCopyPaste:'000201TESTPIX',gatewayStatus:'action_required',createdAt:new Date().toISOString()};
  await store.create(id,old);
  let posts=0;
  const service=createService({store,accessToken:'APP_USR-1234567890',
    statusService:{reconcile:async()=>({status:'pending',paymentStatus:'action_required',qrCode:'000201TESTPIX'})},
    fetch:async(_url,init)=>{posts++;return {ok:true,json:async()=>mpOrder(JSON.parse(init.body))};}});
  await assert.rejects(service.lookup(uid,'vip'),{statusCode:409});
  await assert.rejects(service.create(uid,'buyer@example.com','vip'),{statusCode:409});
  assert.equal(posts,0);
  store.records.set(id,{value:{...old,status:'expired'},updateTime:'v1'});
  const next=await service.create(uid,'buyer@example.com','vip');
  assert.equal(next.amountCents,100);
  assert.equal(posts,1);
});

test('consulta autenticada reutiliza o Pix em outra instancia e confirma estado no gateway',async()=>{
  const store=memoryStore();
  let postedBody,posts=0,gets=0,now=Date.now();
  const fetch=async(url,init)=>{
    if(init.method==='POST'){
      posts++;postedBody=JSON.parse(init.body);
      return {ok:true,json:async()=>mpOrder(postedBody)};
    }
    gets++;
    assert.match(url,/\/v1\/orders\/ORD/);
    return {ok:true,json:async()=>mpOrder(postedBody)};
  };
  const first=createService({store,fetch,now:()=>now,accessToken:'APP_USR-1234567890'});
  const order=await first.create('owner','buyer@example.com','vip');
  const second=createService({store,fetch,now:()=>now,accessToken:'APP_USR-1234567890'});
  const resumed=await second.lookup('owner','vip');
  assert.equal(resumed.orderId,order.orderId);
  assert.equal(resumed.pixCopyPaste,order.pixCopyPaste);
  assert.equal(resumed.pixExpiresAt,order.pixExpiresAt);
  assert.equal(posts,1);
  assert.equal(gets,1);
  assert.equal(await second.lookup('another-user','vip'),null);
  assert.equal(posts,1);
  now+=24*60*60*1000+1000;
  await assert.rejects(second.lookup('owner','vip'),{statusCode:409});
  await assert.rejects(second.create('owner','buyer@example.com','vip'),{statusCode:409});
  assert.equal(posts,1);
});

test('vencimento confirmado no gateway permite novo Pix e arquiva o anterior',async()=>{
  const store=memoryStore();let postedBody,posts=0,expired=false;
  const service=createService({store,accessToken:'APP_USR-1234567890',fetch:async(_url,init)=>{
    if(init.method==='POST'){posts++;postedBody=JSON.parse(init.body);return {ok:true,json:async()=>mpOrder(postedBody)};}
    const result=mpOrder(postedBody);
    if(expired){result.status='canceled';result.status_detail='expired';result.transactions.payments[0].status='canceled';}
    return {ok:true,json:async()=>result};
  }});
  const first=await service.create('owner','buyer@example.com','plus');
  expired=true;
  assert.equal(await service.lookup('owner','plus'),null);
  const second=await service.create('owner','buyer@example.com','plus');
  assert.notEqual(second.orderId,first.orderId);
  assert.equal(posts,2);
  assert.equal([...store.records.values()].filter(item=>item.value.status==='expired').length,1);
});

test('falha no GET do Mercado Pago impede reutilizacao e nova cobranca',async()=>{
  const store=memoryStore();let postedBody,posts=0,failGet=false;
  const service=createService({store,accessToken:'APP_USR-1234567890',fetch:async(_url,init)=>{
    if(init.method==='POST'){posts++;postedBody=JSON.parse(init.body);return {ok:true,json:async()=>mpOrder(postedBody)};}
    if(failGet)throw new Error('gateway offline');
    return {ok:true,json:async()=>mpOrder(postedBody)};
  }});
  await service.create('owner','buyer@example.com','vip');
  failGet=true;
  await assert.rejects(service.lookup('owner','vip'),{statusCode:503});
  await assert.rejects(service.create('owner','buyer@example.com','vip'),{statusCode:503});
  assert.equal(posts,1);
});

test('solicitacoes simultaneas reservam um unico POST e preservam a idempotencia',async()=>{
  const store=memoryStore();let release,posts=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const fetch=async(_url,init)=>{
    if(init.method==='POST'){
      posts++;await gate;
      return {ok:true,json:async()=>mpOrder(JSON.parse(init.body))};
    }
    throw new Error('GET inesperado');
  };
  const first=createService({store,fetch,accessToken:'APP_USR-1234567890'});
  const second=createService({store,fetch,accessToken:'APP_USR-1234567890'});
  const pending=first.create('owner','buyer@example.com','vip');
  await new Promise(resolve=>setTimeout(resolve,0));
  await assert.rejects(second.create('owner','buyer@example.com','vip'),{statusCode:409});
  assert.equal(posts,1);
  release();
  assert.equal((await pending).status,'pending');
});

test('Firestore usa criação exclusiva e atualização condicional com escopo datastore',async()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const calls=[];
  const account={project_id:'animes-64408',client_email:'test@animes-64408.iam.gserviceaccount.com',
    private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  const store=createStore({account,fetch:async(url,init)=>{
    calls.push({url,init});
    if(url.includes('oauth2.googleapis.com'))return {ok:true,json:async()=>({access_token:'google-token',expires_in:3600})};
    return {ok:true,json:async()=>({fields:JSON.parse(init.body||'{}').fields||{status:{stringValue:'creating'}},updateTime:'2026-11-21T00:00:00Z'})};
  }});
  const id='a'.repeat(64);
  await store.create(id,{uid:'uid-1',amountCents:990,status:'creating'});
  await store.update(id,{uid:'uid-1',amountCents:990,status:'pending'},'2026-11-21T00:00:00Z');
  const assertion=new URLSearchParams(calls[0].init.body).get('assertion');
  const claims=JSON.parse(Buffer.from(assertion.split('.')[1],'base64url').toString('utf8'));
  assert.equal(claims.scope,'https://www.googleapis.com/auth/datastore');
  assert.match(calls[1].url,/paymentOrders\?documentId=/);
  assert.equal(calls[1].init.method,'POST');
  assert.equal(JSON.parse(calls[1].init.body).fields.amountCents.integerValue,'990');
  assert.match(calls[2].url,/currentDocument.updateTime=/);
  assert.equal(calls[2].init.method,'PATCH');
});

test('Firestore query and conditional commit preserve the order version',async()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const account={project_id:'animes-64408',client_email:'test@animes-64408.iam.gserviceaccount.com',
    private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  const id='a'.repeat(64),orderId='123e4567-e89b-42d3-a456-426614174000';
  const updateTime='2026-11-21T00:00:00Z',calls=[];
  const store=createStore({account,fetch:async(url,init)=>{
    calls.push({url,init});
    if(url.includes('oauth2.googleapis.com'))return {ok:true,json:async()=>({access_token:'google-token',expires_in:3600})};
    if(url.endsWith(':runQuery'))return {ok:true,json:async()=>[{document:{name:'projects/animes-64408/databases/(default)/documents/paymentOrders/'+id,
      fields:{orderId:{stringValue:orderId},uid:{stringValue:'buyer'},amountCents:{integerValue:'990'}},updateTime}}]};
    if(url.endsWith(':commit'))return {ok:true,json:async()=>({writeResults:
      JSON.parse(init.body).writes.map(()=>({updateTime:'2026-11-21T00:01:00Z'}))})};
    throw new Error('Unexpected URL');
  }});
  const found=await store.findByOrderId(orderId);
  assert.equal(found.id,id);
  assert.equal(found.value.amountCents,990);
  assert.equal(found.updateTime,updateTime);
  const owned=await store.findByUid('buyer');
  assert.equal(owned.length,1);
  assert.equal(owned[0].value.orderId,orderId);
  const result=await store.commitUpdate(id,{...found.value,status:'approved'},found.updateTime);
  assert.equal(result.updateTime,'2026-11-21T00:01:00Z');
  assert.match(calls[1].url,/documents:runQuery$/);
  assert.equal(JSON.parse(calls[1].init.body).structuredQuery.where.fieldFilter.value.stringValue,orderId);
  assert.equal(JSON.parse(calls[2].init.body).structuredQuery.where.fieldFilter.field.fieldPath,'uid');
  assert.match(calls[3].url,/documents:commit$/);
  const write=JSON.parse(calls[3].init.body).writes[0];
  assert.equal(write.currentDocument.updateTime,updateTime);
  assert.equal(write.update.fields.status.stringValue,'approved');
  const replacement={...found.value,orderId:'223e4567-e89b-42d3-a456-426614174000',status:'creating'};
  await store.rotateOrder(id,{...found.value,status:'rejected'},replacement,updateTime);
  const writes=JSON.parse(calls[4].init.body).writes;
  assert.equal(writes.length,2);
  assert.equal(writes[0].currentDocument.exists,false);
  assert.equal(writes[1].currentDocument.updateTime,updateTime);
  assert.equal(writes[1].update.fields.orderId.stringValue,replacement.orderId);
});
