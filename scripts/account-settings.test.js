'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('preferencias aguardam confirmacao e preservam cache quando a gravacao falha',async()=>{
  const storage=new Map();
  const account={profilePreferences:{principal:{blockAdult:false,hiddenGenres:['terror'],aiFillers:false,aiSkip:false}}};
  const writes=[];
  let denied=false;
  const window={
    DK_FIREBASE_CONFIG:{},
    RabbitHubSession:{
      get:()=>({status:'authenticated',uid:'owner',profile:{id:'principal'},account}),
      async updateAccount(updates){
        if(denied)throw new Error('Permission denied');
        writes.push(updates);
        for(const [key,value] of Object.entries(updates))account.profilePreferences.principal[key.split('/').at(-1)]=value;
        return account;
      }
    },
    setTimeout,clearTimeout
  };
  const database=()=>({});database.ServerValue={TIMESTAMP:123};
  const firebase={apps:[{}],database};window.firebase=firebase;
  const document={readyState:'loading',addEventListener(){},dispatchEvent(){}};
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/user-features.js'),'utf8'),{
    window,firebase,document,localStorage,setTimeout,clearTimeout,CustomEvent:function(){},console
  });
  const service=window.RabbitHubFeatures;
  const result=await service.savePreferences({blockAdult:true});
  assert.equal(result.synced,true);
  assert.equal(service.getPreferences().blockAdult,true);
  assert.equal(service.getPreferences().hiddenGenres[0],'terror');
  assert.equal(writes[0]['profilePreferences/principal/hiddenGenres'],undefined);
  denied=true;
  await assert.rejects(service.savePreferences({blockAdult:false}),/Permission denied/);
  assert.equal(service.getPreferences().blockAdult,true);
});
