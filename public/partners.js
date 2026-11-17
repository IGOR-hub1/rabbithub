(function(){
  'use strict';
  var status=document.getElementById('status'),list=document.getElementById('partners'),content=document.getElementById('content');
  firebase.initializeApp(window.DK_FIREBASE_CONFIG);
  async function api(action,body){
    var user=firebase.auth().currentUser;if(!user)throw new Error('Entre na conta administrativa.');
    var response=await fetch('/api/affiliates/'+action,{method:action==='list'?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:action==='list'?undefined:JSON.stringify(body),cache:'no-store'});
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
  firebase.auth().onAuthStateChanged(async function(user){
    if(!user){status.textContent='Entre na conta administrativa pelo painel.';return;}
    try{await user.getIdToken(true);var marker=await firebase.database().ref('admins/'+user.uid).once('value');
      if(marker.val()!==true)throw new Error('Acesso administrativo obrigatório.');content.hidden=false;await refresh();
      var config=(await api('settings',{read:true})).settings||{},form=document.getElementById('settings');
      form.elements.allowPartnerLinks.checked=config.allowPartnerLinks===true;form.elements.payoutsEnabled.checked=config.payoutsEnabled===true;
      form.elements.minPayout.value=Number(config.minPayout)||0;form.elements.currency.value=config.currency||'BRL';form.elements.commissionDescription.value=config.commissionDescription||'';
    }catch(error){content.hidden=true;status.textContent=error.message;}
  });
  document.getElementById('create').addEventListener('submit',async function(event){event.preventDefault();
    var data=new FormData(event.currentTarget);try{await api('create',{uid:data.get('uid'),label:data.get('label')});event.currentTarget.reset();await refresh();}catch(error){status.textContent=error.message;}
  });
  document.getElementById('settings').addEventListener('submit',async function(event){event.preventDefault();var form=event.currentTarget;
    try{await api('settings',{allowPartnerLinks:form.elements.allowPartnerLinks.checked,payoutsEnabled:form.elements.payoutsEnabled.checked,minPayout:Number(form.elements.minPayout.value),currency:form.elements.currency.value,commissionDescription:form.elements.commissionDescription.value});status.textContent='Configurações salvas.';}catch(error){status.textContent=error.message;}
  });
})();
