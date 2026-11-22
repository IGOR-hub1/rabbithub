'use strict';

const crypto=require('node:crypto');
const net=require('node:net');
const {createStore}=require('./firestore-payment-orders');

function fail(message,statusCode=503){return Object.assign(new Error(message),{statusCode});}
function positive(name,fallback,max){
  const raw=process.env[name];
  if(raw===undefined||raw==='')return fallback;
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<1||value>max)throw fail('Configuracao de rate limit invalida: '+name);
  return value;
}
function config(){
  return {
    windowMs:positive('PIX_RATE_LIMIT_WINDOW_SECONDS',600,3600)*1000,
    create:{uid:positive('PIX_CREATE_LIMIT_PER_UID',5,100),ip:positive('PIX_CREATE_LIMIT_PER_IP',20,1000)},
    lookup:{uid:positive('PIX_LOOKUP_LIMIT_PER_UID',120,1000),ip:positive('PIX_LOOKUP_LIMIT_PER_IP',600,5000)},
    status:{uid:positive('PIX_STATUS_LIMIT_PER_UID',120,1000),ip:positive('PIX_STATUS_LIMIT_PER_IP',3000,10000)},
    webhookInvalid:{ip:positive('PIX_INVALID_WEBHOOK_LIMIT_PER_IP',30,1000)}
  };
}
function header(request,name){
  const value=request?.headers?.[name]||request?.headers?.[name.toLowerCase()];
  return Array.isArray(value)?value[0]:value;
}
function clientIp(request,vercel=process.env.VERCEL==='1'){
  if(vercel){
    // Vercel define estes headers. Nunca confiar neles fora da plataforma.
    const forwarded=String(header(request,'x-vercel-forwarded-for')||header(request,'x-forwarded-for')||'').trim();
    return net.isIP(forwarded)?forwarded:'unknown';
  }
  const direct=String(request?.socket?.remoteAddress||'').trim();
  return net.isIP(direct)?direct:'unknown';
}
function createLimiter(options={}){
  const store=options.store||createStore();
  const limits=options.config||config();
  const now=options.now||Date.now;
  async function consume(kind,uid,request){
    const policy=limits[kind];
    if(!policy)throw fail('Limite desconhecido.',400);
    if(policy.uid&&(!/^[A-Za-z0-9_-]{1,128}$/.test(uid||'')))throw fail('Usuario invalido.',400);
    const subjects=[];
    if(policy.uid)subjects.push({scope:'uid',value:uid,limit:policy.uid});
    if(policy.ip)subjects.push({scope:'ip',
      value:clientIp(request,options.vercel===undefined?process.env.VERCEL==='1':options.vercel),limit:policy.ip});
    for(let attempt=0;attempt<10;attempt++){
      const instant=now();
      const records=await Promise.all(subjects.map(async subject=>{
        const id=crypto.createHash('sha256').update(kind+'\0'+subject.scope+'\0'+subject.value).digest('hex');
        const stored=await store.getRateLimit(id);
        let hits=[];
        if(stored){
          try{hits=JSON.parse(stored.value.hits);}catch(_){throw fail('Contador de limite invalido.');}
          if(!Array.isArray(hits)||hits.some(value=>!Number.isSafeInteger(value)))
            throw fail('Contador de limite invalido.');
          hits=hits.filter(value=>value>instant-limits.windowMs&&value<=instant+limits.windowMs);
        }
        return {id,stored,hits,limit:subject.limit};
      }));
      const blocked=records.filter(item=>item.hits.length>=item.limit);
      if(blocked.length){
        const retryMs=Math.max(...blocked.map(item=>Math.min(...item.hits)+limits.windowMs-instant));
        throw Object.assign(fail('Muitas tentativas. Aguarde antes de tentar novamente.',429),
          {retryAfter:String(Math.max(1,Math.ceil(retryMs/1000)))});
      }
      const entries=records.map(item=>({id:item.id,updateTime:item.stored?.updateTime||null,
        value:{hits:JSON.stringify([...item.hits,instant]),updatedAt:instant}}));
      const committed=await store.commitRateLimits(entries);
      if(!committed?.conflict)return;
    }
    throw fail('Muitas solicitacoes simultaneas. Tente novamente.',503);
  }
  return {consume};
}

module.exports={createLimiter,clientIp,_test:{config}};
