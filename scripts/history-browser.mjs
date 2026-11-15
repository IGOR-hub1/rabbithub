// Full application + native video/localStorage. Only auth, catalog and cloud are fixtures.
// Run: node scripts/history-browser.mjs (Chrome required; no production credentials).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const radiant=process.argv.includes('--radiant');
const live=process.argv.includes('--dreamland')||radiant;
const slowSource=process.argv.includes('--slow-source');
const rejectFirstSources=process.argv.includes('--reject-first-sources');
const output=path.join(root,'.cache',radiant?'history-radiant':live?(rejectFirstSources?'history-dreamland-renewal':'history-dreamland'):'history-browser');
const episodeLink=radiant?'https://meusanimes.blog/e/radiant-dublado-episodio-1/':live?'https://meusanimes.blog/e/dreamland-episodio-1/':'fixture-1';
const animeTitle=radiant?'Radiant Dublado':live?'Dreamland':'Anime de teste';
const animeSlug=radiant?'a/radiant-dublado':live?'a/dreamland':'fixture-anime';
const cover=radiant?'https://meusanimes.blog/wp-content/uploads/2025/08/yPgjtFvf62BT6EbjGYPt9AwGP2.jpg':live?'https://meusanimes.blog/wp-content/uploads/2026/10/lZ88hdOO2J7EX40fctU1leGgZFu.jpg':'img/logo-blue.jpg';
fs.mkdirSync(output,{recursive:true});
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'].find(fs.existsSync);
assert.ok(chrome,'Chrome/Brave required');
let media=Buffer.alloc(0),browser,bloggerRequests=0,rejectedStreams=0;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  // Test-only public upstream transport. Production /proxy authentication is unchanged.
  // The real adapter still resolves the episode, service API and Blogger HTML in Chrome.
  if(live && ['/proxy','/api/proxy','/stream'].includes(url.pathname)){
    const streaming=url.pathname==='/stream';
    const target=streaming?new URL(req.url,'http://localhost:8080'):new URL(url.searchParams.get('url'));
    if(!streaming && target.hostname==='www.blogger.com' && target.pathname==='/video.g')bloggerRequests++;
    if(streaming && rejectFirstSources && bloggerRequests===1){rejectedStreams++;res.writeHead(403).end('Expired URL (test)');return;}
    if(!streaming && !(target.protocol==='https:'&& /(^|\.)(meusanimes\.blog|meusdoramas\.club|blogger\.com)$/.test(target.hostname))){res.writeHead(403).end();return;}
    const headers=streaming?{}:{'User-Agent':'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36','Referer':url.searchParams.get('referer')||target.origin+'/','X-Requested-With':'XMLHttpRequest'};
    if(req.headers.range)headers.Range=req.headers.range;
    const upstream=(streaming?http:https).request(target,{method:req.method,headers,timeout:20000},response=>{
      res.writeHead(response.statusCode,{...response.headers,'access-control-allow-origin':'*'});response.pipe(res);
    });
    upstream.on('error',e=>{if(!res.headersSent)res.writeHead(502);res.end(e.message);});
    upstream.on('timeout',()=>upstream.destroy(new Error('Upstream timeout')));
    res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
  }
  if(url.pathname==='/blank'){res.end('<!doctype html><title>Media fixture</title>');return;}
  let data,type;
  if(url.pathname==='/fixture.webm'){data=media;type='video/webm';}
  else {
    const file=path.resolve(root,'public','.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
    data=fs.readFileSync(file);
    type=({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream';
  }
  const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
  res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.setHeader('Accept-Ranges','bytes');
  if(range){const start=Number(range[1]),end=Math.min(data.length-1,range[2]?Number(range[2]):data.length-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});res.end(data.subarray(start,end+1));}
  else {res.setHeader('Content-Length',data.length);res.end(data);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let sequence=0,buffer='';const pending=new Map(),events=[];
function send(method,params={},sessionId){
  return new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);
    pending.set(id,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
}
let session;
const cdp=(method,params)=>send(method,params,session);
async function evaluate(expression){
  const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression,label,timeout=15000){
  const start=Date.now();
  while(Date.now()-start<timeout){if(await evaluate(expression))return;await delay(150);}
  throw new Error('Timeout '+label+': '+JSON.stringify(await evaluate(`({url:location.href,video:document.querySelector('video')&&{time:document.querySelector('video').currentTime,duration:document.querySelector('video').duration,paused:document.querySelector('video').paused},text:document.body.innerText.slice(-900)})`)));
}
async function screenshot(name){
  if(name!=='failure')await until(`document.documentElement.getAttribute('data-rh-boot')==='ready'`,'visible page');
  await delay(450);
  const result=await cdp('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(result.data,'base64'));
}
async function click(selector){
  const target=await evaluate(`(()=>{
    const button=document.querySelector(${JSON.stringify(selector)}),r=button.getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y),chain=[];
    for(let el=button;el;el=el.parentElement){const s=getComputedStyle(el);chain.push({tag:el.tagName,id:el.id,classes:el.className,hidden:el.hidden,display:s.display,visibility:s.visibility,opacity:s.opacity,z:s.zIndex,rect:el.getBoundingClientRect().toJSON()});}
    return {x,y,clickable:button===hit||button.contains(hit),hit:hit&&hit.outerHTML.slice(0,180),chain};
  })()`);
  if(!target.clickable){
    await cdp('DOM.enable');await cdp('CSS.enable');
    const {root:dom}=await cdp('DOM.getDocument');
    const {nodeId}=await cdp('DOM.querySelector',{nodeId:dom.nodeId,selector});
    fs.writeFileSync(path.join(output,'button-styles.json'),JSON.stringify(await cdp('CSS.getMatchedStylesForNode',{nodeId}),null,2));
  }
  assert.ok(target.clickable,'button must be visible and receive real mouse input: '+JSON.stringify(target));
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y});
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:target.x,y:target.y});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:target.x,y:target.y});
}
const report={kind:live?animeTitle+' real episode, details, cover, service API, Blogger and localhost:8080/stream; isolated fixture identity/cloud/home feed':'native video, real elapsed time; fixture authentication/catalog/cloud',slowSource,rejectFirstSources,checks:[]};
const blockedUrls=['*gstatic.com*','*jsdelivr.net*','*auth-guard.js*','*user-session.js*','*firebaseio.com*','*firebasedatabase.app*',...(live?[]:['*meusanimes.js*','https://meusanimes.blog/*'])];
try {
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required','--remote-debugging-pipe','--user-data-dir='+fs.mkdtempSync(path.join(output,'browser-')),'--window-size=1440,1000','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
  browser.stdio[4].on('data',chunk=>{
    buffer+=chunk.toString();let boundary;
    while((boundary=buffer.indexOf('\0'))!==-1){
      const text=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);if(!text)continue;
      const message=JSON.parse(text),job=pending.get(message.id);
      if(job){pending.delete(message.id);clearTimeout(job.timer);message.error?job.reject(new Error(JSON.stringify(message.error))):job.resolve(message.result);}
      else events.push(message);
    }
  });
  const {targetId}=await send('Target.createTarget',{url:origin+'/blank'});
  session=(await send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  if(!live){
  await until('typeof VideoEncoder!=="undefined"','WebCodecs');
  // Generate a seekable 90s VP8 WebM instantly, using real encoded video frames.
  const encoded=await evaluate(`(async()=>{
    const chunks=[],canvas=new OffscreenCanvas(320,180),ctx=canvas.getContext('2d');
    const encoder=new VideoEncoder({output:chunk=>{const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);chunks.push({time:chunk.timestamp/1000,key:chunk.type==='key',data});},error:e=>{throw e;}});
    encoder.configure({codec:'vp8',width:320,height:180,bitrate:100000,framerate:2});
    for(let i=0;i<180;i++){ctx.fillStyle=i%2?'#183880':'#102550';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='22px sans-serif';ctx.fillText('X-Bunny · teste de vídeo',25,75);ctx.fillText((i/2).toFixed(1)+' segundos',70,115);const frame=new VideoFrame(canvas,{timestamp:i*500000,duration:500000});encoder.encode(frame,{keyFrame:i%2===0});frame.close();if(i%20===0)await encoder.flush();}
    await encoder.flush();encoder.close();
    const cat=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;};
    const hex=s=>new Uint8Array(s.match(/../g).map(x=>parseInt(x,16)));
    const vint=n=>{let len=1;while(n>=2**(7*len)-1)len++;const a=new Uint8Array(len);for(let i=len-1;i>=0;i--){a[i]=n%256;n=Math.floor(n/256);}a[0]|=1<<(8-len);return a;};
    const uint=n=>{let h=n.toString(16);return hex(h.length%2?'0'+h:h);};
    const str=s=>new TextEncoder().encode(s);
    const elem=(id,data)=>cat([hex(id),vint(data.length),data]);
    const u=(id,n)=>elem(id,uint(n));
    const f=new Uint8Array(8);new DataView(f.buffer).setFloat64(0,90000);
    const header=elem('1a45dfa3',cat([u('4286',1),u('42f7',1),u('42f2',4),u('42f3',8),elem('4282',str('webm')),u('4287',4),u('4285',2)]));
    const info=elem('1549a966',cat([u('2ad7b1',1000000),elem('4489',f),elem('4d80',str('history-test')),elem('5741',str('history-test'))]));
    const tracks=elem('1654ae6b',elem('ae',cat([u('d7',1),u('73c5',1),u('83',1),elem('86',str('V_VP8')),elem('e0',cat([u('b0',320),u('ba',180)]))])));
    const clusters=chunks.map(c=>elem('1f43b675',cat([u('e7',c.time),elem('a3',cat([new Uint8Array([0x81,0,0,c.key?0x80:0]),c.data]))])));
    const bytes=cat([header,elem('18538067',cat([info,tracks,...clusters]))]);
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);
  })()`);
  media=Buffer.from(encoded,'base64');fs.writeFileSync(path.join(output,'fixture.webm'),media);
  }
  await cdp('Network.setBlockedURLs',{urls:blockedUrls});
  const fixture=`
    const profile={id:'test-profile',name:'Teste',avatar:'img/logo-blue.jpg'};
    const account={uid:'history-test',plan:'Free',email:'test@example.invalid',profiles:[profile]};
    const state={status:'authenticated',ready:true,uid:'history-test',authUser:{emailVerified:true,getIdToken:()=>Promise.resolve('isolated-test-identity')},account,profile};
    window.RabbitHubSession={get:()=>state,subscribe:fn=>{setTimeout(()=>fn(state),0);return ()=>{};},ready:()=>Promise.resolve(state),readAccount:()=>new Promise(()=>{}),updateAccount:()=>Promise.reject(new Error('Offline fixture'))};
    localStorage.setItem('dk_session',JSON.stringify({uid:state.uid,displayName:'Teste',plan:'Free'}));
    localStorage.setItem('dk_active_profile',JSON.stringify(profile));
    localStorage.setItem('draksyon_autoplay_v1','0');
    localStorage.setItem('rh_drawer_mode','fixed');
    const episode={nome:'Episódio 1',numero:1,temporada:1,link:${JSON.stringify(episodeLink)}};
    const catalog={detalhes:async()=>({titulo:${JSON.stringify(animeTitle)},capa:'img/logo-blue.jpg',episodios:[episode,{...episode,nome:'Episódio 2',numero:2,link:'fixture-2'}]}),home:async()=>({}),categorias:async()=>[],catalogo:async()=>[],lancamentos:async()=>[],dublados:async()=>[],legendados:async()=>[],genero:async()=>[]};
    if(${live}){delete catalog.detalhes;let actual;Object.defineProperty(window,'AF',{configurable:true,get:()=>actual,set:value=>{
      actual=Object.assign(value,catalog);
      if(${slowSource}){const resolve=actual.resolvePlayerMedia;actual.resolvePlayerMedia=async(...args)=>{const result=await resolve(...args);await new Promise(r=>setTimeout(r,19000));return result;};}
    }});}
    else window.AF={...catalog,player:async()=>({sources:[{url:location.origin+'/fixture.webm',type:'video/webm',height:180}],animeSlug:'fixture-anime'})};
    window.addEventListener('load',()=>{document.documentElement.setAttribute('data-dk-ready','1');document.dispatchEvent(new CustomEvent('dk:userready',{detail:{uid:state.uid}}));document.dispatchEvent(new CustomEvent('rh:sessionchange',{detail:state}));});
    window.__testState=state;
  `;
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:fixture});
  const url=origin+'/player-animes.html?anime='+encodeURIComponent(animeSlug)+'&ep='+encodeURIComponent(episodeLink)+'&season=1&number=1&nome=Epis%C3%B3dio%201&titulo='+encodeURIComponent(animeTitle)+'&capa='+encodeURIComponent(cover);
  await cdp('Page.navigate',{url});
  await until(`document.getElementById('main-video')?.currentTime>0.1`,'playback',60000);
  report.media=await evaluate(`(()=>{const v=document.getElementById('main-video'),route=new URL(v.currentSrc),source=route.searchParams.get('url');return {route:route.pathname,sourceHost:source?new URL(source).hostname:route.hostname,duration:v.duration,width:v.videoWidth,height:v.videoHeight,externalFrames:document.querySelectorAll('.dk-external-frame').length};})()`);
  assert.equal(report.media.externalFrames,0);
  if(rejectFirstSources){assert.ok(rejectedStreams>=2);assert.ok(bloggerRequests>=2);report.renewal={rejectedStreams,bloggerRequests};}
  const watchSeconds=process.argv.includes('--quick')?2:31;
  report.watchSeconds=watchSeconds;
  const started=Date.now();console.log('Playing native video for '+watchSeconds+' seconds…');
  await until(`document.getElementById('main-video')?.currentTime>=${watchSeconds}`,'real playback',40000);
  assert.ok(Date.now()-started>=(watchSeconds-2)*1000,'real elapsed playback, no seek shortcut');
  const periodic=await evaluate(`({time:document.getElementById('main-video').currentTime,item:RabbitHubProfileData.getHistory()[0]})`);
  assert.ok(periodic.time-periodic.item.seconds<=5.5,'periodic save within 5 seconds');
  const before=await evaluate(`(async()=>{const v=document.getElementById('main-video');await new Promise(resolve=>{v.addEventListener('pause',resolve,{once:true});v.pause();});return {time:v.currentTime,duration:v.duration,items:RabbitHubProfileData.getHistory()};})()`);
  report.checks.push({step:watchSeconds+'s playback + pause while cloud hangs/offline',...before});
  assert.equal(before.items.length,1);assert.ok(Math.abs(before.items[0].seconds-before.time)<0.01);
  if(live)assert.ok(before.duration>1000);else assert.equal(before.duration,90);
  assert.ok(Math.abs(before.items[0].progresso-before.time/before.duration*100)<0.11);
  await screenshot('01-playback');
  await cdp('Page.navigate',{url:origin+'/index.html'});
  await until(`document.readyState==='complete' && document.documentElement.getAttribute('data-rh-boot')==='ready' && !!document.querySelector('[data-tab="perfil"]')`,'home ready');
  await evaluate(`document.querySelector('[data-tab="perfil"]').click()`);
  await until(`!!document.querySelector('[data-yc-open="historico"]')`,'profile');
  await evaluate(`document.querySelector('[data-yc-open="historico"]').click()`);
  await until(`document.querySelectorAll('.history-watch-card').length===1`,'history item');
  const history=await evaluate(`({count:document.querySelector('.history-reference-screen .reference-screen-count').textContent,title:document.querySelector('.history-watch-title').innerText,bar:document.querySelector('.history-detail-progress b').style.width,href:document.querySelector('.history-watch-continue').href,items:RabbitHubProfileData.getHistory()})`);
  assert.equal(history.count,'1 item');assert.ok(history.title.includes(animeTitle));assert.ok(Math.abs(Number.parseFloat(history.bar)-before.time/before.duration*100)<0.11);
  assert.equal(history.items[0].seconds,before.items[0].seconds);
  report.checks.push({step:'history after page navigation',...history});await screenshot('02-history');
  await evaluate(`document.querySelector('.history-watch-continue').click()`);
  await until(`document.getElementById('dk-resume')?.hidden===false`,'resume dialog',60000);
  assert.equal(await evaluate(`document.getElementById('dk-resume-title').textContent`),'Deseja continuar de onde parou?');
  assert.equal(await evaluate(`RabbitHubProfileData.getHistory()[0].seconds`),before.items[0].seconds);
  await screenshot('03-resume');
  await evaluate(`window.__seekResult=null;document.getElementById('main-video').addEventListener('seeked',()=>{window.__seekResult=document.getElementById('main-video').currentTime;},{once:true})`);
  await click('#dk-resume-continue');
  await until(`window.__seekResult!==null`,'exact seek',live?45000:15000);
  assert.ok(Math.abs((await evaluate('window.__seekResult'))-before.items[0].seconds)<0.05);
  await until(`document.getElementById('main-video').currentTime>${before.time+6}`,'continued playback');
  // Reload while playing; beforeunload/pagehide must save newer than periodic autosave.
  const atReload=await evaluate(`document.getElementById('main-video').currentTime`);
  await cdp('Page.reload',{});
  await until(`document.getElementById('dk-resume')?.hidden===false`,'resume after reload',60000);
  const afterReload=await evaluate(`({items:RabbitHubProfileData.getHistory(),time:document.getElementById('main-video').currentTime})`);
  assert.equal(afterReload.items.length,1);assert.ok(afterReload.items[0].seconds>=atReload-0.05);assert.ok(afterReload.items[0].seconds<atReload+2);assert.equal(afterReload.time,0);
  report.checks.push({step:'continued playback + reload preserved exact position',atReload,...afterReload});
  await screenshot('04-after-reload');
  // Starting over is the only operation allowed to replace a valid position with zero.
  await click('#dk-resume-restart');
  await until(`document.getElementById('main-video').currentTime>0.2 && document.getElementById('main-video').currentTime<3`,'restart');
  const restart=await evaluate(`(async()=>{const v=document.getElementById('main-video');await new Promise(resolve=>{v.addEventListener('pause',resolve,{once:true});v.pause();});return RabbitHubProfileData.getHistory()[0];})()`);
  assert.ok(restart.seconds<3&&restart.resetAt>0);report.checks.push({step:'explicit restart',item:restart});
  const isolation=await evaluate(`(()=>{const p=__testState.profile,u=__testState.uid;__testState.profile={id:'other'};const otherProfile=RabbitHubProfileData.getHistory().length;__testState.profile=p;__testState.uid='other';const otherUser=RabbitHubProfileData.getHistory().length;__testState.uid=u;return {otherProfile,otherUser,restored:RabbitHubProfileData.getHistory().length};})()`);
  assert.deepEqual(isolation,{otherProfile:0,otherUser:0,restored:1});report.checks.push({step:'UID/profile isolation',...isolation});
  let switched;
  if(!live){
  // Switching episode must flush the previous video and keep independent entries.
  await evaluate(`document.getElementById('main-video').play()`);
  await until(`document.getElementById('main-video').currentTime>2`,'play before episode switch');
  const beforeSwitch=await evaluate(`document.getElementById('main-video').currentTime`);
  await evaluate(`document.getElementById('btn-next').click()`);
  await until(`new URLSearchParams(location.search).get('number')==='2' && document.getElementById('main-video')?.currentTime>1`,'second episode');
  switched=await evaluate(`RabbitHubProfileData.getHistory()`);
  assert.equal(switched.length,2);assert.ok(switched.find(x=>x.number===1).seconds>=beforeSwitch-0.05);assert.ok(switched.find(x=>x.number===2).seconds<5);
  report.checks.push({step:'episode switch preserves both entries',items:switched});
  }else switched=await evaluate(`RabbitHubProfileData.getHistory()`);
  // Closing the document and creating a fresh one uses disk-backed localStorage.
  const newTarget=(await send('Target.createTarget',{url:'about:blank'})).targetId;
  await send('Target.closeTarget',{targetId});
  session=(await send('Target.attachToTarget',{targetId:newTarget,flatten:true})).sessionId;
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  await cdp('Network.setBlockedURLs',{urls:blockedUrls});
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:fixture});
  await cdp('Page.navigate',{url});
  await until(`document.getElementById('dk-resume')?.hidden===false`,'resume in fresh tab',60000);
  const reopened=await evaluate(`RabbitHubProfileData.getHistory()`);
  assert.equal(reopened.length,switched.length);assert.equal(reopened.find(x=>x.number===1).seconds,switched.find(x=>x.number===1).seconds);
  report.checks.push({step:'close tab and reopen',items:reopened});
  const errors=events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);
  assert.deepEqual(errors,[],'application runtime exceptions');
  report.success=true;console.log(JSON.stringify(report,null,2));
} catch(error){report.success=false;report.error=error.stack;await screenshot('failure').catch(()=>{});throw error;}
finally {
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  if(browser){await send('Browser.close').catch(()=>{});browser.kill();}
  server.close();for(const job of pending.values())clearTimeout(job.timer);
}
