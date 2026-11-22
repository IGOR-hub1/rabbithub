'use strict';
const crypto=require('crypto');
const {createStore}=require('./affiliate-store');
const {verifyFirebaseRequest}=require('./firebase-auth');
const {normalize}=require('./account-plan');
const WINDOW=30*86400000;
const codePattern=/^[A-Z0-9]{6,20}$/;
const uidPattern=/^[A-Za-z0-9_-]{1,128}$/;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const clean=value=>String(value||'').trim();
const entries=value=>Object.entries(value||{}).map(([id,record])=>({id,...record}));
const finiteMoney=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.round(value*100)/100:null;
const allowedStatus=(value,values)=>values.includes(value)?value:'unknown';
const validCode=value=>codePattern.test(clean(value).toUpperCase());
const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

function createService(deps={}) {
  const store=deps.store||createStore();
  const verify=deps.verify||verifyFirebaseRequest;
  const now=deps.now||Date.now;
  const random=deps.random||(()=>crypto.randomBytes(18).toString('base64url'));
  const read=async path=>(await store.request(path)).value;
  const livePaymentsUnavailable=()=>{if(deps.testOnlyAllowFinancialOperations===true)return;throw fail('Operações financeiras reais indisponíveis até integrar e validar um gateway. Use o simulador.',503);};
  async function identity(req){const user=await verify(req);if(!uidPattern.test(user.sub))throw fail('UID inválido.');return user;}
  async function admin(req){const user=await identity(req);if(await read('admins/'+user.sub)!==true)throw fail('Acesso administrativo obrigatório.',403);return user;}
  async function audit(actor,action,target,before,after){
    const id=random();await store.request('affiliateAudit/'+id,'PUT',{actorUid:actor.sub,action,target,before:before||null,after:after||null,at:now()},'null_etag');
  }
  async function adminData(req){await admin(req);const paths=['partners','referralLinks','referralClicks','referrals','conversions','commissions','payouts','affiliateSettings','affiliateAudit','partnerCommissionRules','simulationFlows'];const values=await Promise.all(paths.map(read));
    return {...Object.fromEntries(paths.map((path,index)=>[path,values[index]||{}])),financialOperationsAvailable:false};
  }
  async function list(req){await admin(req);const [partners,links,clicks,referrals,conversions]=await Promise.all(['partners','referralLinks','referralClicks','referrals','conversions'].map(read));
    return entries(partners).map(partner=>{
      const ownLinks=entries(links).filter(link=>link.partnerUid===partner.id);
      const codes=new Set(ownLinks.map(link=>link.code));
      const ownClicks=entries(clicks).filter(click=>codes.has(click.code));
      return {...partner,links:ownLinks,stats:{clicks:ownClicks.length,uniqueVisitorsEstimated:new Set(ownClicks.map(click=>click.visitorId)).size,signups:entries(referrals).filter(ref=>ref.partnerUid===partner.id).length,conversions:entries(conversions).filter(conversion=>conversion.partnerUid===partner.id).length}};
    });
  }
  async function create(req,body){await admin(req);const uid=clean(body.uid),label=clean(body.label).slice(0,80);
    if(!uidPattern.test(uid)||!label)throw fail('Informe UID válido e nome do parceiro.');
    // The account must already exist. No email or private profile is copied.
    if(!await read('users/'+uid))throw fail('Conta Firebase não encontrada.',404);
    const existing=await read('partners/'+uid);if(existing)throw fail('Parceiro já cadastrado.',409);
    const partner={uid,label,status:'pending',createdAt:now(),updatedAt:now()};
    const result=await store.request('partners/'+uid,'PUT',partner,'null_etag');if(result.conflict)throw fail('Parceiro já cadastrado.',409);
    await audit(await admin(req),'partner.create',uid,null,partner);
    return partner;
  }
  async function status(req,body){await admin(req);const uid=clean(body.uid),next=clean(body.status);
    if(!uidPattern.test(uid)||!['approved','suspended','removed'].includes(next))throw fail('Status inválido.');
    const current=await read('partners/'+uid);if(!current)throw fail('Parceiro não encontrado.',404);
    if(current.status==='removed')throw fail('Parceiro removido não pode ser reativado.',409);
    const partner={...current,status:next,updatedAt:now()};await store.request('partners/'+uid,'PUT',partner);await audit(await admin(req),'partner.status',uid,{status:current.status},{status:next});return partner;
  }
  async function link(req,body){const actor=await admin(req),uid=clean(body.uid);if(!uidPattern.test(uid))throw fail('UID inválido.');const result=await issueLink(uid,clean(body.campaign),body);await audit(actor,'link.create',result.code,null,result);return result;}
  async function myLink(req,body){const user=await identity(req),settings=await read('affiliateSettings')||{};
    if(settings.allowPartnerLinks!==true)throw fail('Links adicionais não estão habilitados.',403);
    return issueLink(user.sub,clean(body.campaign));
  }
  async function issueLink(uid,campaign,options={}){
    const partner=await read('partners/'+uid);if(!partner||partner.status!=='approved')throw fail('Parceria não aprovada.',403);
    if(campaign.length>60||!/^[\p{L}\p{N} ._-]*$/u.test(campaign))throw fail('Campanha inválida.');
    const settings=await read('affiliateSettings')||{},all=await read('referralLinks')||{};
    if(settings.enabled===false)throw fail('Programa suspenso.',403);
    if(nonnegative(settings.maxLinksPerPartner)&&settings.maxLinksPerPartner>0&&entries(all).filter(item=>item.partnerUid===uid&&item.active).length>=settings.maxLinksPerPartner)throw fail('Limite de links atingido.',409);
    const expiresAt=Number(options.expiresAt)||0;if(expiresAt&&(expiresAt<=now()||expiresAt>now()+365*86400000))throw fail('Validade inválida.');
    const custom=clean(options.code).toUpperCase();if(custom&&!validCode(custom))throw fail('Código personalizado inválido.');
    const rules=clean(options.rules).slice(0,300);
    for(let i=0;i<(custom?1:5);i++){const code=custom||crypto.randomBytes(6).toString('hex').toUpperCase();const record={code,partnerUid:uid,campaign:campaign||'Geral',createdAt:now(),expiresAt,rules,active:true};
      const result=await store.request('referralLinks/'+code,'PUT',record,'null_etag');if(!result.conflict)return record;
    }throw fail('Não foi possível gerar link.',503);
  }
  async function linkUpdate(req,body){const actor=await admin(req),code=clean(body.code).toUpperCase();if(!validCode(code))throw fail('Código inválido.');const link=await read('referralLinks/'+code);if(!link)throw fail('Link não encontrado.',404);
    const next={...link,active:body.active===true,updatedAt:now()};await store.request('referralLinks/'+code,'PUT',next);await audit(actor,'link.status',code,{active:link.active},{active:next.active});return next;
  }
  async function campaignUpdate(req,body){const actor=await admin(req),uid=clean(body.uid),campaign=clean(body.campaign);
    if(!uidPattern.test(uid)||!campaign||campaign.length>60)throw fail('Campanha invalida.');
    const links=entries(await read('referralLinks')).filter(item=>item.partnerUid===uid&&item.campaign===campaign&&item.active);
    if(!links.length)throw fail('Campanha ativa nao encontrada.',404);
    const updates={};links.forEach(item=>{const {id,...link}=item;updates['referralLinks/'+item.code]={...link,active:false,updatedAt:now()};});
    updates['affiliateAudit/'+random()]={actorUid:actor.sub,action:'campaign.disable',target:uid+':'+campaign,before:{activeLinks:links.length},after:{activeLinks:0},at:now()};
    await store.request('','PATCH',updates);return {disabled:links.length};
  }
  async function partnerRules(req,body){const actor=await admin(req),uid=clean(body.uid);if(!uidPattern.test(uid))throw fail('UID inválido.');const partner=await read('partners/'+uid);if(!partner)throw fail('Parceiro não encontrado.',404);
    const rate=Number(body.percent),fixed=Number(body.fixedSignup),budget=Number(body.budget);
    if(![rate,fixed,budget].every(nonnegative)||rate>100||!Number.isInteger(Math.round(fixed*100))||budget>1e9)throw fail('Regras financeiras inválidas.');
    const previous=await read('partnerCommissionRules/'+uid),rules={percent:rate,fixedSignup:fixed,budget,updatedAt:now()};await store.request('partnerCommissionRules/'+uid,'PUT',rules);await audit(actor,'partner.rules',uid,previous,rules);return rules;
  }
  async function financialAction(req,body){const actor=await admin(req),kind=clean(body.kind),id=clean(body.id),next=clean(body.status);
    if(next==='approved'||next==='paid')livePaymentsUnavailable();
    if(!['commission','payout'].includes(kind)||!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw fail('Lançamento inválido.');
    const path=(kind==='commission'?'commissions':'payouts')+'/'+id,current=await read(path);if(!current)throw fail('Lançamento não encontrado.',404);
    if(current.isSimulation===true)throw fail('Use o simulador para eventos de teste.',403);
    if(kind==='commission'&&current.kind==='purchase'&&current.sourceId){const source=await read('conversions/'+current.sourceId);if(source&&(source.status==='simulated'||source.isSimulation===true))throw fail('Comissão ligada a compra simulada antiga.',403);}
    const transitions=kind==='commission'?{pending:['approved','rejected'],approved:['paid','rejected']}:{requested:['approved','rejected'],approved:['paid','rejected']};
    if(!(transitions[current.status]||[]).includes(next))throw fail('Transição financeira inválida.',409);
    if(next==='paid'&&kind==='payout'&&body.recordOnly!==true)throw fail('Registre somente pagamento realizado fora do sistema.',400);
    const updated={...current,status:next,updatedAt:now(),updatedBy:actor.sub},auditId=random();
    await store.request('','PATCH',{[path]:updated,['affiliateAudit/'+auditId]:{actorUid:actor.sub,action:kind+'.'+next,target:id,before:{status:current.status,amount:current.amount},after:{status:next,amount:current.amount},at:now()} });
    if(kind==='commission'&&next==='rejected'){
      const reservation=await store.request('commissionBudgetUsage/'+current.partnerUid,'GET',undefined,true);
      const held=Number(reservation.value)||0;
      if(held>0)await store.request('commissionBudgetUsage/'+current.partnerUid,'PUT',Math.max(0,Math.round((held-(Number(current.amount)||0))*100)/100),reservation.etag||'null_etag');
    }
    if(kind==='payout'&&next==='rejected'){
      const reservation=await store.request('payoutReservations/'+current.partnerUid,'GET',undefined,true);
      const held=Number(reservation.value)||0;
      if(held>0)await store.request('payoutReservations/'+current.partnerUid,'PUT',Math.max(0,Math.round((held-(Number(current.amount)||0))*100)/100),reservation.etag||'null_etag');
    }
    return {id,status:next};
  }
  async function recordPurchase(req,body){const actor=await admin(req),uid=clean(body.uid),amount=finiteMoney(body.amount),status=clean(body.status);
    livePaymentsUnavailable();
    if(!uidPattern.test(uid)||amount===null||!['confirmed','simulated'].includes(status))throw fail('Compra inválida.');
    if(status!=='confirmed')throw fail('Compras de teste devem usar o simulador.',400);
    const referral=await read('referrals/'+uid);if(!referral)throw fail('Conta sem atribuição.',404);
    const id=random(),record={uid,partnerUid:referral.partnerUid,code:referral.code,plan:clean(body.plan)||'VIP',amount,status,at:now()};
    await store.request('','PATCH',{['conversions/'+id]:record,['affiliateAudit/'+random()]:{actorUid:actor.sub,action:'purchase.record',target:id,before:null,after:{partnerUid:record.partnerUid,amount,status},at:now()}});
    return {id,record};
  }
  async function settle(req,body){const actor=await admin(req),kind=clean(body.kind),id=clean(body.id);
    livePaymentsUnavailable();
    if(!['signup','purchase'].includes(kind)||!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw fail('Origem inválida.');
    const source=await read((kind==='signup'?'referrals':'conversions')+'/'+id);if(!source||!uidPattern.test(source.partnerUid))throw fail('Origem não encontrada.',404);
    if(source.isSimulation===true||source.status==='simulated')throw fail('Evento simulado nao gera comissao real.',403);
    if(kind==='purchase'&&source.status!=='confirmed')throw fail('Compra ainda nao confirmada.',409);
    const settings=await read('affiliateSettings')||{},rules=await read('partnerCommissionRules/'+source.partnerUid)||{};
    const percent=nonnegative(rules.percent)?rules.percent:Number(settings.percent)||0,fixed=nonnegative(rules.fixedSignup)?rules.fixedSignup:Number(settings.fixedSignup)||0;
    const amount=Math.round((kind==='signup'?fixed:(finiteMoney(source.amount)||0)*percent/100)*100)/100;
    if(amount<=0)throw fail('Regra sem valor de comissão.',409);
    const commissions=entries(await read('commissions')).filter(item=>item.partnerUid===source.partnerUid&&item.status!=='rejected');
    const spent=commissions.reduce((sum,item)=>sum+(finiteMoney(item.amount)||0),0),budget=nonnegative(rules.budget)&&rules.budget>0?rules.budget:Number(settings.budget)||0;
    if(budget>0&&spent+amount>budget)throw fail('Orçamento do parceiro excedido.',409);
    const usage=await store.request('commissionBudgetUsage/'+source.partnerUid,'GET',undefined,true),held=Math.max(spent,Number(usage.value)||0);
    if(budget>0&&held+amount>budget)throw fail('Orcamento do parceiro excedido.',409);
    const commissionId=kind+'_'+id;if(await read('commissions/'+commissionId))throw fail('Comissão já registrada.',409);
    const record={partnerUid:source.partnerUid,sourceId:id,kind,code:source.code,amount,status:'pending',at:now()};
    await audit(actor,'commission.attempt',commissionId,null,record);
    const lock=await store.request('commissionBudgetUsage/'+source.partnerUid,'PUT',Math.round((held+amount)*100)/100,usage.etag||'null_etag');if(lock.conflict)throw fail('Orcamento alterado. Atualize e tente novamente.',409);
    const created=await store.request('commissions/'+commissionId,'PUT',record,'null_etag');if(created.conflict)throw fail('Comissão já registrada.',409);
    await audit(actor,'commission.create',commissionId,null,record);return {id:commissionId,record};
  }
  async function report(req,body){const user=await identity(req),isAdmin=await read('admins/'+user.sub)===true;
    const uid=isAdmin&&uidPattern.test(clean(body.uid))?clean(body.uid):user.sub;
    const partner=await read('partners/'+uid);
    if(!partner||(!isAdmin&&!['approved','suspended'].includes(partner.status)))throw fail('Acesso de parceiro obrigatório.',403);
    const [links,clicks,referrals,conversions,commissions,payouts,settings,flows]=await Promise.all(['referralLinks','referralClicks','referrals','conversions','commissions','payouts','affiliateSettings','simulationFlows'].map(read));
    const ownLinks=entries(links).filter(item=>item.partnerUid===uid).map(item=>({code:item.code,campaign:item.campaign||'Geral',createdAt:item.createdAt,active:item.active===true}));
    const rawClicks=entries(clicks).filter(item=>item.partnerUid===uid);
    const uniqueVisitorsEstimated=new Set(rawClicks.map(item=>item.visitorId)).size;
    const linkUniqueVisitors={};
    ownLinks.forEach(link=>{linkUniqueVisitors[link.code]=new Set(rawClicks.filter(item=>item.code===link.code).map(item=>item.visitorId)).size;});
    const ownClicks=rawClicks.map(item=>({code:item.code,at:item.at}));
    const ownReferrals=entries(referrals).filter(item=>item.partnerUid===uid).map(item=>({code:item.code,at:item.registeredAt||item.attributedAt}));
    const ownConversions=entries(conversions).filter(item=>item.partnerUid===uid&&item.isSimulation!==true&&item.status!=='simulated').map(item=>({code:item.code,at:item.at,plan:item.plan,amount:finiteMoney(item.amount)}));
    const ownCommissions=entries(commissions).filter(item=>item.partnerUid===uid&&item.isSimulation!==true&&!(item.kind==='purchase'&&item.sourceId&&conversions&&conversions[item.sourceId]&&(conversions[item.sourceId].status==='simulated'||conversions[item.sourceId].isSimulation===true))).map(item=>({code:item.code||'',at:item.at||item.createdAt,status:allowedStatus(item.status,['pending','approved','paid','rejected']),amount:finiteMoney(item.amount)||0}));
    const ownPayouts=entries(payouts).filter(item=>item.partnerUid===uid).map(item=>({at:item.at||item.createdAt,status:allowedStatus(item.status,['requested','approved','paid','rejected']),amount:finiteMoney(item.amount)||0}));
    const config=settings&&typeof settings==='object'?settings:{};
    const simulations=entries(flows).filter(item=>item.partnerUid===uid).map(item=>({id:item.id,code:item.code,campaign:item.campaign,at:item.createdAt,plan:item.purchase&&item.purchase.plan||null,paymentStatus:item.purchase&&item.purchase.status||null,amount:item.purchase&&item.purchase.amount||0,commission:item.commission&&item.commission.amount||0,isSimulation:true}));
    return {partner:{uid,label:partner.label,status:partner.status,createdAt:partner.createdAt},links:ownLinks,clicks:ownClicks,uniqueVisitorsEstimated,linkUniqueVisitors,referrals:ownReferrals,conversions:ownConversions,commissions:ownCommissions,payouts:ownPayouts,simulations,settings:{allowPartnerLinks:config.allowPartnerLinks===true,payoutsEnabled:false,minPayout:finiteMoney(config.minPayout)||0,currency:/^[A-Z]{3}$/.test(config.currency||'')?config.currency:'BRL',commissionDescription:clean(config.commissionDescription).slice(0,300)},adminView:isAdmin&&uid!==user.sub};
  }
  async function payout(req,body){const user=await identity(req),settings=await read('affiliateSettings')||{};
    livePaymentsUnavailable();
    if(settings.enabled===false||settings.payoutsEnabled!==true)throw fail('Saques não estão habilitados.',403);
    const partner=await read('partners/'+user.sub);if(!partner||partner.status!=='approved')throw fail('Parceria não aprovada.',403);
    const amount=finiteMoney(body.amount),minimum=finiteMoney(settings.minPayout)||0;
    if(!amount||amount<minimum)throw fail('Valor abaixo do mínimo permitido.');
    const reportData=await report(req,{});
    const approved=reportData.commissions.filter(item=>item.status==='approved').reduce((sum,item)=>sum+item.amount,0);
    const reserved=reportData.payouts.filter(item=>['requested','approved','paid'].includes(item.status)).reduce((sum,item)=>sum+item.amount,0);
    const reservation=await store.request('payoutReservations/'+user.sub,'GET',undefined,true);
    const held=Math.max(reserved,Number(reservation.value)||0);
    if(amount>Math.round((approved-held)*100)/100)throw fail('Saldo disponível insuficiente.',409);
    const locked=await store.request('payoutReservations/'+user.sub,'PUT',Math.round((held+amount)*100)/100,reservation.etag||'null_etag');
    if(locked.conflict)throw fail('Saldo alterado. Atualize e tente novamente.',409);
    const id=random(),record={partnerUid:user.sub,amount,status:'requested',at:now()};
    await audit(user,'payout.request',id,null,{partnerUid:user.sub,amount});
    const result=await store.request('payouts/'+id,'PUT',record,'null_etag');if(result.conflict)throw fail('Tente novamente.',409);
    return {id,amount,status:'requested',at:record.at};
  }
  async function settings(req,body){await admin(req);
    if(body.read===true)return {settings:await read('affiliateSettings')||{}};
    if(body.payoutsEnabled===true)livePaymentsUnavailable();
    const description=clean(body.commissionDescription),currency=clean(body.currency).toUpperCase(),minPayout=finiteMoney(body.minPayout);
    if(description.length>300||!/^[A-Z]{3}$/.test(currency)||minPayout===null)throw fail('Configuração de afiliados inválida.');
    const previous=await read('affiliateSettings')||{},days=Number(body.attributionDays??previous.attributionDays??30),maxLinks=Number(body.maxLinksPerPartner??previous.maxLinksPerPartner??0),rate=Number(body.percent??previous.percent??0),fixed=Number(body.fixedSignup??previous.fixedSignup??0),budget=Number(body.budget??previous.budget??0);
    if(!Number.isInteger(days)||days<1||days>30||!Number.isInteger(maxLinks)||maxLinks<0||maxLinks>100||![rate,fixed,budget].every(nonnegative)||rate>100)throw fail('Limites inválidos.');
    const value={...previous,allowPartnerLinks:body.allowPartnerLinks===undefined?previous.allowPartnerLinks===true:body.allowPartnerLinks===true,payoutsEnabled:body.payoutsEnabled===undefined?previous.payoutsEnabled===true:body.payoutsEnabled===true,minPayout,currency,commissionDescription:description,attributionDays:days,maxLinksPerPartner:maxLinks,percent:rate,fixedSignup:fixed,budget,enabled:body.enabled===undefined?previous.enabled!==false:body.enabled===true,antifraudEnabled:body.antifraudEnabled===undefined?previous.antifraudEnabled!==false:body.antifraudEnabled===true,simulationEnabled:body.simulationEnabled===undefined?previous.simulationEnabled===true:body.simulationEnabled===true,updatedAt:now()};
    await store.request('affiliateSettings','PUT',value);await audit(await admin(req),'settings.update','global',previous,value);return {settings:value};
  }
  async function simulationTestAccount(req,body){const actor=await admin(req),uid=clean(body.uid);if(!uidPattern.test(uid)||!await read('users/'+uid))throw fail('Conta não encontrada.',404);
    const enabled=body.enabled===true;await store.request('affiliateTestAccounts/'+uid,'PUT',enabled?{isSimulation:true,enabled:true,at:now()}:null);
    await store.request('affiliateAudit/'+random(),'PUT',{isSimulation:true,actorUid:actor.sub,action:'simulation.testAccount',target:uid,before:null,after:{enabled},at:now()},'null_etag');return {uid,enabled};
  }
  async function simulationUsers(req){await admin(req);const [accounts,users]=await Promise.all([read('affiliateTestAccounts'),read('users')]);return {users:Object.entries(accounts||{}).filter(([,record])=>record&&record.isSimulation===true&&record.enabled===true).map(([uid])=>({uid,label:clean(users&&users[uid]&&(users[uid].displayName||users[uid].profileName)||uid).slice(0,80)}))};}
  async function simulationStart(req,body){const actor=await admin(req),settings=await read('affiliateSettings')||{};
    if(settings.simulationEnabled!==true)throw fail('Simulador desativado.',403);
    const uid=clean(body.uid),code=clean(body.code).toUpperCase();if(!uidPattern.test(uid)||!validCode(code))throw fail('Conta ou link inválido.');
    const [user,link,authorized]=await Promise.all([read('users/'+uid),read('referralLinks/'+code),read('affiliateTestAccounts/'+uid)]);
    if(!user||!authorized||authorized.isSimulation!==true||authorized.enabled!==true||!link||!link.active||link.expiresAt&&link.expiresAt<=now())throw fail('Conta de teste autorizada ou link não encontrado.',404);
    const partner=await read('partners/'+link.partnerUid);if(!partner||partner.status!=='approved')throw fail('Parceiro indisponível.',409);
    if(settings.antifraudEnabled!==false&&uid===link.partnerUid)throw fail('Autorreferência bloqueada.',403);
    const id=random(),record={isSimulation:true,id,uid,partnerUid:link.partnerUid,code,campaign:link.campaign||'Geral',createdAt:now(),click:{isSimulation:true,at:now()},signup:{isSimulation:true,at:now(),uid},purchase:null,commission:null,history:[{isSimulation:true,action:'flow.started',at:now(),actorUid:actor.sub}]};
    const result=await store.request('simulationFlows/'+id,'PUT',record,'null_etag');if(result.conflict)throw fail('Identificador duplicado.',409);
    return {flow:record};
  }
  async function simulationPurchase(req,body){const actor=await admin(req),settings=await read('affiliateSettings')||{};
    if(settings.simulationEnabled!==true)throw fail('Simulador desativado.',403);
    const id=clean(body.flowId),status=clean(body.status),plan=clean(body.plan),amount=finiteMoney(body.amount),requestId=clean(body.requestId);
    if(!/^[A-Za-z0-9_-]{20,80}$/.test(id)||!['approved','pending','declined','reversed'].includes(status)||!['VIP','Plus'].includes(plan)||amount===null||amount>1000000||!/^[A-Za-z0-9_-]{8,80}$/.test(requestId))throw fail('Compra simulada inválida.');
    const current=await store.request('simulationFlows/'+id,'GET',undefined,true),flow=current.value;
    if(!flow||flow.isSimulation!==true)throw fail('Fluxo de teste não encontrado.',404);
    if(flow.purchase&&flow.purchase.requestId===requestId)return {flow,idempotent:true};
    const previous=flow.purchase&&flow.purchase.status;
    if(!previous&&status==='reversed')throw fail('Não existe compra aprovada para estornar.',409);
    if(previous&&!(previous==='pending'&&['approved','declined'].includes(status))&&!(previous==='approved'&&status==='reversed'))throw fail('Transição simulada inválida.',409);
    if(previous&&(plan!==flow.purchase.plan||amount!==flow.purchase.amount))throw fail('Plano ou valor não podem mudar.',409);
    const rules=await read('partnerCommissionRules/'+flow.partnerUid)||{},percent=nonnegative(rules.percent)?rules.percent:Number(settings.percent)||0;
    const calculated=Math.round(amount*percent)/100;
    const purchase={isSimulation:true,plan,amount,status,requestId,at:now()};
    const commission={isSimulation:true,status:status==='approved'?'simulated':status==='reversed'?'reversed':'none',amount:status==='approved'?calculated:0,calculatedAmount:calculated,at:now()};
    const next={...flow,purchase,commission,updatedAt:now(),history:[...(flow.history||[]),{isSimulation:true,action:'purchase.'+status,at:now(),actorUid:actor.sub}]};
    const saved=await store.request('simulationFlows/'+id,'PUT',next,current.etag||'null_etag');if(saved.conflict)throw fail('Fluxo alterado. Atualize e tente novamente.',409);
    return {flow:next,idempotent:false};
  }
  async function simulationClear(req,body){const actor=await admin(req);if(clean(body.confirmation)!=='LIMPAR SIMULACOES')throw fail('Confirmação inválida.',400);
    const flows=await read('simulationFlows')||{},count=entries(flows).length;
    await store.request('','PATCH',{simulationFlows:null,['affiliateAudit/'+random()]:{actorUid:actor.sub,action:'simulation.clear',target:'all',before:{count},after:{count:0},at:now(),isSimulation:true}});
    return {removed:count};
  }
  async function click(body,visitorId){const code=clean(body.code).toUpperCase();if(!codePattern.test(code)||!/^[A-Za-z0-9_-]{20,80}$/.test(visitorId))throw fail('Código ou visitante inválido.');
    const settings=await read('affiliateSettings')||{};if(settings.enabled===false)throw fail('Programa suspenso.',403);
    const link=await read('referralLinks/'+code);if(!link||!link.active)throw fail('Link inativo.',404);
    if(link.expiresAt&&link.expiresAt<=now())throw fail('Campanha encerrada.',404);
    const partner=await read('partners/'+link.partnerUid);if(!partner||partner.status!=='approved')throw fail('Parceiro indisponível.',404);
    if(settings.antifraudEnabled!==false){const history=entries(await read('referralVisitorClicks/'+visitorId));if(history.some(item=>item.code===code&&now()-item.at<30000))throw fail('Clique repetido em curto intervalo.',429);}
    const id=random(),record={code,partnerUid:link.partnerUid,visitorId,at:now()};
    await store.request('referralClicks/'+id,'PUT',record,'null_etag');
    await store.request('referralVisitorClicks/'+visitorId+'/'+id,'PUT',{code,partnerUid:link.partnerUid,at:record.at},'null_etag');
    return {clickId:id,at:record.at};
  }
  async function claim(req,body){const user=await identity(req),clickId=clean(body.clickId);
    const settings=await read('affiliateSettings')||{},windowMs=(Number(settings.attributionDays)||30)*86400000;if(settings.enabled===false)throw fail('Programa suspenso.',403);
    if(!/^[A-Za-z0-9_-]{20,80}$/.test(clickId))throw fail('Clique inválido.');
    const click=await read('referralClicks/'+clickId);if(!click||click.at>now()||now()-click.at>windowMs)throw fail('Indicação expirada.',409);
    const visitorCookie=String(req.headers.cookie||'').match(/(?:^|;\s*)rh_aff_visitor=([A-Za-z0-9_-]{24,80})(?:;|$)/);
    if(!visitorCookie||visitorCookie[1]!==click.visitorId)throw fail('Indicação deste navegador não encontrada.',403);
    // Firebase Authentication creation time is authoritative; a later login cannot claim a new click.
    const authToken=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const lookup=deps.lookup||lookupAccount;
    const createdAt=await lookup(authToken,user.sub);
    if(click.at>createdAt||createdAt-click.at>windowMs)throw fail('Clique fora do prazo de atribuição.',409);
    const visitorClicks=await read('referralVisitorClicks/'+click.visitorId);
    const latest=entries(visitorClicks).filter(item=>item.at<=createdAt&&createdAt-item.at<=windowMs).sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id))[0];
    if(!latest)throw fail('Nenhum clique válido antes do cadastro.',409);
    const latestLink=await read('referralLinks/'+latest.code),latestPartner=await read('partners/'+latest.partnerUid);
    if(!latestLink||!latestLink.active||!latestPartner||latestPartner.status!=='approved'||latest.partnerUid===user.sub)throw fail('Indicação indisponível.',409);
    const record={uid:user.sub,partnerUid:latest.partnerUid,code:latest.code,clickId:latest.id,clickAt:latest.at,registeredAt:createdAt,attributedAt:now()};
    const result=await store.request('referrals/'+user.sub,'PUT',record,'null_etag');
    if(result.conflict)return {attributed:false,referral:await read('referrals/'+user.sub)};
    return {attributed:true,referral:record};
  }
  async function conversion(req,body){await admin(req);const uid=clean(body.uid);if(!uidPattern.test(uid))throw fail('UID inválido.');
    const [referral,account]=await Promise.all([read('referrals/'+uid),read('users/'+uid)]);
    if(!referral)throw fail('Conta sem indicação.',404);
    const plan=normalize(account||{},now());if(!plan.isVip)throw fail('Conta sem VIP ativo.',409);
    const updatedAt=Number(account.planUpdatedAt||0);
    if(!Number.isFinite(updatedAt)||updatedAt<=0)throw fail('Plano sem evento verificável.',409);
    const eventId=uid+'_'+updatedAt;
    if(!/^[A-Za-z0-9_-]+$/.test(eventId))throw fail('Evento inválido.');
    const record={uid,partnerUid:referral.partnerUid,code:referral.code,plan:'VIP',planUpdatedAt:updatedAt,at:now()};
    const result=await store.request('conversions/'+eventId,'PUT',record,'null_etag');
    return {created:!result.conflict,conversion:result.conflict?await read('conversions/'+eventId):record};
  }
  return {list,adminData,create,status,link,myLink,linkUpdate,campaignUpdate,partnerRules,financialAction,recordPurchase,settle,report,payout,settings,simulationTestAccount,simulationUsers,simulationStart,simulationPurchase,simulationClear,click,claim,conversion};
}
async function lookupAccount(token,uid){
  const key=String(process.env.FIREBASE_WEB_API_KEY||'AIzaSyBqjU_05Lo8w-XOhB_r41Bcj3aQvgh51_4');
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
  if(!response.ok)throw fail('Não foi possível confirmar a data do cadastro.',503);
  const data=await response.json(),account=data.users&&data.users[0];
  if(!account||account.localId!==uid||!Number.isFinite(Number(account.createdAt)))throw fail('Conta não encontrada.',403);
  return Number(account.createdAt);
}
module.exports={createService,WINDOW};

