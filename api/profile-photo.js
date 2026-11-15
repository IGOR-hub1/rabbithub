'use strict';

const {verifyFirebaseRequest}=require('../lib/firebase-auth');
const {uploadProfileImage,MAX_PROFILE_IMAGE_BYTES}=require('../lib/r2-profile');

module.exports=async function handler(request,response){
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  if(request.method==='OPTIONS'){response.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Profile-Id');response.statusCode=204;return response.end();}
  if(request.method!=='POST'){response.setHeader('Allow','POST');response.statusCode=405;return response.end(JSON.stringify({ok:false,error:'Método não permitido.'}));}
  try{
    const identity=await verifyFirebaseRequest(request);
    const contentType=String(request.headers['content-type']||'').split(';')[0].toLowerCase();
    let body=request.body;
    if(!Buffer.isBuffer(body)){
      if(typeof body==='string')body=Buffer.from(body,'base64');
      else if(body&&typeof body==='object'&&body.base64)body=Buffer.from(String(body.base64),'base64');
      else throw Object.assign(new Error('Envie uma imagem válida.'),{statusCode:400});
    }
    if(body.length>MAX_PROFILE_IMAGE_BYTES)throw Object.assign(new Error('A imagem pode ter no máximo 1,5 MB.'),{statusCode:413});
    const result=await uploadProfileImage(body,{uid:identity.sub,profileId:request.headers['x-profile-id'],contentType});
    response.statusCode=200;return response.end(JSON.stringify({ok:true,url:result.url}));
  }catch(error){response.statusCode=Number(error.statusCode)||500;return response.end(JSON.stringify({ok:false,error:error.message||'Falha no envio da imagem.'}));}
};
