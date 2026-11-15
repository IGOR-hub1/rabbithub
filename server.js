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
const zlib  = require('zlib');
const crypto= require('crypto');

const os = require('os');
const {readBody} = require('./lib/http-body');

// Carrega configurações locais de .env sem dependências externas. Variáveis
// já definidas no sistema têm prioridade e nenhum segredo é enviado ao cliente.
function loadLocalEnv(){
  try {
    const envFile = path.join(__dirname,'.env');
    if (!fs.existsSync(envFile)) return;
    fs.readFileSync(envFile,'utf8').split(/\r?\n/).forEach(line => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.prototype.hasOwnProperty.call(process.env,match[1])) return;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
      process.env[match[1]] = value;
    });
  } catch(error) { console.warn('[draksyon] não foi possível ler .env:',error.message); }
}
loadLocalEnv();
const R2Profile = require('./lib/r2-profile');
const {verifyFirebaseRequest} = require('./lib/firebase-auth');

const PORT       = process.env.PORT || 8080;
const HOST       = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_TTL  = 1000 * 60 * 30; // 30 min para HTML/JSON
const MAX_BUFFERED_RESPONSE_BYTES = 4 * 1024 * 1024;
const ORIGIN     = 'https://meusanimes.blog';
const ANIME_NEWS_FEED = 'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/pt-BR/rss';
const COOKIE_JAR = new Map();
let lastAnimeNews = null;

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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, X-Requested-With, X-Same-Domain',
  'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'unsafe-none',
  'Vary':                         'Origin'
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
  const out = {
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy':'same-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()'
  };
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

function hostnameAllowed(hostname){
  const host=String(hostname||'').toLowerCase().replace(/\.$/,'');
  return ['meusanimes.blog','meusdoramas.club','blogger.com','blogspot.com','googlevideo.com','googleusercontent.com','crunchyroll.com','crunchyrollsvc.com','storyblok.com']
    .some(domain => host===domain||host.endsWith('.'+domain));
}
function allowedExternalUrl(value){
  try{
    const parsed=new URL(String(value||''));
    if(!/^https?:$/.test(parsed.protocol)||parsed.username||parsed.password||
       (parsed.port&&parsed.port!=='80'&&parsed.port!=='443')||!hostnameAllowed(parsed.hostname))return null;
    return parsed;
  }catch(error){return null;}
}

function sendJson(res, status, payload, extraHeaders){
  res.writeHead(status, safeHeaders(Object.assign({
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store'
  }, CORS_HEADERS, extraHeaders || {})));
  res.end(JSON.stringify(payload));
}

function decodeXml(value){
  const named = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
  return String(value || '')
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : parseInt(code,10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : '';
    })
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTag(block, tag){
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match = String(block || '').match(new RegExp('<' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + escaped + '>','i'));
  return match ? decodeXml(match[1]) : '';
}

function safeExternalUrl(value, allowedHosts){
  try{
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:') return '';
    if (allowedHosts && allowedHosts.length && !allowedHosts.some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))) return '';
    return parsed.href;
  }catch(e){ return ''; }
}

function parseAnimeNewsRss(xml){
  const blocks = String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0,18).map((block, index) => {
    const thumbnail = block.match(/<media:thumbnail\b[^>]*\burl=(?:"([^"]+)"|'([^']+)')[^>]*>/i);
    const link = safeExternalUrl(xmlTag(block,'link'), ['crunchyroll.com']);
    const published = xmlTag(block,'pubDate');
    const timestamp = Date.parse(published);
    return {
      id: crypto.createHash('sha1').update(link || xmlTag(block,'title') || String(index)).digest('hex').slice(0,16),
      title: xmlTag(block,'title').slice(0,180),
      summary: xmlTag(block,'description').slice(0,320),
      image: safeExternalUrl(thumbnail && (thumbnail[1] || thumbnail[2]), ['storyblok.com','crunchyroll.com']),
      url: link,
      category: xmlTag(block,'category').slice(0,60) || 'Notícias',
      author: xmlTag(block,'author').slice(0,80),
      publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''
    };
  }).filter(item => item.title && item.url);
}

function publicAnimeNewsItems(items){
  return (Array.isArray(items) ? items : []).map(item => Object.assign({}, item, {
    image:item.image ? '/api/anime-news-image?url=' + encodeURIComponent(item.image) : ''
  }));
}

async function handleAnimeNewsImage(req, res, parsed){
  if (req.method !== 'GET') return sendJson(res, 405, {ok:false,error:'method-not-allowed'}, {'Allow':'GET'});
  const target = safeExternalUrl(parsed && parsed.query && parsed.query.url, ['storyblok.com','crunchyroll.com']);
  if (!target){ res.writeHead(400); return res.end('Imagem inválida'); }
  const key = cacheKey('GET', target, 'anime-news-image-v1');
  const cached = cacheGet(key);
  if (cached && cached.bodyB64 && cached.contentType){
    res.writeHead(200, safeHeaders({'Content-Type':cached.contentType,'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800'}));
    return res.end(Buffer.from(cached.bodyB64,'base64'));
  }
  try{
    const upstream = await fetchRaw(target, {
      referer:'https://www.crunchyroll.com/pt-br/news',origin:'https://www.crunchyroll.com',
      headers:{'Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}
    });
    const contentType = String(upstream.res && upstream.res.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (!upstream.res || upstream.res.statusCode < 200 || upstream.res.statusCode >= 300 || !contentType.startsWith('image/') || upstream.body.length > 6 * 1024 * 1024) throw new Error('imagem-indisponivel');
    cacheSet(key,{contentType,bodyB64:upstream.body.toString('base64')});
    res.writeHead(200,safeHeaders({'Content-Type':contentType,'Cache-Control':'public, max-age=86400, stale-while-revalidate=604800'}));
    return res.end(upstream.body);
  }catch(error){
    log('anime news image err', error && error.message || error);
    res.writeHead(502);return res.end('Imagem indisponível');
  }
}

async function handleAnimeNews(req, res){
  if (req.method !== 'GET') return sendJson(res, 405, {ok:false,error:'method-not-allowed'}, {'Allow':'GET'});
  const key = cacheKey('GET', ANIME_NEWS_FEED, 'anime-news-v1');
  const cached = cacheGet(key);
  if (cached && Array.isArray(cached.items) && cached.items.length){
    return sendJson(res, 200, {ok:true,source:'Crunchyroll News',sourceUrl:'https://www.crunchyroll.com/pt-br/news',cached:true,items:publicAnimeNewsItems(cached.items)});
  }
  try{
    const upstream = await fetchRaw(ANIME_NEWS_FEED, {
      referer:'https://www.crunchyroll.com/pt-br/news',
      origin:'https://www.crunchyroll.com',
      headers:{'Accept':'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'}
    });
    if (!upstream.res || upstream.res.statusCode < 200 || upstream.res.statusCode >= 300) throw new Error('feed-status-' + (upstream.res && upstream.res.statusCode));
    const items = parseAnimeNewsRss(upstream.body.toString('utf8'));
    if (!items.length) throw new Error('feed-sem-noticias');
    const payload = {items,updatedAt:new Date().toISOString()};
    lastAnimeNews = payload;
    cacheSet(key, payload);
    return sendJson(res, 200, {ok:true,source:'Crunchyroll News',sourceUrl:'https://www.crunchyroll.com/pt-br/news',cached:false,items:publicAnimeNewsItems(items)});
  }catch(error){
    log('anime news err', error && error.message || error);
    if (lastAnimeNews && lastAnimeNews.items && lastAnimeNews.items.length){
      return sendJson(res, 200, {ok:true,source:'Crunchyroll News',sourceUrl:'https://www.crunchyroll.com/pt-br/news',cached:true,stale:true,items:publicAnimeNewsItems(lastAnimeNews.items)});
    }
    return sendJson(res, 503, {ok:false,source:'Crunchyroll News',sourceUrl:'https://www.crunchyroll.com/pt-br/news',items:[],error:'noticias-indisponiveis'});
  }
}

async function handleProfilePhotoUpload(req,res){
  if(req.method!=='POST') return sendJson(res,405,{ok:false,error:'method-not-allowed'},{'Allow':'POST'});
  try{
    const user=await verifyFirebaseRequest(req);
    const body=await R2Profile.readImageBody(req);
    const uploaded=await R2Profile.uploadProfileImage(body,{uid:user.sub,profileId:req.headers['x-profile-id'],contentType:req.headers['content-type']});
    return sendJson(res,200,{ok:true,url:uploaded.url});
  }catch(error){
    const status=Number(error.statusCode)||500;
    return sendJson(res,status,{ok:false,error:error.message||'Falha ao enviar a foto.'});
  }
}

function cookieKey(target){
  try { return new URL(target).hostname.toLowerCase(); } catch(e){ return ''; }
}
function cookieHeader(target){
  const now = Date.now();
  const host = cookieKey(target);
  const entries = COOKIE_JAR.get(host) || [];
  const active = entries.filter(item => !item.expires || item.expires > now);
  if (active.length !== entries.length) COOKIE_JAR.set(host, active);
  return active.map(item => item.name + '=' + item.value).join('; ');
}
function rememberCookies(target, setCookie){
  const host = cookieKey(target);
  if (!host || !setCookie) return;
  const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
  const saved = COOKIE_JAR.get(host) || [];
  lines.forEach(line => {
    const first = String(line || '').split(';')[0];
    const separator = first.indexOf('=');
    if (separator < 1) return;
    const name = first.slice(0, separator).trim();
    const value = first.slice(separator + 1).trim();
    let expires = 0;
    const maxAge = String(line).match(/;\s*Max-Age=(\d+)/i);
    const expiry = String(line).match(/;\s*Expires=([^;]+)/i);
    if (maxAge) expires = Date.now() + Number(maxAge[1]) * 1000;
    else if (expiry) expires = Date.parse(expiry[1]) || 0;
    const index = saved.findIndex(item => item.name === name);
    const item = { name, value, expires };
    if (index >= 0) saved[index] = item; else saved.push(item);
  });
  COOKIE_JAR.set(host, saved.slice(-40));
}

/* fetchRaw — buffered (para HTML/JSON/m3u8). Segue redirects. */
function fetchRaw(target, opts = {}, maxRedirects = 5){
  return new Promise((resolve, reject) => {
    const u = allowedExternalUrl(target);
    if(!u){reject(new Error('Destino externo nao permitido.'));return;}
    target=u.toString();
    const lib = u.protocol === 'http:' ? http : https;
    const headers = Object.assign({
      'User-Agent':       UA,
      'Accept':           '*/*',
      'Accept-Language':  'pt-BR,pt;q=0.9,en;q=0.8',
      'Referer':          opts.referer || ORIGIN + '/',
      'Origin':           opts.origin || (() => { try { return new URL(opts.referer || target).origin; } catch(e){ return ORIGIN; } })(),
      'Accept-Encoding':  'gzip, deflate, br'
    }, opts.headers || {});
    const cookies = cookieHeader(target);
    if (cookies && !headers.Cookie) headers.Cookie = cookies;
    if (opts.range) headers['Range'] = opts.range;

    const req = lib.request({
      method:   opts.method || 'GET',
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + u.search,
      headers:  headers,
      timeout:  20000
    }, (res) => {
      rememberCookies(target, res.headers['set-cookie']);
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0){
        const next = new URL(res.headers.location, target).toString();
        res.resume();
        return resolve(fetchRaw(next, opts, maxRedirects - 1));
      }
      const chunks = [];
      let receivedBytes = 0;
      res.on('data', c => {
        receivedBytes += c.length;
        if (receivedBytes > MAX_BUFFERED_RESPONSE_BYTES) {
          res.destroy(new Error('Resposta externa muito grande.'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding']||'').toLowerCase();
        try{
          const limits = {maxOutputLength:MAX_BUFFERED_RESPONSE_BYTES};
          if (enc === 'gzip')    buf = zlib.gunzipSync(buf,limits);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf,limits);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf,limits);
        }catch(e){ reject(new Error('Resposta comprimida inválida ou muito grande.')); return; }
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
    const u = allowedExternalUrl(target);
    if(!u){reject(new Error('Destino externo nao permitido.'));return;}
    target=u.toString();
    const lib = u.protocol === 'http:' ? http : https;
    const headers = Object.assign({
      'User-Agent':       UA,
      'Accept':           '*/*',
      'Accept-Language':  'pt-BR,pt;q=0.9,en;q=0.8',
      'Referer':          opts.referer || ORIGIN + '/',
      'Origin':           opts.origin || (() => { try { return new URL(opts.referer || target).origin; } catch(e){ return ORIGIN; } })()
      // Nota: NÃO enviamos Accept-Encoding em stream — queremos bytes crus
      // para repassar Content-Length / Range corretamente sem descomprimir.
    }, opts.headers || {});
    const cookies = cookieHeader(target);
    if (cookies && !headers.Cookie) headers.Cookie = cookies;
    if (opts.range) headers['Range'] = opts.range;

    const upReq = lib.request({
      method:   'GET',
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + u.search,
      headers:  headers,
      timeout:  20000
    }, (upRes) => {
      rememberCookies(target, upRes.headers['set-cookie']);
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
  if(req.method!=='GET'&&req.method!=='POST'){
    res.writeHead(405,safeHeaders(Object.assign({'Allow':'GET, POST'},CORS_HEADERS)));return res.end('Metodo nao permitido');
  }
  try{await verifyFirebaseRequest(req,{checkActive:false});}catch(error){
    return sendJson(res,Number(error&&error.statusCode)||401,{ok:false,error:error&&error.message||'Autenticacao obrigatoria.'});
  }
  const targetUrl=allowedExternalUrl(parsed.query.url);
  if (!targetUrl){
    res.writeHead(400, safeHeaders(CORS_HEADERS)); return res.end('Param "url" inválido');
  }
  const target=targetUrl.toString();

  let body = '';
  if (req.method === 'POST'){
    try { body = await readBody(req); }
    catch (error) { return sendJson(res,error.statusCode||400,{ok:false,error:error.message}); }
  }

  const noCache = parsed.query.nocache === '1';
  const refererUrl=allowedExternalUrl(parsed.query.referer);
  const referer=refererUrl?refererUrl.toString():undefined;
  const key = cacheKey(req.method, target + '|' + (referer || ''), body);
  const cached = noCache ? null : cacheGet(key);
  if (cached){
    res.writeHead(200, safeHeaders(Object.assign({
      'Content-Type': cached.contentType || 'text/html; charset=utf-8',
      'X-Draksyon-Cache': 'HIT'
    }, CORS_HEADERS)));
    return res.end(Buffer.from(cached.bodyB64, 'base64'));
  }

  try{
    const headers = {
      'Accept': req.headers.accept || 'text/html,application/json;q=0.9,*/*;q=0.8'
    };
    if (req.headers['x-requested-with']) headers['X-Requested-With'] = req.headers['x-requested-with'];
    if (req.headers['x-same-domain']) headers['X-Same-Domain'] = req.headers['x-same-domain'];
    if (req.method === 'POST') headers['Content-Type'] =
        req.headers['content-type'] || 'application/x-www-form-urlencoded';

    const { res: up, body: buf } = await fetchRaw(target, {
      method:  req.method,
      headers: headers,
      body:    body || undefined,
      referer: referer
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
    if (!noCache) cacheSet(key, { contentType: ct, bodyB64: buf.toString('base64') });

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
  if(req.method!=='GET'){
    res.writeHead(405,safeHeaders(Object.assign({'Allow':'GET'},CORS_HEADERS)));return res.end('Metodo nao permitido');
  }
  const targetUrl=allowedExternalUrl(parsed.query.url);
  if (!targetUrl){
    res.writeHead(400, safeHeaders(CORS_HEADERS)); return res.end('Param "url" inválido');
  }
  const target=targetUrl.toString();

  const refererUrl=allowedExternalUrl(parsed.query.referer);
  const referer=refererUrl?refererUrl.toString():undefined;
  const isPlaylist = /\.m3u8(?:\?|$)/i.test(target);
  const isDashManifest = /\.mpd(?:\?|$)/i.test(target);

  // ===== Manifesto MPEG-DASH =====
  if (isDashManifest){
    try{
      const { res: up, body: buf } = await fetchRaw(target, { referer });
      if (up.statusCode >= 400){
        res.writeHead(up.statusCode, safeHeaders(CORS_HEADERS));
        return res.end('Upstream HTTP ' + up.statusCode);
      }
      const baseUrl = new URL(target);
      let segmentBase = baseUrl;
      const declaredBase = buf.toString('utf8').match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
      if (declaredBase) {
        try { segmentBase = new URL(declaredBase[1].trim().replace(/&amp;/gi, '&'), baseUrl); } catch(e){}
      }
      const route = (value, from) => {
        if (!value || /^(?:data:|urn:|#)/i.test(value)) return value;
        const absolute = new URL(String(value).replace(/&amp;/gi, '&'), from || segmentBase).toString();
        // Os marcadores $Number$, $Time$ e $RepresentationID$ precisam ficar
        // visíveis ao dash.js antes de a URL chegar ao servidor.
        return ('/stream?url=' + encodeURIComponent(absolute).replace(/%24/gi, '$') +
          (referer ? '&referer=' + encodeURIComponent(referer) : '')).replace(/&/g, '&amp;');
      };
      let xml = buf.toString('utf8');
      xml = xml.replace(/<(BaseURL)([^>]*)>([^<]+)<\/BaseURL>/gi,
        (match, tag, attrs, value) => '<' + tag + attrs + '>' + route(value.trim(), baseUrl) + '</BaseURL>');
      xml = xml.replace(/\b(media|initialization|sourceURL|href)=(['"])([^'"]+)\2/gi,
        (match, name, quote, value) => name + '=' + quote + route(value) + quote);
      res.writeHead(200, safeHeaders(Object.assign({
        'Content-Type': 'application/dash+xml; charset=utf-8',
        'Cache-Control': 'no-store'
      }, CORS_HEADERS)));
      return res.end(xml);
    }catch(e){
      log('mpd err', target, e.message);
      if (!res.headersSent){
        res.writeHead(502, safeHeaders(CORS_HEADERS));
        res.end('Manifesto DASH falhou: ' + e.message);
      }
      return;
    }
  }

  // ===== Playlist HLS =====
  if (isPlaylist){
    try{
      const { res: up, body: buf } = await fetchRaw(target, { referer });
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
            return 'URI="/stream?url=' + encodeURIComponent(abs) +
              (referer ? '&referer=' + encodeURIComponent(referer) : '') + '"';
          });
        }
        const abs = new URL(t, baseUrl).toString();
        return '/stream?url=' + encodeURIComponent(abs) +
          (referer ? '&referer=' + encodeURIComponent(referer) : '');
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
  req.on('close', () => { if (!req.complete) onClientClose(); });
  res.on('close', onClientClose);

  try{
    const { upReq, upRes } = await streamUpstream(target, {
      range: req.headers.range,
      referer
    });
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
  const route = String(pathname || '/').replace(/\/{2,}/g, '/');
  const aliases = {
    '/':'/index.html','/home':'/index.html','/index':'/index.html','/index.html/':'/index.html',
    '/login':'/login.html','/login/':'/login.html','/login.html/':'/login.html',
    '/perfis':'/perfis.html','/perfis/':'/perfis.html','/perfis.html/':'/perfis.html',
    '/detalhes':'/detalhes.html','/detalhes/':'/detalhes.html','/detalhes.html/':'/detalhes.html',
    '/player-animes':'/player-animes.html','/player-animes/':'/player-animes.html','/player-animes.html/':'/player-animes.html',
    '/chat':'/chat.html','/chat/':'/chat.html','/chat.html/':'/chat.html',
    '/admin':'/admin.html','/admin/':'/admin.html','/admin.html/':'/admin.html'
  };
  let file = aliases[route.toLowerCase()] || route;
  let full;
  try{full=path.resolve(PUBLIC_DIR,'.'+decodeURIComponent(file));}catch(error){res.writeHead(400);return res.end('Bad path');}
  if(full!==PUBLIC_DIR&&!full.startsWith(PUBLIC_DIR+path.sep)){res.writeHead(400);return res.end('Bad path');}
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()){
      res.writeHead(404, safeHeaders({'Content-Type':'text/html; charset=utf-8'}));
      return res.end('<h1>404</h1><p>Arquivo não encontrado.</p>');
    }
    const extension = path.extname(full).toLowerCase();
    res.writeHead(200, safeHeaders({
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': extension === '.html'
        ? 'no-store, no-cache, must-revalidate'
        : 'public, max-age=300, must-revalidate'
    }));
    fs.createReadStream(full).pipe(res);
  });
}

/* -------------------- server -------------------- */

async function handleRequest(req, res) {
  let requestedUrl;
  try {
    requestedUrl = new URL(String(req.url || '/'), 'http://localhost');
  } catch (error) {
    res.writeHead(400, safeHeaders({'Content-Type':'application/json; charset=utf-8'}));
    return res.end(JSON.stringify({error:'URL inválida'}));
  }
  const parsed = {
    pathname:requestedUrl.pathname,
    query:Object.fromEntries(requestedUrl.searchParams.entries())
  };

  // Upstream documents must never execute as this site's origin. This does
  // not change fetch()/media responses consumed by the application.
  if (['/proxy','/api/proxy','/stream'].includes(parsed.pathname)) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }

  if (req.method === 'OPTIONS'){
    res.writeHead(204, safeHeaders(CORS_HEADERS)); return res.end();
  }

  if (parsed.pathname === '/api/proxy') {
    req.query = parsed.query;
    if (req.method === 'POST') req.body = await readBody(req);
    return require('./api/proxy')(req,res);
  }
  const aiRoute = parsed.pathname.match(/^\/api\/ai\/(episode|anime|recommendations)$/);
  if (aiRoute) {
    req.query = Object.assign({},parsed.query,{mode:aiRoute[1]});
    if (req.method === 'POST') req.body = await readBody(req,128*1024);
    Object.entries(safeHeaders({})).forEach(([key,value]) => res.setHeader(key,value));
    res.status = code => { res.statusCode=code; return res; };
    res.json = value => res.end(JSON.stringify(value));
    return require('./api/ai/[mode]')(req,res);
  }

  // Loga só o essencial (não polui com TS de HLS)
  if (parsed.pathname !== '/stream') log(req.method, parsed.pathname.slice(0, 140));

  if (parsed.pathname === '/api/anime-news-image') return handleAnimeNewsImage(req, res, parsed);
  if (parsed.pathname === '/api/profile-photo') return handleProfilePhotoUpload(req,res);
  if (parsed.pathname === '/api/anime-news') return handleAnimeNews(req, res);
  if (parsed.pathname === '/proxy')  return handleProxy(req, res, parsed);
  if (parsed.pathname === '/stream') return handleStream(req, res, parsed);
  if (parsed.pathname === '/health'){
    res.writeHead(200, safeHeaders(Object.assign({'Content-Type':'application/json'}, CORS_HEADERS)));
    return res.end(JSON.stringify({ ok:true, uptime: process.uptime() }));
  }

  serveStatic(req, res, parsed.pathname);
}
const server = http.createServer((req,res) => {
  handleRequest(req,res).catch(error => {
    log('request failed',Number(error.statusCode)||500);
    if (!res.headersSent) sendJson(res,error.statusCode||500,{ok:false,error:error.statusCode?error.message:'Falha interna.'});
    else res.end();
  });
});

// Evita derrubar o processo por erros de socket
server.on('clientError', (err, socket) => {
  try { socket.destroy(); } catch(e){}
});
server.on('error', error => {
  if (error && error.code === 'EADDRINUSE') {
    log('A porta ' + PORT + ' já está em uso. O servidor provavelmente já está aberto.');
    log('Use a janela que já está rodando e acesse http://localhost:' + PORT);
    process.exitCode = 1;
    return;
  }
  log('Falha ao iniciar o servidor:', error && error.message || error);
  process.exitCode = 1;
});
process.on('uncaughtException', (e) => log('uncaught', e.message));
process.on('unhandledRejection', (e) => log('unhandled', e && e.message || e));

server.listen(PORT, HOST, () => {
  log('====================================================');
  log(' DRAKSYON server v2 rodando em http://' + HOST + ':' + server.address().port);
  log(' Abra no navegador:  http://localhost:' + PORT);
  log(' Cache em disco:    ' + CACHE_DIR);
  log('====================================================');
});
