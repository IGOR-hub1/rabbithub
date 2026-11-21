'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');

function page(account,storage=new Map()){
  const handlers={},attributes={},properties={};
  const style={setProperty:(key,value)=>properties[key]=value,getPropertyValue:key=>properties[key]||''};
  const element=()=>({style,classList:{add(){},remove(){}},setAttribute(){},appendChild(){}});
  const root=Object.assign(element(),{setAttribute:(key,value)=>attributes[key]=value,getAttribute:key=>attributes[key],removeAttribute:key=>delete attributes[key]});
  const document={readyState:'loading',documentElement:root,head:element(),hidden:false,
    createElement:element,querySelector:()=>null,querySelectorAll:()=>[],
    addEventListener:(name,fn)=>(handlers[name]||(handlers[name]=[])).push(fn),
    dispatchEvent:event=>(handlers[event.type]||[]).forEach(fn=>fn(event))};
  const access={ready:true,customTheme:true,isVip:true,uid:'owner'};
  const state={status:'authenticated',uid:'owner',profile:{id:'principal'},account};
  let denied=false;
  const writes=[];
  const window={document,location:{pathname:'/index.html'},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},addEventListener(){},
    DK_FIREBASE_CONFIG:{},RabbitHubPlans:{get:()=>access},RabbitHubSession:{get:()=>state,
      async updateAccount(updates){
        if(denied)throw new Error('Permission denied');
        writes.push(updates);
        for(const [key,value] of Object.entries(updates)){
          const parts=key.split('/');let node=account;
          for(const part of parts.slice(0,-1))node=node[part]||(node[part]={});
          node[parts.at(-1)]=value;
        }
        document.dispatchEvent({type:'rh:sessionchange',detail:state});
        return account;
      }
    }};
  const db={ref(){return {update(){throw new Error('Unexpected SDK write');}};}};
  function database(){return db;}database.ServerValue={TIMESTAMP:123};
  const firebase={database,app:()=>({database:()=>db})};window.firebase=firebase;
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const context=vm.createContext({window,document,localStorage,firebase,location:window.location,console,
    getComputedStyle:()=>style,CustomEvent:function(type,options){this.type=type;this.detail=options&&options.detail;}});
  vm.runInContext(read('theme.js'),context);
  vm.runInContext(read('profile-data.js'),context);
  return {window,access,properties,attributes,storage,writes,document,deny:()=>denied=true};
}

test('oito temas persistem, reabrem sem cache e sincronizam com outra tela',async()=>{
  const account={profiles:[{id:'principal',theme:'blue',banner:'default'}]};
  const first=page(account);
  first.window.DK_setGlobalTheme('orange');
  assert.equal(first.window.DK_getTheme(),'orange','VIP sem escolha usa tema global');
  await first.window.RabbitHubProfileData.saveProfileCustomization({banner:'default'});
  assert.equal(first.window.DK_getTheme(),'orange','salvar banner nao cria preferencia de tema');
  assert.equal(account.profileCustomization.principal.theme,undefined);
  for(const color of Object.keys(first.window.DK_THEMES)){
    const count=first.writes.length;
    const result=await first.window.RabbitHubProfileData.saveProfileCustomization({theme:color});
    assert.equal(result.synced,true);
    assert.equal(first.writes.length,count+1,'aplicar faz apenas uma gravacao');
    assert.equal(first.writes.at(-1)['profileCustomization/principal/theme'],color);
    assert.equal(first.writes.at(-1)['profileCustomization/principal/banner'],undefined);
    const reopened=page(JSON.parse(JSON.stringify(account)));
    reopened.window.DK_setGlobalTheme('green');
    await reopened.window.RabbitHubProfileData.getProfileCustomization();
    assert.equal(reopened.window.DK_getTheme(),color);
    assert.equal(reopened.attributes['data-theme'],color);
    assert.equal(reopened.properties['--brand'],first.window.DK_THEMES[color].brand);
    assert.equal(reopened.properties['--theme-accent'],first.window.DK_THEMES[color].brand);
    assert.equal(reopened.writes.length,0,'abrir outra tela nao grava tema');
  }
  account.profileCustomization.principal.theme='purple';
  first.document.dispatchEvent({type:'rh:sessionchange'});
  assert.equal(first.attributes['data-theme'],'purple','alteracao remota atualiza tela aberta');
});

test('Free segue admin sem apagar escolha VIP e falha nao altera tema',async()=>{
  const account={profiles:[{id:'principal',theme:'pink'}],profileCustomization:{principal:{theme:'pink'}}};
  const client=page(account);
  client.window.DK_setGlobalTheme('cyan');
  client.access.customTheme=false;client.access.isVip=false;
  client.window.DK_verifyTheme();
  assert.equal(client.attributes['data-theme'],'cyan');
  await assert.rejects(client.window.RabbitHubProfileData.saveProfileCustomization({theme:'blue'}),/VIP/);
  client.window.DK_setGlobalTheme('red');
  assert.equal(client.attributes['data-theme'],'red');
  assert.equal(account.profileCustomization.principal.theme,'pink');
  client.access.customTheme=true;client.access.isVip=true;
  client.window.DK_verifyTheme();
  assert.equal(client.attributes['data-theme'],'pink');
  client.deny();
  const result=await client.window.RabbitHubProfileData.saveProfileCustomization({theme:'yellow'});
  assert.equal(result.synced,false);
  assert.equal(client.attributes['data-theme'],'pink');
  assert.equal(account.profileCustomization.principal.theme,'pink');
});
