'use strict';

const crypto=require('node:crypto');
const PROJECT_ID=String(process.env.FIREBASE_PROJECT_ID||'animes-64408').trim();

function failure(message,statusCode=503){return Object.assign(new Error(message),{statusCode});}
function fields(value){
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    Number.isSafeInteger(item)?{integerValue:String(item)}:{stringValue:String(item)}]));
}
function decode(document){
  if(!document||!document.fields||!document.updateTime)throw failure('Resposta inválida do Firestore.');
  const value={};
  for(const [key,item] of Object.entries(document.fields)){
    if(item.stringValue!==undefined)value[key]=item.stringValue;
    else if(item.integerValue!==undefined)value[key]=Number(item.integerValue);
  }
  return {value,updateTime:document.updateTime};
}

function createStore(options={}){
  const fetchFn=options.fetch||fetch;
  let account;
  try{account=options.account||JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'null');}
  catch(_){throw failure('FIREBASE_SERVICE_ACCOUNT_JSON inválido.');}
  if(!account||account.project_id!==PROJECT_ID||!account.client_email||!account.private_key)
    throw failure('Configure uma conta de serviço Firebase do projeto para o Firestore.');
  const base='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(PROJECT_ID)+'/databases/(default)/documents/paymentOrders';
  const rateBase=base.replace(/\/paymentOrders$/,'')+'/paymentRateLimits';
  let cachedToken='',expiresAt=0;
  async function timed(url,init){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await fetchFn(url,{...init,signal:controller.signal});}
    catch(_){throw failure('Firestore indisponível.');}
    finally{clearTimeout(timer);}
  }
  async function token(){
    if(cachedToken&&Date.now()<expiresAt-60000)return cachedToken;
    const now=Math.floor(Date.now()/1000),enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const signing=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:account.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const assertion=signing+'.'+crypto.sign('RSA-SHA256',Buffer.from(signing),account.private_key).toString('base64url');
    const response=await timed('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
    if(!response.ok)throw failure('Não foi possível autenticar o Firestore.');
    let data;try{data=await response.json();}catch(_){throw failure('Resposta inválida da autenticação Google.');}
    if(!data.access_token)throw failure('Resposta inválida da autenticação Google.');
    cachedToken=data.access_token;expiresAt=Date.now()+Number(data.expires_in||3600)*1000;
    return cachedToken;
  }
  async function request(url,method,body){
    const response=await timed(url,{method,headers:{Authorization:'Bearer '+await token(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(response.status===404)return null;
    if(response.status===409||response.status===412)return {conflict:true};
    if(!response.ok)throw failure('Falha ao acessar o Firestore.');
    let data;try{data=await response.json();}catch(_){throw failure('Resposta inválida do Firestore.');}
    return decode(data);
  }
  function documentUrl(id){
    if(!/^[a-f0-9]{64}$/.test(id))throw failure('Identificador de pedido inválido.',400);
    return base+'/'+id;
  }
  function rateLimitUrl(id){
    if(!/^[a-f0-9]{64}$/.test(id))throw failure('Identificador de limite invalido.',400);
    return rateBase+'/'+id;
  }
  return {
    getRateLimit:id=>request(rateLimitUrl(id),'GET'),
    async commitRateLimits(entries){
      if(!Array.isArray(entries)||!entries.length||entries.length>3)
        throw failure('Contadores de limite invalidos.',400);
      const prefix='projects/'+PROJECT_ID+'/databases/(default)/documents/paymentRateLimits/';
      const writes=entries.map(entry=>{
        rateLimitUrl(entry.id);
        if(entry.updateTime!==null&&(typeof entry.updateTime!=='string'||!entry.updateTime))
          throw failure('Versao do limite invalida.',400);
        return {update:{name:prefix+entry.id,fields:fields(entry.value)},
          currentDocument:entry.updateTime?{updateTime:entry.updateTime}:{exists:false}};
      });
      const response=await timed(base.replace(/\/paymentOrders$/,'')+':commit',{
        method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},
        body:JSON.stringify({writes})
      });
      if([404,409,412].includes(response.status))return {conflict:true};
      if(!response.ok)throw failure('Falha ao registrar limite no Firestore.');
      let result;try{result=await response.json();}catch(_){throw failure('Resposta invalida do limite Firestore.');}
      if(!Array.isArray(result?.writeResults)||result.writeResults.length!==entries.length||
         result.writeResults.some(item=>typeof item?.updateTime!=='string'))
        throw failure('Commit do limite sem confirmacao.');
      return {ok:true};
    },
    get:id=>request(documentUrl(id),'GET'),
    create:(id,value)=>request(base+'?documentId='+id,'POST',{fields:fields(value)}),
    update:(id,value,updateTime)=>request(documentUrl(id)+'?currentDocument.updateTime='+encodeURIComponent(updateTime),'PATCH',{fields:fields(value)}),
    async findByOrderId(orderId){
      if(!/^[0-9a-f-]{36}$/.test(orderId))return null;
      const body={structuredQuery:{from:[{collectionId:'paymentOrders'}],where:{fieldFilter:{field:{fieldPath:'orderId'},op:'EQUAL',value:{stringValue:orderId}}},limit:2}};
      const response=await timed(base.replace(/\/paymentOrders$/,'')+':runQuery',{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw failure('Falha ao consultar pedidos no Firestore.');
      let rows;try{rows=await response.json();}catch(_){throw failure('Resposta inválida do Firestore.');}
      if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'))
        throw failure('Resposta invÃ¡lida da consulta Firestore.');
      const matches=rows.filter(row=>row.document);
      if(matches.length>1)throw failure('Referência de pedido duplicada no Firestore.');
      if(!matches.length)return null;
      const document=matches[0].document,id=document.name&&document.name.split('/').pop();
      if(!/^[a-f0-9]{64}$/.test(id||''))throw failure('Documento de pedido inválido.');
      return {id,...decode(document)};
    },
    async findByUid(uid){
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw failure('Usuario invalido.',400);
      const body={structuredQuery:{from:[{collectionId:'paymentOrders'}],where:{fieldFilter:{field:{fieldPath:'uid'},op:'EQUAL',value:{stringValue:uid}}}}};
      const response=await timed(base.replace(/\/paymentOrders$/,'')+':runQuery',{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw failure('Falha ao consultar historico de pedidos.');
      let rows;try{rows=await response.json();}catch(_){throw failure('Resposta invalida do Firestore.');}
      if(!Array.isArray(rows))throw failure('Resposta invalida do Firestore.');
      return rows.filter(row=>row&&row.document).map(row=>{
        const id=row.document.name&&row.document.name.split('/').pop();
        if(!/^[a-f0-9]{64}$/.test(id||''))throw failure('Documento de pedido invalido.');
        return {id,...decode(row.document)};
      });
    },
    async commitUpdate(id,value,updateTime){
      documentUrl(id);
      if(typeof updateTime!=='string'||!updateTime)throw failure('Versão do pedido inválida.');
      const body={writes:[{update:{name:'projects/'+PROJECT_ID+'/databases/(default)/documents/paymentOrders/'+id,fields:fields(value)},currentDocument:{updateTime}}]};
      const response=await timed(base.replace(/\/paymentOrders$/,'')+':commit',{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(response.status===409||response.status===412)return {conflict:true};
      if(!response.ok)throw failure('Falha ao confirmar o estado do pedido no Firestore.');
      let result;try{result=await response.json();}catch(_){throw failure('Resposta invÃ¡lida do commit Firestore.');}
      const committedAt=result?.writeResults?.[0]?.updateTime;
      if(typeof committedAt!=='string'||!committedAt)throw failure('Commit Firestore sem confirmaÃ§Ã£o.');
      return {value,updateTime:committedAt};
    },
    async rotateOrder(id,oldValue,newValue,updateTime){
      documentUrl(id);
      if(typeof updateTime!=='string'||!updateTime||!/^[0-9a-f-]{36}$/.test(oldValue?.orderId||''))
        throw failure('Versao do pedido invalida.');
      const archiveId=crypto.createHash('sha256').update('archive:'+oldValue.orderId).digest('hex');
      const prefix='projects/'+PROJECT_ID+'/databases/(default)/documents/paymentOrders/';
      const body={writes:[
        {update:{name:prefix+archiveId,fields:fields(oldValue)},currentDocument:{exists:false}},
        {update:{name:prefix+id,fields:fields(newValue)},currentDocument:{updateTime}}
      ]};
      const response=await timed(base.replace(/\/paymentOrders$/,'')+':commit',{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(response.status===409||response.status===412)return {conflict:true};
      if(!response.ok)throw failure('Falha ao arquivar pedido anterior.');
      let result;try{result=await response.json();}catch(_){throw failure('Resposta invalida do commit Firestore.');}
      const committedAt=result?.writeResults?.[1]?.updateTime;
      if(typeof committedAt!=='string'||!committedAt)throw failure('Commit Firestore sem confirmacao.');
      return {value:newValue,updateTime:committedAt};
    }
  };
}

module.exports={createStore};
