(function(){'use strict';
  var $=id=>document.getElementById(id),data=null,view='dashboard';
  var names={dashboard:'Visão geral',links:'Meus links',statistics:'Estatísticas',finance:'Financeiro',account:'Minha conta'};
  var now=()=>Date.now(),money=(value,currency)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:currency||'BRL'}).format(Number(value)||0);
  var date=value=>value?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(Number(value)):'—';
  var count=(items,code)=>items.filter(item=>!code||item.code===code).length;
  function el(tag,className,text){var node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;}
  function empty(message){return el('div','empty',message);}
  function metric(label,value){var card=el('article','metric'),small=el('small','',label),strong=el('strong','',value);card.append(small,strong);return card;}
  function linkUrl(code){var url=new URL('/',location.origin);url.searchParams.set('ref',code);return url.href;}
  function filtered(items){var days=$('period').value,campaign=$('campaign').value,start=days==='all'?0:now()-Number(days)*86400000;
    var codes=new Set(data.links.filter(link=>campaign==='all'||link.campaign===campaign).map(link=>link.code));
    return items.filter(item=>Number(item.at)>=start&&codes.has(item.code));
  }
  function chart(target,items,alt){var node=$(target);node.replaceChildren();if(!items.length){node.appendChild(empty('Ainda não há eventos para este período.'));return;}
    var period=$('period').value,countBars=period==='7'?7:30,end=now()+1,start=period==='all'?Math.min(...items.map(item=>Number(item.at))):end-Number(period)*86400000,span=Math.max(1,end-start),buckets=[];
    for(var i=0;i<countBars;i++)buckets.push(0);
    items.forEach(function(item){var index=Math.min(countBars-1,Math.floor((Number(item.at)-start)/span*countBars));if(index>=0&&index<countBars)buckets[index]++;});
    var maximum=Math.max(1,...buckets),bars=el('div','chart');bars.setAttribute('role','img');bars.setAttribute('aria-label',items.length+' eventos no período');
    buckets.forEach(function(number,index){var bar=el('div','bar'+(alt?' alt':''));bar.style.height=Math.max(number?8:2,Math.round(number/maximum*100))+'%';bar.title=number+' eventos · dia '+(index+1);bars.appendChild(bar);});
    node.append(bars,el('div','chart-label',items.length+' eventos registrados no período'));
  }
  function eventLine(type,item){var row=el('div','event-row'),left=el('span','',type),right=el('small','',date(item.at)+' · '+(item.code||'—'));row.append(left,right);return row;}
  function renderDashboard(){var clicks=data.clicks,referrals=data.referrals,conversions=data.conversions,commissions=data.commissions,currency=data.settings.currency;
    var unique=data.uniqueVisitorsEstimated||0,rate=referrals.length?Math.round(conversions.length/referrals.length*1000)/10:0;
    var revenue=conversions.reduce((sum,item)=>sum+(item.amount||0),0),pending=commissions.filter(item=>item.status==='pending').reduce((sum,item)=>sum+item.amount,0),approved=commissions.filter(item=>item.status==='approved').reduce((sum,item)=>sum+item.amount,0),paid=commissions.filter(item=>item.status==='paid').reduce((sum,item)=>sum+item.amount,0);
    var values=[['Cliques',clicks.length],['Visitantes únicos estimados',unique],['Contas criadas',referrals.length],['Compras confirmadas ou simuladas',conversions.length],['Taxa de conversão',rate+'%'],['Receita atribuída',money(revenue,currency)],['Comissões pendentes',money(pending,currency)],['Aprovadas / pagas',money(approved,currency)+' / '+money(paid,currency)]];
    $('kpis').replaceChildren(...values.map(pair=>metric(pair[0],pair[1])));
    var recent=[...clicks.map(item=>({type:'Acesso',...item})),...referrals.map(item=>({type:'Cadastro',...item})),...conversions.map(item=>({type:'Conversão',...item}))].sort((a,b)=>b.at-a.at).slice(0,6);
    $('recent').replaceChildren(...(recent.length?recent.map(item=>eventLine(item.type,item)):[empty('As primeiras visitas aparecerão aqui.')]));
    chart('mini-chart',clicks.filter(item=>Number(item.at)>=now()-30*86400000),false);
  }
  function renderLinks(){var node=$('link-list');node.replaceChildren();$('link-form').hidden=!data.settings.allowPartnerLinks||data.partner.status!=='approved'||data.adminView;
    if(!data.links.length){node.appendChild(empty('Nenhum link disponível. Aguarde a criação pelo administrador ou peça autorização para criar links adicionais.'));return;}
    data.links.forEach(function(link){var card=el('article','card'),top=el('div','link-row'),left=el('div'),title=el('strong','',link.campaign),code=el('code','',linkUrl(link.code)),detail=el('small','',link.code+' · '+(link.active?'Ativo':'Inativo')+' · criado em '+date(link.createdAt)),actions=el('div','actions'),copy=el('button','copy','Copiar');
      copy.type='button';copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(linkUrl(link.code));copy.textContent='Copiado!';setTimeout(()=>copy.textContent='Copiar',1800);}catch(_){$('notice').textContent='Não foi possível copiar automaticamente. Selecione o link para copiar.';}});
      left.append(title,code,detail);actions.append(copy);top.append(left,actions);card.append(top);
      card.append(el('small','',count(data.clicks,link.code)+' cliques · '+(data.linkUniqueVisitors[link.code]||0)+' visitantes únicos estimados · '+count(data.referrals,link.code)+' cadastros · '+count(data.conversions,link.code)+' conversões'));
      node.appendChild(card);
    });
  }
  function renderStatistics(){var campaign=$('campaign'),selected=campaign.value,choices=[...new Set(data.links.map(item=>item.campaign))].sort();campaign.replaceChildren(new Option('Todas','all'),...choices.map(name=>new Option(name,name)));campaign.value=choices.includes(selected)?selected:'all';
    var clicks=filtered(data.clicks),conversions=filtered(data.conversions),referrals=filtered(data.referrals);chart('access-chart',clicks,false);chart('conversion-chart',conversions,true);
    var table=$('campaign-table');table.replaceChildren();if(!data.links.length){table.appendChild(empty('As campanhas aparecerão quando houver links.'));}else{
      var actual=el('table','compare'),head=el('tr');['Campanha','Cliques','Cadastros','Conversões'].forEach(label=>head.appendChild(el('th','',label)));actual.appendChild(head);
      choices.forEach(function(name){var codes=new Set(data.links.filter(link=>link.campaign===name).map(link=>link.code)),row=el('tr');[name,clicks.filter(item=>codes.has(item.code)).length,referrals.filter(item=>codes.has(item.code)).length,conversions.filter(item=>codes.has(item.code)).length].forEach(value=>row.appendChild(el('td','',value)));actual.appendChild(row);});table.appendChild(actual);
    }
    var events=[...clicks.map(item=>({type:'Acesso',...item})),...referrals.map(item=>({type:'Cadastro',...item})),...conversions.map(item=>({type:'Conversão '+item.plan,...item}))].sort((a,b)=>b.at-a.at).slice(0,100);
    $('events').replaceChildren(...(events.length?events.map(item=>eventLine(item.type,item)):[empty('Sem eventos no período selecionado.')]));
  }
  function renderFinance(){var currency=data.settings.currency,commissions=data.commissions,payouts=data.payouts;
    var pending=commissions.filter(item=>item.status==='pending').reduce((sum,item)=>sum+item.amount,0),approved=commissions.filter(item=>item.status==='approved').reduce((sum,item)=>sum+item.amount,0),paid=commissions.filter(item=>item.status==='paid').reduce((sum,item)=>sum+item.amount,0),reserved=payouts.filter(item=>['requested','approved','paid'].includes(item.status)).reduce((sum,item)=>sum+item.amount,0),available=Math.max(0,approved-reserved);
    $('finance-kpis').replaceChildren(metric('Pendente',money(pending,currency)),metric('Aprovado',money(approved,currency)),metric('Pago',money(paid,currency)),metric('Disponível para saque',money(available,currency)));
    function rows(target,items){$(target).replaceChildren(...(items.length?items.sort((a,b)=>b.at-a.at).map(function(item){var row=el('div','money-row');row.append(el('span','',money(item.amount,currency)),el('span','',item.status+' · '+date(item.at)));return row;}):[empty('Nenhum lançamento registrado.') ]));}
    rows('commission-list',[...commissions]);rows('payout-list',[...payouts]);$('payout-form').hidden=!data.settings.payoutsEnabled||data.partner.status!=='approved'||data.adminView;$('payout-rule').textContent='Mínimo: '+money(data.settings.minPayout,currency)+' · disponível: '+money(available,currency);
  }
  function renderAccount(){var node=$('account-detail');node.replaceChildren();[['Parceiro',data.partner.label],['Status',data.partner.status],['UID da conta',data.partner.uid],['Desde',date(data.partner.createdAt)],['Regras de comissão',data.settings.commissionDescription||'O administrador ainda não publicou regras de comissão.'],['Links adicionais',data.settings.allowPartnerLinks?'Permitidos':'Desabilitados'],['Solicitações de saque',data.settings.payoutsEnabled?'Habilitadas':'Desabilitadas']].forEach(function(pair){var row=el('div','money-row');row.append(el('small','',pair[0]),el('strong','',pair[1]));node.appendChild(row);});}
  function render(){if(!data)return;$('partner-status').textContent=data.partner.status==='approved'?'Parceria ativa':data.partner.status==='suspended'?'Parceria suspensa':'Visualização administrativa';renderDashboard();renderLinks();renderStatistics();renderFinance();renderAccount();}
  async function api(action,body){var user=firebase.auth().currentUser;if(!user)throw new Error('Entre na sua conta.');var response=await fetch('/api/affiliates/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify(body||{}),cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Falha ao carregar dados.');return result;}
  async function refresh(){try{var uid=new URLSearchParams(location.search).get('uid');data=await api('report',uid?{uid:uid}:{});$('workspace').hidden=false;$('notice').textContent=data.adminView?'Visualização administrativa de '+data.partner.label+'.':'Dados atualizados.';render();}catch(error){$('workspace').hidden=true;$('notice').textContent=error.message;}}
  firebase.initializeApp(window.DK_FIREBASE_CONFIG);firebase.auth().onAuthStateChanged(function(user){if(!user){$('workspace').hidden=true;$('notice').textContent='Entre na sua conta para acessar a área do parceiro.';return;}refresh();});
  document.querySelectorAll('.nav').forEach(function(button){button.addEventListener('click',function(){view=button.dataset.view;document.querySelectorAll('.nav').forEach(node=>{var active=node===button;node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});document.querySelectorAll('.view').forEach(node=>node.classList.toggle('active',node.dataset.panel===view));$('heading').textContent=names[view];});});
  $('refresh').addEventListener('click',refresh);$('period').addEventListener('change',renderStatistics);$('campaign').addEventListener('change',renderStatistics);
  $('link-form').addEventListener('submit',async function(event){event.preventDefault();var campaign=new FormData(event.currentTarget).get('campaign');try{await api('myLink',{campaign});event.currentTarget.reset();await refresh();}catch(error){$('notice').textContent=error.message;}});
  $('payout-form').addEventListener('submit',async function(event){event.preventDefault();var amount=Number(new FormData(event.currentTarget).get('amount'));try{await api('payout',{amount});event.currentTarget.reset();await refresh();}catch(error){$('notice').textContent=error.message;}});
})();
