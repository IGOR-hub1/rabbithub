'use strict';

const crypto=require('node:crypto');
const {createStore}=require('./firestore-payment-orders');
const {createActivator}=require('./pix-entitlements');

function fail(message,statusCode=503){return Object.assign(new Error(message),{statusCode});}
function money(cents){return (cents/100).toFixed(2);}
function verifySignature(dataId,headers,secret){
  const signature=String(headers['x-signature']||''),requestId=String(headers['x-request-id']||'');
  const ts=(signature.match(/(?:^|,)\s*ts=(\d{10,15})(?:,|$)/)||[])[1];
  const v1=(signature.match(/(?:^|,)\s*v1=([a-fA-F0-9]{64})(?:,|$)/)||[])[1];
  if(!secret||!ts||!v1||!requestId||!/^ORD[A-Za-z0-9_-]{8,80}$/.test(dataId))return false;
  const manifest='id:'+dataId+';request-id:'+requestId+';ts:'+ts+';';
  const expected=crypto.createHmac('sha256',secret).update(manifest).digest();
  return crypto.timingSafeEqual(expected,Buffer.from(v1,'hex'));
}
function classify(order,record,expectedId){
  const expected=money(record.amountCents),payment=order?.transactions?.payments?.[0];
  if(!order||order.id!==expectedId||order.external_reference!==record.orderId||
     order.type!=='online'||order.processing_mode!=='automatic'||
     order.country_code!=='BRA'||(order.currency_id&&order.currency_id!=='BRL')||
     order.total_amount!==expected||
     (record.mercadoPagoOrderId&&record.mercadoPagoOrderId!==expectedId)||
     !['vip','plus'].includes(record.planId)||record.currency!=='BRL'||
     !Number.isSafeInteger(record.amountCents)||record.amountCents<=0)
    throw fail('Order não corresponde ao pedido Pix registrado.',409);
  if(payment&&(payment.amount!==expected||payment.payment_method?.id!=='pix'||
     payment.payment_method?.type!=='bank_transfer'||
     (record.paymentId&&payment.id!==record.paymentId)))
    throw fail('Transação Pix não corresponde ao pedido.',409);
  if(order.status==='processed'&&order.status_detail==='accredited'){
    if(!payment||payment.status!=='processed'||payment.status_detail!=='accredited'||
       order.total_paid_amount!==expected)throw fail('Pagamento aprovado sem confirmação integral.',409);
    return 'approved';
  }
  if(['created','processing','action_required'].includes(order.status))return 'pending';
  if(['canceled','failed'].includes(order.status)&&order.status_detail==='expired')return 'expired';
  if(order.status==='canceled')return 'canceled';
  if(order.status==='failed')return 'rejected';
  if(['refunded','charged_back'].includes(order.status)||order.status_detail==='partially_refunded')return 'reversed';
  throw fail('Status da order ainda não reconhecido.',502);
}
function createService(options={}){
  const store=options.store||createStore(),fetchFn=options.fetch||fetch;
  const accessToken=options.accessToken===undefined?process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN:options.accessToken;
  if(typeof accessToken!=='string'||!/^APP_USR-[^\s]{10,}$/.test(accessToken))throw fail('Access Token de teste não configurado.');
  async function fetchOrder(id){
    if(!/^ORD[A-Za-z0-9_-]{8,80}$/.test(id))throw fail('Identificador de order inválido.',400);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    let response;
    try{response=await fetchFn('https://api.mercadopago.com/v1/orders/'+encodeURIComponent(id),{method:'GET',headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'},signal:controller.signal});}
    catch(_){throw fail('Mercado Pago indisponível.');}
    finally{clearTimeout(timer);}
    if(!response.ok)throw fail('Não foi possível consultar a order no Mercado Pago.',response.status===429?503:502);
    try{return await response.json();}catch(_){throw fail('Resposta inválida do Mercado Pago.',502);}
  }
  async function status(uid,orderId){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||!/^[0-9a-f-]{36}$/.test(orderId))throw fail('Pedido inválido.',400);
    const found=await store.findByOrderId(orderId);
    if(!found||found.value.uid!==uid)throw fail('Pedido não encontrado.',404);
    const record=found.value;
    return {orderId:record.orderId,planId:record.planId,amountCents:record.amountCents,
      currency:record.currency,status:record.status==='creating'?'pending':record.status,
      gatewayStatus:record.gatewayStatus||null,activatedAt:record.activatedAt||null,
      expiresAt:record.expiresAt??null,
      updatedAt:record.verifiedAt||record.updatedAt||record.createdAt};
  }
  async function list(uid){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw fail('Usuario invalido.',400);
    const found=await store.findByUid(uid);
    return found.filter(item=>item.value.uid===uid).map(item=>{
      const record=item.value;
      return {orderId:record.orderId,planId:record.planId,amountCents:record.amountCents,
        currency:record.currency,status:record.status==='creating'?'pending':record.status,
        activatedAt:record.activatedAt||null,expiresAt:record.expiresAt??null,
        createdAt:record.createdAt||null,updatedAt:record.verifiedAt||record.updatedAt||record.createdAt||null};
    }).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async function reconcile(id,eventId){
    const order=await fetchOrder(id);
    if(!/^[0-9a-f-]{36}$/.test(order?.external_reference||''))return {ignored:true};
    for(let attempt=0;attempt<3;attempt++){
      const found=await store.findByOrderId(order.external_reference);
      if(!found)return {ignored:true};
      const record=found.value,nextStatus=classify(order,record,id);
      let duplicate=record.status===nextStatus&&record.gatewayStatus===order.status&&
        record.gatewayStatusDetail===order.status_detail;
      if(!duplicate){
        const next={...record,status:nextStatus,gatewayStatus:order.status,
          gatewayStatusDetail:String(order.status_detail||''),mercadoPagoOrderId:id,
          lastNotificationId:String(eventId||'').slice(0,100),verifiedAt:new Date().toISOString()};
        const updated=await store.commitUpdate(found.id,next,found.updateTime);
        if(updated?.conflict)continue;
      }
      if(nextStatus==='approved'){
        const fresh=await store.findByOrderId(order.external_reference);
        if(!fresh||fresh.value.status!=='approved'||classify(order,fresh.value,id)!=='approved')
          throw fail('Pedido mudou antes da ativacao. Reenvie a notificacao.',503);
        const activator=options.activator||createActivator({period:options.period});
        const activation=await activator.activate(fresh.value);
        for(let updateAttempt=0;updateAttempt<3;updateAttempt++){
          const latest=await store.findByOrderId(order.external_reference);
          if(!latest||latest.value.status!=='approved')throw fail('Pedido mudou durante a ativacao.',503);
          if(latest.value.activatedAt===activation.activatedAt&&latest.value.expiresAt===activation.expiresAt)
            return {duplicate,status:'approved',activatedAt:activation.activatedAt};
          const completed={...latest.value,activatedAt:activation.activatedAt,
            expiresAt:activation.expiresAt,activationStatus:'active'};
          const saved=await store.commitUpdate(latest.id,completed,latest.updateTime);
          if(!saved?.conflict)return {status:'approved',activatedAt:activation.activatedAt};
        }
        throw fail('Conflito ao registrar a ativacao no Firestore. Reenvie a notificacao.',503);
      }
      return duplicate?{duplicate:true,status:nextStatus}:{status:nextStatus};
    }
    throw fail('Conflito ao atualizar pedido. Reenvie a notificação.',503);
  }
  return {status,list,reconcile};
}

module.exports={createService,verifySignature,_test:{classify}};
