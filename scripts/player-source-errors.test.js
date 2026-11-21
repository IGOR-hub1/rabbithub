'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../public/meusanimes.js'),'utf8');
const provider='https://www.blogger.com/video.g?token=public-video';
function adapter(fetch,getIdToken,timers){
 const authUser={emailVerified:true,getIdToken};
 const context=vm.createContext({module:{exports:{}},URL,URLSearchParams,Headers,AbortController,fetch,
  setTimeout:timers||setTimeout,clearTimeout,
  firebase:{auth:()=>({currentUser:authUser})},
  RabbitHubSession:{ready:async()=>({status:'authenticated',ready:true,authUser})}
 });
 vm.runInContext(code,context);return context.module.exports;
}
test('renova token recusado com 401 e tenta a mesma rota antes de desistir',async()=>{
 const calls=[],tokens=[];
 const api=adapter(async(url,options)=>{
  calls.push({url,authorization:options.headers.Authorization});
  if(calls.length===1)return new Response(JSON.stringify({error:'Sessão expirada'}),{status:401,headers:{'content-type':'application/json'}});
  return new Response('<script>{"url":"https://rr2.googlevideo.com/videoplayback?itag=22&sig=ok"}</script>');
 },async force=>{tokens.push(force);return force?'fresh-token':'cached-token';});
 const result=await api.resolvePlayerMedia({provider,sources:[]});
 assert.equal(result.sources.length,1);
 assert.deepEqual(tokens,[false,true]);
 assert.equal(calls[0].url,calls[1].url);
 assert.equal(calls[1].authorization,'Bearer fresh-token');
 assert.ok(calls.every(call=>call.url.startsWith('/proxy?')));
});
test('recusa do proxy conserva status e motivo sem alegar timeout da fonte',async()=>{
 const api=adapter(async()=>new Response(JSON.stringify({error:'Sessao sem permissao.'}),{status:403,headers:{'content-type':'application/json'}}),async()=>'test-token');
 const result=await api.resolvePlayerMedia({provider,sources:[]});
 assert.equal(result.sources.length,0);
 assert.equal(result.mediaError.status,403);
 assert.equal(result.mediaError.code,'proxy/http');
 assert.equal(result.mediaError.message,'HTTP 403: Sessao sem permissao.');
 assert.equal(result.iframe,provider);
});
test('token pendente tem prazo e não dispara fetch sem autorização',async()=>{
 let fetches=0;
 const api=adapter(async()=>{fetches++;throw new Error('não deveria enviar');},()=>new Promise(()=>{}),(fn,ms)=>setTimeout(fn,ms===8000?5:ms));
 const result=await api.resolvePlayerMedia({provider,sources:[]});
 assert.equal(fetches,0);
 assert.equal(result.mediaError.code,'auth/token-timeout');
 assert.match(result.mediaError.message,/sessão não respondeu/);
});
