'use strict';

const {readBody}=require('../lib/http-body');
const {createService,verifySignature}=require('../lib/pix-status');
const {createLimiter}=require('../lib/pix-rate-limit');

module.exports=async function handler(request,response){
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  if(request.method!=='POST'){
    response.setHeader('Allow','POST');response.statusCode=405;
    return response.end(JSON.stringify({ok:false}));
  }
  try{
    const secret=String(process.env.MERCADO_PAGO_WEBHOOK_SECRET_TEST||'');
    if(!secret)throw Object.assign(new Error('Webhook não configurado.'),{statusCode:503});
    const url=new URL(request.url||'/', 'https://localhost');
    const dataId=url.searchParams.get('data.id')||'';
    if(url.searchParams.get('type')!=='order'||!verifySignature(dataId,request.headers||{},secret)){
      try{await createLimiter().consume('webhookInvalid',null,request);}
      catch(error){if(error.statusCode===429)throw error;}
      throw Object.assign(new Error('Notificação não autenticada.'),{statusCode:401});
    }
    const supplied=request.body;
    const raw=supplied===undefined?await readBody(request,65536):Buffer.isBuffer(supplied)?supplied.toString('utf8'):typeof supplied==='string'?supplied:JSON.stringify(supplied);
    if(Buffer.byteLength(raw||'')>65536)throw Object.assign(new Error('Notificação muito grande.'),{statusCode:413});
    let body;try{body=JSON.parse(raw||'{}');}catch(_){throw Object.assign(new Error('JSON inválido.'),{statusCode:400});}
    if(body?.type!=='order'||body?.data?.id!==dataId||body?.data?.currency_id!=='BRL'||body.live_mode!==false)
      throw Object.assign(new Error('Notificação de order inválida para teste.'),{statusCode:400});
    // Os campos de status do webhook são ignorados. A fonte é GET /v1/orders/{id}.
    await createService().reconcile(dataId,body.id);
    response.statusCode=200;response.end(JSON.stringify({ok:true}));
  }catch(error){
    if(error.retryAfter&&/^\d{1,5}$/.test(error.retryAfter))response.setHeader('Retry-After',error.retryAfter);
    response.statusCode=Number(error.statusCode)||500;
    response.end(JSON.stringify({ok:false,error:error.statusCode?error.message:'Falha interna.'}));
  }
};
