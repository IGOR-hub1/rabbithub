'use strict';

const {createStore}=require('./affiliate-store');
const {getPlan}=require('./plan-pricing');
const {paidPlanExpiry}=require('./plan-duration');

function fail(message,statusCode=503){return Object.assign(new Error(message),{statusCode});}
function validOrder(record){
  const plan=getPlan(record?.planId);
  return !!(plan&&record.status==='approved'&&record.gatewayStatus==='processed'&&
    record.gatewayStatusDetail==='accredited'&&record.currency==='BRL'&&
    record.amountCents===plan.amountCents&&
    /^[A-Za-z0-9_-]{1,128}$/.test(record.uid||'')&&
    /^[0-9a-f-]{36}$/.test(record.orderId||'')&&
    /^ORD[A-Za-z0-9_-]{8,80}$/.test(record.mercadoPagoOrderId||'')&&
    typeof record.verifiedAt==='string');
}
function createActivator(options={}){
  const store=options.store||createStore();
  const clock=options.clock||Date.now;
  const period=options.period||paidPlanExpiry;
  async function activate(record){
    if(!validOrder(record))throw fail('Pedido nao aprovado para ativacao.',409);
    const path='users/'+record.uid;
    for(let attempt=0;attempt<6;attempt++){
      const current=await store.request(path,'GET',undefined,true);
      const account=current?.value;
      if(!account||typeof account!=='object'||account.uid!==record.uid||
         account.banned===true||account.blocked===true)
        throw fail('Conta do comprador indisponivel para ativacao.',409);
      if(!current.etag)throw fail('Versao da conta ausente.');
      const applied=account.appliedPaymentOrders&&typeof account.appliedPaymentOrders==='object'
        ?account.appliedPaymentOrders:{};
      const previous=applied[record.orderId];
      if(previous){
        if(previous.planId!==record.planId)throw fail('Pedido aplicado a outro plano.',409);
        return {activatedAt:previous.activatedAt,expiresAt:previous.expiresAt,duplicate:true};
      }
      const activatedAt=Number(clock());
      if(!Number.isSafeInteger(activatedAt)||activatedAt<=0)throw fail('Horario de ativacao invalido.');
      const requestedExpiry=period(record,activatedAt,account);
      if(!Number.isSafeInteger(requestedExpiry)||requestedExpiry<0)
        throw fail('Validade do plano invalida.');
      const oldExpiry=account.premiumUntil;
      const wasPermanent=(account.premium===true||account.vip===true||account.isPremium===true)&&oldExpiry===0;
      const expiresAt=wasPermanent||requestedExpiry===0?0:Math.max(requestedExpiry,
        Number.isSafeInteger(oldExpiry)&&oldExpiry>activatedAt?oldExpiry:0);
      const label=record.planId==='plus'?'Plus':'VIP';
      const next={...account,plan:label,currentPlan:label,premium:true,vip:true,isPremium:true,
        premiumUntil:expiresAt,vipUntil:expiresAt,planExpiresAt:expiresAt,
        subscriptionStatus:'active',planActivatedAt:activatedAt,planUpdatedAt:activatedAt,
        appliedPaymentOrders:{...applied,[record.orderId]:{planId:record.planId,activatedAt,expiresAt}}};
      const result=await store.request(path,'PUT',next,current.etag);
      if(!result?.conflict)return {activatedAt,expiresAt,duplicate:false};
    }
    throw fail('Conta alterada simultaneamente. Reenvie a notificacao.');
  }
  return {activate};
}

module.exports={createActivator,_test:{validOrder}};
