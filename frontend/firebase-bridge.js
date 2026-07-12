/* =====================================================================
 * DRAKSYON • Firebase Bridge (frontend)
 * ---------------------------------------------------------------------
 * Intercepta chamadas a /proxy?url=... e roteia via Firebase RTDB:
 *   1) Hash da URL -> lê /animes/{hash}  (cache remoto)
 *   2) Se não houver, escreve /queue/{jobId} e escuta /results/{jobId}
 *   3) O worker (LunesHost) baixa e escreve /animes/{hash} + /results/{jobId}
 *
 * /stream?url=... NÃO passa pelo Firebase (vídeo é grande demais):
 * continua indo direto pro backend definido em window.LUNES_BACKEND.
 * ===================================================================== */
(function () {
  var BACKEND = (window.LUNES_BACKEND || "").replace(/\/+$/, "");
  var CACHE_TTL   = 30 * 60 * 1000;   // 30 min (mesmo TTL do worker)
  var JOB_TIMEOUT = 45 * 1000;        // 45s

  function log(){ try{ console.log.apply(console, ['[dk-fb]'].concat([].slice.call(arguments))); }catch(e){} }

  function ensureFirebase(cb){
    if (window.firebase && firebase.database) return cb();
    // Se o dono da página não carregou firebase, injetamos on-demand.
    function load(src, done){
      var s = document.createElement('script');
      s.src = src; s.onload = done; s.onerror = done;
      document.head.appendChild(s);
    }
    load('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', function(){
      load('https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js', function(){
        cb();
      });
    });
  }

  function initFb(){
    if (!window.firebase || !firebase.database) return null;
    if (!window.__DK_FB_INIT__ && window.DK_FIREBASE_CONFIG){
      try { firebase.initializeApp(window.DK_FIREBASE_CONFIG); } catch(e){}
      window.__DK_FB_INIT__ = true;
    }
    try { return firebase.database(); } catch(e){ return null; }
  }

  // SHA-1 em JS puro (para hash igual ao do worker Node).
  function sha1(str){
    function rotl(n,b){ return (n<<b)|(n>>>(32-b)); }
    var msg = unescape(encodeURIComponent(str));
    var H0=0x67452301,H1=0xEFCDAB89,H2=0x98BADCFE,H3=0x10325476,H4=0xC3D2E1F0;
    var ml = msg.length*8;
    msg += '\x80';
    while ((msg.length%64) !== 56) msg += '\x00';
    var bytes = new Array(msg.length);
    for (var i=0;i<msg.length;i++) bytes[i]=msg.charCodeAt(i)&0xff;
    for (var i=0;i<8;i++) bytes.push((ml>>>(8*(7-i)))&0xff);
    for (var chunk=0; chunk<bytes.length; chunk+=64){
      var w = new Array(80);
      for (var i=0;i<16;i++){
        w[i] = (bytes[chunk+i*4]<<24)|(bytes[chunk+i*4+1]<<16)|(bytes[chunk+i*4+2]<<8)|(bytes[chunk+i*4+3]);
      }
      for (var i=16;i<80;i++) w[i] = rotl(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);
      var a=H0,b=H1,c=H2,d=H3,e=H4;
      for (var i=0;i<80;i++){
        var f,k;
        if (i<20){ f=(b&c)|((~b)&d); k=0x5A827999; }
        else if (i<40){ f=b^c^d; k=0x6ED9EBA1; }
        else if (i<60){ f=(b&c)|(b&d)|(c&d); k=0x8F1BBCDC; }
        else { f=b^c^d; k=0xCA62C1D6; }
        var t = (rotl(a,5) + f + e + k + w[i])|0;
        e=d; d=c; c=rotl(b,30); b=a; a=t;
      }
      H0=(H0+a)|0; H1=(H1+b)|0; H2=(H2+c)|0; H3=(H3+d)|0; H4=(H4+e)|0;
    }
    function hex(n){ var s='',v; for (var i=7;i>=0;i--){ v=(n>>>(i*4))&0xf; s+=v.toString(16);} return s; }
    return hex(H0)+hex(H1)+hex(H2)+hex(H3)+hex(H4);
  }

  function b64ToBlob(b64, type){
    var bin = atob(b64);
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var i=0;i<len;i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: type || 'text/html; charset=utf-8' });
  }

  function makeResponse(cached){
    var blob = b64ToBlob(cached.bodyB64, cached.contentType || 'text/html; charset=utf-8');
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Type': cached.contentType || 'text/html; charset=utf-8', 'X-Draksyon-Cache': cached.cache || 'HIT' }
    });
  }

  // Cache local em memória para não bater na RTDB toda vez
  var mem = new Map();

  function fetchViaFirebase(method, target, body){
    return new Promise(function (resolve, reject) {
      var db = initFb();
      if (!db) return reject(new Error('Firebase não inicializado'));

      var key = sha1((method||'GET')+'|'+target+'|'+(body||''));

      // memória local
      var m = mem.get(key);
      if (m && (Date.now()-m.ts) < CACHE_TTL){
        return resolve(makeResponse({ bodyB64:m.bodyB64, contentType:m.contentType, cache:'MEM' }));
      }

      // 1) tenta cache remoto
      db.ref('animes/'+key).get().then(function(snap){
        if (snap.exists()){
          var v = snap.val();
          if (Date.now() - (v.ts||0) < CACHE_TTL){
            mem.set(key, { bodyB64:v.bodyB64, contentType:v.contentType, ts:v.ts });
            return resolve(makeResponse({ bodyB64:v.bodyB64, contentType:v.contentType, cache:'HIT-REMOTE' }));
          }
        }
        // 2) publica pedido na fila
        var jobRef = db.ref('queue').push();
        var jobId  = jobRef.key;
        var payload = { method: method||'GET', url: target, ts: Date.now() };
        if (body) payload.body = String(body);
        jobRef.set(payload);

        var resultRef = db.ref('results/'+jobId);
        var settled = false;
        var timer = setTimeout(function(){
          if (settled) return; settled = true;
          try{ resultRef.off(); }catch(e){}
          try{ db.ref('queue/'+jobId).remove(); }catch(e){}
          try{ resultRef.remove(); }catch(e){}
          reject(new Error('Timeout aguardando worker (45s)'));
        }, JOB_TIMEOUT);

        resultRef.on('value', function(snap2){
          if (!snap2.exists()) return;
          var r = snap2.val();
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try{ resultRef.off(); }catch(e){}
          // limpa /results/{jobId} depois de consumir
          setTimeout(function(){ try{ resultRef.remove(); }catch(e){} }, 500);
          if (!r.ok){ return reject(new Error(r.error || 'Falha no worker')); }
          mem.set(key, { bodyB64:r.bodyB64, contentType:r.contentType, ts:Date.now() });
          resolve(makeResponse({ bodyB64:r.bodyB64, contentType:r.contentType, cache:r.cache||'MISS' }));
        });
      }).catch(reject);
    });
  }

  function shouldBridge(u){
    return typeof u === 'string' && (u.indexOf('/proxy?') === 0 || u.indexOf('/proxy/') === 0);
  }
  function rewriteStream(u){
    if (typeof u !== 'string') return u;
    if (u.indexOf('/stream?') === 0 && BACKEND) return BACKEND + u;
    return u;
  }

  ensureFirebase(function(){
    initFb();

    // fetch
    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch){
      window.fetch = function(input, init){
        try{
          var reqUrl = typeof input === 'string' ? input : (input && input.url) || '';
          if (shouldBridge(reqUrl)){
            var method = (init && init.method) || (input && input.method) || 'GET';
            var body = init && init.body;
            // /proxy?url=... -> extrai a URL alvo
            var qs = reqUrl.split('?')[1] || '';
            var params = new URLSearchParams(qs);
            var target = params.get('url');
            if (target){
              return fetchViaFirebase(method.toUpperCase(), target, body ? String(body) : '');
            }
          }
          if (typeof input === 'string') input = rewriteStream(input);
          return origFetch(input, init);
        }catch(e){ return origFetch(input, init); }
      };
    }

    // XHR — usado por libs antigas. Aqui apenas redirecionamos /stream;
    // /proxy via XHR é raro no site, então respondemos assíncrono.
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, u){
      this.__dk_method = method; this.__dk_url = u;
      if (shouldBridge(u)){
        this.__dk_bridge = true;
        arguments[1] = 'about:blank'; // será cancelado no send
      } else {
        arguments[1] = rewriteStream(u);
      }
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body){
      var xhr = this;
      if (xhr.__dk_bridge){
        var qs = xhr.__dk_url.split('?')[1] || '';
        var params = new URLSearchParams(qs);
        var target = params.get('url');
        fetchViaFirebase(xhr.__dk_method.toUpperCase(), target, body ? String(body) : '')
          .then(function(resp){ return resp.text().then(function(t){ return { t:t, resp:resp }; }); })
          .then(function(o){
            Object.defineProperty(xhr, 'readyState',   { value: 4, configurable:true });
            Object.defineProperty(xhr, 'status',       { value: 200, configurable:true });
            Object.defineProperty(xhr, 'responseText', { value: o.t, configurable:true });
            Object.defineProperty(xhr, 'response',     { value: o.t, configurable:true });
            if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
            if (typeof xhr.onload === 'function') xhr.onload();
            xhr.dispatchEvent(new Event('load'));
          })
          .catch(function(err){
            log('xhr bridge erro', err.message);
            Object.defineProperty(xhr, 'readyState', { value: 4, configurable:true });
            Object.defineProperty(xhr, 'status',     { value: 502, configurable:true });
            if (typeof xhr.onerror === 'function') xhr.onerror();
            xhr.dispatchEvent(new Event('error'));
          });
        return;
      }
      return origSend.apply(this, arguments);
    };

    // src de <video>/<source>/<iframe>/<img> — /stream continua indo pro backend
    ['HTMLVideoElement','HTMLSourceElement','HTMLIFrameElement','HTMLImageElement'].forEach(function(name){
      var proto = window[name] && window[name].prototype; if (!proto) return;
      var desc = Object.getOwnPropertyDescriptor(proto, 'src') ||
                 Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'src');
      if (!desc || !desc.set) return;
      Object.defineProperty(proto, 'src', {
        configurable:true, enumerable:desc.enumerable, get:desc.get,
        set:function(v){ desc.set.call(this, rewriteStream(v)); }
      });
    });
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(n, v){
      if (n === 'src') v = rewriteStream(v);
      return origSetAttr.call(this, n, v);
    };

    log('bridge pronto (fila Firebase + stream direto).');
  });
})();
