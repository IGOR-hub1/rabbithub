'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname,'../public/player-animes.html'),'utf8');
function extract(start,end){ const a=html.indexOf(start),b=html.indexOf(end,a); assert.ok(a>=0&&b>a); return html.slice(a,b); }
test('identidade do episódio prioriza temporada e número mesmo com links iguais',()=>{
 const ctx={animeSlug:'anime',epLink:'mesmo',epIndex:0,queryEpisodeNumber:2,querySeasonNumber:1,episodeLinkKey:x=>x};
 vm.runInNewContext(extract('    function isCurrentHistoryEntry(item){','    function currentHistoryEntry()'),ctx);
 assert.equal(ctx.isCurrentHistoryEntry({slug:'anime',epLink:'mesmo',epIdx:0,season:1,number:1}),false);
 assert.equal(ctx.isCurrentHistoryEntry({slug:'anime',epLink:'outro',epIdx:1,season:1,number:2}),true);
 assert.equal(ctx.isCurrentHistoryEntry({slug:'anime',epLink:'outro',epIdx:0}),false);
});
test('atualização sem progresso preserva tempo previamente salvo',()=>{
 let saved;
 const ctx={samePlaybackContext:()=>true,currentHistoryEntry:()=>({seconds:123,duration:1000,progresso:12.3}),animeSlug:'anime',animeTitulo:'Anime',animeData:null,epNome:'Ep',animeCapa:'',epIndex:0,epLink:'link',querySeasonNumber:1,queryEpisodeNumber:1,querySeasonTotal:1,window:{RabbitHubProfileData:{saveHistory:item=>saved=item}}};
 vm.runInNewContext(extract('    function playbackPercent(', '    function progressIdentity('),ctx);
 ctx.pushHistory(null,null,null);
 assert.equal(saved.seconds,123); assert.equal(saved.duration,1000); assert.equal(saved.progresso,12.3);
});

test('histórico mantém mais de 50 episódios',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../public/profile-data.js'),'utf8');
 const a=source.indexOf('  function sortHistory('),b=source.indexOf('  function saveLocal(',a);
 const ctx={}; vm.runInNewContext(source.slice(a,b),ctx);
 assert.equal(ctx.sortHistory(Array.from({length:75},(_,i)=>({ts:i}))).length,75);
});
test('resposta remota tardia mescla com o histórico local atualizado',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../public/profile-data.js'),'utf8');
 const a=source.indexOf('  function refreshHistory()'),b=source.indexOf('  function clearHistory()',a);
 let finish,local=[{ts:1}],saved;
 const request=new Promise(resolve=>{finish=resolve});
 const ctx={context:()=>({uid:'owner',profileId:'principal'}),historyRef:()=>({toString:()=>'/h',once:()=>request}),getHistory:()=>local,cacheKey:()=> 'owner',historyRefreshJobs:{},mergeHistory:(remote,current)=>remote.concat(current),saveLocal:value=>{saved=value},emitHistoryChange:()=>{},settleWithTimeout:p=>p};
 vm.runInNewContext(source.slice(a,b),ctx);
 const pending=ctx.refreshHistory(); local=[{ts:2}]; finish({val:()=>({remote:{ts:0}})}); await pending;
 assert.equal(saved[1].ts,2);
});

test('episódios especiais não substituem episódios da primeira temporada',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../public/profile-data.js'),'utf8');
 const a=source.indexOf('  function sameEpisode('),b=source.indexOf('  function preservePlayback(',a);
 const ctx={};vm.runInNewContext(source.slice(a,b),ctx);
 assert.equal(ctx.sameEpisode({slug:'anime',season:0,number:1},{slug:'anime',season:1,number:1}),false);
 assert.equal(ctx.sameEpisode({slug:'anime',season:0,number:1},{slug:'anime',season:0,number:1}),true);
 assert.equal(ctx.sameEpisode({slug:'anime',season:0,number:0,epLink:'shared',epIdx:0},{slug:'anime',season:1,number:1,epLink:'shared',epIdx:0}),false);
 assert.equal(ctx.sameEpisode({slug:'anime',number:0,epLink:'shared',epIdx:1},{slug:'anime',number:2,epLink:'shared',epIdx:2}),false);
});
test('player grava posição real e não registra abertura como reprodução',()=>{
 assert.doesNotMatch(html,/pushHistory\(saved&&saved\.progress/);
 assert.match(html,/video\.addEventListener\('pause',function\(\)\{ if \(!resumeDecisionPending\) persistPlayback\(true\);/);
 assert.match(html,/window\.addEventListener\('pagehide',function\(\)\{ persistPlayback\(true\);/);
 assert.match(html,/Math\.abs\(current-lastSavedSecond\) < 1/);
});

test('retomada local nao aguarda Firebase nem planos',async()=>{
 const saved={t:31.625,d:90,ts:1000};
 const ctx={loadProgress:()=>saved,samePlaybackContext:()=>true,window:{RabbitHubProfileData:{getEpisodeProgress(){throw new Error('nao deve bloquear o cache');}}}};
 vm.runInNewContext(extract('    function resolveResumeProgress(){','    function formatPlayerTime('),ctx);
 assert.equal(await ctx.resolveResumeProgress(),saved);
});

test('identidade do player aguarda sessao autenticada antes de fixar o perfil',()=>{
 let state={status:'loading'},profile={uid:'owner',profileId:'principal'};
 const ctx={playbackContext:null,window:{RabbitHubSession:{get:()=>state},RabbitHubProfileData:{getContext:()=>profile}}};
 vm.runInNewContext(extract('    function samePlaybackContext(){','    function escapeAnimeHtml('),ctx);
 assert.equal(ctx.samePlaybackContext(),false);
 assert.equal(ctx.playbackContext,null);
 state={status:'authenticated'};profile={uid:'owner',profileId:'real-profile'};
 assert.equal(ctx.samePlaybackContext(),true);
 assert.equal(ctx.playbackContext.profileId,'real-profile');
 state={status:'syncing',uid:'owner'};
 assert.equal(ctx.samePlaybackContext(),true,'reconexao nao pode interromper o salvamento local do perfil ja confirmado');
 state={status:'syncing',uid:'different'};
 assert.equal(ctx.samePlaybackContext(),false,'a reconexao de outro UID nao pode herdar o player');
 state={status:'authenticated'};
 profile={uid:'different',profileId:'real-profile'};
 assert.equal(ctx.samePlaybackContext(),false);
});
