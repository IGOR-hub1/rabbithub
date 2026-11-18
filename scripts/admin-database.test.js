'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');

test('admin faz leituras e gravações HTTP confirmadas sem depender do socket SDK',async t=>{
  const data={config:{theme:'blue',contact:'preservado'},items:{first:{name:'Original'}}};
  const requests=[];let version=1,conflict=false,deny=false;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),keys=url.pathname.replace(/\.json$/,'').split('/').filter(Boolean).map(decodeURIComponent);
    requests.push({method:req.method,path:url.pathname,query:url.searchParams,etag:req.headers['if-match']});
    res.setHeader('Content-Type','application/json');res.setHeader('ETag','"'+version+'"');
    if(deny||url.searchParams.get('auth')!=='test-token'){res.writeHead(403);return res.end(JSON.stringify({error:'Permission denied'}));}
    if(keys[0]==='timeout')return;
    const get=parts=>parts.reduce((node,key)=>node&&node[key],data)??null;
    const put=(parts,value)=>{const last=parts.pop();let node=data;parts.forEach(key=>{node[key]??={};node=node[key];});if(value===null)delete node[last];else node[last]=value;};
    let body='';for await(const chunk of req)body+=chunk;
    if(req.method==='PUT'&&req.headers['if-match']){
      if(conflict){data.items.concurrent={name:'Outro editor'};version++;conflict=false;}
      if(req.headers['if-match']!=='"'+version+'"'){res.writeHead(412);return res.end(JSON.stringify(get(keys)));}
    }
    if(req.method==='PUT')put([...keys],JSON.parse(body));
    if(req.method==='DELETE')put([...keys],null);
    if(req.method==='PATCH')Object.entries(JSON.parse(body)).forEach(([key,value])=>put(keys.concat(key.split('/')),value));
    if(req.method!=='GET')version++;
    res.end(JSON.stringify(get(keys)));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const window={fetch,crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin-database.js'),'utf8'),{window,URL,AbortController,setTimeout,clearTimeout});
  const user={getIdToken:async()=> 'test-token'};
  const db=window.RabbitHubAdminDatabase.create({databaseURL:'http://127.0.0.1:'+server.address().port,auth:()=>({currentUser:user}),timeout:1500,pollMs:30});
  t.after(()=>db.close());
  assert.equal((await db.ref('config').once('value')).val().contact,'preservado');
  await db.ref('config').update({theme:'red'});
  assert.deepEqual(data.config,{theme:'red',contact:'preservado'});
  await db.ref().update({'config/theme':'green','config/other':true});
  assert.equal(data.config.theme,'green');assert.equal(data.config.contact,'preservado');
  const notification=db.ref('notifications/user/u').push();
  const second=db.ref('notifications/user/u').push();
  assert.notEqual(notification.key,second.key);
  await notification.set({message:'Aviso de teste'});
  assert.equal(data.notifications.user.u[notification.key].message,'Aviso de teste');
  conflict=true;
  const transaction=await db.ref('items').transaction(current=>Object.assign({},current,{added:{name:'Novo'}}));
  assert.equal(transaction.committed,true);
  assert.deepEqual(Object.keys(data.items).sort(),['added','concurrent','first']);
  const before=requests.filter(r=>r.method==='PUT').length;
  const skipped=await db.ref('items').transaction(()=>undefined);
  assert.equal(skipped.committed,false);assert.equal(requests.filter(r=>r.method==='PUT').length,before);
  const names=[];transaction.snapshot.forEach(s=>names.push(s.key));assert.equal(names.length,3);
  await db.ref('items').orderByChild('updatedAt').limitToLast(50).once('value');
  assert.equal(requests.at(-1).query.get('orderBy'),'"updatedAt"');
  assert.equal(requests.at(-1).query.get('limitToLast'),'50');
  let received;
  const updated=new Promise(resolve=>{received=resolve;});
  db.ref('config').on('value',snapshot=>{if(snapshot.val().theme==='purple')received();});
  await db.ref('config').update({theme:'purple'});
  await Promise.race([updated,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Polling não confirmou escrita')),1000);timer.unref();})]);
  db.ref('config').off();
  deny=true;await assert.rejects(db.ref('config').update({theme:'yellow'}),/negou/);assert.equal(data.config.theme,'purple');
  deny=false;await assert.rejects(db.ref('timeout').once('value'),/demorou/);
  await db.ref('items/added').remove();assert.equal(data.items.added,undefined);
  db.close();await assert.rejects(db.ref('config').set({}),/novamente/);
});

test('admin também encerra espera por token que nunca resolve',async()=>{
  const window={fetch};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin-database.js'),'utf8'),{window,URL,AbortController,setTimeout,clearTimeout});
  const user={getIdToken:()=>new Promise(()=>{})};
  const db=window.RabbitHubAdminDatabase.create({databaseURL:'https://unused.invalid',auth:()=>({currentUser:user}),timeout:20});
  await assert.rejects(db.ref('config').once('value'),/demorou/);db.close();
});

test('assinatura nativa recebe alterações remotas e é encerrada corretamente',async()=>{
  const listeners=new Map();
  const firebase={database:()=>({ref(path){return {
    on(event,callback){listeners.set(path,callback);callback({val:()=>path==='.info/connected'});},
    off(event,callback){if(listeners.get(path)===callback)listeners.delete(path);},
    orderByChild(){return this;},limitToLast(){return this;}
  };}})};
  const window={fetch,crypto:require('node:crypto').webcrypto,firebase};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin-database.js'),'utf8'),{window,URL,AbortController,setTimeout,clearTimeout});
  const user={getIdToken:async()=> 'test-token'};
  const db=window.RabbitHubAdminDatabase.create({databaseURL:'https://unused.invalid',auth:()=>({currentUser:user})});
  const values=[];
  const callback=snapshot=>values.push(snapshot.val());
  db.ref('dk_broadcast/config').on('value',callback);
  listeners.get('dk_broadcast/config')({val:()=>({forcedTheme:'purple'})});
  assert.equal(values.at(-1).forcedTheme,'purple');
  db.ref('dk_broadcast/config').off('value',callback);
  assert.equal(listeners.has('dk_broadcast/config'),false);
  db.ref('users').on('value',callback);
  db.close();
  assert.equal(listeners.size,0);
});
