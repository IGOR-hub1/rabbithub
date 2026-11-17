/* Authenticated RTDB transport for the admin UI. No optimistic writes. */
(function(){
  'use strict';
  function create(config){
    var base=String(config.databaseURL).replace(/\/+$/,'');
    var subscriptions=[],connected=false,closed=false;
    // The SDK owns live subscriptions; REST remains the confirmed write transport.
    var liveDatabase=config.database || (window.firebase && window.firebase.database && window.firebase.database());
    var fetcher=config.fetch||window.fetch.bind(window);
    function snapshot(value,key){return {key:key||null,val:function(){return value;},exists:function(){return value!=null;},forEach:function(callback){
      return Object.keys(value||{}).some(function(name){return callback(snapshot(value[name],name))===true;});
    }};}
    function connection(value){
      if(connected===value)return;connected=value;
      subscriptions.filter(function(item){return item.path==='.info/connected';}).forEach(function(item){item.callback(snapshot(value));});
    }
    async function request(path,method,value,etag,query){
      var user=config.auth().currentUser;
      if(closed||!user)throw new Error('Entre novamente no painel.');
      var controller=new AbortController();
      var timer=setTimeout(function(){controller.abort();},config.timeout||10000);
      try{
        var token=await Promise.race([user.getIdToken(false),new Promise(function(resolve,reject){controller.signal.addEventListener('abort',function(){var error=new Error('Tempo excedido.');error.name='AbortError';reject(error);},{once:true});})]);
        if(closed||config.auth().currentUser!==user)throw new Error('A sessão mudou.');
        var url=new URL(base+'/'+path.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'.json');
        url.searchParams.set('auth',token);
        Object.keys(query||{}).forEach(function(key){url.searchParams.set(key,JSON.stringify(query[key]));});
        var headers={'Accept':'application/json'};
        if(etag===true)headers['X-Firebase-ETag']='true';
        else if(etag)headers['if-match']=etag;
        if(value!==undefined)headers['Content-Type']='application/json';
        var response=await fetcher(url.href,{method:method||'GET',headers:headers,body:value===undefined?undefined:JSON.stringify(value),cache:'no-store',signal:controller.signal});
        var body=await response.json();
        if(!response.ok){
          var error=new Error(response.status===401||response.status===403
            ? 'O Firebase negou a operação. Verifique a sessão administrativa e as regras publicadas.'
            : 'Falha no Firebase (HTTP '+response.status+'). Tente novamente.');
          error.status=response.status;throw error;
        }
        if(closed||config.auth().currentUser!==user)throw new Error('A sessão mudou.');
        if(!liveDatabase)connection(true);
        return {value:body,etag:response.headers.get('etag')};
      }catch(error){
        if(!liveDatabase)connection(false);
        if(error.name==='AbortError')throw new Error('O Firebase demorou para responder. Tente novamente.');
        throw error;
      }finally{clearTimeout(timer);}
    }
    async function poll(item){
      if(item.busy||item.stopped||closed)return;
      item.busy=true;
      try{
        var result=await request(item.path,'GET',undefined,undefined,item.query);
        if(item.stopped||item.refreshAfter)return;
        var serialized=JSON.stringify(result.value);
        if(serialized!==item.last){item.last=serialized;item.callback(snapshot(result.value));}
      }catch(error){if(!item.stopped&&item.error)item.error(error);}
      finally{
        item.busy=false;
        if(!item.stopped&&!closed){var delay=item.refreshAfter?0:(config.pollMs||5000);item.refreshAfter=false;item.timer=setTimeout(function(){poll(item);},delay);}
      }
    }
    function refresh(path){
      subscriptions.forEach(function(item){
        if(item.path==='.info/connected')return;
        if(!path||item.path===path||item.path.indexOf(path+'/')===0||path.indexOf(item.path+'/')===0){
          if(item.nativeRef) return;
          clearTimeout(item.timer);if(item.busy)item.refreshAfter=true;else poll(item);
        }
      });
    }
    function ref(path,query){
      path=String(path||'').replace(/^\/+|\/+$/g,'');query=query||{};
      return {
        key:path.split('/').pop()||null,
        push:function(){
          var bytes=new Uint8Array(16);window.crypto.getRandomValues(bytes);
          var key=Date.now().toString(36)+'_'+Array.from(bytes,function(value){return value.toString(16).padStart(2,'0');}).join('');
          return ref([path,key].filter(Boolean).join('/'));
        },
        child:function(child){return ref([path,child].filter(Boolean).join('/'));},
        orderByChild:function(key){return ref(path,Object.assign({},query,{orderBy:key}));},
        limitToLast:function(count){return ref(path,Object.assign({},query,{limitToLast:count}));},
        once:async function(){var result=await request(path,'GET',undefined,undefined,query);return snapshot(result.value);},
        on:function(event,callback,error){
          if(event!=='value')throw new Error('Evento não suportado: '+event);
          var item={path:path,query:query,callback:callback,error:error,last:undefined,stopped:false};
          subscriptions.push(item);
          if(liveDatabase){
            var nativeRef=liveDatabase.ref(path);
            if(query.orderBy)nativeRef=nativeRef.orderByChild(query.orderBy);
            if(query.limitToLast)nativeRef=nativeRef.limitToLast(query.limitToLast);
            item.nativeRef=nativeRef;
            item.nativeCallback=path==='.info/connected'
              ? function(s){connection(s.val()===true);}
              : function(s){if(!item.stopped&&!closed)callback(s);};
            item.nativeError=function(e){if(!item.stopped&&!closed){if(path==='.info/connected')connection(false);if(error)error(e);}};
            nativeRef.on('value',item.nativeCallback,item.nativeError);
          }else if(path==='.info/connected')callback(snapshot(connected));else poll(item);
          return callback;
        },
        off:function(event,callback){subscriptions.filter(function(item){return item.path===path&&(!callback||item.callback===callback);}).forEach(function(item){item.stopped=true;clearTimeout(item.timer);if(item.nativeRef)item.nativeRef.off('value',item.nativeCallback);});subscriptions=subscriptions.filter(function(item){return !item.stopped;});},
        set:async function(value){await request(path,'PUT',value);refresh(path);},
        update:async function(value){await request(path,'PATCH',value);refresh(path);},
        remove:async function(){await request(path,'DELETE');refresh(path);},
        transaction:async function(update){
          for(var attempt=0;attempt<4;attempt++){
            var previous=await request(path,'GET',undefined,true);
            var next=update(previous.value);
            if(next===undefined)return {committed:false,snapshot:snapshot(previous.value)};
            if(!previous.etag)throw new Error('O Firebase não retornou a versão dos dados. A gravação foi cancelada.');
            try{
              var result=await request(path,'PUT',next,previous.etag);refresh(path);
              return {committed:true,snapshot:snapshot(result.value)};
            }catch(error){if(error.status!==412||attempt===3)throw error;}
          }
        }
      };
    }
    return {ref:ref,close:function(){closed=true;subscriptions.forEach(function(item){item.stopped=true;clearTimeout(item.timer);if(item.nativeRef)item.nativeRef.off('value',item.nativeCallback);});subscriptions=[];}};
  }
  window.RabbitHubAdminDatabase={create:create};
})();
