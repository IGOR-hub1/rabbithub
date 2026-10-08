'use strict';

const {verifyFirebaseRequest}=require('../lib/firebase-auth');

/* Proxy serverless usado pelo site publicado na Vercel. O APK e o servidor
   Node local continuam usando /proxy; esta função cobre o navegador web, onde
   server.js não permanece em execução. */
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 120;
const RATE = new Map();

function consumeRate(request, userId) {
  const forwarded = String(request.headers && request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || request.socket && request.socket.remoteAddress || 'unknown';
  const key = String(userId || 'unknown').slice(0,128) + '|' + String(address).slice(0,100);
  const now = Date.now();
  if (RATE.size > 2000) {
    for (const [entryKey,value] of RATE) if (now - value.startedAt >= RATE_WINDOW) RATE.delete(entryKey);
  }
  let value = RATE.get(key);
  if (!value || now - value.startedAt >= RATE_WINDOW) value = {startedAt:now,count:0};
  if (value.count >= RATE_MAX) return false;
  value.count += 1;
  RATE.set(key,value);
  return true;
}

function hostnameAllowed(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return [
    'meusanimes.blog',
    'meusdoramas.club',
    'blogger.com',
    'blogspot.com',
    'googlevideo.com',
    'googleusercontent.com'
  ].some(domain => host === domain || host.endsWith('.' + domain));
}

function targetFrom(request) {
  const raw = request.query && request.query.url;
  if (!raw || Array.isArray(raw)) return null;
  try {
    const parsed = new URL(String(raw));
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password ||
        (parsed.port && parsed.port !== '80' && parsed.port !== '443') ||
        !hostnameAllowed(parsed.hostname)) return null;
    return parsed;
  } catch (_) { return null; }
}

function refererFrom(request, target) {
  const raw = request.query && request.query.referer;
  if (raw && !Array.isArray(raw)) {
    try {
      const parsed = new URL(String(raw));
      if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password &&
          (!parsed.port || parsed.port === '80' || parsed.port === '443') &&
          hostnameAllowed(parsed.hostname)) return parsed.toString();
    } catch (_) {}
  }
  return target.origin + '/';
}

function requestBody(request) {
  if (request.method !== 'POST' || request.body == null) return undefined;
  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === 'object') return new URLSearchParams(request.body).toString();
  return String(request.body);
}

function blockedResponse(text) {
  const sample = String(text || '').slice(0,5000).toLowerCase();
  return !sample || sample.includes('sorry, you have been blocked') ||
    sample.includes('attention required! | cloudflare') ||
    sample.includes('checking your browser before') || sample.includes('cf-error-details');
}

function responseHeaders(response, cacheControl) {
  response.setHeader('Access-Control-Allow-Origin','https://rabbithub-7dvf.vercel.app');
  response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Requested-With, X-Same-Domain');
  response.setHeader('Access-Control-Expose-Headers','X-RabbitHub-Final-URL');
  response.setHeader('Cross-Origin-Resource-Policy','same-origin');
  response.setHeader('Cache-Control',cacheControl || 'no-store');
}

function cachePolicy(request,target) {
  // A autorização não participa da chave do CDN. Cache compartilhado aqui
  // permitiria que uma resposta autenticada fosse reutilizada por um visitante
  // sem sessão. O APK já mantém seu próprio cache privado no dispositivo.
  return 'no-store';
}

async function fetchAllowed(target, options, redirects) {
  redirects = redirects == null ? 4 : redirects;
  const upstream = await fetch(target.toString(),Object.assign({},options,{redirect:'manual'}));
  if (![301,302,303,307,308].includes(upstream.status)) return upstream;
  const location = upstream.headers.get('location');
  if (!location || redirects <= 0) throw new Error('Redirecionamento inválido.');
  const next = new URL(location,target);
  if (!/^https?:$/.test(next.protocol) || next.username || next.password ||
      (next.port && next.port !== '80' && next.port !== '443') ||
      !hostnameAllowed(next.hostname)) {
    throw new Error('Redirecionamento para destino não permitido.');
  }
  const nextOptions = Object.assign({},options);
  if (upstream.status === 303 || ((upstream.status === 301 || upstream.status === 302) && nextOptions.method === 'POST')) {
    nextOptions.method = 'GET';
    delete nextOptions.body;
    delete nextOptions.headers['Content-Type'];
  }
  return fetchAllowed(next,nextOptions,redirects - 1);
}

module.exports = async function handler(request,response) {
  if (request.method === 'OPTIONS') {
    responseHeaders(response,'no-store');
    response.statusCode = 204;
    return response.end();
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    responseHeaders(response,'no-store');
    response.statusCode = 405;
    return response.end('Método não permitido.');
  }
  let identity;
  try {
    identity = await verifyFirebaseRequest(request);
  } catch (error) {
    responseHeaders(response,'no-store');
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.statusCode = error && error.statusCode || 401;
    return response.end(JSON.stringify({ok:false,error:error && error.message || 'Autenticação obrigatória.'}));
  }
  if (!consumeRate(request,identity && identity.sub)) {
    responseHeaders(response,'no-store');
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Retry-After','60');
    response.statusCode = 429;
    return response.end(JSON.stringify({ok:false,error:'Muitas consultas. Aguarde um minuto.'}));
  }
  const target = targetFrom(request);
  if (!target) {
    responseHeaders(response,'no-store');
    response.statusCode = 400;
    return response.end('Destino inválido ou não permitido.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),18000);
  try {
    const referer = refererFrom(request,target);
    const outboundBody = requestBody(request);
    if (outboundBody != null && Buffer.byteLength(outboundBody) > MAX_REQUEST_BYTES) {
      responseHeaders(response,'no-store');
      response.setHeader('Content-Type','application/json; charset=utf-8');
      response.statusCode = 413;
      return response.end(JSON.stringify({ok:false,error:'Solicitação muito grande.'}));
    }
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': String(request.headers && request.headers.accept || 'text/html,application/json;q=0.9,*/*;q=0.8'),
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Referer': referer
    };
    if (request.method === 'POST') {
      headers['Content-Type'] = String(request.headers && request.headers['content-type'] || 'application/x-www-form-urlencoded;charset=UTF-8');
      if (request.headers && request.headers['x-requested-with']) headers['X-Requested-With'] = String(request.headers['x-requested-with']);
      if (request.headers && request.headers['x-same-domain']) headers['X-Same-Domain'] = String(request.headers['x-same-domain']);
    }
    const upstream = await fetchAllowed(target,{
      method:request.method,
      headers,
      body:outboundBody,
      signal:controller.signal
    });
    const length = Number(upstream.headers.get('content-length') || 0);
    if (length > MAX_RESPONSE_BYTES) throw new Error('Resposta maior que o limite seguro.');
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > MAX_RESPONSE_BYTES) throw new Error('Resposta maior que o limite seguro.');
    const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    if (upstream.ok && /(?:text|json|javascript|xml|html)/i.test(contentType) && blockedResponse(body.toString('utf8'))) {
      throw new Error('A origem bloqueou temporariamente a consulta.');
    }
    responseHeaders(response,cachePolicy(request,target));
    response.setHeader('Content-Type',contentType);
    response.setHeader('X-RabbitHub-Final-URL',upstream.url || target.toString());
    response.statusCode = upstream.status;
    return response.end(body);
  } catch (error) {
    responseHeaders(response,'no-store');
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.statusCode = error && error.name === 'AbortError' ? 504 : 502;
    return response.end(JSON.stringify({ok:false,error:'Não foi possível consultar o catálogo agora.'}));
  } finally {
    clearTimeout(timeout);
  }
};

module.exports._test = { hostnameAllowed, targetFrom, blockedResponse, requestBody, fetchAllowed, cachePolicy, consumeRate };
