'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { once } = require('node:events');

test('Vercel publica a rota /stream como função sem alterar a URL da mídia', async () => {
  const root=path.join(__dirname,'..');
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.ok(config.functions['api/stream.mjs']);
  assert.ok(config.rewrites.some(route=>route.source==='/stream'&&route.destination==='/api/stream'));
  const {default:handler}=await import('../api/stream.mjs');
  const gateway=http.createServer(handler);
  gateway.listen(0,'127.0.0.1');
  await once(gateway,'listening');
  try {
    const response=await fetch('http://127.0.0.1:'+gateway.address().port+'/api/stream?url='+encodeURIComponent('https://example.invalid/video.mp4'));
    assert.equal(response.status,400);
    assert.match(await response.text(),/inválido/);
  } finally {gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}
});

test('stream HTTP entrega Range, cancela ao sair e limita respostas em memória', async t => {
  let cancelled;
  const cancellation = new Promise(resolve => { cancelled=resolve; });
  const upstream = http.createServer((req,res) => {
    if (req.url === '/large.html' || req.url === '/compressed.html') {
      let body=Buffer.alloc(4*1024*1024+1,'x');
      if(req.url==='/compressed.html'){
        res.setHeader('Content-Encoding','gzip');
        body=require('node:zlib').gzipSync(body);
      }
      res.end(body);
      return;
    }
    if (req.url === '/slow.mp4') {
      res.writeHead(200,{'Content-Type':'video/mp4'});
      res.write('first');
      const timer=setInterval(()=>res.write('next'),25);
      res.on('close',()=>{clearInterval(timer);cancelled();});
      return;
    }
    assert.equal(req.headers.range,'bytes=3-6');
    setTimeout(()=>{
      res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':'bytes 3-6/10','Content-Length':'4'});
      res.end('3456');
    },30);
  });
  upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  t.after(()=>{upstream.closeAllConnections();upstream.close();});
  const root=path.join(__dirname,'..');
  const localRequire=createRequire(path.join(root,'server.js'));
  // Only the HTTPS transport is redirected to a local fixture. Routing,
  // allowlist, Range forwarding, sockets and cancellation run unchanged.
  const transport={...require('node:https'),request(options,callback){
    return http.request({...options,hostname:'127.0.0.1',port:upstream.address().port},callback);
  }};
  const context={
    require:name=>name==='https'?transport:localRequire(name),__dirname:root,
    process:{env:{PORT:'0',HOST:'127.0.0.1',DRAKSYON_CACHE_DIR:path.join(root,'.cache')},on(){},uptime:()=>0},
    console:{log(){},warn(){}},Buffer,URL,AbortController,fetch,setTimeout,clearTimeout,module:{exports:{}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,'server.js'),'utf8')+'\nmodule.exports={server,fetchRaw};',context);
  const {server,fetchRaw}=context.module.exports;
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port+'/stream?url=';
  const response=await fetch(base+encodeURIComponent('https://meusanimes.blog/video.mp4'),{
    headers:{Range:'bytes=3-6'},signal:AbortSignal.timeout(3000)
  });
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),'bytes 3-6/10');
  assert.equal(await response.text(),'3456');
  await assert.rejects(fetchRaw('https://meusanimes.blog/large.html'),/muito grande/);
  await assert.rejects(fetchRaw('https://meusanimes.blog/compressed.html'),/comprimida/);
  const controller=new AbortController();
  const slow=await fetch(base+encodeURIComponent('https://meusanimes.blog/slow.mp4'),{signal:controller.signal});
  await slow.body.getReader().read();
  controller.abort();
  let timer;
  try { await Promise.race([cancellation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('upstream não foi cancelado')),3000);})]); }
  finally { clearTimeout(timer); }
});
