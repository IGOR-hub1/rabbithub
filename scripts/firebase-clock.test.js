'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../lib/firebase-auth.js'),'utf8');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const epoch=1800000000;
function setup(options={}){
 let monotonic=0,localOffset=options.localOffset??10800,certificateCalls=0,lookupCalls=0;
 class LocalDate extends Date{static now(){return (epoch+localOffset)*1000;}}
 const fetch=async url=>{
  if(String(url).includes('/metadata/x509/')){
   certificateCalls++;
   if(options.certUnavailable)return {ok:false,status:503};
   return {ok:true,headers:new Headers({date:options.badDate?'invalid':new Date((epoch-90)*1000).toUTCString(),age:'90','cache-control':'public, max-age=86400'}),json:async()=>({'test-key':publicKey.export({type:'spki',format:'pem'})})};
  }
  if(String(url).includes('accounts:lookup')){lookupCalls++;return {ok:!options.lookupReject,status:options.lookupReject?400:200,headers:new Headers({date:options.badLookupDate?'invalid':new Date(epoch*1000).toUTCString()}),json:async()=>({users:[{localId:'test-user',emailVerified:true,validSince:'0'}]})};}
  return {ok:!options.databaseReject,status:options.databaseReject?403:200,headers:new Headers({date:options.badDatabaseDate?'invalid':new Date(epoch*1000).toUTCString()}),json:async()=>options.revoked&&String(url).includes('/revokedSessions/')?true:false};
 };
 const sandbox={module:{exports:{}},Buffer,Date:LocalDate,AbortController,setTimeout,clearTimeout,fetch,
  process:{env:{FIREBASE_PROJECT_ID:'clock-test',FIREBASE_DATABASE_URL:'https://test.invalid'}},
  require:name=>name==='node:perf_hooks'?{performance:{now:()=>monotonic}}:require(name)};
 vm.runInNewContext(source,sandbox,{filename:'firebase-auth.js'});
 function token(overrides={},key=privateKey){
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({aud:'clock-test',iss:'https://securetoken.google.com/clock-test',sub:'test-user',email_verified:true,iat:epoch-10,auth_time:epoch-100,exp:epoch+3600,...overrides})).toString('base64url');
  const input=header+'.'+payload;
  return input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),key).toString('base64url');
 }
 return {auth:sandbox.module.exports,token,request:value=>({headers:{authorization:'Bearer '+value}}),advance:ms=>{monotonic+=ms;},setLocalOffset:value=>{localOffset=value;},calls:()=>certificateCalls,lookups:()=>lookupCalls};
}
test('token Firebase válido não é recusado com Windows três horas adiantado',async()=>{
 const env=setup();
 const result=await env.auth.verifyFirebaseRequest(env.request(env.token()),{checkActive:false});
 assert.equal(result.sub,'test-user');
 assert.equal(env.calls(),1);
});
test('expiração real continua sendo recusada mesmo com relógio local atrasado',async()=>{
 const env=setup({localOffset:-10800});
 await assert.rejects(()=>env.auth.verifyFirebaseRequest(env.request(env.token({exp:epoch-1})),{checkActive:false}),error=>error.statusCode===401&&/expirou/.test(error.message));
});
test('Age e tempo monotônico preservam expiração após alteração do relógio do Windows',async()=>{
 const env=setup();
 const request=env.request(env.token({exp:epoch+60}));
 await env.auth.verifyFirebaseRequest(request,{checkActive:false});
 env.setLocalOffset(-86400);
 env.advance(61000);
 await assert.rejects(()=>env.auth.verifyFirebaseRequest(request,{checkActive:false}),error=>error.statusCode===401&&/expirou/.test(error.message));
 assert.equal(env.calls(),1,'a amostra em cache deve avançar pelo tempo monotônico');
});
test('horário confiável não dispensa assinatura, identidade, emissão ou revogação',async()=>{
 const env=setup();
 for(const fields of [{iat:epoch+301},{auth_time:epoch+301},{aud:'outro'},{email_verified:false}]){
  await assert.rejects(()=>env.auth.verifyFirebaseRequest(env.request(env.token(fields)),{checkActive:false}),error=>[401,403].includes(error.statusCode));
 }
 const otherKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
 await assert.rejects(()=>env.auth.verifyFirebaseRequest(env.request(env.token({},otherKey)),{checkActive:false}),error=>error.statusCode===401&&/Assinatura/.test(error.message));
 const revoked=setup({revoked:true});
 await assert.rejects(()=>revoked.auth.verifyFirebaseRequest(revoked.request(revoked.token()),{checkActive:false}),error=>error.statusCode===401&&/revogada/.test(error.message));
});
test('resposta Google sem data confiável falha fechada, sem confiar no token',async()=>{
 const env=setup({badDate:true});
 await assert.rejects(()=>env.auth.verifyFirebaseRequest(env.request(env.token()),{checkActive:false}),error=>error.statusCode===503&&/horário/.test(error.message));
});
test('consultas concorrentes compartilham certificados e amostra de horário',async()=>{
 const env=setup();
 await Promise.all(Array.from({length:5},()=>env.auth.verifyFirebaseRequest(env.request(env.token()),{checkActive:false})));
 assert.equal(env.calls(),1);
});
test('falha transitória das chaves usa o Realtime Database protegido sem abrir tokens falsos',async()=>{
 const available=setup({certUnavailable:true});
 const result=await available.auth.verifyFirebaseRequest(available.request(available.token()),{checkActive:false});
 assert.equal(result.sub,'test-user');
 assert.equal(available.lookups(),0);
 const denied=setup({certUnavailable:true,databaseReject:true});
 await assert.rejects(()=>denied.auth.verifyFirebaseRequest(denied.request(denied.token()),{checkActive:false}),error=>error.statusCode===403);
 const noClock=setup({certUnavailable:true,badDatabaseDate:true,badLookupDate:true});
 await assert.rejects(()=>noClock.auth.verifyFirebaseRequest(noClock.request(noClock.token()),{checkActive:false}),error=>error.statusCode===503);
 const lookup=setup({certUnavailable:true,badDatabaseDate:true});
 assert.equal((await lookup.auth.verifyFirebaseRequest(lookup.request(lookup.token()),{checkActive:false})).sub,'test-user');
 assert.equal(lookup.lookups(),1);
 const revoked=setup({certUnavailable:true,revoked:true});
 await assert.rejects(()=>revoked.auth.verifyFirebaseRequest(revoked.request(revoked.token()),{checkActive:false}),error=>error.statusCode===401&&/revogada/.test(error.message));
});
