(function(){
  'use strict';
  var KEY='rh_aff_click_v1',CHOICE='rh_aff_consent_v1',WINDOW=30*86400000;
  function blocked(){
    return navigator.globalPrivacyControl===true||navigator.doNotTrack==='1'||localStorage.getItem(CHOICE)==='no';
  }
  function pending(){try{if(blocked()){localStorage.removeItem(KEY);return null;}var value=JSON.parse(localStorage.getItem(KEY)||'null');return value&&Date.now()-value.at<WINDOW?value:null;}catch(_){return null;}}
  async function api(name,body,user){
    var headers={'Content-Type':'application/json'};
    if(user)headers.Authorization='Bearer '+await user.getIdToken();
    var response=await fetch('/api/affiliates/'+name,{method:'POST',headers:headers,body:JSON.stringify(body),cache:'no-store'});
    var result=await response.json();if(!response.ok)throw new Error(result.error||'Falha na indicação.');return result;
  }
  function claim(user){var value=pending();if(!value||!user||!user.emailVerified)return;
    api('claim',{clickId:value.clickId},user).then(function(){localStorage.removeItem(KEY);}).catch(function(error){
      if(/expirada|fora dos 30|indisponível|inválido/.test(error.message))localStorage.removeItem(KEY);
    });
  }
  function capture(code){api('click',{code:code,consent:true}).then(function(result){
    var old=pending();if(!old||result.at>=old.at)localStorage.setItem(KEY,JSON.stringify({clickId:result.clickId,at:result.at}));
    if(window.firebase&&firebase.auth)claim(firebase.auth().currentUser);
  }).catch(function(){});}
  function ask(code){
    var box=document.createElement('div');box.setAttribute('role','dialog');box.setAttribute('aria-label','Indicação de parceiro');
    box.style.cssText='position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:560px;margin:auto;padding:18px;border:1px solid #70539a;border-radius:14px;background:#19151f;color:#fff;box-shadow:0 12px 40px #0009;font:14px/1.5 Arial,sans-serif';
    var message=document.createElement('p');message.textContent='Este link é de um parceiro. Você permite registrar a visita e vincular a indicação à sua conta se criar um cadastro nos próximos 30 dias? Usamos um identificador aleatório, sem salvar seu IP.';
    var accept=document.createElement('button'),decline=document.createElement('button');accept.textContent='Permitir';decline.textContent='Não permitir';
    [accept,decline].forEach(function(button){button.type='button';button.style.cssText='margin:4px 10px 0 0;padding:8px 13px;border-radius:8px;border:0;cursor:pointer';box.appendChild(button);});
    box.insertBefore(message,accept);document.body.appendChild(box);
    accept.onclick=function(){localStorage.setItem(CHOICE,'yes');box.remove();capture(code);};
    decline.onclick=function(){localStorage.setItem(CHOICE,'no');box.remove();localStorage.removeItem(KEY);};
  }
  function start(){
    var code=new URLSearchParams(location.search).get('ref');
    if(code&&/^[A-Za-z0-9]{6,20}$/.test(code)&&!blocked()){
      if(localStorage.getItem(CHOICE)==='yes')capture(code.toUpperCase());else ask(code.toUpperCase());
    }
    document.addEventListener('dk:userready',function(event){claim(event.detail&&event.detail.authUser||firebase.auth().currentUser);});
    if(window.firebase&&firebase.auth)firebase.auth().onAuthStateChanged(claim);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
