'use strict';

const crypto=require('node:crypto');
const {getPlan}=require('./plan-pricing');
const {createStore}=require('./firestore-payment-orders');

function fail(message,statusCode=503){return Object.assign(new Error(message),{statusCode});}
function amount(cents){return (cents/100).toFixed(2);}
function publicOrder(record){
  return {orderId:record.orderId,planId:record.planId,amountCents:record.amountCents,
    currency:record.currency,mercadoPagoOrderId:record.mercadoPagoOrderId,
    paymentId:record.paymentId,status:record.status,gatewayStatus:record.gatewayStatus,
    qrCode:record.pixCopyPaste,qrCodeBase64:record.qrCodeBase64||null,pixCopyPaste:record.pixCopyPaste,
    ticketUrl:record.ticketUrl||null};
}
function extract(order,record){
  const payment=order&&order.transactions&&order.transactions.payments&&order.transactions.payments[0];
  const method=payment&&payment.payment_method;
  if(!order||typeof order.id!=='string'||!/^ORD[A-Za-z0-9_-]{8,80}$/.test(order.id)||
     order.external_reference!==record.orderId||order.type!=='online'||
     order.country_code!=='BRA'||(order.currency_id&&order.currency_id!=='BRL')||
     order.total_amount!==amount(record.amountCents)||order.processing_mode!=='automatic'||
     !payment||payment.amount!==amount(record.amountCents)||
     typeof payment.id!=='string'||!payment.id||method?.id!=='pix'||method.type!=='bank_transfer'||
     order.status!=='action_required'||payment.status!=='action_required'||
     typeof method.qr_code!=='string'||!method.qr_code||method.qr_code.length>8192||
     (method.qr_code_base64!==undefined&&typeof method.qr_code_base64!=='string')||
     (method.qr_code_base64||'').length>500000)
    throw fail('Resposta Pix incompleta ou inválida do Mercado Pago.',502);
  let ticketUrl='';
  if(typeof method.ticket_url==='string'){
    try{const url=new URL(method.ticket_url);if(url.protocol==='https:'&&url.hostname.endsWith('.mercadopago.com.br'))ticketUrl=url.href;}catch(_){}
  }
  return {...record,status:'pending',gatewayStatus:order.status,mercadoPagoOrderId:order.id,
    paymentId:payment.id,pixCopyPaste:method.qr_code,qrCodeBase64:method.qr_code_base64||'',
    ticketUrl,updatedAt:new Date().toISOString()};
}
function createService(options={}){
  const fetchFn=options.fetch||fetch;
  const accessToken=options.accessToken===undefined?process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN:options.accessToken;
  if(typeof accessToken!=='string'||!/^APP_USR-[^\s]{10,}$/.test(accessToken))
    throw fail('Configure MERCADO_PAGO_TEST_ACCESS_TOKEN com o Access Token do ambiente de teste.');
  const store=options.store||createStore();
  async function mercadoRequest(url,init){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    let response;
    try{response=await fetchFn(url,{...init,headers:{Authorization:'Bearer '+accessToken,Accept:'application/json',...(init.headers||{})},signal:controller.signal});}
    catch(_){throw fail('Mercado Pago indisponível. Tente novamente.',503);}
    finally{clearTimeout(timer);}
    if(!response.ok){
      const error=fail(response.status===429?'Mercado Pago limitou as tentativas. Tente mais tarde.':'Mercado Pago não criou a cobrança Pix.',response.status===429?429:502);
      if(response.status===429&&response.headers?.get('retry-after'))error.retryAfter=response.headers.get('retry-after');
      throw error;
    }
    try{return await response.json();}catch(_){throw fail('Resposta inválida do Mercado Pago.',502);}
  }
  async function create(uid,email,planId){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email))
      throw fail('Conta Firebase sem e-mail verificado.',403);
    const plan=getPlan(planId);
    if(!plan)throw fail('Plano inválido.',400);
    const documentId=crypto.createHash('sha256').update(uid+'\0'+plan.id).digest('hex');
    let stored=await store.get(documentId);
    if(!stored){
      const initial={orderId:crypto.randomUUID(),uid,planId:plan.id,amountCents:plan.amountCents,
        currency:plan.currency,status:'creating',createdAt:new Date().toISOString()};
      const created=await store.create(documentId,initial);
      stored=created?.conflict?await store.get(documentId):created;
    }
    if(!stored||!stored.value||stored.value.uid!==uid||stored.value.planId!==plan.id||
       (!['rejected','canceled','expired'].includes(stored.value.status)&&stored.value.amountCents!==plan.amountCents)||stored.value.currency!=='BRL'||
       !/^[0-9a-f-]{36}$/.test(stored.value.orderId))throw fail('Registro do pedido inconsistente.',503);
    const record=stored.value;
    if(record.status==='pending')return publicOrder(record);
    if(['rejected','canceled','expired'].includes(record.status)){
      const replacement={orderId:crypto.randomUUID(),uid,planId:plan.id,amountCents:plan.amountCents,
        currency:plan.currency,status:'creating',createdAt:new Date().toISOString()};
      const rotated=await store.rotateOrder(documentId,record,replacement,stored.updateTime);
      stored=rotated?.conflict?await store.get(documentId):rotated;
      if(!stored||stored.value.uid!==uid||stored.value.planId!==plan.id||
         stored.value.amountCents!==plan.amountCents||stored.value.status!=='creating')
        throw fail('Pedido concorrente em processamento. Tente novamente.',409);
    }else if(record.status!=='creating')throw fail('Pedido existente requer revisão antes de nova cobrança.',409);
    const activeRecord=stored.value;
    const body={type:'online',total_amount:amount(plan.amountCents),external_reference:activeRecord.orderId,
      processing_mode:'automatic',transactions:{payments:[{amount:amount(plan.amountCents),
        payment_method:{id:'pix',type:'bank_transfer'}}]},payer:{email}};
    let result=await mercadoRequest('https://api.mercadopago.com/v1/orders',{
      method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':activeRecord.orderId},body:JSON.stringify(body)
    });
    if(result?.id&&!result?.transactions?.payments?.[0]?.payment_method?.qr_code){
      result=await mercadoRequest('https://api.mercadopago.com/v1/orders/'+encodeURIComponent(result.id),{method:'GET'});
    }
    const completed=extract(result,activeRecord);
    const updated=await store.update(documentId,completed,stored.updateTime);
    if(updated?.conflict){
      const latest=await store.get(documentId);
      if(latest?.value?.status==='pending'&&latest.value.mercadoPagoOrderId===completed.mercadoPagoOrderId)
        return publicOrder(latest.value);
      throw fail('Pedido concorrente ainda em processamento. Tente novamente.',409);
    }
    if(!updated||updated.value?.status!=='pending')throw fail('Não foi possível registrar o pedido Pix. Tente novamente.');
    return publicOrder(updated.value);
  }
  return {create};
}

module.exports={createService,_test:{extract,amount}};
