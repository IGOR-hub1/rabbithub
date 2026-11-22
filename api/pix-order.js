'use strict';

const {verifyFirebaseRequest}=require('../lib/firebase-auth');
const {readBody}=require('../lib/http-body');
const {createService}=require('../lib/pix-orders');
const {createLimiter}=require('../lib/pix-rate-limit');
const {createStore}=require('../lib/firestore-payment-orders');

module.exports=async function handler(request,response){
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options','nosniff');
  if(request.method!=='POST'&&request.method!=='GET'){
    response.setHeader('Allow','GET, POST');
    response.statusCode=405;
    return response.end(JSON.stringify({ok:false,error:'Método não permitido.'}));
  }
  try{
    const identity=await verifyFirebaseRequest(request);
    if(request.method==='GET'){
      const url=new URL(request.url||'/', 'https://localhost');
      const keys=[...url.searchParams.keys()];
      if(keys.length!==1||keys[0]!=='planId')
        throw Object.assign(new Error('Informe somente planId.'),{statusCode:400});
      const store=createStore();
      await createLimiter({store}).consume('lookup',identity.sub,request);
      const order=await createService({store}).lookup(identity.sub,url.searchParams.get('planId'));
      response.statusCode=200;
      return response.end(JSON.stringify({ok:true,order}));
    }
    const supplied=request.body;
    const raw=supplied===undefined?await readBody(request,1024):
      Buffer.isBuffer(supplied)?supplied.toString('utf8'):
      typeof supplied==='string'?supplied:JSON.stringify(supplied);
    if(Buffer.byteLength(raw||'')>1024)throw Object.assign(new Error('Solicitação muito grande.'),{statusCode:413});
    let body;try{body=JSON.parse(raw||'{}');}catch(_){throw Object.assign(new Error('JSON inválido.'),{statusCode:400});}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||
       !Object.prototype.hasOwnProperty.call(body,'planId')||typeof body.planId!=='string')
      throw Object.assign(new Error('Envie somente planId.'),{statusCode:400});
    const store=createStore();
    const limiter=createLimiter({store});
    const service=createService({store});
    await limiter.consume('lookup',identity.sub,request);
    const existing=await service.lookup(identity.sub,body.planId);
    if(existing){response.statusCode=200;return response.end(JSON.stringify({ok:true,reused:true,...existing}));}
    await limiter.consume('create',identity.sub,request);
    const order=await service.create(identity.sub,identity.email,body.planId);
    response.statusCode=200;
    response.end(JSON.stringify({ok:true,...order}));
  }catch(error){
    if(error.retryAfter&&/^\d{1,5}$/.test(error.retryAfter))response.setHeader('Retry-After',error.retryAfter);
    response.statusCode=Number(error.statusCode)||500;
    response.end(JSON.stringify({ok:false,error:error.statusCode?error.message:'Falha interna.'}));
  }
};
