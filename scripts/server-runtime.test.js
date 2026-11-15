'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const { readBody } = require('../lib/http-body');
const root = process.env.RABBITHUB_TEST_ROOT || path.join(__dirname, '..');

test('HTTP real: páginas, navegação, recursos e barreiras de API', async t => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    windowsHide: true, stdio: ['ignore','pipe','pipe']
  });
  t.after(async () => { if (server.exitCode === null) { server.kill(); await once(server, 'exit'); } });
  // The server reports its actual bound port, including ephemeral port zero.
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou: ' + output)), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error('Servidor encerrou: '+code)); });
    server.stdout.on('data', data => {
      output += data;
      const match = output.match(/rodando em (http:\/\/127\.0\.0\.1:[1-9]\d*)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const request = async (url, options) => fetch(origin + url, { ...options, signal: AbortSignal.timeout(5000) });
  await t.test('sete páginas e todos os scripts/estilos locais carregam', async () => {
    const assets = new Set();
    for (const page of ['index','login','perfis','detalhes','player-animes','chat','admin']) {
      const response = await request('/'+page);
      assert.equal(response.status,200,page);
      assert.match(response.headers.get('content-type'),/text\/html/);
      assert.match(response.headers.get('cache-control'),/no-store/);
      const html = await response.text();
      for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
        if (!/^(?:https?:)?\/\//.test(match[1])) assets.add(new URL(match[1],origin+'/').pathname);
      }
    }
    for (const asset of assets) assert.equal((await request(asset)).status,200,asset);
  });
  await t.test('APIs exigem autenticação e uploads têm limite', async () => {
    for (const endpoint of ['/api/ai/episode','/api/ai/anime','/api/ai/recommendations','/api/profile-photo']) {
      const response = await request(endpoint,{method:'POST',body:'{}'});
      assert.equal(response.status,401,endpoint);
    }
    for (const endpoint of ['/proxy','/api/proxy']) {
      const response = await request(endpoint+'?url=https://meusanimes.blog/');
      assert.equal(response.status,401,endpoint);
      assert.match(response.headers.get('content-security-policy'),/sandbox/);
    }
    assert.equal((await request('/api/ai/anime',{method:'POST',body:'x'.repeat(128*1024+1)})).status,413);
    assert.equal((await request('/api/proxy',{method:'POST',body:'x'.repeat(256*1024+1)})).status,413);
    assert.equal((await request('/api/ai/anime')).status,405);
  });
  await t.test('não expõe segredos, caminhos externos ou destinos privados', async () => {
    for (const url of ['/.env','/.git/config','/server.js','/lib/firebase-auth.js','/missing-page']) {
      assert.equal((await request(url)).status,404,url);
    }
    for (const target of ['http://127.0.0.1/','http://169.254.169.254/','https://evil.example/']) {
      const response = await request('/stream?url='+encodeURIComponent(target));
      assert.equal(response.status,400);
      assert.match(response.headers.get('content-security-policy'),/sandbox/);
    }
    const status = await new Promise((resolve,reject) => {
      http.get(origin+'/%2e%2e%2f.env',response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
    });
    assert.equal(status,400);
    const health = await request('/health');
    assert.equal((await health.json()).ok,true);
  });
  if (process.env.RABBITHUB_TEST_ROOT) await t.test('pacote contém apenas runtime e manifesto verificável', () => {
    const crypto = require('node:crypto');
    const manifest = JSON.parse(fs.readFileSync(path.join(root,'build-manifest.json'),'utf8'));
    for (const file of manifest.files) {
      assert.match(file.path,/^(?:public\/|api\/|lib\/|server\.js$)/);
      const actual = fs.readFileSync(path.join(root,file.path));
      assert.equal(crypto.createHash('sha256').update(actual).digest('hex'),file.sha256,file.path);
    }
    assert.equal(fs.existsSync(path.join(root,'.env')),false);
  });
});

test('leitura de upload aceita corpo válido e encerra excesso, interrupção e timeout', async () => {
  const make = () => { const stream = new PassThrough(); stream.headers={}; return stream; };
  let stream=make(), result=readBody(stream,4); stream.end('ok'); assert.equal(await result,'ok');
  stream=make(); result=readBody(stream,4); stream.end('large'); await assert.rejects(result,{statusCode:413});
  stream=make(); result=readBody(stream,4); stream.emit('aborted'); await assert.rejects(result,{statusCode:400});
  stream=make(); await assert.rejects(readBody(stream,4,10),{statusCode:408});
});
