'use strict';

const crypto = require('crypto');
const {performance} = require('node:perf_hooks');

const PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || 'animes-64408').trim();
const WEB_API_KEY = String(process.env.FIREBASE_WEB_API_KEY || 'AIzaSyBqjU_05Lo8w-XOhB_r41Bcj3aQvgh51_4').trim();
const CERTIFICATES_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const MAX_TOKEN_BYTES = 16 * 1024;
let certificateCache = { expiresAt: 0, values: null, serverTimeMs: 0, sampledAt: 0 };
let certificateRequest = null;

function authError(message, statusCode) {
  const error = new Error(message || 'Autenticação obrigatória.');
  error.statusCode = statusCode || 401;
  return error;
}

function decodePart(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw authError('Token de autenticação inválido.');
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (_) {
    throw authError('Token de autenticação inválido.');
  }
}

function bearerToken(request) {
  const headers = request && request.headers || {};
  const value = String(headers.authorization || headers.Authorization || '').trim();
  const match = value.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw authError('Entre na sua conta para continuar.');
  if (Buffer.byteLength(match[1]) > MAX_TOKEN_BYTES) throw authError('Token de autenticação inválido.');
  return match[1];
}

function cacheDuration(value) {
  const match = String(value || '').match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Math.max(60, Math.min(86400, Number(match[1]))) * 1000 : 60 * 60 * 1000;
}

async function certificates() {
  if (certificateCache.values && certificateCache.expiresAt > performance.now() + 5000) return certificateCache.values;
  if (certificateRequest) return certificateRequest;
  certificateRequest = loadCertificates();
  try { return await certificateRequest; }
  finally { certificateRequest = null; }
}

async function loadCertificates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const startedAt = performance.now();
  try {
    const response = await fetch(CERTIFICATES_URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw authError('Não foi possível validar a sessão agora.', 503);
    const values = await response.json();
    if (!values || typeof values !== 'object') throw authError('Não foi possível validar a sessão agora.', 503);
    // The local Windows clock can be hours ahead/behind. Calibrate only from
    // Google's HTTPS certificate response, never from the JWT or client input.
    // Age compensates for Google's cached response. A monotonic clock keeps
    // expiry validation correct even if the OS clock changes while running.
    const serverDate = Date.parse(response.headers.get('date') || '');
    const rawAge = response.headers.get('age');
    const age = rawAge == null ? 0 : Number(rawAge);
    if (!Number.isFinite(serverDate) || !Number.isFinite(age) || age < 0 || age > 86400) {
      throw authError('Não foi possível confirmar o horário de validação da sessão.', 503);
    }
    const sampledAt = performance.now();
    certificateCache = {
      values,
      expiresAt: sampledAt + cacheDuration(response.headers.get('cache-control')),
      serverTimeMs: serverDate + age * 1000 + (sampledAt - startedAt),
      sampledAt
    };
    return values;
  } catch (error) {
    if (error && error.statusCode) throw error;
    throw authError('Não foi possível validar a sessão agora.', 503);
  } finally {
    clearTimeout(timeout);
  }
}

function validateIdentity(payload) {
  if (!payload || payload.aud !== PROJECT_ID || payload.iss !== 'https://securetoken.google.com/' + PROJECT_ID) {
    throw authError('Token emitido para outro projeto Firebase.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) throw authError('Token sem usuário válido.');
  if (payload.email_verified !== true) throw authError('Confirme seu e-mail antes de continuar.', 403);
}

function validateClaims(payload, referenceSeconds) {
  validateIdentity(payload);
  const now = Number.isFinite(referenceSeconds) ? referenceSeconds : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw authError('Sua sessão expirou. Entre novamente.');
  if (!Number.isFinite(payload.iat) || payload.iat > now + 300) throw authError('Token com data inválida.');
  if (!Number.isFinite(payload.auth_time) || payload.auth_time <= 0 || payload.auth_time > now + 300) {
    throw authError('Token com autenticação inválida.');
  }
  return payload;
}

async function verifyActiveAccount(token,payload) {
  const controller=new AbortController();
  const timeout=setTimeout(() => controller.abort(),6000);
  try{
    const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(WEB_API_KEY),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),signal:controller.signal
    });
    if(response.status===400||response.status===401||response.status===403)throw authError('Sua sessao nao esta mais ativa. Entre novamente.');
    if(!response.ok)throw authError('Nao foi possivel validar a sessao agora.',503);
    const result=await response.json();
    const user=result&&result.users&&result.users[0];
    if(!user||user.localId!==payload.sub||user.disabled===true)throw authError('Sua sessao nao esta mais ativa. Entre novamente.');
    if(Number(user.validSince)>Number(payload.auth_time||0))throw authError('Sessao revogada. Entre novamente.');
    if(user.emailVerified!==true)throw authError('Confirme seu e-mail antes de continuar.',403);
    return user;
  }catch(error){
    if(error&&error.statusCode)throw error;
    throw authError('Nao foi possivel validar a sessao agora.',503);
  }finally{clearTimeout(timeout);}
}

async function verifySessionAccess(token,payload){
  const base=String(process.env.FIREBASE_DATABASE_URL||'https://animes-64408-default-rtdb.firebaseio.com').replace(/\/+$/,'');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
  try{
    const ownPath='users/'+encodeURIComponent(payload.sub);
    const paths=['revokedSessions/'+encodeURIComponent(payload.sub)+'/'+Number(payload.auth_time),ownPath+'/banned',ownPath+'/blocked'];
    const [revoked,banned,blocked]=await Promise.all(paths.map(async path=>{
      const response=await fetch(base+'/'+path+'.json?auth='+encodeURIComponent(token),{signal:controller.signal});
      if(response.status===401||response.status===403)throw authError('Sessao sem permissao.',403);
      if(!response.ok)throw authError('Nao foi possivel validar a conta.',503);
      return response.json();
    }));
    if(revoked===true)throw authError('Sessao revogada. Entre novamente.');
    if(banned===true||blocked===true)throw authError('Conta bloqueada.',403);
  }catch(error){if(error.statusCode)throw error;throw authError('Nao foi possivel validar a sessao.',503);}
  finally{clearTimeout(timer);}
}

async function verifyFirebaseRequest(request,options) {
  options=options||{};
  const token = bearerToken(request);
  const parts = token.split('.');
  if (parts.length !== 3) throw authError('Token de autenticação inválido.');
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid || typeof header.kid !== 'string') {
    throw authError('Token de autenticação inválido.');
  }
  validateIdentity(payload);
  const keys = await certificates();
  const referenceSeconds = Math.floor((certificateCache.serverTimeMs + performance.now() - certificateCache.sampledAt) / 1000);
  validateClaims(payload,referenceSeconds);
  const certificate = keys[header.kid];
  if (!certificate) throw authError('Chave de autenticação desconhecida. Entre novamente.');
  let valid = false;
  try {
    valid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(parts[0] + '.' + parts[1]),
      certificate,
      Buffer.from(parts[2], 'base64url')
    );
  } catch (_) {
    valid = false;
  }
  if (!valid) throw authError('Assinatura da sessão inválida.');
  /* APIs privadas conferem tambem validSince/desativacao no Authentication.
     Todas as rotas conferem o registro de revogacao e bloqueio no RTDB. */
  if(options.checkActive!==false){await verifyActiveAccount(token,payload);}
  await verifySessionAccess(token,payload);
  return payload;
}

module.exports = {
  verifyFirebaseRequest,
  _test: { bearerToken, decodePart, validateClaims, cacheDuration, verifyActiveAccount, verifySessionAccess }
};
