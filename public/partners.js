(function(){
  'use strict';
  var status=document.getElementById('status'),list=document.getElementById('partners'),content=document.getElementById('content');
  if(!window.firebase||!window.DK_FIREBASE_CONFIG){status.textContent='Firebase Authentication indisponível. Atualize a página e verifique a conexão.';return;}
  try{window.firebase.initializeApp(window.DK_FIREBASE_CONFIG);}catch(error){status.textContent='Não foi possível iniciar a autenticação Firebase: '+error.message;return;}
  function timed(promise,ms,message){var timer;return Promise.race([promise,new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error(message));},ms);})]).finally(function(){clearTimeout(timer);});}
  async function api(action,body){
    var user=window.firebase.auth().currentUser;if(!user)throw new Error('Entre na conta administrativa.');
    var token=await timed(user.getIdToken(),10000,'A autenticação demorou demais. Atualize a página.');
    var response=await timed(fetch('/api/affiliates/'+action,{method:action==='list'?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:action==='list'?undefined:JSON.stringify(body),cache:'no-store'}),12000,'A API de afiliados não respondeu. Atualize a página.');
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('API de afiliados indisponível nesta origem (HTTP '+response.status+'). Verifique a publicação de /api/affiliates.');
    var result=await response.json();if(!response.ok)throw new Error(result.error||'Falha ao consultar parceiros.');return result;
  }
  function button(label,action,body){var element=document.createElement('button');element.type='button';element.textContent=label;element.onclick=async function(){element.disabled=true;try{await api(action,body);await refresh();}catch(error){status.textContent=error.message;}finally{element.disabled=false;}};return element;}
  async function refresh(){var result=await api('list');list.replaceChildren();
    if(!result.partners.length){list.textContent='Nenhum parceiro cadastrado.';return;}
    result.partners.forEach(function(partner){
      var article=document.createElement('article'),title=document.createElement('strong'),detail=document.createElement('div'),stats=document.createElement('small'),row=document.createElement('div');
      title.textContent=partner.label+' · '+partner.status;detail.textContent='UID: '+partner.uid;
      stats.textContent='Cliques: '+partner.stats.clicks+' · Visitantes únicos estimados: '+partner.stats.uniqueVisitorsEstimated+' · Cadastros: '+partner.stats.signups+' · Conversões: '+partner.stats.conversions;
      row.className='row';
      if(partner.status==='pending'||partner.status==='suspended')row.appendChild(button('Aprovar','status',{uid:partner.uid,status:'approved'}));
      if(partner.status==='approved')row.appendChild(button('Suspender','status',{uid:partner.uid,status:'suspended'}));
      if(partner.status!=='removed')row.appendChild(button('Remover','status',{uid:partner.uid,status:'removed'}));
      if(partner.status==='approved'){
        var generate=document.createElement('button');generate.type='button';generate.textContent='Gerar link';generate.onclick=async function(){var campaign=window.prompt('Nome da campanha (até 60 caracteres):','Geral');if(campaign===null)return;generate.disabled=true;try{await api('link',{uid:partner.uid,campaign:campaign});await refresh();}catch(error){status.textContent=error.message;}finally{generate.disabled=false;}};row.appendChild(generate);
      }
      var dashboard=document.createElement('a');dashboard.href='affiliate.html?uid='+encodeURIComponent(partner.uid);dashboard.textContent='Ver painel';dashboard.style.color='#d8b6ff';row.appendChild(dashboard);
      article.append(title,detail,stats,row);
      (partner.links||[]).forEach(function(link){var line=document.createElement('div'),url=document.createElement('code');
        var address=new URL('/',location.origin);address.searchParams.set('ref',link.code);url.textContent=address.href;line.appendChild(url);article.appendChild(line);
      });list.appendChild(article);
    });status.textContent='Dados atualizados.';
  }
  var accessTimer=setTimeout(function(){if(status.textContent.indexOf('Verificando acesso')!==-1)status.textContent='A autenticação não respondeu. Atualize a página ou entre novamente.';},12000);
  try{window.firebase.auth().onAuthStateChanged(async function(user){
    clearTimeout(accessTimer);
    if(!user){status.textContent='Entre na conta administrativa pelo painel.';return;}
    status.textContent='Validando acesso administrativo…';
    try{await timed(user.getIdToken(true),10000,'A autenticação demorou demais. Atualize a página.');var marker=await timed(window.firebase.database().ref('admins/'+user.uid).once('value'),10000,'O Realtime Database não respondeu. Atualize a página.');
      if(marker.val()!==true)throw new Error('Acesso administrativo obrigatório.');content.hidden=false;await refresh();
      var config=(await api('settings',{read:true})).settings||{},form=document.getElementById('settings');
      form.elements.allowPartnerLinks.checked=config.allowPartnerLinks===true;form.elements.payoutsEnabled.checked=config.payoutsEnabled===true;
      form.elements.minPayout.value=Number(config.minPayout)||0;form.elements.currency.value=config.currency||'BRL';form.elements.commissionDescription.value=config.commissionDescription||'';
    }catch(error){content.hidden=true;status.textContent=error.message;}
  },function(error){clearTimeout(accessTimer);content.hidden=true;status.textContent='Falha ao verificar a autenticação: '+error.message;});}catch(error){clearTimeout(accessTimer);content.hidden=true;status.textContent='Falha ao iniciar a autenticação: '+error.message;}
  document.getElementById('create').addEventListener('submit',async function(event){event.preventDefault();
    var data=new FormData(event.currentTarget);try{await api('create',{uid:data.get('uid'),label:data.get('label')});event.currentTarget.reset();await refresh();}catch(error){status.textContent=error.message;}
  });
  document.getElementById('settings').addEventListener('submit',async function(event){event.preventDefault();var form=event.currentTarget;
    try{await api('settings',{allowPartnerLinks:form.elements.allowPartnerLinks.checked,payoutsEnabled:form.elements.payoutsEnabled.checked,minPayout:Number(form.elements.minPayout.value),currency:form.elements.currency.value,commissionDescription:form.elements.commissionDescription.value});status.textContent='Configurações salvas.';}catch(error){status.textContent=error.message;}
  });
})();
