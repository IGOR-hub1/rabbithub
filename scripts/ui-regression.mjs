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
  for (let attempt = 0; attempt < 50; attempt++) {
    const evaluation = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `Boolean(document.getElementById('drawer') && document.getElementById('open-drawer') && window.RabbitHubDropdowns && window.DK_setTheme)`
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
  const createdTarget = await browserCdp.send('Target.createTarget', { url: origin + '/index.html' });
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

  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', {
    urls: ['*gstatic.com*', '*auth-guard.js*', '*user-session.js*', '*meusanimes.blog*', '*jsdelivr.net*']
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.RabbitHubSession={
        get:()=>({status:'authenticated',ready:true,uid:'ui-test',authUser:null,account:{uid:'ui-test',plan:'VIP',premium:true,profiles:[{id:'principal',name:'Teste',avatar:'',theme:'red'}]},profile:{id:'principal',name:'Teste',avatar:'',theme:'red'}}),
        subscribe:(callback)=>{setTimeout(()=>callback(window.RabbitHubSession.get()),0);return ()=>{};},
        ready:()=>Promise.resolve(window.RabbitHubSession.get())
      };
      window.addEventListener('load',()=>document.dispatchEvent(new CustomEvent('dk:userready',{detail:{uid:'ui-test'}})),{once:true});
      localStorage.setItem('rh_drawer_mode','fixed');
      localStorage.setItem('dk_theme_color','red');
      localStorage.setItem('dk_session',JSON.stringify({uid:'ui-test',displayName:'Teste',profileAvatar:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3Crect width=%221%22 height=%221%22 fill=%22red%22/%3E%3C/svg%3E'}));
      localStorage.setItem('dk_active_profile',JSON.stringify({id:'principal',name:'Teste',avatar:''}));
    `
  });
  await cdp.send('Page.navigate', { url: origin + '/index.html?ui-regression=1' });
  await waitForPage(cdp);

  const evaluation = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      localStorage.setItem('dk_session',JSON.stringify({uid:'ui-test',displayName:'Teste',profileAvatar:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3Crect width=%221%22 height=%221%22 fill=%22red%22/%3E%3C/svg%3E'}));
      localStorage.setItem('dk_active_profile',JSON.stringify({id:'principal',name:'Teste',avatar:''}));
      RabbitHubAccount.refresh();
      DK_setTheme('blue',false,{system:true});
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

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
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

  const accountEvaluation = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async function(){
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rect=(element)=>{const value=element.getBoundingClientRect();return {top:value.top,right:value.right,bottom:value.bottom,left:value.left,width:value.width,height:value.height};};
      document.getElementById('yc-config-close').click();
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
        headerDisplay:getComputedStyle(sheetHeader).display,closeDisplay:getComputedStyle(closeButton).display,
        bodyBorderRadius:parseFloat(getComputedStyle(sheetBody).borderRadius),
        dialogOpen:document.body.classList.contains('rh-dialog-open'),
        horizontalOverflow:sheetBody.scrollWidth-sheetBody.clientWidth,
        bodyOverflowY:getComputedStyle(sheetBody).overflowY
      };
    }())`
  });
  const account = accountEvaluation.result.value;
  console.log(JSON.stringify({ account }, null, 2));
  assert.equal(account.kind, 'conta');
  assert.equal(account.plan, 'VIP', 'conta deve exibir o VIP confirmado mesmo com aliases antigos vencidos');
  assert.equal(account.headerDisplay, 'none');
  assert.equal(account.closeDisplay, 'grid');
  assert.equal(account.dialogOpen, true);
  assert.ok(account.body.left > account.sheet.left && account.body.right < account.sheet.right, 'dialogo de conta deve flutuar com margem lateral');
  assert.ok(account.body.top > account.sheet.top && account.body.bottom < account.sheet.bottom, 'dialogo de conta deve flutuar com margem vertical');
  assert.ok(account.bodyBorderRadius >= 20, 'dialogo de conta deve manter cantos arredondados');
  assert.ok(account.horizontalOverflow <= 1, 'conta nao deve ter rolagem horizontal');
  assert.equal(account.bodyOverflowY, 'auto');
  const mobileAccountScreenshot = await captureScreenshot(cdp, 'mobile-account');

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

  async function auditResponsivePage(relativeUrl, viewport) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile
    });
    await cdp.send('Page.navigate', { url: origin + relativeUrl });
    for (let attempt = 0; attempt < 40; attempt++) {
      const state = await cdp.send('Runtime.evaluate', { returnByValue:true, expression:'document.readyState' });
      if (state.result.value !== 'loading') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 220));
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
          headerTitleCenterDelta:innerRect&&titleRect?Math.round(Math.abs((titleRect.left+titleRect.width/2)-(innerRect.left+innerRect.width/2))):null
        };
      }())`
    });
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
    '/admin.html?layout-audit=1'
  ];
  const responsiveAudit=[];
  for (const viewport of [
    {name:'small-mobile',width:320,height:568,mobile:true},
    {name:'mobile',width:390,height:844,mobile:true},
    {name:'tablet',width:768,height:1024,mobile:true},
    {name:'laptop',width:1366,height:768,mobile:false},
    {name:'full-hd',width:1920,height:1080,mobile:false},
    {name:'tv-4k',width:3840,height:2160,mobile:false}
  ]) {
    for (const page of pagesToAudit) {
      const pageAudit=await auditResponsivePage(page,viewport);
      pageAudit.mode=viewport.name;
      responsiveAudit.push(pageAudit);
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
    }
  }
  console.log(JSON.stringify({responsiveAudit},null,2));
  console.log(JSON.stringify({ screenshots:[mobileConfigScreenshot,mobileAccountScreenshot,mobileSupportScreenshot,desktopSupportScreenshot] }, null, 2));
  cdp.close();
} finally {
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
  fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
