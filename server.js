/* =====================================================================
 *  DRAKSYON • Servidor local (Node.js puro, zero dependências) — v2
 *  -------------------------------------------------------------------
 *  - Serve os HTMLs de /public (mesma origem -> sem CORS/CORP)
 *  - /proxy?url=...   -> baixa HTML/JSON com headers reais + cache
 *  - /stream?url=...  -> faz stream de mp4/m3u8/ts com Range,
 *                        reescreve playlists .m3u8 para passarem pelo
 *                        próprio /stream. Cancela upstream ao
 *                        desconectar o cliente (corrige loop de
 *                        carregamento ao pular/seek no player).
 *  -------------------------------------------------------------------
 *  Como rodar (Termux / Linux / Windows / Mac):
 *      pkg install nodejs        # (Termux) OU instale Node 18+
 *      node server.js
 *  Acesse: http://localhost:8080
 * ===================================================================== */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');
const zlib  = require('zlib');
const crypto= require('crypto');

const os = require('os');

const PORT       = process.env.PORT || 8080;
const HOST       = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_TTL  = 1000 * 60 * 30; // 30 min para HTML/JSON
const ORIGIN     = 'https://animefire.io';

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// Nome de header de cache (sem espaços — HTTP não permite espaço em nomes).
const CACHE_HEADER = 'X-Draksyon-Cache';

// Escolhe o primeiro diretório onde conseguimos criar/gravar.
// Em Termux, __dirname pode cair em /storage/emulated/0/... onde o
// Android bloqueia criação de subpastas -> ENOENT ao escrever.
function pickCacheDir(){
  const candidates = [
    process.env.DRAKSYON_CACHE_DIR,
    path.join(__dirname, '.cache'),
    process.env.TMPDIR && path.join(process.env.TMPDIR, 'draksyon-cache'),
    path.join(os.tmpdir(), 'draksyon-cache')
  ].filter(Boolean);

  for (const dir of candidates){
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      // teste real de gravação
      const probe = path.join(dir, '.probe-' + Date.now());
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return dir;
    } catch (e) { /* tenta o próximo */ }
  }
  return null; // cache em disco desativado
}

const CACHE_DIR = pickCacheDir();
if (CACHE_DIR) console.log('[draksyon] cache dir:', CACHE_DIR);
else           console.log('[draksyon] cache em disco desativado (sem diretório gravável)');

// Aumenta limite de sockets simultâneos (importante para HLS com muitos .ts)
http.globalAgent.maxSockets  = 64;
https.globalAgent.maxSockets = 64;
http.globalAgent.keepAlive   = true;
https.globalAgent.keepAlive  = true;

/* -------------------- helpers -------------------- */

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon',
  '.mp4':'video/mp4','.webm':'video/webm','.m3u8':'application/vnd.apple.mpegurl',
  '.ts':'video/mp2t','.txt':'text/plain; charset=utf-8'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Embedder-Policy': 'unsafe-none',
  'Timing-Allow-Origin':          '*'
};

function log(...a){ console.log('[' + new Date().toISOString() + ']', ...a); }

function cacheKey(method, target, body){
  return crypto.createHash('sha1')
    .update(method + '|' + target + '|' + (body||''))
    .digest('hex');
}
function cacheGet(key){
  if (!CACHE_DIR) return null;
  try{
    const f = path.join(CACHE_DIR, key + '.json');
    if (!fs.existsSync(f)) return null;
    const o = JSON.parse(fs.readFileSync(f,'utf8'));
    if (Date.now() - o.ts > CACHE_TTL) return null;
    return o;
  }catch(e){ return null; }
}
function cacheSet(key, payload){
  if (!CACHE_DIR) return;
  try{
    const f = path.join(CACHE_DIR, key + '.json');
    fs.writeFileSync(f, JSON.stringify({ ts: Date.now(), ...payload }));
  }catch(e){ /* silencioso: cache é otimização, não crítico */ }
}

// Sanitiza headers: remove chaves com caracteres inválidos (ex.: espaço)
// e força valores a string. Isso evita:
//   "TypeError: Header name must be a valid HTTP token [\"X-Foo Bar\"]"
const VALID_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
function safeHeaders(obj){
  const out = {};
  for (const k of Object.keys(obj || {})){
    if (!VALID_TOKEN.test(k)){
      log('header ignorado (nome inválido):', JSON.stringify(k));
      continue;
    }
    const v = obj[k];
    if (v === undefined || v === null) continue;
    out[k] = String(v).replace(/[\r\n]/g, ' ');
  }
  return out;
}

/* fetchRaw — buffered (para HTML/JSON/m3u8). Segue redirects. */
function fetchRaw(target, opts = {}, maxRedirects = 5){
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const lib = u.protocol === 'http:' ? http : https;
    const headers = Object.assign({
      'User-Agent':       UA,
      'Accept':           '*/*',
      'Accept-Language':  'pt-BR,pt;q=0.9,en;q=0.8',
      'Referer':          ORIGIN + '/',
      'Origin':           ORIGIN,
      'Accept-Encoding':  'gzip, deflate, br'
    }, opts.headers || {});
    if (opts.range) headers['Range'] = opts.range;

    const req = lib.request({
      method:   opts.method || 'GET',
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + u.search,
      headers:  headers,
      timeout:  20000
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0){
        const next = new URL(res.headers.location, target).toString();
        res.resume();
        return resolve(fetchRaw(next, opts, maxRedirects - 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding']||'').toLowerCase();
        try{
          if (enc === 'gzip')    buf = zlib.gunzipSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
        }catch(e){ /* keep raw */ }
        resolve({ res, body: buf, target });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* streamUpstream — versão STREAMING que respeita cancelamento do cliente.
 * - Segue redirects.
 * - Repassa Range.
 * - clientReq permite destruir o socket upstream quando o cliente desconectar.
 */
function streamUpstream(target, opts = {}, maxRedirects = 5){
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const lib = u.protocol === 'http:' ? http : https;
    const headers = Object.assign({
      'User-Agent':       UA,
      'Accept':           '*/*',
      'Accept-Language':  'pt-BR,pt;q=0.9,en;q=0.8',
      'Referer':          ORIGIN + '/',
      'Origin':           ORIGIN
      // Nota: NÃO enviamos Accept-Encoding em stream — queremos bytes crus
      // para repassar Content-Length / Range corretamente sem descomprimir.
    }, opts.headers || {});
    if (opts.range) headers['Range'] = opts.range;

    const upReq = lib.request({
      method:   'GET',
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + u.search,
      headers:  headers,
      timeout:  20000
    }, (upRes) => {
      if ([301,302,303,307,308].includes(upRes.statusCode) && upRes.headers.location && maxRedirects > 0){
        const next = new URL(upRes.headers.location, target).toString();
        upRes.resume();
        try { upReq.destroy(); } catch(e){}
        return resolve(streamUpstream(next, opts, maxRedirects - 1));
      }
      resolve({ upReq, upRes });
    });

    upReq.on('timeout', () => { upReq.destroy(new Error('timeout')); });
    upReq.on('error', reject);
    upReq.end();
  });
}

function isBlocked(text){
  if (!text) return true;
  const s = text.slice(0, 4000).toLowerCase();
  return s.includes('sorry, you have been blocked')
      || s.includes('attention required! | cloudflare')
      || s.includes('checking your browser before')
      || s.includes('cf-error-details');
}

/* -------------------- handlers -------------------- */

async function handleProxy(req, res, parsed){
  const target = parsed.query.url;
  if (!target || !/^https?:\/\//i.test(target)){
    res.writeHead(400, safeHeaders(CORS_HEADERS)); return res.end('Param "url" inválido');
  }

  let body = '';
  if (req.method === 'POST'){
    body = await new Promise(r => {
      const chunks = []; req.on('data', c => chunks.push(c));
      req.on('end', () => r(Buffer.concat(chunks).toString('utf8')));
    });
  }

  const key = cacheKey(req.method, target, body);
  const cached = cacheGet(key);
  if (cached){
    res.writeHead(200, safeHeaders(Object.assign({
      'Content-Type': cached.contentType || 'text/html; charset=utf-8',
      'X-Draksyon-Cache': 'HIT'
    }, CORS_HEADERS)));
    return res.end(Buffer.from(cached.bodyB64, 'base64'));
  }

  try{
    const headers = {};
    if (req.method === 'POST') headers['Content-Type'] =
        req.headers['content-type'] || 'application/x-www-form-urlencoded';

    const { res: up, body: buf } = await fetchRaw(target, {
      method:  req.method,
      headers: headers,
      body:    body || undefined
    });

    const text = buf.toString('utf8');
    if (up.statusCode >= 400){
      res.writeHead(up.statusCode, safeHeaders(CORS_HEADERS));
      return res.end('Upstream HTTP ' + up.statusCode);
    }
    if (isBlocked(text)){
      res.writeHead(503, safeHeaders(CORS_HEADERS));
      return res.end('Bloqueado pela origem (Cloudflare).');
    }

    const ct = up.headers['content-type'] || 'text/html; charset=utf-8';
    cacheSet(key, { contentType: ct, bodyB64: buf.toString('base64') });

    res.writeHead(200, safeHeaders(Object.assign({
      'Content-Type': ct,
      'X-Draksyon-Cache': 'MISS'
    }, CORS_HEADERS)));
    res.end(buf);
  }catch(e){
    log('proxy err', target, e.message);
    if (!res.headersSent){
      res.writeHead(502, safeHeaders(CORS_HEADERS));
      res.end('Proxy falhou: ' + e.message);
    }
  }
}

/* /stream — para mídia.
 * - .m3u8: baixa, reescreve URIs internas e devolve.
 * - .ts/.mp4/etc: stream com Range, propaga statusCode (200/206),
 *   CANCELA upstream se o cliente desconectar (corrige loop ao seek).
 */
async function handleStream(req, res, parsed){
  const target = parsed.query.url;
  if (!target || !/^https?:\/\//i.test(target)){
    res.writeHead(400, safeHeaders(CORS_HEADERS)); return res.end('Param "url" inválido');
  }

  const isPlaylist = /\.m3u8(\?|$)/i.test(target);

  // ===== Playlist HLS =====
  if (isPlaylist){
    try{
      const { res: up, body: buf } = await fetchRaw(target);
      if (up.statusCode >= 400){
        res.writeHead(up.statusCode, safeHeaders(CORS_HEADERS));
        return res.end('Upstream HTTP ' + up.statusCode);
      }
      const baseUrl = new URL(target);
      const text = buf.toString('utf8');
      const rewritten = text.split('\n').map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')){
          return line.replace(/URI="([^"]+)"/g, (m, u) => {
            const abs = new URL(u, baseUrl).toString();
            return 'URI="/stream?url=' + encodeURIComponent(abs) + '"';
          });
        }
        const abs = new URL(t, baseUrl).toString();
        return '/stream?url=' + encodeURIComponent(abs);
      }).join('\n');

      res.writeHead(200, safeHeaders(Object.assign({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store'
      }, CORS_HEADERS)));
      return res.end(rewritten);
    }catch(e){
      log('m3u8 err', target, e.message);
      if (!res.headersSent){
        res.writeHead(502, safeHeaders(CORS_HEADERS));
        res.end('Playlist falhou: ' + e.message);
      }
      return;
    }
  }

  // ===== Mídia binária (mp4 / ts / webm / imagem) =====
  let upReqRef = null;
  let upResRef = null;
  let aborted  = false;

  // Se o cliente fechar (ex: player buscou outro segmento ao pular 10s),
  // matamos imediatamente a conexão upstream para não vazar sockets.
  const onClientClose = () => {
    aborted = true;
    try { if (upResRef) upResRef.destroy(); } catch(e){}
    try { if (upReqRef) upReqRef.destroy(); } catch(e){}
  };
  req.on('close', onClientClose);
  res.on('close', onClientClose);

  try{
    const { upReq, upRes } = await streamUpstream(target, { range: req.headers.range });
    upReqRef = upReq;
    upResRef = upRes;

    if (aborted){
      try { upRes.destroy(); upReq.destroy(); } catch(e){}
      return;
    }

    // Monta headers de resposta — preserva Content-Range / Length / Type
    const headers = Object.assign({}, CORS_HEADERS, {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });
    const passthrough = ['content-type','content-length','content-range',
                         'last-modified','etag'];
    passthrough.forEach(h => {
      if (upRes.headers[h]){
        const Hh = h.replace(/(^|-)([a-z])/g, (_,a,b)=>a+b.toUpperCase());
        headers[Hh] = upRes.headers[h];
      }
    });

    const status = upRes.statusCode || 200;
    res.writeHead(status, safeHeaders(headers));

    upRes.on('error', (e) => {
      log('upstream pipe err', e.message);
      try { res.end(); } catch(_){}
      try { upReq.destroy(); } catch(_){}
    });
    res.on('error', (e) => {
      try { upRes.destroy(); } catch(_){}
      try { upReq.destroy(); } catch(_){}
    });

    upRes.pipe(res);
  }catch(e){
    log('stream err', target, e.message);
    if (!res.headersSent && !aborted){
      try {
        res.writeHead(502, safeHeaders(CORS_HEADERS));
        res.end('Stream falhou: ' + e.message);
      } catch(_){}
    }
  }
}

/* Estáticos */
function serveStatic(req, res, pathname){
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file.includes('..')) { res.writeHead(400); return res.end('Bad path'); }
  const full = path.join(PUBLIC_DIR, file);
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()){
      res.writeHead(404, safeHeaders({'Content-Type':'text/html; charset=utf-8'}));
      return res.end('<h1>404</h1><p>Arquivo não encontrado: ' + file + '</p>');
    }
    res.writeHead(200, safeHeaders({
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300'
    }));
    fs.createReadStream(full).pipe(res);
  });
}

/* -------------------- server -------------------- */

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'OPTIONS'){
    res.writeHead(204, safeHeaders(CORS_HEADERS)); return res.end();
  }

  // Loga só o essencial (não polui com TS de HLS)
  if (!/\/stream\?.*\.ts/i.test(req.url)) log(req.method, req.url.slice(0, 140));

  if (parsed.pathname === '/proxy')  return handleProxy(req, res, parsed);
  if (parsed.pathname === '/stream') return handleStream(req, res, parsed);
  if (parsed.pathname === '/health'){
    res.writeHead(200, safeHeaders(Object.assign({'Content-Type':'application/json'}, CORS_HEADERS)));
    return res.end(JSON.stringify({ ok:true, uptime: process.uptime() }));
  }

  serveStatic(req, res, parsed.pathname);
});

// Evita derrubar o processo por erros de socket
server.on('clientError', (err, socket) => {
  try { socket.destroy(); } catch(e){}
});
process.on('uncaughtException', (e) => log('uncaught', e.message));
process.on('unhandledRejection', (e) => log('unhandled', e && e.message || e));

server.listen(PORT, HOST, () => {
  log('====================================================');
  log(' DRAKSYON server v2 rodando em http://' + HOST + ':' + PORT);
  log(' Abra no navegador:  http://localhost:' + PORT);
  log(' Cache em disco:    ' + CACHE_DIR);
  log('====================================================');
});
