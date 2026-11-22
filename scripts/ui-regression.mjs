import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
];
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
assert.ok(browserPath, 'Brave ou Chrome precisa estar instalado para o teste visual');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbithub-ui-'));
let browser;
let appServer;
let browserClient;

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForSite(origin) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(origin + '/health');
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Servidor local não respondeu ao teste visual');
}

function connect(process) {
  const input = process.stdio[3];
  const output = process.stdio[4];
  assert.ok(input && output, 'Chromium precisa expor os pipes de depuracao');
  const pending = new Map();
  const listeners = new Set();
  let sequence = 0;
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let boundary = buffer.indexOf('\0');
    while (boundary !== -1) {
      const payload = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf('\0');
      if (!payload) continue;
      const message = JSON.parse(payload);
      if (!message.id) {
        for (const listener of listeners) listener(message);
        continue;
      }
      if (!pending.has(message.id)) continue;
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.rejectCommand(new Error(message.error.message));
      else item.resolveCommand(message.result);
    }
  });
  return {
    send(method, params = {}, sessionId = '') {
      const id = ++sequence;
      input.write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + '\0');
      return new Promise((resolveCommand, rejectCommand) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCommand(new Error('CDP excedeu 15s em ' + method));
        }, 15000);
        pending.set(id, { resolveCommand, rejectCommand, timer });
      });
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { input.end(); }
  };
}

async function captureScreenshot(cdp, name) {
  // Let the existing modal transition finish before recording evidence.
  await new Promise(resolve=>setTimeout(resolve,350));
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  });
  const outputDir = path.join(projectRoot, '.cache', 'ui-regression');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, name + '.png');
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
  return outputPath;
}

async function waitForPage(cdp) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const evaluation = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `Boolean(document.getElementById('drawer') && document.getElementById('open-drawer') && window.RabbitHubDropdowns && window.DK_setTheme && document.documentElement.getAttribute('data-rh-boot')==='ready')`
    });
    if (evaluation.result.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Home nao concluiu a inicializacao visual');
}

try {
  const port = await availablePort();
  const origin = 'http://127.0.0.1:' + port;
  appServer = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true
  });
  await waitForSite(origin);

  browser = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-pipe',
    '--user-data-dir=' + profileDir,
    '--window-size=1440,1000',
    'about:blank'
  ], { windowsHide: true, stdio: ['ignore','ignore','pipe','pipe','pipe'] });

  const browserCdp = connect(browser);
  browserClient=browserCdp;
  const createdTarget = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
  const attachedTarget = await browserCdp.send('Target.attachToTarget', { targetId: createdTarget.targetId, flatten: false });
  const sessionId = attachedTarget.sessionId;
  const pagePending = new Map();
  let pageSequence = 0;
  browserCdp.onEvent((event) => {
    if (event.method !== 'Target.receivedMessageFromTarget' || event.params.sessionId !== sessionId) return;
    const message = JSON.parse(event.params.message);
    if (!message.id || !pagePending.has(message.id)) return;
    const item = pagePending.get(message.id);
    pagePending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.rejectCommand(new Error(message.error.message));
    else item.resolveCommand(message.result);
  });
  const cdp = {
    send(method, params = {}) {
      const id = ++pageSequence;
      const promise = new Promise((resolveCommand, rejectCommand) => {
        const timer = setTimeout(() => {
          pagePending.delete(id);
          rejectCommand(new Error('CDP da pagina excedeu 15s em ' + method));
        }, 15000);
        pagePending.set(id, { resolveCommand, rejectCommand, timer });
      });
      browserCdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method, params })
      }).catch((error) => {
        const item = pagePending.get(id);
        if (!item) return;
        pagePending.delete(id);
        clearTimeout(item.timer);
        item.rejectCommand(error);
      });
      return promise;
    },
    close() { browserCdp.close(); }
  };

  const runtimeErrors=[];
  const consoleErrors=[];
  browserCdp.onEvent(event=>{
    if(event.method!=='Target.receivedMessageFromTarget'||event.params.sessionId!==sessionId)return;
    const message=JSON.parse(event.params.message);
    if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails);
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')
      consoleErrors.push(message.params.args.map(arg=>arg.value||arg.description||'').join(' '));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', {
    urls: ['*gstatic.com*', '*auth-guard.js*', '*user-session.js*', '*meusanimes.blog*', '*jsdelivr.net*']
  });
  const plansOnly=process.argv.includes('--plans-only');
  const sessionFixture = `
      window.RabbitHubSession={
        get:()=>({status:'authenticated',ready:true,uid:'ui-test',authUser:${plansOnly?"{uid:'ui-test',getIdToken:()=>Promise.resolve('fixture-token')}":'null'},account:{uid:'ui-test',plan:'${plansOnly?'Free':'VIP'}',premium:${plansOnly?'false':'true'},profiles:[{id:'principal',name:'Teste',avatar:'',theme:'red'}]},profile:{id:'principal',name:'Teste',avatar:'',theme:'red'}}),
        subscribe:(callback)=>{setTimeout(()=>callback(window.RabbitHubSession.get()),0);return ()=>{};},
        ready:()=>Promise.resolve(window.RabbitHubSession.get()),
        readAccount:()=>{window.__pixAccountRefreshes=(window.__pixAccountRefreshes||0)+1;return Promise.resolve(window.RabbitHubSession.get().account);}
      };
      window.addEventListener('load',()=>{
        document.documentElement.setAttribute('data-dk-ready','1');
        document.dispatchEvent(new CustomEvent('dk:userready',{detail:{uid:'ui-test'}}));
      },{once:true});
      localStorage.setItem('rh_drawer_mode','fixed');
      localStorage.setItem('dk_theme_color','red');
      localStorage.setItem('dk_session',JSON.stringify({uid:'ui-test',displayName:'Teste',profileAvatar:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3Crect width=%221%22 height=%221%22 fill=%22red%22/%3E%3C/svg%3E'}));
      localStorage.setItem('dk_active_profile',JSON.stringify({id:'principal',name:'Teste',avatar:''}));
      ${plansOnly?`window.__pixRequests=[];
      window.__pixLookups=[];
      window.__pixStatusRequests=0;
      window.__pixPending=null;
      window.__pixMockMode='success';
      window.__pixMockStatus='pending';
      const realFetch=window.fetch.bind(window);
      window.fetch=function(url,options){
        if(url==='/api/pix-orders')return Promise.resolve(new Response(JSON.stringify({ok:true,orders:[]}),{status:200,headers:{'Content-Type':'application/json'}}));
        if(String(url).startsWith('/api/pix-status?')){
          window.__pixStatusRequests++;
          const last=window.__pixRequests[window.__pixRequests.length-1];
          const plan=last?.body?.planId||'plus';
          return Promise.resolve(new Response(JSON.stringify({ok:true,orderId:'test-order',planId:plan,
            amountCents:plan==='vip'?100:1990,currency:'BRL',status:window.__pixMockStatus,
            activatedAt:window.__pixMockStatus==='approved'?2000000000000:null}),
            {status:200,headers:{'Content-Type':'application/json'}}));
        }
        if(String(url).startsWith('/api/pix-order?')){
          const plan=new URL(url,location.href).searchParams.get('planId');
          window.__pixLookups.push({plan,authorization:options.headers.Authorization});
          return Promise.resolve(new Response(JSON.stringify({ok:true,order:window.__pixPending?.planId===plan?window.__pixPending:null}),{status:200,headers:{'Content-Type':'application/json'}}));
        }
        if(url!=='/api/pix-order')return realFetch(url,options);
        window.__pixRequests.push({url,method:options.method,headers:options.headers,body:JSON.parse(options.body)});
        if(window.__pixMockMode==='error')return Promise.resolve(new Response(JSON.stringify({ok:false,error:'Pix indisponível no teste.'}),{status:503,headers:{'Content-Type':'application/json'}}));
        if(window.__pixMockMode==='rate-limited')return Promise.resolve(new Response(JSON.stringify({ok:false,error:'Muitas tentativas.'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':'120'}}));
        const requested=JSON.parse(options.body).planId;
        const order={orderId:'test-order',planId:requested,amountCents:window.__pixMockMode==='tampered'?1:requested==='vip'?100:1990,currency:'BRL',status:'pending',gatewayStatus:'action_required',pixCopyPaste:'000201TESTPIXCODE',qrCodeBase64:requested==='vip'?'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=':null};
        if(window.__pixMockMode==='success')window.__pixPending=order;
        return Promise.resolve(new Response(JSON.stringify({ok:true,...order}),{status:200,headers:{'Content-Type':'application/json'}}));
      };`:''}
    `;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source:sessionFixture});
  await cdp.send('Page.navigate', { url: origin + (plansOnly?'/index.html?tab=perfil&ui-regression=1':'/index.html?ui-regression=1') });
  await waitForPage(cdp);

  if(plansOnly){
    let opened=false;
    for(let attempt=0;attempt<50;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
        const tile=document.querySelector('[data-yc-open="planos"]');
        if(!tile)return false;
        tile.click();
        return document.getElementById('yc-sheet')?.getAttribute('data-sheet-kind')==='planos';
      }())`});
      opened=result.result.value===true;
      if(opened)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(opened,true,'a página de planos deve abrir');
    for(const viewport of [
      {name:'desktop',width:1440,height:1000,mobile:false},
      {name:'mobile',width:390,height:844,mobile:true},
      {name:'small-mobile',width:320,height:568,mobile:true}
    ]){
      await cdp.send('Emulation.setDeviceMetricsOverride',{
        width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.mobile
      });
      let page;
      for(let attempt=0;attempt<50;attempt++){
        const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
          const body=document.querySelector('#yc-sheet .yc-sheet-body');
          const vip=body?.querySelector('.plan-card.vip');
          const plus=body?.querySelector('.plan-card.plus');
          return {viewport:innerWidth,overflow:body?body.scrollWidth-body.clientWidth:999,
            vipPrice:vip?.querySelector('.plan-card-price')?.textContent.trim(),
            plusPrice:plus?.querySelector('.plan-card-price')?.textContent.trim(),
            vipId:vip?.querySelector('.plan-request-btn')?.dataset.planId,
            plusId:plus?.querySelector('.plan-request-btn')?.dataset.planId,
            hasClientAmount:!!body?.querySelector('[data-amount], [data-price]')};
        }())`});
        page=result.result.value;
        if(page.vipPrice?.includes('1,00')&&page.plusPrice?.includes('19,90'))break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(page.viewport,viewport.width);
      assert.ok(page.overflow<=1,'planos não devem transbordar em '+viewport.name);
      assert.match(page.vipPrice,/R\$\s*1,00/);
      assert.match(page.plusPrice,/R\$\s*19,90/);
      assert.equal(page.vipId,'vip');
      assert.equal(page.plusId,'plus');
      assert.equal(page.hasClientAmount,false);
      const screenshot=await captureScreenshot(cdp,viewport.name+'-plans');
      console.log(JSON.stringify({viewport:viewport.name,vip:page.vipPrice,plus:page.plusPrice,overflow:page.overflow,screenshot}));
      if(viewport.mobile){
        const lower=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
          const card=document.querySelector('.plan-card.plus');
          card.scrollIntoView({block:'center'});
          const button=card.querySelector('.plan-request-btn');
          const rect=button.getBoundingClientRect();
          return {price:card.querySelector('.plan-card-price').textContent.trim(),
            buttonVisible:rect.top>=0&&rect.bottom<=innerHeight,
            overflow:document.querySelector('#yc-sheet .yc-sheet-body').scrollWidth-document.querySelector('#yc-sheet .yc-sheet-body').clientWidth};
        }())`});
        assert.match(lower.result.value.price,/R\$\s*19,90/);
        assert.equal(lower.result.value.buttonVisible,true,'botão Plus deve ficar acessível em '+viewport.name);
        assert.ok(lower.result.value.overflow<=1);
        await captureScreenshot(cdp,viewport.name+'-plans-plus');
      }
    }
    const clicked=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
      const button=document.querySelector('.plan-card.plus [data-plan-request]');
      button.click();button.click();return {loading:button.textContent,disabled:button.disabled};
    }())`});
    assert.deepEqual(clicked.result.value,{loading:'Consultando Pix...',disabled:true});
    let checkout;
    for(let attempt=0;attempt<50;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
        const panel=document.querySelector('.pix-checkout');
        const body=document.querySelector('#yc-sheet .yc-sheet-body');
        return {open:!!panel,plan:document.querySelector('#pix-plan')?.textContent,
          amount:document.querySelector('#pix-amount')?.textContent,
          status:document.querySelector('#pix-status')?.textContent,
          code:document.querySelector('#pix-copy-code')?.value,
          fallbackVisible:document.querySelector('#pix-qr-fallback')?.hidden===false,
          overflow:body?body.scrollWidth-body.clientWidth:999,
          request:window.__pixRequests[0],requests:window.__pixRequests.length};
      }())`});
      checkout=result.result.value;
      if(checkout.open)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(checkout.open,true);
    assert.equal(checkout.plan,'Plano Plus');
    assert.match(checkout.amount,/R\$\s*19,90/);
    assert.equal(checkout.status,'Aguardando pagamento');
    assert.equal(checkout.code,'000201TESTPIXCODE');
    assert.equal(checkout.fallbackVisible,true);
    assert.ok(checkout.overflow<=1);
    assert.deepEqual(checkout.request.body,{planId:'plus'});
    assert.equal(checkout.request.headers.Authorization,'Bearer fixture-token');
    assert.equal(checkout.requests,1);
    const hiddenBaseline=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
      window.__pixTestHidden=true;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__pixTestHidden});
      document.dispatchEvent(new Event('visibilitychange'));
      return window.__pixStatusRequests;
    }())`});
    await new Promise(resolve=>setTimeout(resolve,3600));
    const whileHidden=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`window.__pixStatusRequests`});
    assert.equal(whileHidden.result.value,hiddenBaseline.result.value,'pagina oculta nao consulta status Pix');
    await cdp.send('Runtime.evaluate',{expression:`window.__pixTestHidden=false;document.dispatchEvent(new Event('visibilitychange'))`});
    let resumedPolling=false;
    for(let attempt=0;attempt<25;attempt++){
      const count=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`window.__pixStatusRequests`});
      if(count.result.value>hiddenBaseline.result.value){resumedPolling=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(resumedPolling,true,'pagina visivel retoma consulta de status');
    await captureScreenshot(cdp,'small-mobile-pix-checkout');
    const mobileActions=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
      const button=document.getElementById('pix-copy-button');button.scrollIntoView({block:'center'});
      const rect=button.getBoundingClientRect();
      return {visible:rect.top>=0&&rect.bottom<=innerHeight,
        overflow:document.querySelector('#yc-sheet .yc-sheet-body').scrollWidth-document.querySelector('#yc-sheet .yc-sheet-body').clientWidth};
    }())`});
    assert.equal(mobileActions.result.value.visible,true);
    assert.ok(mobileActions.result.value.overflow<=1);
    await captureScreenshot(cdp,'small-mobile-pix-actions');
    const copy=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(async function(){
      Object.defineProperty(navigator,'clipboard',{value:null,configurable:true});
      document.getElementById('pix-copy-button').click();
      await new Promise(resolve=>setTimeout(resolve,100));
      return document.getElementById('pix-copy-feedback').textContent;
    }())`,awaitPromise:true});
    assert.match(copy.result.value,/copiado|Selecione e copie/);
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockStatus='approved'`});
    let confirmed=false;
    for(let attempt=0;attempt<115;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`document.getElementById('pix-status')?.textContent`});
      if(result.result.value==='Plano ativado'){confirmed=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(confirmed,true,'status confirmado pelo backend deve aparecer no Pix');
    const approvedState=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`({refreshes:window.__pixAccountRefreshes||0,hidden:document.querySelector('.pix-payment-grid')?.hidden,requests:window.__pixStatusRequests})`});
    assert.ok(approvedState.result.value.refreshes>=1,'conta Firebase deve ser atualizada apos ativacao confirmada');
    assert.equal(approvedState.result.value.hidden,true,'codigo Pix pago nao deve continuar em destaque');
    await new Promise(resolve=>setTimeout(resolve,3500));
    const completedPolls=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`window.__pixStatusRequests`});
    assert.equal(completedPolls.result.value,approvedState.result.value.requests,'pagamento concluido encerra consultas');
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockStatus='pending'`});
    const closed=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
      document.getElementById('pix-close-button').click();
      return {plans:!!document.querySelector('.plans-reference-screen'),requests:window.__pixRequests.length};
    }())`});
    assert.deepEqual(closed.result.value,{plans:true,requests:1});
    for(let attempt=0;attempt<50;attempt++){
      const ready=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`document.querySelector('.plan-card.plus [data-plan-request]')?.disabled===false`});
      if(ready.result.value)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await cdp.send('Runtime.evaluate',{expression:`document.querySelector('[data-yc-open="planos"]').click()`});
    for(let attempt=0;attempt<50;attempt++){
      const resumed=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`!!document.querySelector('.pix-checkout')`});
      if(resumed.result.value)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const reused=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`({open:!!document.querySelector('.pix-checkout'),posts:window.__pixRequests.length,lookups:window.__pixLookups.length,recovery:document.getElementById('pix-recovery-note')?.hidden===false})`});
    assert.equal(reused.result.value.open,true);
    assert.equal(reused.result.value.posts,1,'reabrir os planos deve recuperar o Pix sem novo POST');
    assert.ok(reused.result.value.lookups>=1);
    assert.equal(reused.result.value.recovery,true);
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockStatus='expired'`});
    let expired=false;
    for(let attempt=0;attempt<50;attempt++){
      const state=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`({text:document.getElementById('pix-status')?.textContent,state:document.querySelector('.pix-checkout')?.dataset.paymentState,hidden:document.querySelector('.pix-payment-grid')?.hidden})`});
      if(state.result.value.text==='Pagamento expirado'&&state.result.value.state==='expired'&&state.result.value.hidden===true){expired=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(expired,true,'status expirado confirmado pelo backend aparece na interface');
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockStatus='pending'`});
    await cdp.send('Runtime.evaluate',{expression:`document.getElementById('pix-close-button').click();window.__pixPending=null`});
    for(let attempt=0;attempt<50;attempt++){
      const ready=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`document.querySelector('.plan-card.plus [data-plan-request]')?.disabled===false`});
      if(ready.result.value)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const failed=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
      window.__pixMockMode='error';document.querySelector('.plan-card.plus [data-plan-request]').click();return true;
    }())`});
    assert.equal(failed.result.value,true);
    let errorState;
    for(let attempt=0;attempt<50;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
        const button=document.querySelector('.plan-card.plus [data-plan-request]');
        return {disabled:button?.disabled,note:document.getElementById('plan-contact-note')?.textContent,checkout:!!document.querySelector('.pix-checkout')};
      }())`});
      errorState=result.result.value;
      if(errorState.note?.includes('Pix indisponível no teste.'))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(errorState.disabled,false);
    assert.equal(errorState.checkout,false);
    assert.match(errorState.note,/Pix indisponível no teste/);
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockMode='rate-limited';document.querySelector('.plan-card.plus [data-plan-request]').click()`});
    let limited;
    for(let attempt=0;attempt<50;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`({note:document.getElementById('plan-contact-note')?.textContent,disabled:document.querySelector('.plan-card.plus [data-plan-request]')?.disabled})`});
      limited=result.result.value;
      if(limited.note?.includes('2 min'))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.match(limited.note,/2 min/);
    assert.equal(limited.disabled,false);
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockMode='tampered';document.querySelector('.plan-card.plus [data-plan-request]').click()`});
    let tampered;
    for(let attempt=0;attempt<50;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`({note:document.getElementById('plan-contact-note')?.textContent,checkout:!!document.querySelector('.pix-checkout')})`});
      tampered=result.result.value;
      if(tampered.note?.includes('Resposta Pix inválida'))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(tampered.checkout,false);
    assert.match(tampered.note,/Resposta Pix inválida/);
    const anonymous=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
      const original=RabbitHubSession.get;
      RabbitHubSession.get=()=>({status:'anonymous',ready:true});
      document.querySelector('.plan-card.plus [data-plan-request]').click();
      const result={note:document.getElementById('plan-contact-note').textContent,requests:window.__pixRequests.length};
      RabbitHubSession.get=original;
      return result;
    }())`});
    assert.match(anonymous.result.value.note,/Entre na sua conta/);
    assert.equal(anonymous.result.value.requests,4);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockMode='success';document.querySelector('.plan-card.plus [data-plan-request]').click()`});
    for(let attempt=0;attempt<50;attempt++){
      const ready=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`!!document.querySelector('.pix-checkout')`});
      if(ready.result.value)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await captureScreenshot(cdp,'desktop-pix-checkout');
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockStatus='canceled'`});
    let canceled=false;
    for(let attempt=0;attempt<50;attempt++){
      const state=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`({text:document.getElementById('pix-status')?.textContent,state:document.querySelector('.pix-checkout')?.dataset.paymentState,hidden:document.querySelector('.pix-payment-grid')?.hidden})`});
      if(state.result.value.text==='Pagamento cancelado'&&state.result.value.state==='canceled'&&state.result.value.hidden===true){canceled=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(canceled,true,'status cancelado confirmado pelo backend aparece na interface');
    await cdp.send('Runtime.evaluate',{expression:`window.__pixMockStatus='pending'`});
    await cdp.send('Runtime.evaluate',{expression:`document.getElementById('pix-close-button').click()`});
    for(let attempt=0;attempt<50;attempt++){
      const ready=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`document.querySelector('.plan-card.vip [data-plan-request]')?.disabled===false`});
      if(ready.result.value)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await cdp.send('Runtime.evaluate',{expression:`document.querySelector('.plan-card.vip [data-plan-request]').click()`});
    let vipCheckout;
    for(let attempt=0;attempt<50;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
        const image=document.getElementById('pix-qr-image');
        return {plan:document.getElementById('pix-plan')?.textContent,
          amount:document.getElementById('pix-amount')?.textContent,
          qrVisible:image?.hidden===false,qrLoaded:image?.naturalWidth>0,
          request:window.__pixRequests[window.__pixRequests.length-1]?.body,
          vipUnlocked:RabbitHubPlans.isVip()};
      }())`});
      vipCheckout=result.result.value;
      if(vipCheckout.plan==='Plano VIP'&&vipCheckout.qrLoaded)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(vipCheckout.plan,'Plano VIP');
    assert.match(vipCheckout.amount,/R\$\s*1,00/);
    assert.equal(vipCheckout.qrVisible,true);
    assert.equal(vipCheckout.qrLoaded,true);
    assert.deepEqual(vipCheckout.request,{planId:'vip'});
    assert.equal(vipCheckout.vipUnlocked,false);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:2,mobile:true});
    await cdp.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36'});
    await new Promise(resolve=>setTimeout(resolve,150));
    const webView=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
      const wrap=document.querySelector('.pix-qr-wrap'),image=document.getElementById('pix-qr-image');
      const code=document.getElementById('pix-copy-code'),button=document.getElementById('pix-copy-button');
      code.value='000201'+('0123456789'.repeat(30));
      const qr=wrap.getBoundingClientRect(),img=image.getBoundingClientRect(),copy=button.getBoundingClientRect();
      const body=document.querySelector('#yc-sheet .yc-sheet-body');
      return {qrInside:img.left>=qr.left&&img.right<=qr.right&&img.top>=qr.top&&img.bottom<=qr.bottom,
        qrWidth:img.width,codeOverflow:code.scrollWidth-code.clientWidth,
        buttonInside:copy.left>=0&&copy.right<=innerWidth,overflow:body.scrollWidth-body.clientWidth};
    }())`});
    console.log(JSON.stringify({webView:webView.result.value}));
    assert.equal(webView.result.value.qrInside,true,'QR completo no layout Android WebView');
    assert.ok(webView.result.value.qrWidth<=232);
    assert.ok(webView.result.value.codeOverflow<=1,'Pix Copia e Cola sem corte horizontal');
    assert.equal(webView.result.value.buttonInside,true);
    assert.ok(webView.result.value.overflow<=1);
    await captureScreenshot(cdp,'android-webview-vip-pix');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await captureScreenshot(cdp,'desktop-vip-pix-checkout');
    assert.equal(runtimeErrors.length,0,'nenhuma excecao JavaScript na pagina de planos');
    assert.deepEqual(consoleErrors,[],'nenhum erro de console na pagina de planos');
  } else {

  const evaluation = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      localStorage.setItem('dk_session',JSON.stringify({uid:'ui-test',displayName:'Teste',profileAvatar:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3Crect width=%221%22 height=%221%22 fill=%22red%22/%3E%3C/svg%3E'}));
      localStorage.setItem('dk_active_profile',JSON.stringify({id:'principal',name:'Teste',avatar:''}));
      RabbitHubAccount.refresh();
      DK_setGlobalTheme('blue');
      await nextFrame();
      const drawer=document.getElementById('drawer');
      const menuButton=document.getElementById('open-drawer');
      const avatar=document.querySelector('.drawer-avatar');
      const logo=document.querySelector('img[data-dk-logo]');
      const spacer=document.createElement('div');
      spacer.style.height='2200px';
      document.body.appendChild(spacer);
      const drawerTopBefore=drawer.getBoundingClientRect().top;
      window.scrollTo(0,700);
      await nextFrame();
      const drawerTopAfter=drawer.getBoundingClientRect().top;

      const host=document.createElement('div');
      host.style.cssText='position:fixed;left:420px;bottom:12px;z-index:5000';
      const select=document.createElement('select');
      for(let i=1;i<=20;i++)select.add(new Option('Opção '+i,String(i)));
      host.appendChild(select);
      document.body.appendChild(host);
      RabbitHubDropdowns.refresh(select);
      const trigger=host.querySelector('.rh-select__trigger');
      trigger.click();
      await nextFrame();
      const dropdown=select._rhDropdown;
      const triggerRect=trigger.getBoundingClientRect();
      const menuRect=dropdown.menu.getBoundingClientRect();
      dropdown.menu.dispatchEvent(new Event('scroll'));
      await nextFrame();

      return {
        href:location.pathname,
        drawerPosition:getComputedStyle(drawer).position,
        drawerTopBefore,drawerTopAfter,
        menuButtonDisplay:getComputedStyle(menuButton).display,
        drawerAriaHidden:drawer.getAttribute('aria-hidden'),
        avatarImage:avatar.style.backgroundImage,
        storedSession:localStorage.getItem('dk_session'),
        storedProfile:localStorage.getItem('dk_active_profile'),
        logoSource:logo.getAttribute('src'),
        expectedLogo:DK_getLogoUrl(),
        logoLoaded:logo.complete&&logo.naturalWidth>0,
        dropdownAboveGap:Math.round(triggerRect.top-menuRect.bottom),
        dropdownStillOpen:dropdown.open,
        dropdownVisible:!dropdown.menu.hidden
      };
    }())`
  });

  const result = evaluation.result.value;
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.href, '/index.html');
  assert.equal(result.drawerPosition, 'fixed');
  assert.ok(Math.abs(result.drawerTopBefore) < 1 && Math.abs(result.drawerTopAfter) < 1, 'drawer não deve acompanhar a rolagem');
  assert.equal(result.menuButtonDisplay, 'none');
  assert.equal(result.drawerAriaHidden, 'false');
  assert.match(result.avatarImage, /data:image\/svg\+xml/);
  assert.equal(result.logoSource, result.expectedLogo);
  assert.equal(result.logoLoaded, true);
  assert.ok(result.dropdownAboveGap >= 7 && result.dropdownAboveGap <= 10, 'dropdown deve abrir junto ao gatilho');
  assert.equal(result.dropdownStillOpen, true);
  assert.equal(result.dropdownVisible, true);

  /* Valida o caminho real do mouse no desktop. element.click() n\u00e3o reproduz
     a sequ\u00eancia pointerdown/mousedown/mouseup que revelou a regress\u00e3o. */
  const dropdownTarget = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(function(){
      const select=document.querySelector('div[style*="left: 420px"] select');
      const instance=select._rhDropdown;
      RabbitHubDropdowns.close(false);
      select.dataset.uiChangeCount='0';
      select.addEventListener('change',()=>select.dataset.uiChangeCount=String(Number(select.dataset.uiChangeCount)+1));
      const rect=instance.trigger.getBoundingClientRect();
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    }())`
  });
  const clickAt = async ({ x, y }) => {
    await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
  };
  await clickAt(dropdownTarget.result.value);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const optionTarget = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(function(){
      const select=document.querySelector('div[style*="left: 420px"] select');
      const instance=select._rhDropdown;
      const option=instance.menu.querySelectorAll('.rh-select__option')[1];
      const rect=option.getBoundingClientRect();
      return {open:instance.open,x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    }())`
  });
  assert.equal(optionTarget.result.value.open, true, 'clique f\u00edsico deve abrir o dropdown no desktop');
  await clickAt(optionTarget.result.value);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const physicalDropdown = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(function(){
      const select=document.querySelector('div[style*="left: 420px"] select');
      return {selectedIndex:select.selectedIndex,changes:Number(select.dataset.uiChangeCount),open:select._rhDropdown.open};
    }())`
  });
  assert.equal(physicalDropdown.result.value.selectedIndex, 1, 'clique f\u00edsico deve selecionar a op\u00e7\u00e3o');
  assert.equal(physicalDropdown.result.value.changes, 1, 'dropdown deve emitir um change por escolha');
  assert.equal(physicalDropdown.result.value.open, false, 'dropdown deve fechar ap\u00f3s a escolha');

  const searchDesktop=await cdp.send('Runtime.evaluate', {awaitPromise:true,returnByValue:true,expression:`(async function(){
    const plans=window.RabbitHubPlans,can=plans.can;
    plans.can=function(feature){return feature==='searchAssist'||can.call(this,feature);};
    localStorage.setItem('rh_vip_recent_searches_v1_ui-test_principal',JSON.stringify(['Naruto']));
    const toggle=document.getElementById('open-search'),input=document.getElementById('search-input'),assist=document.getElementById('search-assist');
    toggle.click();
    const opened=!assist.hidden&&!!assist.querySelector('[data-search-suggestion]');
    input.value='One Piece';input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    const enterClosed=assist.hidden;
    await new Promise(resolve=>setTimeout(resolve,450));
    const stayedClosed=assist.hidden;
    input.focus();input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,400));
    const reopened=!assist.hidden;
    const item=assist.querySelector('[data-search-suggestion]');
    item.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    input.blur();item.click();
    const chosen=input.value==='Naruto'&&assist.hidden;
    input.focus();
    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const outsideClosed=assist.hidden;
    toggle.click();plans.can=can;
    return {opened,enterClosed,stayedClosed,reopened,chosen,outsideClosed};
  }())`});
  assert.ok(!searchDesktop.exceptionDetails, JSON.stringify(searchDesktop.exceptionDetails));
  assert.deepEqual(searchDesktop.result.value,{opened:true,enterClosed:true,stayedClosed:true,reopened:true,chosen:true,outsideClosed:true});

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const mobileSearchOpen=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
    const plans=window.RabbitHubPlans;window.__uiSearchCan=plans.can;
    plans.can=function(feature){return feature==='searchAssist'||window.__uiSearchCan.call(this,feature);};
    document.getElementById('open-search').click();
    return !document.getElementById('search-assist').hidden;
  }())`});
  assert.equal(mobileSearchOpen.result.value,true);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:500,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,100));
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,100));
  const mobileSearchClosed=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
    const assist=document.getElementById('search-assist'),input=document.getElementById('search-input');
    const closed=assist.hidden;
    input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const reopened=!assist.hidden;
    document.getElementById('open-search').click();
    window.RabbitHubPlans.can=window.__uiSearchCan;
    delete window.__uiSearchCan;
    return {closed,reopened};
  }())`});
  assert.deepEqual(mobileSearchClosed.result.value,{closed:true,reopened:true});
  const mobileEvaluation = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rect=(element)=>{const value=element.getBoundingClientRect();return {top:value.top,right:value.right,bottom:value.bottom,left:value.left,width:value.width,height:value.height};};
      window.scrollTo(0,0);
      const button=document.getElementById('open-drawer');
      const drawer=document.getElementById('drawer');
      const overlay=document.getElementById('drawer-overlay');
      await nextFrame();
      const buttonDisplay=getComputedStyle(button).display;
      button.click();
      await nextFrame();
      const drawerOpen=drawer.classList.contains('open');
      const drawerAriaHidden=drawer.getAttribute('aria-hidden');
      const overlayOpen=overlay.classList.contains('open');
      button.click();
      const profileTab=document.querySelector('[data-tab="perfil"]');
      if(!profileTab)throw new Error('Aba de perfil nao encontrada');
      profileTab.click();
      await nextFrame();
      const configButton=document.querySelector('[data-yc-open="config"]');
      if(!configButton)throw new Error('Botao de configuracoes nao encontrado');
      configButton.click();
      await nextFrame();
      const sheet=document.getElementById('yc-sheet');
      const sheetHeader=sheet.querySelector('.yc-sheet-header');
      const sheetBody=sheet.querySelector('.yc-sheet-body');
      const settingsHero=sheet.querySelector('.settings-hero');
      const closeButton=sheet.querySelector('.yc-config-close');
      return {
        viewport:window.innerWidth,
        buttonDisplay,
        drawerOpen,
        drawerAriaHidden,
        overlayOpen,
        config:{
          kind:sheet.getAttribute('data-sheet-kind'),
          sheet:rect(sheet),body:rect(sheetBody),hero:rect(settingsHero),close:rect(closeButton),
          headerDisplay:getComputedStyle(sheetHeader).display,
          closeDisplay:getComputedStyle(closeButton).display,
          bodyBorderRadius:parseFloat(getComputedStyle(sheetBody).borderRadius),
          dialogOpen:document.body.classList.contains('rh-dialog-open'),
          sheetCoversHeader:sheet.contains(document.elementFromPoint(window.innerWidth/2,20)),
          bodyScrollable:sheetBody.scrollHeight>sheetBody.clientHeight,
          horizontalOverflow:sheetBody.scrollWidth-sheetBody.clientWidth,
          bodyOverflowY:getComputedStyle(sheetBody).overflowY
        }
      };
    }())`
  });
  const mobile = mobileEvaluation.result.value;
  console.log(JSON.stringify({ mobile }, null, 2));
  assert.equal(mobile.viewport, 390);
  assert.notEqual(mobile.buttonDisplay, 'none');
  assert.equal(mobile.drawerOpen, true);
  assert.equal(mobile.drawerAriaHidden, 'false');
  assert.equal(mobile.overlayOpen, true);
  assert.equal(mobile.config.kind, 'config');
  assert.ok(Math.abs(mobile.config.sheet.top) < 1 && Math.abs(mobile.config.sheet.left) < 1, 'overlay do dialogo deve ocupar a viewport mobile');
  assert.equal(mobile.config.headerDisplay, 'none');
  assert.equal(mobile.config.closeDisplay, 'grid');
  assert.equal(mobile.config.dialogOpen, true);
  assert.ok(mobile.config.body.left > mobile.config.sheet.left && mobile.config.body.right < mobile.config.sheet.right, 'dialogo de configuracoes deve flutuar com margem lateral');
  assert.ok(mobile.config.body.top > mobile.config.sheet.top && mobile.config.body.bottom < mobile.config.sheet.bottom, 'dialogo de configuracoes deve flutuar com margem vertical');
  assert.ok(mobile.config.bodyBorderRadius >= 20, 'dialogo de configuracoes deve manter cantos arredondados');
  assert.ok(mobile.config.body.top <= mobile.config.hero.top, 'primeiro bloco deve comecar dentro do corpo rolavel');
  assert.equal(mobile.config.sheetCoversHeader, true);
  assert.ok(mobile.config.horizontalOverflow <= 1, 'configuracoes nao devem ter rolagem horizontal');
  assert.equal(mobile.config.bodyOverflowY, 'auto');
  const mobileConfigScreenshot = await captureScreenshot(cdp, 'mobile-config');
  const configCloseAfterScroll=await cdp.send('Runtime.evaluate', { awaitPromise:true,returnByValue:true,expression:`(async function(){
    const body=document.getElementById('yc-sheet-body');
    body.scrollTop=body.scrollHeight;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const button=document.getElementById('yc-config-close');
    const bounds=button.getBoundingClientRect();
    const visible=bounds.top>=0&&bounds.bottom<=innerHeight&&button.contains(document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2));
    const backgroundLocked=getComputedStyle(document.body).overflow==='hidden';
    button.click();
    return {visible,backgroundLocked,closed:!document.getElementById('yc-sheet').classList.contains('open'),unlocked:getComputedStyle(document.body).overflow!=='hidden'};
  }())` });
  assert.deepEqual(configCloseAfterScroll.result.value,{visible:true,backgroundLocked:true,closed:true,unlocked:true});
  await captureScreenshot(cdp, 'mobile-profile');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:320,height:568,deviceScaleFactor:1,mobile:true});
  const compactConfig=await cdp.send('Runtime.evaluate', {awaitPromise:true,returnByValue:true,expression:`(async function(){
    document.querySelector('[data-yc-open="config"]').click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const body=document.getElementById('yc-sheet-body'),box=body.getBoundingClientRect();
    const close=document.getElementById('yc-config-close'),button=close.getBoundingClientRect();
    const result={fits:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight,
      scrolls:body.scrollHeight>body.clientHeight,closeVisible:button.top>=box.top&&button.right<=box.right,
      locked:getComputedStyle(document.body).overflow==='hidden'};
    close.click();return result;
  }())`});
  assert.deepEqual(compactConfig.result.value,{fits:true,scrolls:true,closeVisible:true,locked:true});
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp.send('Runtime.evaluate',{expression:"document.querySelector('[data-yc-open=\"config\"]').click()"});
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:667,height:375,deviceScaleFactor:1,mobile:true,
    screenOrientation:{type:'landscapePrimary',angle:90}});
  await new Promise(resolve=>setTimeout(resolve,200));
  const landscapeConfig=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
    const sheet=document.getElementById('yc-sheet'),body=document.getElementById('yc-sheet-body');
    const box=body.getBoundingClientRect(),close=document.getElementById('yc-config-close');
    const button=close.getBoundingClientRect();
    const result={fits:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight,
      scrolls:body.scrollHeight>body.clientHeight,closeVisible:button.top>=box.top&&button.right<=box.right,
      locked:getComputedStyle(document.body).overflow==='hidden',open:sheet.classList.contains('open')};
    close.click();return result;
  }())`});
  assert.deepEqual(landscapeConfig.result.value,{fits:true,scrolls:true,closeVisible:true,locked:true,open:true});
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true,
    screenOrientation:{type:'portraitPrimary',angle:0}});

  const accountEvaluation = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rect=(element)=>{const value=element.getBoundingClientRect();return {top:value.top,right:value.right,bottom:value.bottom,left:value.left,width:value.width,height:value.height};};
      await new Promise(resolve=>setTimeout(resolve,20));
      await nextFrame();
      const accountButton=document.querySelector('[data-yc-action="conta"]');
      if(!accountButton)throw new Error('Botao de conta nao encontrado');
      const vipSession=JSON.parse(localStorage.getItem('dk_session')||'{}');
      Object.assign(vipSession,{plan:'VIP',currentPlan:'VIP',premium:true,vip:true,premiumUntil:null,vipUntil:Date.now()-86400000,planExpiresAt:Date.now()-86400000,subscriptionStatus:'expired'});
      localStorage.setItem('dk_session',JSON.stringify(vipSession));
      const profileService=window.RabbitHubProfileData;
      window.RabbitHubProfileData=null;
      accountButton.click();
      window.RabbitHubProfileData=profileService;
      await nextFrame();
      const sheet=document.getElementById('yc-sheet');
      const sheetHeader=sheet.querySelector('.yc-sheet-header');
      const sheetBody=sheet.querySelector('.yc-sheet-body');
      const closeButton=sheet.querySelector('.account-dialog-close');
      const planField=Array.from(sheet.querySelectorAll('.account-info-field')).find(field=>field.querySelector('span')&&field.querySelector('span').textContent.trim()==='PLANO ATUAL');
      return {
        kind:sheet.getAttribute('data-sheet-kind'),sheet:rect(sheet),body:rect(sheetBody),close:rect(closeButton),
        plan:planField&&planField.querySelector('strong')?planField.querySelector('strong').textContent.trim():'',
        livePlan:window.RabbitHubAccountPlan&&window.RabbitHubAccountPlan.normalize(window.RabbitHubSession&&window.RabbitHubSession.get().account),
        liveSession:window.RabbitHubSession&&window.RabbitHubSession.get(),
        headerDisplay:getComputedStyle(sheetHeader).display,closeDisplay:getComputedStyle(closeButton).display,
        bodyBorderRadius:parseFloat(getComputedStyle(sheetBody).borderRadius),
        dialogOpen:document.body.classList.contains('rh-dialog-open'),
        horizontalOverflow:sheetBody.scrollWidth-sheetBody.clientWidth,
        bodyOverflowY:getComputedStyle(sheetBody).overflowY
      };
    }())`
  });
  const account = accountEvaluation.result.value;
  if(accountEvaluation.exceptionDetails)console.log(JSON.stringify(accountEvaluation.exceptionDetails,null,2));
  console.log(JSON.stringify({ account }, null, 2));
  assert.equal(account.kind, 'conta');
  assert.equal(account.plan, 'VIP', 'conta deve usar o plano da sessão central, mesmo sem o serviço de perfil');
  assert.equal(account.headerDisplay, 'none');
  assert.equal(account.closeDisplay, 'grid');
  assert.equal(account.dialogOpen, true);
  assert.ok(account.body.left > account.sheet.left && account.body.right < account.sheet.right, 'dialogo de conta deve flutuar com margem lateral');
  assert.ok(account.body.top > account.sheet.top && account.body.bottom < account.sheet.bottom, 'dialogo de conta deve flutuar com margem vertical');
  assert.ok(account.bodyBorderRadius >= 20, 'dialogo de conta deve manter cantos arredondados');
  assert.ok(account.horizontalOverflow <= 1, 'conta nao deve ter rolagem horizontal');
  assert.equal(account.bodyOverflowY, 'auto');
  const mobileAccountScreenshot = await captureScreenshot(cdp, 'mobile-account');

  const planRegression=await cdp.send('Runtime.evaluate',{
    awaitPromise:true,returnByValue:true,expression:`(async function(){
      const originalGet=RabbitHubSession.get, profileService=RabbitHubProfileData;
      const plans=[];
      try {
        window.RabbitHubProfileData=null;
        for(const account of [{premium:false},{premium:true,premiumUntil:Date.now()-1000},{premium:true,premiumUntil:0}]){
          RabbitHubSession.get=()=>{const state=originalGet();return {...state,account:{...state.account,...account}};};
          document.querySelector('.account-dialog-close').click();
          await new Promise(resolve=>setTimeout(resolve,30));
          document.querySelector('[data-yc-action="conta"]').click();
          await new Promise(resolve=>requestAnimationFrame(resolve));
          const field=Array.from(document.querySelectorAll('.account-info-field')).find(node=>node.querySelector('span')?.textContent.trim()==='PLANO ATUAL');
          plans.push(field.querySelector('strong').textContent.trim());
        }
      } finally {RabbitHubSession.get=originalGet;window.RabbitHubProfileData=profileService;}
      return plans;
    }())`
  });
  assert.deepEqual(planRegression.result.value,['Free','Free','VIP'],'cache local VIP não pode sobrepor revogação ou validade real');

  const supportEvaluation = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rect=(element)=>{const value=element.getBoundingClientRect();return {top:value.top,right:value.right,bottom:value.bottom,left:value.left,width:value.width,height:value.height};};
      document.querySelector('.account-dialog-close').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      await nextFrame();
      const supportButton=document.querySelector('[data-yc-action="suporte"]');
      if(!supportButton)throw new Error('Botao de suporte nao encontrado');
      supportButton.click();
      await nextFrame();
      const sheet=document.getElementById('yc-sheet');
      const sheetHeader=sheet.querySelector('.yc-sheet-header');
      const sheetBody=sheet.querySelector('.yc-sheet-body');
      const card=sheet.querySelector('.support-reference-card');
      const internalBack=sheet.querySelector('.yc-sheet-back');
      const globalHeader=document.querySelector('.otk-header-fixed');
      const globalBack=document.getElementById('header-context-back');
      const globalTitle=document.querySelector('.otk-header-fixed .header-title');
      return {
        kind:sheet.getAttribute('data-sheet-kind'),
        internalHeaderDisplay:getComputedStyle(sheetHeader).display,
        globalHeader:rect(globalHeader),body:rect(sheetBody),card:rect(card),back:rect(globalBack),
        title:globalTitle.textContent.trim(),
        backDisplay:getComputedStyle(globalBack).display,backVisibility:getComputedStyle(globalBack).visibility,backOpacity:getComputedStyle(globalBack).opacity,
        internalBackVisible:internalBack.getClientRects().length>0,
        headerBorderColor:getComputedStyle(globalHeader).borderBottomColor,
        horizontalOverflow:sheetBody.scrollWidth-sheetBody.clientWidth,
        globalHeaderOnTop:globalHeader.contains(document.elementFromPoint(window.innerWidth/2,20))
      };
    }())`
  });
  const support = supportEvaluation.result.value;
  console.log(JSON.stringify({ support }, null, 2));
  assert.equal(support.kind, 'suporte');
  assert.equal(support.title, 'Ajuda');
  assert.equal(support.internalHeaderDisplay, 'none');
  assert.equal(support.internalBackVisible, false);
  assert.notEqual(support.backDisplay, 'none');
  assert.ok(support.globalHeader.bottom <= support.body.top + 1, 'ajuda nao pode ficar sob o cabecalho principal');
  assert.ok(support.body.top <= support.card.top, 'cartao de suporte deve comecar dentro do corpo');
  assert.ok(support.card.left >= support.body.left && support.card.right <= support.body.right + 1, 'cartao de suporte deve caber no celular');
  assert.ok(support.horizontalOverflow <= 1, 'suporte nao deve ter rolagem horizontal');
  assert.equal(support.globalHeaderOnTop, true);
  const mobileSupportScreenshot = await captureScreenshot(cdp, 'mobile-support');

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const desktopSheetsEvaluation = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      try {
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rect=(element)=>{const value=element.getBoundingClientRect();return {top:value.top,right:value.right,bottom:value.bottom,left:value.left,width:value.width,height:value.height};};
      document.getElementById('yc-sheet-back').click();
      await nextFrame();
      document.querySelector('[data-yc-open="config"]').click();
      await nextFrame();
      const sheet=document.getElementById('yc-sheet');
      const body=sheet.querySelector('.yc-sheet-body');
      const result={
        configBody:rect(body),
        configOverflow:body.scrollWidth-body.clientWidth,
        configHeaderDisplay:getComputedStyle(sheet.querySelector('.yc-sheet-header')).display
      };
      document.getElementById('yc-config-close').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      await nextFrame();
      const supportButton=document.querySelector('[data-yc-action="suporte"]');
      if(!supportButton)throw new Error('Botao de suporte nao reapareceu no desktop');
      supportButton.click();
      await new Promise(resolve=>setTimeout(resolve,20));
      await nextFrame();
      const supportSheet=document.getElementById('yc-sheet');
      const supportBody=supportSheet.querySelector('.yc-sheet-body');
      const supportCard=supportSheet.querySelector('.support-reference-card');
      if(!supportCard)throw new Error('Cartao de suporte nao abriu no desktop');
      result.supportBody=rect(supportBody);
      result.supportCard=rect(supportCard);
      result.supportOverflow=supportBody.scrollWidth-supportBody.clientWidth;
      result.supportTitle=document.querySelector('.otk-header-fixed .header-title').textContent.trim();
      result.supportBackDisplay=getComputedStyle(document.getElementById('header-context-back')).display;
      result.supportInternalHeaderDisplay=getComputedStyle(supportSheet.querySelector('.yc-sheet-header')).display;
      return result;
      } catch(error) {
        return {error:String(error&&error.message||error),stack:String(error&&error.stack||'')};
      }
    }())`
  });
  const desktopSheets = desktopSheetsEvaluation.result.value;
  console.log(JSON.stringify({ desktopSheets }, null, 2));
  assert.equal(desktopSheets.error, undefined, desktopSheets.error || 'desktop sheets');
  assert.equal(desktopSheets.configHeaderDisplay, 'none');
  assert.ok(desktopSheets.configBody.left > 0 && desktopSheets.configBody.right < 1440, 'modal de configuracoes deve ficar centralizado no desktop');
  assert.ok(desktopSheets.configOverflow <= 1, 'configuracoes nao devem transbordar no desktop');
  assert.ok(desktopSheets.supportCard.left >= desktopSheets.supportBody.left, 'suporte deve permanecer dentro do corpo no desktop');
  assert.ok(desktopSheets.supportCard.right <= desktopSheets.supportBody.right + 1, 'suporte deve caber no corpo no desktop');
  assert.ok(desktopSheets.supportOverflow <= 1, 'suporte nao deve transbordar no desktop');
  assert.equal(desktopSheets.supportTitle, 'Ajuda');
  assert.notEqual(desktopSheets.supportBackDisplay, 'none');
  assert.equal(desktopSheets.supportInternalHeaderDisplay, 'none');
  const desktopSupportScreenshot = await captureScreenshot(cdp, 'desktop-support');

  const openPlans=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
    document.getElementById('yc-sheet-back').click();
    const tile=document.querySelector('[data-yc-open="planos"]');
    if(!tile)return false;
    tile.click();
    return document.getElementById('yc-sheet')?.getAttribute('data-sheet-kind')==='planos';
  }())`});
  assert.equal(openPlans.result.value,true,'a página de planos deve abrir');
  for(const viewport of [
    {name:'desktop',width:1440,height:1000,mobile:false},
    {name:'mobile',width:390,height:844,mobile:true},
    {name:'small-mobile',width:320,height:568,mobile:true}
  ]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{
      width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.mobile
    });
    let page;
    for(let attempt=0;attempt<50;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(function(){
        const body=document.querySelector('#yc-sheet .yc-sheet-body');
        const vip=body?.querySelector('.plan-card.vip');
        const plus=body?.querySelector('.plan-card.plus');
        return {viewport:innerWidth,overflow:body?body.scrollWidth-body.clientWidth:999,
          vipPrice:vip?.querySelector('.plan-card-price')?.textContent.trim(),
          plusPrice:plus?.querySelector('.plan-card-price')?.textContent.trim(),
          vipId:vip?.querySelector('.plan-request-btn')?.dataset.planId,
          plusId:plus?.querySelector('.plan-request-btn')?.dataset.planId,
          hasClientAmount:!!body?.querySelector('[data-amount], [data-price]')};
      }())`});
      page=result.result.value;
      if(page.vipPrice?.includes('1,00')&&page.plusPrice?.includes('19,90'))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(page.viewport,viewport.width);
    assert.ok(page.overflow<=1,'planos não devem transbordar em '+viewport.name);
    assert.match(page.vipPrice,/R\$\s*1,00/);
    assert.match(page.plusPrice,/R\$\s*19,90/);
    assert.equal(page.vipId,'vip');
    assert.equal(page.plusId,'plus');
    assert.equal(page.hasClientAmount,false);
    await captureScreenshot(cdp,viewport.name+'-plans');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{
    width:1440,height:1000,deviceScaleFactor:1,mobile:false
  });

  async function auditResponsivePage(relativeUrl, viewport) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile
    });
    await cdp.send('Page.navigate', { url: origin + relativeUrl });
    for (let attempt = 0; attempt < 40; attempt++) {
      const state = await cdp.send('Runtime.evaluate', { returnByValue:true, expression:'({ready:document.readyState,path:location.pathname})' });
      if (state.result.value && state.result.value.ready !== 'loading' && state.result.value.path === new URL(relativeUrl,origin).pathname) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (relativeUrl.startsWith('/affiliate.html')) {
      for (let attempt=0;attempt<30;attempt++) {
        const styled=await cdp.send('Runtime.evaluate', { returnByValue:true,
          expression:"parseFloat(getComputedStyle(document.querySelector('.brand img')).width)<=40" });
        if (styled.result.value) break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    }
    const audit = await cdp.send('Runtime.evaluate', {
      returnByValue:true,
      expression:`(function(){
        const root=document.documentElement;
        const body=document.body;
        const details=location.pathname.endsWith('/detalhes.html');
        const drawer=document.getElementById('drawer');
        const back=document.getElementById('detail-back');
        const header=document.querySelector('.otk-header-fixed');
        const headerInner=document.querySelector('.otk-header-fixed .header-inner');
        const headerTitle=document.querySelector('.otk-header-fixed .header-title,.otk-header-fixed .header-title-text');
        const innerRect=headerInner&&headerInner.getBoundingClientRect();
        const titleRect=headerTitle&&headerTitle.getBoundingClientRect();
        const cast=location.pathname.endsWith('/player-animes.html')&&document.getElementById('dk-cast-modal');
        let castBounds=null;
        if(cast){
          cast.hidden=false;
          const card=cast.querySelector('.dk-cast-card').getBoundingClientRect();
          const hit=document.elementFromPoint(card.left+card.width/2,card.top+card.height/2);
          castBounds={top:card.top,bottom:card.bottom,left:card.left,right:card.right,hit:!!(hit&&hit.closest('#dk-cast-modal'))};
          cast.hidden=true;
        }
        let expandedOverflow=null,expandedOutliers=[];
        if(['/affiliate.html','/affiliates-admin.html','/simulator-admin.html','/partners.html'].some(path=>location.pathname.endsWith(path))){
          const panels=[document.getElementById('workspace'),document.getElementById('app'),document.getElementById('content')].filter(Boolean);
          if(location.pathname.endsWith('/affiliates-admin.html'))panels.push(...document.querySelectorAll('#app section[data-panel]:not([data-panel="simulator"])'));
          const hiddenPanels=panels.filter(node=>node.hidden);
          hiddenPanels.forEach(node=>node.hidden=false);
          expandedOverflow=Math.max(0,root.scrollWidth-root.clientWidth);
          expandedOutliers=Array.from(document.querySelectorAll('body *'))
            .filter(node=>node.getClientRects().length).map(node=>({node,rect:node.getBoundingClientRect()}))
            .filter(item=>!item.node.closest('.sidebar nav,.tabs,#campaign-table') &&
              (item.rect.left<-1||item.rect.right>${viewport.width}+1))
            .slice(0,15).map(item=>item.node.tagName.toLowerCase()+' '+(item.node.id||item.node.className||'')+' '+Math.round(item.rect.left)+'..'+Math.round(item.rect.right));
          hiddenPanels.forEach(node=>node.hidden=true);
          void root.offsetWidth;
        }
        return {
          path:location.pathname,
          search:location.search,
          viewport:innerWidth,
          documentOverflow:Math.max(0,root.scrollWidth-root.clientWidth),
          bodyOverflow:Math.max(0,body.scrollWidth-root.clientWidth),
          readyState:document.readyState,
          detailsDrawerDisplay:details&&drawer?getComputedStyle(drawer).display:null,
          detailsMenuExists:details?Boolean(document.getElementById('menu-btn')):null,
          detailsBackDisplay:details&&back?getComputedStyle(back).display:null,
          detailsHeaderLeft:details&&header?Math.round(header.getBoundingClientRect().left):null,
          headerTitleCenterDelta:innerRect&&titleRect?Math.round(Math.abs((titleRect.left+titleRect.width/2)-(innerRect.left+innerRect.width/2))):null,
          castBounds,expandedOverflow,expandedOutliers
        };
      }())`
    });
    if(!audit.result.value)throw new Error(JSON.stringify(audit.exceptionDetails||audit));
    return audit.result.value;
  }

  const pagesToAudit = [
    '/index.html?layout-audit=1',
    '/index.html?tab=dublados&layout-audit=1',
    '/index.html?tab=legendados&layout-audit=1',
    '/index.html?tab=categoria&layout-audit=1',
    '/login.html?layout-audit=1',
    '/perfis.html?layout-audit=1',
    '/detalhes.html?id=layout-audit',
    '/player-animes.html?anime=layout-audit&ep=1',
    '/chat.html?layout-audit=1',
    '/admin.html?layout-audit=1',
    '/affiliate.html?layout-audit=1',
    '/affiliates-admin.html?layout-audit=1',
    '/simulator-admin.html?layout-audit=1',
    '/partners.html?layout-audit=1',
    '/404.html?layout-audit=1'
  ];
  const responsiveAudit=[];
  for (const viewport of [
    {name:'small-mobile',width:320,height:568,mobile:true},
    {name:'mobile',width:390,height:844,mobile:true},
    {name:'mobile-landscape',width:667,height:375,mobile:true},
    {name:'tablet',width:768,height:1024,mobile:true},
    {name:'tablet-landscape',width:1024,height:768,mobile:true},
    {name:'laptop',width:1366,height:768,mobile:false},
    {name:'full-hd',width:1920,height:1080,mobile:false},
    {name:'tv-4k',width:3840,height:2160,mobile:false}
  ]) {
    for (const page of pagesToAudit) {
      const pageAudit=await auditResponsivePage(page,viewport);
      pageAudit.mode=viewport.name;
      responsiveAudit.push(pageAudit);
      if (((viewport.name==='small-mobile'||viewport.name==='mobile-landscape') && !page.includes('tab=')) ||
          (viewport.name==='laptop' && ['/index.html?layout-audit=1','/detalhes.html?id=layout-audit','/player-animes.html?anime=layout-audit&ep=1'].includes(page))) {
        await captureScreenshot(cdp, 'layout-'+viewport.name+'-'+new URL(page,origin).pathname.slice(1).replace('.html',''));
      }
      assert.equal(pageAudit.path,new URL(page,origin).pathname,'navegação deve chegar à página solicitada');
      assert.equal(pageAudit.viewport,viewport.width,page+' deve respeitar a viewport '+viewport.name);
      assert.ok(pageAudit.documentOverflow<=1,page+' nao pode criar rolagem horizontal em '+viewport.name);
      assert.ok(pageAudit.bodyOverflow<=1,page+' nao pode transbordar o body em '+viewport.name);
      if (pageAudit.headerTitleCenterDelta!==null) {
        assert.ok(pageAudit.headerTitleCenterDelta<=1,page+' deve manter o titulo centralizado em '+viewport.name);
      }
      if (pageAudit.path==='/detalhes.html') {
        assert.equal(pageAudit.detailsDrawerDisplay,'none','detalhes nao deve exibir o drawer em '+viewport.name);
        assert.equal(pageAudit.detailsMenuExists,false,'detalhes deve ter somente o botao Voltar em '+viewport.name);
        assert.notEqual(pageAudit.detailsBackDisplay,'none','botao Voltar deve permanecer visivel em '+viewport.name);
        assert.equal(pageAudit.detailsHeaderLeft,0,'cabecalho de detalhes deve ocupar a largura toda em '+viewport.name);
      }
      if (pageAudit.path==='/player-animes.html' && viewport.width<=390) {
        assert.ok(pageAudit.castBounds.top>=0 && pageAudit.castBounds.bottom<=viewport.height,
          'modal Cast deve caber na altura do celular '+viewport.name);
        assert.ok(pageAudit.castBounds.left>=0 && pageAudit.castBounds.right<=viewport.width,
          'modal Cast deve caber na largura do celular '+viewport.name);
        assert.equal(pageAudit.castBounds.hit,true,'modal Cast deve permanecer clicável acima do vídeo em '+viewport.name);
      }
      if (pageAudit.expandedOverflow!==null) {
        assert.ok(pageAudit.expandedOverflow<=1,page+' forms nao podem criar rolagem horizontal em '+viewport.name);
        assert.deepEqual(pageAudit.expandedOutliers,[],page+' controles devem caber em '+viewport.name);
      }
    }
  }
  const navigationAudit=[];
  async function assertRoute(client,pathname,tab){
    let state;
    for(let attempt=0;attempt<120;attempt++){
      const result=await client.send('Runtime.evaluate',{returnByValue:true,expression:`({path:location.pathname,search:location.search,ready:document.readyState,boot:document.documentElement.getAttribute('data-rh-boot'),tab:document.querySelector('[data-tab].active')?.dataset.tab})`});
      state=result.result.value;
      if(state&&state.path===pathname&&state.ready==='complete'&&state.boot==='ready'&&(!tab||state.tab===tab))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(state.path,pathname);assert.equal(state.boot,'ready');
    if(tab){assert.equal(state.tab,tab);assert.equal(new URLSearchParams(state.search).get('tab')||'home',tab);}
    return state;
  }
  async function clickTab(tab){
    await cdp.send('Runtime.evaluate',{expression:`document.querySelector('[data-tab="${tab}"]').click()`});
    return assertRoute(cdp,'/index.html',tab);
  }
  async function reloadPage(){
    await cdp.send('Runtime.evaluate',{expression:'window.__navigationBeforeReload=true'});
    await cdp.send('Page.reload',{ignoreCache:true});
    for(let attempt=0;attempt<120;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:'!window.__navigationBeforeReload'});
      if(result.result.value)return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Reload não criou um novo documento');
  }
  await cdp.send('Page.navigate',{url:origin+'/index.html?tab=perfil'});
  await assertRoute(cdp,'/index.html','perfil');
  await clickTab('home');
  await reloadPage();
  navigationAudit.push({case:'Perfil → Home → atualizar',state:await assertRoute(cdp,'/index.html','home')});
  await clickTab('perfil');await clickTab('home');
  navigationAudit.push({case:'Home → Perfil → Home',state:await assertRoute(cdp,'/index.html','home')});
  await cdp.send('Page.navigate',{url:origin+'/detalhes.html?anime=navigation-test'});
  await assertRoute(cdp,'/detalhes.html');
  const playerUrl=origin+'/player-animes.html?anime=navigation-test&ep=1&season=2';
  await cdp.send('Page.navigate',{url:playerUrl});
  await assertRoute(cdp,'/player-animes.html');
  await reloadPage();
  const playerState=await assertRoute(cdp,'/player-animes.html');
  assert.equal(playerState.search,new URL(playerUrl).search);
  navigationAudit.push({case:'Player → atualizar (episódio preservado)',state:playerState});
  await cdp.send('Runtime.evaluate',{expression:`document.querySelector('a[href="index.html?tab=perfil"]').click()`});
  navigationAudit.push({case:'Home → Anime → Player → Perfil',state:await assertRoute(cdp,'/index.html','perfil')});
  await clickTab('home');
  await cdp.send('Runtime.evaluate',{expression:'history.back()'});
  await assertRoute(cdp,'/index.html','perfil');
  await cdp.send('Runtime.evaluate',{expression:'history.forward()'});
  await assertRoute(cdp,'/index.html','home');

  const adminFixture=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    if(location.pathname==='/admin.html'){
      const denied=location.search.includes('test-deny'),permission=location.search.includes('test-permission');
      const user={uid:'test-admin',email:'admin@example.test',emailVerified:true,displayName:'Admin teste',
        reload:async()=>{},getIdToken:async()=> 'fixture',getIdTokenResult:async()=>({token:'fixture',claims:{email_verified:true}})};
      const authObject={currentUser:user,onAuthStateChanged:fn=>{setTimeout(()=>fn(user),20);return ()=>{};}};
      const auth=()=>authObject;
      const ref=(path='')=>({on(event,callback){if(event==='value'&&(path==='dk_broadcast/config'||path==='.info/connected'))setTimeout(()=>{const data=JSON.parse(localStorage.getItem('admin-fixture-database'));callback({val:()=>path==='.info/connected'?true:data.dk_broadcast.config,forEach(){}});},0);},off(){},once:async()=>({val:()=>null,forEach(){}}),transaction:async()=>({committed:false}),set:async()=>{},update:async()=>{},child:part=>ref([path,part].filter(Boolean).join('/')),orderByChild:()=>ref(path),limitToLast:()=>ref(path)});
      const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
      window.firebase={apps:[{}],auth,database,initializeApp(){}};
      const fixtureKey='admin-fixture-database';
      if(!localStorage.getItem(fixtureKey))localStorage.setItem(fixtureKey,JSON.stringify({users:{'test-admin':{uid:'test-admin',displayName:'Admin teste'}},dk_broadcast:{config:{forcedTheme:'blue',preserved:'keep'},homeFeatured:{version:2,managed:true,sections:{}}}}));
      const originalFetch=window.fetch;
      window.fetch=(url,options)=>{
        if(String(url).includes('firebaseio.com')){
          if(permission)return Promise.resolve(new Response(JSON.stringify({error:'Permission denied'}),{status:403}));
          const parts=new URL(url).pathname.replace(/\\.json$/,'').split('/').filter(Boolean).map(decodeURIComponent);
          if(parts[0]==='admins')return Promise.resolve(new Response(JSON.stringify(!denied),{headers:{ETag:'"fixture"'}}));
          const data=JSON.parse(localStorage.getItem(fixtureKey));
          const method=options&&options.method||'GET';
          const put=(keys,value)=>{const last=keys.pop();let parent=data;keys.forEach(key=>{parent[key]??={};parent=parent[key];});if(value===null)delete parent[last];else parent[last]=value;};
          if(method==='PATCH')Object.entries(JSON.parse(options.body)).forEach(([key,value])=>put(parts.concat(key.split('/')),value));
          if(method==='PUT')put([...parts],JSON.parse(options.body));
          if(method==='DELETE')put([...parts],null);
          if(method!=='GET')localStorage.setItem(fixtureKey,JSON.stringify(data));
          const value=parts.reduce((node,key)=>node&&node[key],data)??null;
          return Promise.resolve(new Response(JSON.stringify(value),{headers:{ETag:'"fixture"'}}));
        }
        return originalFetch(url,options);
      };
    }
  `});
  for(const mode of ['test-admin','test-deny','test-permission']){
    await cdp.send('Page.navigate',{url:origin+'/admin.html?'+mode});
    let status;
    for(let attempt=0;attempt<120;attempt++){
      const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`({search:location.search,opened:document.getElementById('adminApp')?.getAttribute('data-opened')==='1',denied:document.getElementById('gateAction')?.style.display==='inline-flex',text:document.getElementById('gateText')?.textContent})`});
      status=result.result.value;
      if(status&&status.search==='?'+mode&&(status.opened||status.denied))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(status.opened,mode==='test-admin',JSON.stringify(status));
    if(mode!=='test-admin')assert.equal(status.denied,true);
    navigationAudit.push({case:'Admin '+mode+' (Firebase simulado)',state:status});
    if(mode==='test-admin'){
      const saved=await cdp.send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
        for(let i=0;i<100&&!document.getElementById('overviewConnectionText').textContent.includes('Conectado ao Firebase');i++)await new Promise(r=>setTimeout(r,50));
        document.getElementById('forcedTheme').value='green';document.getElementById('saveSettings').click();
        for(let i=0;i<100;i++){
          const data=JSON.parse(localStorage.getItem('admin-fixture-database'));
          if(data.dk_broadcast.config.forcedTheme==='green')return data.dk_broadcast.config;
          await new Promise(r=>setTimeout(r,50));
        }
        throw new Error('Configuração não foi gravada pelo painel');
      })()`});
      assert.equal(saved.result.value?.forcedTheme,'green',JSON.stringify(saved));
      assert.equal(saved.result.value.preserved,'keep');
      await reloadPage();
      let restored;
      for(let attempt=0;attempt<120;attempt++){
        const result=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`document.getElementById('forcedTheme')?.value`});
        restored=result.result.value;if(restored==='green')break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(restored,'green');
      navigationAudit.push({case:'Admin salva configuração e relê após reload (Firebase simulado)',value:restored});
    }
  }
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:adminFixture.identifier});

  // Force the original race: select Home before delayed preferences resolve.
  await cdp.send('Network.setBlockedURLs',{urls:['*gstatic.com*','*auth-guard.js*','*user-session.js*','*meusanimes.blog*','*jsdelivr.net*','*user-features.js*']});
  const delayed=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.RabbitHubFeatures={ready:()=>new Promise(resolve=>setTimeout(resolve,1500)),filterAnimeList:items=>items,getPreferences:()=>({})};`});
  await cdp.send('Page.navigate',{url:origin+'/index.html?tab=perfil&slow-preferences=1'});
  for(let i=0;i<100;i++){
    const ready=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`document.readyState==='complete'&&location.search.includes('slow-preferences')`});
    if(ready.result.value)break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  await clickTab('home');
  await new Promise(resolve=>setTimeout(resolve,1800));
  navigationAudit.push({case:'Home escolhida antes das preferências tardias',state:await assertRoute(cdp,'/index.html','home')});
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:delayed.identifier});
  await cdp.send('Network.setBlockedURLs',{urls:['*gstatic.com*','*auth-guard.js*','*user-session.js*','*meusanimes.blog*','*jsdelivr.net*']});

  // Close and reopen a tab in the same isolated browser profile.
  const reopened=await browserCdp.send('Target.createTarget',{url:'about:blank'});
  const newSession=await browserCdp.send('Target.attachToTarget',{targetId:reopened.targetId,flatten:true});
  const newClient={send:(method,params={})=>browserCdp.send(method,params,newSession.sessionId)};
  await newClient.send('Page.enable');await newClient.send('Network.enable');
  await newClient.send('Network.setBlockedURLs',{urls:['*gstatic.com*','*auth-guard.js*','*user-session.js*','*meusanimes.blog*','*jsdelivr.net*']});
  await newClient.send('Page.addScriptToEvaluateOnNewDocument',{source:sessionFixture});
  await browserCdp.send('Target.closeTarget',{targetId:createdTarget.targetId});
  await newClient.send('Page.navigate',{url:playerUrl});
  navigationAudit.push({case:'Fechar aba e reabrir Player (sessão simulada)',state:await assertRoute(newClient,'/player-animes.html')});
  console.log(JSON.stringify({navigationAudit},null,2));
  console.log(JSON.stringify({responsiveAudit},null,2));
  // As telas legadas de afiliados dependem do SDK remoto, bloqueado por esta fixture offline.
  const unexpectedRuntimeErrors=runtimeErrors.filter(error=>{
    const description=error.exception&&error.exception.description||'';
    return !(/\/(affiliate-dashboard|simulator-admin)\.js$/.test(error.url||'') &&
      description.startsWith('ReferenceError: firebase is not defined'));
  });
  fs.writeFileSync(path.join(projectRoot,'.cache','ui-regression','runtime-errors.json'),JSON.stringify(unexpectedRuntimeErrors,null,2));
  assert.equal(unexpectedRuntimeErrors.length,0,'nenhuma exceção JavaScript não tratada; ver runtime-errors.json');
  console.log(JSON.stringify({ screenshots:[mobileConfigScreenshot,mobileAccountScreenshot,mobileSupportScreenshot,desktopSupportScreenshot] }, null, 2));
  }
} finally {
  if(browserClient&&browser&&browser.exitCode===null){
    try{await Promise.race([browserClient.send('Browser.close'),new Promise(resolve=>setTimeout(resolve,2500))]);}catch(ignored){}
  }
  if (browser && browser.exitCode === null) {
    browser.kill();
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2500))
    ]);
  }
  if (appServer && appServer.exitCode === null) {
    appServer.kill();
    await Promise.race([
      new Promise((resolve) => appServer.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2500))
    ]);
  }
  const cleanupPath=path.resolve(profileDir);
  assert.equal(path.dirname(cleanupPath),path.resolve(os.tmpdir()),'limpeza restrita ao diretório temporário');
  assert.ok(path.basename(cleanupPath).startsWith('rabbithub-ui-'),'limpeza restrita ao perfil criado pelo teste');
  try{fs.rmSync(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });}
  catch(error){if(!['EPERM','EBUSY','ENOTEMPTY'].includes(error.code))throw error;console.warn('Perfil temporário ainda bloqueado pelo Chromium; preservado em '+cleanupPath);}
}
