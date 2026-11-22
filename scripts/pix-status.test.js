'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createService,verifySignature,_test}=require('../lib/pix-status');
const {createActivator}=require('../lib/pix-entitlements');

const orderId='123e4567-e89b-42d3-a456-426614174000';
const mpId='ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
function record(){return {orderId,uid:'buyer-uid',planId:'vip',amountCents:990,currency:'BRL',
  status:'pending',gatewayStatus:'action_required',gatewayStatusDetail:'waiting_transfer',
  mercadoPagoOrderId:mpId,paymentId:'PAY01TEST',createdAt:'2026-11-21T00:00:00Z'};}
function mpOrder(status='processed',detail='accredited'){
  return {id:mpId,type:'online',processing_mode:'automatic',external_reference:orderId,
    country_code:'BRA',total_amount:'9.90',total_paid_amount:status==='processed'?'9.90':'0.00',
    status,status_detail:detail,transactions:{payments:[{id:'PAY01TEST',amount:'9.90',
      status:status==='processed'?'processed':status,status_detail:detail,
      payment_method:{id:'pix',type:'bank_transfer'}}]}};
}
function fakeStore(){
  let value=record(),version=1,writes=0;
  return {get writes(){return writes;},get value(){return value;},
    async findByOrderId(id){return id===orderId?{id:'a'.repeat(64),value:{...value},updateTime:'v'+version}:null;},
    async findByUid(uid){return uid==='buyer-uid'?[{id:'a'.repeat(64),value:{...value},updateTime:'v'+version}]:[];},
    async commitUpdate(_id,next,updateTime){
      if(updateTime!=='v'+version)return {conflict:true};
      writes++;value=next;version++;return {value:next,updateTime:'v'+version};
    }};
}
function service(store,getOrder){return createService({store,accessToken:'APP_USR-1234567890',
  activator:{activate:async()=>({activatedAt:2000000000000,expiresAt:0})},fetch:async(url,init)=>{
  assert.equal(url,'https://api.mercadopago.com/v1/orders/'+mpId);
  assert.equal(init.headers.Authorization,'Bearer APP_USR-1234567890');
  return {ok:true,json:async()=>getOrder()};
}});}

test('assinatura HMAC do evento Order valida ID, request-id e timestamp',()=>{
  const secret='test-secret',requestId='request-123',ts='1742505638683';
  const manifest='id:'+mpId+';request-id:'+requestId+';ts:'+ts+';';
  const hash=crypto.createHmac('sha256',secret).update(manifest).digest('hex');
  const headers={'x-request-id':requestId,'x-signature':'ts='+ts+',v1='+hash};
  assert.equal(verifySignature(mpId,headers,secret),true);
  assert.equal(verifySignature(mpId,headers,'other'),false);
  assert.equal(verifySignature(mpId+'X',headers,secret),false);
  assert.equal(verifySignature(mpId,{'x-signature':headers['x-signature']},secret),false);
});

test('aprova apenas Pix integral confirmado na Orders API e ignora repetição',async()=>{
  const store=fakeStore(),current=mpOrder(),s=service(store,()=>current);
  assert.deepEqual(await s.reconcile(mpId,'event-1'),{status:'approved',activatedAt:2000000000000});
  assert.equal(store.value.status,'approved');
  assert.equal(store.writes,2);
  assert.deepEqual(await s.reconcile(mpId,'event-1'),{duplicate:true,status:'approved',activatedAt:2000000000000});
  assert.equal(store.writes,2);
  assert.equal((await s.status('buyer-uid',orderId)).status,'approved');
  assert.equal((await s.list('buyer-uid'))[0].status,'approved');
  assert.deepEqual(await s.list('other-uid'),[]);
  await assert.rejects(s.status('other-uid',orderId),{statusCode:404});
  current.total_paid_amount='0.01';
  await assert.rejects(s.reconcile(mpId,'event-2'),{statusCode:409});
  assert.equal(store.writes,2);
});

test('pendente, recusado, cancelado e expirado são derivados da order consultada',async()=>{
  const sample=record();
  assert.equal(_test.classify(mpOrder('action_required','waiting_transfer'),sample,mpId),'pending');
  assert.equal(_test.classify(mpOrder('failed','failed'),sample,mpId),'rejected');
  assert.equal(_test.classify(mpOrder('canceled','canceled'),sample,mpId),'canceled');
  assert.equal(_test.classify(mpOrder('canceled','expired'),sample,mpId),'expired');
  assert.equal(_test.classify(mpOrder('failed','expired'),sample,mpId),'expired');
  assert.throws(()=>_test.classify({...mpOrder(),country_code:'ARG'},sample,mpId),{statusCode:409});
  assert.throws(()=>_test.classify({...mpOrder(),external_reference:'other'},sample,mpId),{statusCode:409});
  assert.throws(()=>_test.classify({...mpOrder(),total_amount:'19.90'},sample,mpId),{statusCode:409});
  assert.throws(()=>_test.classify({...mpOrder(),total_paid_amount:'0.00'},sample,mpId),{statusCode:409});
});

test('approved webhook activates once; pending and invalid amounts never activate',async()=>{
  const payments=fakeStore();
  let account={uid:'buyer-uid',plan:'Free',premium:false,profile:{name:'Ana'}};
  let accountVersion=1,accountWrites=0,current=mpOrder('action_required','waiting_transfer');
  const accountStore={async request(path,method,value,etag){
    assert.equal(path,'users/buyer-uid');
    if(method==='GET')return {value:{...account},etag:'v'+accountVersion};
    assert.equal(method,'PUT');assert.equal(etag,'v'+accountVersion);
    account=value;accountVersion++;accountWrites++;return {value};
  }};
  const s=createService({store:payments,accessToken:'APP_USR-1234567890',
    activator:createActivator({store:accountStore,clock:()=>2000000000000}),
    fetch:async()=>({ok:true,json:async()=>current})});
  await s.reconcile(mpId,'pending-event');
  assert.equal(accountWrites,0);
  current={...mpOrder(),total_amount:'0.01'};
  await assert.rejects(s.reconcile(mpId,'invalid-event'),{statusCode:409});
  assert.equal(accountWrites,0);
  current=mpOrder();
  await s.reconcile(mpId,'approved-event');
  assert.equal(accountWrites,1);
  assert.equal(account.plan,'VIP');
  assert.equal(account.profile.name,'Ana');
  assert.equal((await s.status('buyer-uid',orderId)).activatedAt,2000000000000);
  await s.reconcile(mpId,'duplicate-event');
  assert.equal(accountWrites,1);
});

test('falha temporaria entre Firestore e conta e recuperada no reenvio do Webhook',async()=>{
  const store=fakeStore();let failOnce=true,activations=0;
  const s=createService({store,accessToken:'APP_USR-1234567890',
    activator:{activate:async()=>{
      if(failOnce){failOnce=false;throw Object.assign(new Error('RTDB offline'),{statusCode:503});}
      activations++;return {activatedAt:2000000000000,expiresAt:0};
    }},fetch:async()=>({ok:true,json:async()=>mpOrder()})});
  await assert.rejects(s.reconcile(mpId,'event-1'),{statusCode:503});
  assert.equal(store.value.status,'approved');
  assert.equal(store.value.activatedAt,undefined);
  await s.reconcile(mpId,'event-1');
  assert.equal(store.value.activatedAt,2000000000000);
  assert.equal(activations,1);
});

test('notificacoes pendentes, recusadas, canceladas e expiradas nao chamam ativacao',async()=>{
  for(const [status,detail] of [['action_required','waiting_transfer'],['failed','failed'],
    ['canceled','canceled'],['canceled','expired']]){
    let calls=0;const store=fakeStore();
    const s=createService({store,accessToken:'APP_USR-1234567890',
      activator:{activate:async()=>{calls++;throw Error('Ativacao indevida');}},
      fetch:async()=>({ok:true,json:async()=>mpOrder(status,detail)})});
    await s.reconcile(mpId,'event-'+status+'-'+detail);
    assert.equal(calls,0,status+'/'+detail);
    assert.notEqual(store.value.status,'approved');
  }
});

test('falhas e respostas invalidas da Orders API nao alteram o pedido nem liberam plano',async()=>{
  for(const result of [
    {ok:false,status:503},
    {ok:true,json:async()=>{throw Error('invalid json');}},
    {ok:true,json:async()=>({...mpOrder(),total_amount:'0.01'})}
  ]){
    const store=fakeStore();let activations=0;
    const s=createService({store,accessToken:'APP_USR-1234567890',
      activator:{activate:async()=>{activations++;}},fetch:async()=>result});
    await assert.rejects(s.reconcile(mpId,'invalid-api'));
    assert.equal(store.writes,0);
    assert.equal(store.value.status,'pending');
    assert.equal(activations,0);
  }
});
