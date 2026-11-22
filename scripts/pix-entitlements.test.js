'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createActivator,_test}=require('../lib/pix-entitlements');
const {normalize}=require('../lib/account-plan');

const orderId='123e4567-e89b-42d3-a456-426614174000';
function order(planId='vip'){
  return {uid:'buyer-uid',orderId,planId,amountCents:planId==='plus'?1990:990,currency:'BRL',
    status:'approved',gatewayStatus:'processed',gatewayStatusDetail:'accredited',
    mercadoPagoOrderId:'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',verifiedAt:'2026-11-21T00:00:00Z'};
}
function memoryStore(initial={}){
  let account={uid:'buyer-uid',email:'buyer@example.com',plan:'Free',premium:false,
    profile:{name:'Ana'},...initial},version=1,writes=0,conflictOnce=false;
  return {get account(){return account;},get writes(){return writes;},
    conflictNext(){conflictOnce=true;},
    async request(path,method,value,etag){
      assert.equal(path,'users/buyer-uid');
      if(method==='GET'){assert.equal(etag,true);return {value:{...account},etag:'v'+version};}
      assert.equal(method,'PUT');
      if(conflictOnce){conflictOnce=false;version++;return {conflict:true};}
      if(etag!=='v'+version)return {conflict:true};
      writes++;account=value;version++;return {value,etag:'v'+version};
    }};
}

test('somente pedido Pix aprovado ativa VIP, preserva perfil e impede repeticao',async()=>{
  const store=memoryStore(),activator=createActivator({store,clock:()=>2000000000000,period:()=>0});
  for(const invalid of [{...order(),status:'pending'},{...order(),status:'rejected'},
    {...order(),amountCents:1},{...order(),currency:'ARS'},{...order(),gatewayStatus:'action_required'}])
    await assert.rejects(activator.activate(invalid),{statusCode:409});
  assert.equal(store.writes,0);
  const first=await activator.activate(order());
  assert.deepEqual(first,{activatedAt:2000000000000,expiresAt:0,duplicate:false});
  assert.equal(store.account.plan,'VIP');
  assert.equal(store.account.profile.name,'Ana');
  assert.equal(normalize(store.account).isVip,true);
  assert.equal(store.account.appliedPaymentOrders[orderId].planId,'vip');
  assert.equal((await activator.activate(order())).duplicate,true);
  assert.equal(store.writes,1);
});

test('aprovacao valida preco novo e preserva pedidos VIP antigos',()=>{
  assert.equal(_test.validOrder(order()),true);
  assert.equal(_test.validOrder({...order(),amountCents:100,priceRevision:'vip-test-1'}),true);
  assert.equal(_test.validOrder({...order(),amountCents:990,priceRevision:'vip-test-1'}),false);
  assert.equal(_test.validOrder({...order(),amountCents:100}),false);
});

test('pedido VIP de R$ 1,00 aprovado ativa somente o plano pago',async()=>{
  const store=memoryStore(),activator=createActivator({store,clock:()=>2000000000000,period:()=>0});
  const paid={...order(),amountCents:100,priceRevision:'vip-test-1'};
  await assert.rejects(activator.activate({...paid,status:'pending'}),{statusCode:409});
  await activator.activate(paid);
  assert.equal(store.account.plan,'VIP');
  assert.equal(store.account.appliedPaymentOrders[orderId].planId,'vip');
  assert.equal(store.writes,1);
});

test('PLUS conserva beneficios VIP e renovacao respeita validade futura',async()=>{
  const until=2000000300000;
  const store=memoryStore({plan:'VIP',premium:true,premiumUntil:until});
  const activator=createActivator({store,clock:()=>2000000000000,period:()=>2000000100000});
  await activator.activate(order('plus'));
  assert.equal(store.account.plan,'Plus');
  assert.equal(store.account.premiumUntil,until);
  assert.equal(normalize(store.account).key,'plus');
  assert.equal(normalize(store.account).isVip,true);
});

test('conflito de versao do Realtime Database e concessao permanente sao preservados',async()=>{
  const store=memoryStore({plan:'VIP',premium:true,premiumUntil:0});store.conflictNext();
  const activator=createActivator({store,clock:()=>2000000000000,period:()=>2000000100000});
  await activator.activate(order('plus'));
  assert.equal(store.account.premiumUntil,0);
  assert.equal(store.writes,1);
});
