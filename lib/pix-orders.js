'use strict';

const crypto=require('node:crypto');
const {getPlan,isOrderPrice}=require('./plan-pricing');
const {createStore}=require('./firestore-payment-orders');
const {createService:createStatusService}=require('./pix-status');
const PIX_LIFETIME_MS=24*60*60*1000;
const CREATE_LEASE_MS=30*1000;

function fail(message,statusCode=503){return Object.assign(new Error(message),{statusCode});}
function amount(cents){return (cents/100).toFixed(2);}
function publicOrder(record){
  return {orderId:record.orderId,planId:record.planId,amountCents:record.amountCents,
    currency:record.currency,mercadoPagoOrderId:record.mercadoPagoOrderId,
    paymentId:record.paymentId,status:record.status,gatewayStatus:record.gatewayStatus,
    qrCode:record.pixCopyPaste,qrCodeBase64:record.qrCodeBase64||null,pixCopyPaste:record.pixCopyPaste,
    ticketUrl:record.ticketUrl||null,createdAt:record.createdAt,pixExpiresAt:record.pixExpiresAt||null};
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
    ticketUrl,updatedAt:new Date().toISOString(),
    pixExpiresAt:new Date(Date.parse(record.paymentRequestedAt||record.createdAt)+PIX_LIFETIME_MS).toISOString()};
}
function createService(options={}){
  const fetchFn=options.fetch||fetch;
  const accessToken=options.accessToken===undefined?process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN:options.accessToken;
  if(typeof accessToken!=='string'||!/^APP_USR-[^\s]{10,}$/.test(accessToken))
    throw fail('Configure MERCADO_PAGO_TEST_ACCESS_TOKEN com o Access Token do ambiente de teste.');
  const store=options.store||createStore();
  const statusService=options.statusService||createStatusService({store,fetch:fetchFn,accessToken});
  const now=options.now||Date.now;
  function planDocument(uid,planId){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw fail('Conta Firebase invalida.',403);
    const plan=getPlan(planId);
    if(!plan)throw fail('Plano invalido.',400);
    return {plan,documentId:crypto.createHash('sha256').update(uid+'\0'+plan.id).digest('hex')};
  }
  function checkRecord(stored,uid,plan){
    if(!stored||!stored.value||stored.value.uid!==uid||stored.value.planId!==plan.id||
       !isOrderPrice(stored.value)||
       stored.value.currency!=='BRL'||!/^[0-9a-f-]{36}$/.test(stored.value.orderId))
      throw fail('Registro do pedido inconsistente.',503);
    return stored.value;
  }
  async function pendingOrder(documentId,record,uid,plan){
    if(!/^ORD[A-Za-z0-9_-]{8,80}$/.test(record.mercadoPagoOrderId||'')||
       typeof record.pixCopyPaste!=='string'||!record.pixCopyPaste)
      throw fail('Cobranca Pix pendente incompleta.',503);
    const verified=await statusService.reconcile(record.mercadoPagoOrderId,'lookup');
    const latest=await store.get(documentId);
    const current=checkRecord(latest,uid,plan);
    if(current.orderId!==record.orderId)throw fail('Pedido atualizado por outra solicitacao. Tente novamente.',409);
    if(current.status!=='pending')return null;
    if(verified.status!=='pending'||current.gatewayStatus!=='action_required'||
       verified.paymentStatus!=='action_required'||verified.qrCode!==current.pixCopyPaste)
      throw fail('Estado do Pix em atualizacao. Tente novamente.',409);
    const expires=Date.parse(current.pixExpiresAt||'')||Date.parse(current.paymentRequestedAt||current.createdAt||'')+PIX_LIFETIME_MS;
    if(!Number.isFinite(expires)||expires<=now())throw fail('Aguardando confirmacao do vencimento do Pix no Mercado Pago.',409);
    return publicOrder(current);
  }
  async function lookup(uid,planId){
    const {plan,documentId}=planDocument(uid,planId);
    const stored=await store.get(documentId);
    if(!stored)return null;
    const record=checkRecord(stored,uid,plan);
    if(record.status==='pending'){
      const order=await pendingOrder(documentId,record,uid,plan);
      if(order&&order.amountCents!==plan.amountCents)
        throw fail('Existe um Pix VIP anterior de R$ 9,90. Aguarde a confirmacao ou o vencimento antes de gerar outro.',409);
      return order;
    }
    if(record.status==='creating'&&Number(record.leaseUntil)>now())
      throw Object.assign(fail('Pedido Pix em preparacao. Tente novamente em instantes.',409),{retryAfter:'2'});
    return null;
  }
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
    const {plan,documentId}=planDocument(uid,planId);
    let stored=await store.get(documentId);
    let ownsLease=false;
    if(!stored){
      const initial={orderId:crypto.randomUUID(),uid,planId:plan.id,amountCents:plan.amountCents,
        currency:plan.currency,priceRevision:plan.priceRevision,status:'creating',createdAt:new Date(now()).toISOString(),
        paymentRequestedAt:new Date(now()).toISOString(),leaseUntil:now()+CREATE_LEASE_MS};
      const created=await store.create(documentId,initial);
      stored=created?.conflict?await store.get(documentId):created;
      ownsLease=!created?.conflict;
    }
    let record=checkRecord(stored,uid,plan);
    if(record.status==='pending'){
      const reusable=await pendingOrder(documentId,record,uid,plan);
      if(reusable){
        if(reusable.amountCents!==plan.amountCents)
          throw fail('Existe um Pix VIP anterior de R$ 9,90. Aguarde a confirmacao ou o vencimento antes de gerar outro.',409);
        return reusable;
      }
      stored=await store.get(documentId);
      record=checkRecord(stored,uid,plan);
      if(!['rejected','canceled','expired'].includes(record.status))
        throw fail('Pedido anterior em atualizacao. Consulte novamente antes de criar outro Pix.',409);
    }
    if(['rejected','canceled','expired'].includes(record.status)){
      const replacement={orderId:crypto.randomUUID(),uid,planId:plan.id,amountCents:plan.amountCents,
        currency:plan.currency,priceRevision:plan.priceRevision,status:'creating',createdAt:new Date(now()).toISOString(),
        paymentRequestedAt:new Date(now()).toISOString(),leaseUntil:now()+CREATE_LEASE_MS};
      const rotated=await store.rotateOrder(documentId,record,replacement,stored.updateTime);
      stored=rotated?.conflict?await store.get(documentId):rotated;
      if(!stored||stored.value.uid!==uid||stored.value.planId!==plan.id||
         stored.value.amountCents!==plan.amountCents||stored.value.status!=='creating')
        throw fail('Pedido concorrente em processamento. Tente novamente.',409);
      ownsLease=!rotated?.conflict;
    }else if(record.status!=='creating')throw fail('Pedido existente requer revisão antes de nova cobrança.',409);
    if(stored.value.amountCents!==plan.amountCents)
      throw fail('Existe um pedido VIP anterior em preparacao. Aguarde a conclusao antes de gerar outro.',409);
    if(!ownsLease){
      if(Number(stored.value.leaseUntil)>now())
        throw Object.assign(fail('Pedido Pix em preparacao. Tente novamente em instantes.',409),{retryAfter:'2'});
      const reserved={...stored.value,leaseUntil:now()+CREATE_LEASE_MS,
        paymentRequestedAt:stored.value.paymentRequestedAt||new Date(now()).toISOString()};
      const claim=await store.update(documentId,reserved,stored.updateTime);
      if(claim?.conflict)throw Object.assign(fail('Pedido concorrente em processamento. Tente novamente.',409),{retryAfter:'2'});
      if(!claim?.value||claim.value.orderId!==stored.value.orderId)
        throw fail('Nao foi possivel reservar o pedido Pix.',503);
      stored=claim;
    }
    const activeRecord=stored.value;
    const body={type:'online',total_amount:amount(plan.amountCents),external_reference:activeRecord.orderId,
      processing_mode:'automatic',transactions:{payments:[{amount:amount(plan.amountCents),
        payment_method:{id:'pix',type:'bank_transfer'},expiration_time:'P1D'}]},payer:{email}};
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
  return {create,lookup};
}

module.exports={createService,_test:{extract,amount}};
