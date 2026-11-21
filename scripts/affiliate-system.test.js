'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const vm=require('node:vm');
const {createService,WINDOW}=require('../lib/affiliate-service');
const {createStore}=require('../lib/affiliate-store');

test('REST Firebase separa leitura de ETag e escrita condicional',async()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const calls=[];
  const store=createStore({account:{project_id:'animes-64408',client_email:'test@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})},databaseURL:'https://animes-64408-default-rtdb.firebaseio.com',fetch:async(url,init)=>{
    calls.push({url,init});
    if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'token',expires_in:3600})};
    return {ok:true,status:200,headers:{get:key=>key==='etag'?'"v1"':null},json:async()=>({ok:true})};
  }});
  await store.request('simulationFlows/test','GET',undefined,true);
  await store.request('simulationFlows/test','PUT',{isSimulation:true},'"v1"');
  assert.equal(calls[1].init.headers['X-Firebase-ETag'],'true');
  assert.equal(calls[1].init.headers['if-match'],undefined);
  assert.equal(calls[2].init.headers['if-match'],'"v1"');
});

test('credencial e URL do Realtime Database devem pertencer ao projeto configurado',()=>{
  const account={project_id:'animes-64408',client_email:'test@example.invalid',private_key:'test'};
  assert.throws(()=>createStore({account:{...account,project_id:'outro-projeto'}}),{statusCode:503});
  assert.throws(()=>createStore({account,databaseURL:'http://animes-64408-default-rtdb.firebaseio.com'}),{statusCode:503});
  assert.throws(()=>createStore({account,databaseURL:'https://outro-projeto-default-rtdb.firebaseio.com'}),{statusCode:503});
  assert.doesNotThrow(()=>createStore({account,databaseURL:'https://animes-64408-default-rtdb.firebaseio.com'}));
  const previous=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {process.env.FIREBASE_SERVICE_ACCOUNT_JSON='{';assert.throws(()=>createStore(),{statusCode:503});}
  finally {if(previous===undefined)delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;else process.env.FIREBASE_SERVICE_ACCOUNT_JSON=previous;}
});

test('entrada Vercel roteia afiliados sem abrir porta local',async()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json'),'utf8'));
  assert.equal(config.framework,null);
  assert.equal(config.buildCommand,'node scripts/verify-affiliate-deploy.mjs');
  assert.equal(config.outputDirectory,'public');
  assert.ok(config.functions['api/affiliates.mjs']);
  assert.ok(config.rewrites.some(item=>item.source==='/api/affiliates/:action'&&item.destination==='/api/affiliates?action=:action'));
  const {default:handler}=await import('../api/affiliates.mjs');
  assert.equal(typeof handler,'function');
  const request={url:'/api/affiliates?action=../bad'},response={statusCode:200,end(value){this.body=value;}};
  handler(request,response);assert.equal(response.statusCode,404);
  const local=http.createServer(handler);
  await new Promise(resolve=>local.listen(0,'127.0.0.1',resolve));
  try{
    const result=await fetch('http://127.0.0.1:'+local.address().port+'/api/affiliates?action=report',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(result.status,401);
    const unauthenticated=await fetch('http://127.0.0.1:'+local.address().port+'/api/affiliates?action=adminData');
    assert.equal(unauthenticated.status,401);
    assert.match(unauthenticated.headers.get('content-type')||'',/application\/json/);
    assert.match((await unauthenticated.json()).error,/Autenticação obrigatória/);
  }finally{await new Promise(resolve=>local.close(resolve));}
  const parsed=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;req.body=JSON.parse(body);handler(req,res);});
  await new Promise(resolve=>parsed.listen(0,'127.0.0.1',resolve));
  try{
    const result=await fetch('http://127.0.0.1:'+parsed.address().port+'/api/affiliates?action=report',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(result.status,401);
  }finally{await new Promise(resolve=>parsed.close(resolve));}
});

test('painel antigo encerra Verificando acesso quando Firebase falha ou não responde',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/partners.js'),'utf8');
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:id==='status'?'Verificando acesso...':'',hidden:true,addEventListener(){}});return elements.get(id);}};
  vm.runInNewContext(source,{document,window:{}});
  assert.match(document.getElementById('status').textContent,/Firebase Authentication indisponível/);
  document.getElementById('status').textContent='Verificando acesso...';
  let watchdog;
  const firebase={initializeApp(){},auth(){return {onAuthStateChanged(){}}}};
  vm.runInNewContext(source,{document,window:{firebase,DK_FIREBASE_CONFIG:{}},setTimeout(callback){watchdog=callback;return 1;},clearTimeout(){}});
  assert.equal(typeof watchdog,'function');
  watchdog();
  assert.match(document.getElementById('status').textContent,/autenticação não respondeu/);
});

function fixture(allowFinance=true){
  const data={admins:{admin:true},users:{partner:{uid:'partner',plan:'Free'},partner2:{uid:'partner2',plan:'Free'},member:{uid:'member',plan:'VIP',premium:true,vip:true,planUpdatedAt:12345}}};
  const store={async request(path,method='GET',value,etag){const parts=path.split('/');let node=data;
    if(path===''&&method==='PATCH'){for(const [subpath,item] of Object.entries(value)){const keys=subpath.split('/');let target=data;for(const part of keys.slice(0,-1))target=target[part]??(target[part]={});target[keys.at(-1)]=item;}return {value};}
    for(const key of parts.slice(0,-1))node=node[key]??(node[key]={});const key=parts.at(-1);
    if(method==='GET')return {value:node[key]??null,etag:node[key]==null?'null_etag':'"mock-etag"'};
    if(etag==='null_etag'&&node[key]!=null)return {conflict:true};
    node[key]=value;return {value};
  }};
  let time=1700000000000;
  const verify=async req=>({sub:req.uid});
  let serial=0;
  const service=createService({store,verify,now:()=>time,random:()=> String(++serial).padStart(24,'a'),lookup:async()=>time+1000,testOnlyAllowFinancialOperations:allowFinance});
  return {data,service,setTime:value=>{time=value;},time};
}

test('sem gateway validado não aceita compra, comissão, saque ou aprovação real',async()=>{
  const {data,service}=fixture(false);
  data.partners={partner:{uid:'partner',label:'Canal',status:'approved'}};
  data.referrals={member:{uid:'member',partnerUid:'partner',code:'ABCDEF'}};
  data.affiliateSettings={payoutsEnabled:true,currency:'BRL'};
  data.commissions={one:{partnerUid:'partner',status:'pending',amount:5}};
  await assert.rejects(service.recordPurchase({uid:'admin'},{uid:'member',amount:30,status:'confirmed'}),{statusCode:503});
  await assert.rejects(service.settle({uid:'admin'},{kind:'signup',id:'member'}),{statusCode:503});
  await assert.rejects(service.payout({uid:'partner'},{amount:5}),{statusCode:503});
  await assert.rejects(service.financialAction({uid:'admin'},{kind:'commission',id:'one',status:'approved'}),{statusCode:503});
  await assert.rejects(service.settings({uid:'admin'},{payoutsEnabled:true}),{statusCode:503});
  assert.equal(data.conversions,undefined);
  assert.equal(data.payouts,undefined);
  assert.equal((await service.adminData({uid:'admin'})).financialOperationsAvailable,false);
});

test('admin cria, aprova, gera link; parceiro suspenso não atribui clique',async()=>{
  const {data,service}=fixture();
  await assert.rejects(service.create({uid:'member'},{uid:'partner',label:'Canal'}),{statusCode:403});
  await service.create({uid:'admin'},{uid:'partner',label:'Canal'});
  await assert.rejects(service.link({uid:'admin'},{uid:'partner'}),{statusCode:403});
  await service.status({uid:'admin'},{uid:'partner',status:'approved'});
  const link=await service.link({uid:'admin'},{uid:'partner'});
  assert.match(link.code,/^[A-Z0-9]{6,20}$/);
  await service.status({uid:'admin'},{uid:'partner',status:'suspended'});
  await assert.rejects(service.click({code:link.code},'v'.repeat(24)),{statusCode:404});
  assert.equal(data.partners.partner.status,'suspended');
});

test('admin registra compras, calcula comissão e audita transições financeiras',async()=>{
  const {data,service}=fixture();
  data.partners={partner:{uid:'partner',label:'Canal',status:'approved'}};
  data.referrals={member:{uid:'member',partnerUid:'partner',code:'ABCDEF',registeredAt:100}};
  data.affiliateSettings={percent:10,fixedSignup:2,budget:50,currency:'BRL'};
  await assert.rejects(service.recordPurchase({uid:'partner'},{uid:'member',amount:30,status:'confirmed'}),{statusCode:403});
  await assert.rejects(service.adminData({uid:'partner'}),{statusCode:403});
  const purchase=await service.recordPurchase({uid:'admin'},{uid:'member',amount:30,status:'confirmed',plan:'VIP'});
  const commission=await service.settle({uid:'admin'},{kind:'purchase',id:purchase.id});
  assert.equal(commission.record.amount,3);
  await assert.rejects(service.settle({uid:'admin'},{kind:'purchase',id:purchase.id}),{statusCode:409});
  await assert.rejects(service.financialAction({uid:'partner'},{kind:'commission',id:commission.id,status:'approved'}),{statusCode:403});
  await service.financialAction({uid:'admin'},{kind:'commission',id:commission.id,status:'approved'});
  assert.equal(data.commissions[commission.id].status,'approved');
  assert.ok(Object.values(data.affiliateAudit).some(item=>item.action==='commission.approved'));
  const panel=await service.adminData({uid:'admin'});assert.equal(panel.conversions[purchase.id].status,'confirmed');
});

test('simulador separa compras aprovadas, pendentes, recusadas e estornadas',async()=>{
  const {data,service}=fixture();data.partners={partner:{uid:'partner',label:'Canal',status:'approved'}};
  data.referralLinks={ABCDEF:{code:'ABCDEF',partnerUid:'partner',campaign:'Teste',active:true}};
  data.affiliateSettings={simulationEnabled:true,percent:10,currency:'BRL'};
  const beforeUser=JSON.stringify(data.users.member);
  await assert.rejects(service.simulationStart({uid:'partner'},{uid:'member',code:'ABCDEF'}),{statusCode:403});
  await assert.rejects(service.simulationStart({uid:'admin'},{uid:'member',code:'ABCDEF'}),{statusCode:404});
  await service.simulationTestAccount({uid:'admin'},{uid:'member',enabled:true});
  assert.equal((await service.simulationUsers({uid:'admin'})).users[0].uid,'member');
  const start=async()=> (await service.simulationStart({uid:'admin'},{uid:'member',code:'ABCDEF'})).flow.id;
  const approvedId=await start(),pendingId=await start(),declinedId=await start();
  const purchase=(flowId,status,requestId,plan='VIP')=>service.simulationPurchase({uid:'admin'},{flowId,plan,amount:50,status,requestId});
  const approved=await purchase(approvedId,'approved','request_approved');assert.equal(approved.flow.commission.amount,5);
  assert.equal((await purchase(approvedId,'approved','request_approved')).idempotent,true);
  await purchase(pendingId,'pending','request_pending','Plus');assert.equal(data.simulationFlows[pendingId].commission.amount,0);
  assert.equal((await purchase(pendingId,'approved','request_plus_approved','Plus')).flow.commission.amount,5);
  await purchase(declinedId,'declined','request_declined');assert.equal(data.simulationFlows[declinedId].commission.amount,0);
  const reversed=await purchase(approvedId,'reversed','request_reversed');assert.equal(reversed.flow.commission.amount,0);assert.equal(reversed.flow.commission.calculatedAmount,5);
  await assert.rejects(purchase(declinedId,'approved','request_retry'),{statusCode:409});
  assert.equal(JSON.stringify(data.users.member),beforeUser);assert.equal(data.conversions,undefined);assert.equal(data.commissions,undefined);assert.equal(data.payouts,undefined);
  const report=await service.report({uid:'partner'},{});assert.equal(report.simulations.length,3);assert.equal(report.conversions.length,0);
  await assert.rejects(service.simulationClear({uid:'partner'},{confirmation:'LIMPAR SIMULACOES'}),{statusCode:403});
  await assert.rejects(service.simulationClear({uid:'admin'},{confirmation:'wrong'}),{statusCode:400});
  assert.equal((await service.simulationClear({uid:'admin'},{confirmation:'LIMPAR SIMULACOES'})).removed,3);
  assert.equal(data.simulationFlows,null);
});

test('interfaces distinguem resultados reais e simulados e exigem confirmação de limpeza',()=>{
  const root=path.join(__dirname,'../public');
  const admin=fs.readFileSync(path.join(root,'affiliates-admin.html'),'utf8');
  const adminScript=fs.readFileSync(path.join(root,'affiliates-admin.js'),'utf8');
  const partner=fs.readFileSync(path.join(root,'affiliate.html'),'utf8');
  const simulator=fs.readFileSync(path.join(root,'simulator-admin.html'),'utf8');
  const script=fs.readFileSync(path.join(root,'simulator-admin.js'),'utf8');
  assert.match(admin,/data-tab="simulator"/);assert.match(admin,/name="simulationEnabled"/);
  for(const id of ['overview-source','event-source','finance-source'])assert.match(admin,new RegExp('id="'+id+'"'));
  assert.match(partner,/id="data-mode"/);assert.match(simulator,/id="test-user"/);assert.match(simulator,/id="test-link"/);
  assert.match(script,/LIMPAR SIMULACOES/);
  assert.match(adminScript,/afiliados-simulacoes\.csv/);
  for(const file of ['affiliates-admin.js','simulator-admin.js','affiliate-dashboard.js','partners.js','affiliate-referral.js']){
    assert.match(fs.readFileSync(path.join(root,file),'utf8'),/API de afiliados indisponível nesta origem/,file);
  }
});

test('configuração global e validade encerram a captura',async()=>{
  const {data,service,time,setTime}=fixture();
  data.partners={partner:{uid:'partner',label:'Canal',status:'approved'}};
  const link=await service.link({uid:'admin'},{uid:'partner',campaign:'Vídeos',expiresAt:time+86400000});
  setTime(time+86400001);
  await assert.rejects(service.click({code:link.code},'v'.repeat(24)),{statusCode:404});
  data.affiliateSettings={enabled:false};
  await assert.rejects(service.click({code:link.code},'v'.repeat(24)),{statusCode:403});
});

test('campanha pode ser desativada e orçamento limita comissões',async()=>{
  const {data,service}=fixture();data.partners={partner:{uid:'partner',label:'Canal',status:'approved'}};
  data.referrals={member:{uid:'member',partnerUid:'partner',code:'ABCDEF',registeredAt:100}};
  data.affiliateSettings={fixedSignup:5,budget:4};
  await assert.rejects(service.settle({uid:'admin'},{kind:'signup',id:'member'}),{statusCode:409});
  data.affiliateSettings.budget=10;
  const result=await service.settle({uid:'admin'},{kind:'signup',id:'member'});
  assert.equal(data.commissionBudgetUsage.partner,5);
  await service.financialAction({uid:'admin'},{kind:'commission',id:result.id,status:'rejected'});
  assert.equal(data.commissionBudgetUsage.partner,0);
  const link=await service.link({uid:'admin'},{uid:'partner',campaign:'Promo'});
  await service.campaignUpdate({uid:'admin'},{uid:'partner',campaign:'Promo'});
  assert.equal(data.referralLinks[link.code].active,false);
  assert.ok(Object.values(data.affiliateAudit).some(x=>x.action==='campaign.disable'));
});

test('atribuição aceita último clique válido antes do cadastro e não pode ser substituída',async()=>{
  const {data,service,time,setTime}=fixture();
  await service.create({uid:'admin'},{uid:'partner',label:'Canal'});
  await service.status({uid:'admin'},{uid:'partner',status:'approved'});
  await service.create({uid:'admin'},{uid:'partner2',label:'Outro canal'});
  await service.status({uid:'admin'},{uid:'partner2',status:'approved'});
  const link=await service.link({uid:'admin'},{uid:'partner'}),secondLink=await service.link({uid:'admin'},{uid:'partner2'});
  const click=await service.click({code:link.code},'v'.repeat(24));
  setTime(time+1);
  const lastClick=await service.click({code:secondLink.code},'v'.repeat(24));
  const memberRequest={uid:'member',headers:{authorization:'Bearer test',cookie:'rh_aff_visitor='+'v'.repeat(24)}};
  await assert.rejects(service.claim({uid:'member',headers:{authorization:'Bearer test'}},{clickId:click.clickId}),{statusCode:403});
  assert.equal((await service.claim(memberRequest,{clickId:click.clickId})).attributed,true);
  assert.equal((await service.claim(memberRequest,{clickId:lastClick.clickId})).attributed,false);
  assert.equal(data.referrals.member.partnerUid,'partner2');
  setTime(time+WINDOW+1);
  await assert.rejects(service.claim({uid:'other',headers:{authorization:'Bearer test',cookie:'rh_aff_visitor='+'v'.repeat(24)}},{clickId:click.clickId}),{statusCode:409});
  const conversion=await service.conversion({uid:'admin'},{uid:'member'});
  assert.equal(conversion.created,true);
  assert.equal((await service.conversion({uid:'admin'},{uid:'member'})).created,false);
  assert.equal(data.conversions.member_12345.partnerUid,'partner2');
});

test('Firebase nega gravações diretas e Firestore permanece fechado',()=>{
  const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../API ANIMES E CHAT/database.rules.json'),'utf8')).rules;
  for(const name of ['partners','referralLinks','referralClicks','referralVisitorClicks','referrals','conversions','commissions','payouts','payoutReservations','affiliateSettings','affiliateAudit','partnerCommissionRules','commissionBudgetUsage','simulationFlows','affiliateTestAccounts']){
    assert.equal((rules[name].$uid||rules[name])['.write'],false,name);
  }
  assert.match(fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8'),/allow read, write: if false/);
});

test('relatório mostra somente dados do parceiro e remove identidade dos indicados',async()=>{
  const {data,service}=fixture();
  data.partners={partner:{uid:'partner',label:'Canal',status:'approved'},partner2:{uid:'partner2',label:'Outro',status:'approved'}};
  data.referralLinks={ABCDEF:{code:'ABCDEF',partnerUid:'partner',campaign:'Vídeos'},GHIJKL:{code:'GHIJKL',partnerUid:'partner2'}};
  data.referralClicks={one:{code:'ABCDEF',partnerUid:'partner',visitorId:'v'.repeat(24),at:100},two:{code:'GHIJKL',partnerUid:'partner2',visitorId:'w'.repeat(24),at:110}};
  data.referrals={member:{uid:'member',partnerUid:'partner',code:'ABCDEF',registeredAt:120,email:'secret@example.com'},other:{uid:'other',partnerUid:'partner2',code:'GHIJKL',registeredAt:130}};
  data.conversions={event:{uid:'member',partnerUid:'partner',code:'ABCDEF',at:140,plan:'VIP',amount:25}};
  data.commissions={commission:{partnerUid:'partner',code:'ABCDEF',at:150,status:'approved',amount:5}};
  data.affiliateSettings={allowPartnerLinks:false,payoutsEnabled:false,currency:'BRL'};
  const report=await service.report({uid:'partner'},{});
  assert.equal(report.clicks.length,1);assert.equal(report.links[0].campaign,'Vídeos');
  assert.equal(report.uniqueVisitorsEstimated,1);assert.equal(report.linkUniqueVisitors.ABCDEF,1);
  assert.equal(report.referrals.length,1);assert.equal(report.conversions[0].amount,25);
  assert.doesNotMatch(JSON.stringify(report),/member|secret@example|partner2|[vw]{24}/);
  await assert.rejects(service.report({uid:'member'},{}),{statusCode:403});
  await assert.rejects(service.myLink({uid:'partner'},{campaign:'Canal'}),{statusCode:403});
  await assert.rejects(service.payout({uid:'partner'},{amount:5}),{statusCode:403});
  const adminView=await service.report({uid:'admin'},{uid:'partner'});
  assert.equal(adminView.adminView,true);
});

test('saque respeita configuração e reserva apenas saldo aprovado',async()=>{
  const {data,service}=fixture();
  data.partners={partner:{uid:'partner',label:'Canal',status:'approved'}};
  data.affiliateSettings={payoutsEnabled:true,minPayout:5,currency:'BRL'};
  data.commissions={one:{partnerUid:'partner',status:'approved',amount:10,at:1},two:{partnerUid:'partner',status:'pending',amount:100,at:2}};
  await assert.rejects(service.payout({uid:'partner'},{amount:4}),{statusCode:400});
  const request=await service.payout({uid:'partner'},{amount:7});assert.equal(request.status,'requested');
  await assert.rejects(service.payout({uid:'partner'},{amount:5}),{statusCode:409});
  assert.equal(data.payoutReservations.partner,7);
});

test('somente admin altera regras e habilita links adicionais',async()=>{
  const {data,service}=fixture();
  data.partners={partner:{uid:'partner',label:'Canal',status:'approved'}};
  await assert.rejects(service.settings({uid:'partner'},{read:true}),{statusCode:403});
  await service.settings({uid:'admin'},{allowPartnerLinks:true,payoutsEnabled:false,minPayout:20,currency:'BRL',commissionDescription:'Aprovação manual.'});
  const link=await service.myLink({uid:'partner'},{campaign:'Vídeos'});
  assert.equal(link.campaign,'Vídeos');
  assert.equal(data.affiliateSettings.payoutsEnabled,false);
});

test('painel possui navegação e pontos de quebra para celular',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/affiliate.html'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../public/affiliate-dashboard.css'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/affiliate-dashboard.js'),'utf8');
  for(const view of ['dashboard','links','statistics','finance','account']){
    assert.match(html,new RegExp('data-view="'+view+'"'));
    assert.match(html,new RegExp('data-panel="'+view+'"'));
  }
  assert.match(js,/period.*addEventListener\('change',renderStatistics\)/);
  assert.match(js,/campaign.*addEventListener\('change',renderStatistics\)/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-width:460px\)/);
});

test('Drawer administrativo preserva módulos e integra seis seções de afiliados',()=>{
  const admin=fs.readFileSync(path.join(__dirname,'../public/admin.html'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../public/affiliates-admin.html'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../public/affiliates-admin.css'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/affiliates-admin.js'),'utf8');
  for(const view of ['overview','home','users','messages','maintenance','history','settings','affiliates'])assert.match(admin,new RegExp('data-view="'+view+'"'));
  assert.match(admin,/data-view-panel="affiliates"/);
  for(const tab of ['overview','partners','links','conversions','finance','simulator','settings']){
    assert.match(html,new RegExp('data-tab="'+tab+'"'));
    assert.match(html,new RegExp('data-panel="'+tab+'"'));
  }
  assert.match(js,/event-period.*onchange=renderConversions/);
  assert.match(js,/overview-period.*onchange=renderOverview/);
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/@media\(max-width:540px\)/);
  assert.match(html,/id="overview-source"/);
  assert.match(html,/id="event-source"/);
  assert.match(html,/id="finance-source"/);
});
