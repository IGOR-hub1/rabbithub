'use strict';

const {verifyFirebaseRequest}=require('../lib/firebase-auth');
const {createService}=require('../lib/pix-status');

module.exports=async function handler(request,response){
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  if(request.method!=='GET'){
    response.setHeader('Allow','GET');response.statusCode=405;
    return response.end(JSON.stringify({ok:false,error:'Método não permitido.'}));
  }
  try{
    const identity=await verifyFirebaseRequest(request);
    const url=new URL(request.url||'/', 'https://localhost');
    const result=await createService().status(identity.sub,url.searchParams.get('orderId')||'');
    response.statusCode=200;response.end(JSON.stringify({ok:true,...result}));
  }catch(error){
    response.statusCode=Number(error.statusCode)||500;
    response.end(JSON.stringify({ok:false,error:error.statusCode?error.message:'Falha interna.'}));
  }
};
