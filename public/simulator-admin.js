(function(){'use strict';
  firebase.initializeApp(window.DK_FIREBASE_CONFIG);
  var $=id=>document.getElementById(id),data=null,users=[];
  var entries=value=>Object.entries(value||{}).map(([id,item])=>({id,...item}));
  var el=(tag,text)=>{var node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
  async function api(action,body){var user=firebase.auth().currentUser;if(!user)throw new Error('Acesso administrativo obrigatório.');var response=await fetch('/api/affiliates/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify(body||{}),cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Falha no simulador.');return result;}
  function message(value){$('message').textContent=value;}
  async function load(){try{data=await api('adminData');users=(await api('simulationUsers')).users||[];$('app').hidden=false;$('mode').textContent=data.affiliateSettings.simulationEnabled===true?'Modo ativo':'Modo desativado';render();message('Dados de teste atualizados.');}catch(error){$('app').hidden=true;message(error.message);}}
  function render(){var enabled=data.affiliateSettings.simulationEnabled===true,usersList=$('test-user'),linksList=$('test-link'),flowsList=$('flow'),selectedUser=usersList.value,selectedLink=linksList.value,selectedFlow=flowsList.value;
    usersList.replaceChildren(...users.map(user=>new Option(user.label+' · '+user.uid,user.uid)));if(selectedUser)usersList.value=selectedUser;
    linksList.replaceChildren(...entries(data.referralLinks).filter(link=>link.active&&data.partners[link.partnerUid]&&data.partners[link.partnerUid].status==='approved').map(link=>new Option((data.partners[link.partnerUid].label||link.partnerUid)+' · '+(link.campaign||'Geral')+' · '+link.code,link.code)));if(selectedLink)linksList.value=selectedLink;
    var flows=entries(data.simulationFlows).sort((a,b)=>b.createdAt-a.createdAt);flowsList.replaceChildren(...flows.map(flow=>new Option(flow.id+' · '+(flow.purchase&&flow.purchase.status||'sem compra'),flow.id)));if(selectedFlow)flowsList.value=selectedFlow;
    document.querySelectorAll('form button').forEach(button=>button.disabled=!enabled);
    var root=$('flows');root.replaceChildren();if(!flows.length){var empty=el('div','Nenhum teste realizado.');empty.className='empty';root.append(empty);return;}
    flows.forEach(flow=>{var row=el('div'),left=el('div'),actions=el('div');row.className='row';actions.className='actions';var partner=data.partners[flow.partnerUid]||{},purchase=flow.purchase||{},commission=flow.commission||{};
      left.append(el('strong',(partner.label||flow.partnerUid)+' · '+flow.campaign+' · '+flow.code),el('span','Teste '+flow.id+' · '+flow.uid+' · '+(purchase.plan||'sem plano')+' · '+(purchase.status||'sem compra')+' · valor fictício '+(purchase.amount||0)+' · comissão simulada '+(commission.amount||0)));
      function update(status){api('simulationPurchase',{flowId:flow.id,plan:purchase.plan,amount:purchase.amount,status,requestId:crypto.randomUUID()}).then(load).catch(error=>message(error.message));}
      if(enabled&&purchase.status==='pending'){var approve=el('button','Aprovar');approve.onclick=()=>update('approved');var decline=el('button','Recusar');decline.onclick=()=>update('declined');actions.append(approve,decline);}
      if(enabled&&purchase.status==='approved'){var reverse=el('button','Estornar');reverse.onclick=()=>update('reversed');actions.append(reverse);}
      row.append(left,actions);root.append(row);
    });
  }
  $('start').onsubmit=async event=>{event.preventDefault();var form=event.currentTarget;try{var result=await api('simulationStart',{uid:form.elements.uid.value,code:form.elements.code.value});await load();$('flow').value=result.flow.id;message('Percurso de teste criado. Selecione o plano e o resultado da compra.');}catch(error){message(error.message);}};
  $('authorize').onsubmit=async event=>{event.preventDefault();var form=event.currentTarget,uid=form.elements.uid.value.trim();if(!confirm('Autorizar esta conta para testes simulados?'))return;try{await api('simulationTestAccount',{uid,enabled:true});form.reset();await load();$('test-user').value=uid;message('Conta de teste autorizada.');}catch(error){message(error.message);}};
  $('purchase').onsubmit=async event=>{event.preventDefault();var form=event.currentTarget;try{var result=await api('simulationPurchase',{flowId:form.elements.flowId.value,plan:form.elements.plan.value,amount:Number(form.elements.amount.value),status:form.elements.status.value,requestId:crypto.randomUUID()});await load();message('Compra '+result.flow.purchase.status+' · comissão simulada '+result.flow.commission.amount+'. Nenhum dinheiro foi movimentado.');}catch(error){message(error.message);}};
  $('clear').onclick=async()=>{var phrase=prompt('Para apagar somente os testes, digite LIMPAR SIMULACOES:');if(phrase!=='LIMPAR SIMULACOES')return;try{var result=await api('simulationClear',{confirmation:phrase});await load();message(result.removed+' percursos simulados removidos.');}catch(error){message(error.message);}};
  firebase.auth().onAuthStateChanged(user=>{if(user)load();else message('Entre no Admin para acessar o simulador.');});
})();
