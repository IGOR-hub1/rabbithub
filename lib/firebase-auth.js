'use strict';

const crypto = require('crypto');

const PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || 'animes-64408').trim();
const CERTIFICATES_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const MAX_TOKEN_BYTES = 16 * 1024;
let certificateCache = { expiresAt: 0, values: null };

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
  if (certificateCache.values && certificateCache.expiresAt > Date.now() + 5000) return certificateCache.values;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(CERTIFICATES_URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw authError('Não foi possível validar a sessão agora.', 503);
    const values = await response.json();
    if (!values || typeof values !== 'object') throw authError('Não foi possível validar a sessão agora.', 503);
    certificateCache = {
      values,
      expiresAt: Date.now() + cacheDuration(response.headers.get('cache-control'))
    };
    return values;
  } catch (error) {
    if (error && error.statusCode) throw error;
    throw authError('Não foi possível validar a sessão agora.', 503);
  } finally {
    clearTimeout(timeout);
  }
}

function validateClaims(payload) {
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.aud !== PROJECT_ID || payload.iss !== 'https://securetoken.google.com/' + PROJECT_ID) {
    throw authError('Token emitido para outro projeto Firebase.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) throw authError('Token sem usuário válido.');
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw authError('Sua sessão expirou. Entre novamente.');
  if (!Number.isFinite(payload.iat) || payload.iat > now + 300) throw authError('Token com data inválida.');
  if (payload.auth_time != null && (!Number.isFinite(payload.auth_time) || payload.auth_time > now + 300)) {
    throw authError('Token com autenticação inválida.');
  }
  if (payload.email_verified !== true) throw authError('Confirme seu e-mail antes de continuar.', 403);
  return payload;
}

async function verifyFirebaseRequest(request) {
  const token = bearerToken(request);
  const parts = token.split('.');
  if (parts.length !== 3) throw authError('Token de autenticação inválido.');
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid || typeof header.kid !== 'string') {
    throw authError('Token de autenticação inválido.');
  }
  validateClaims(payload);
  const keys = await certificates();
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
  return payload;
}

module.exports = {
  verifyFirebaseRequest,
  _test: { bearerToken, decodePart, validateClaims, cacheDuration }
};
