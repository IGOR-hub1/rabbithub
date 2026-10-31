'use strict';

const crypto = require('crypto');

const MAX_PROFILE_IMAGE_BYTES = 1536 * 1024;
const TYPES = {
  'image/jpeg': {extension:'jpg', magic(buffer){ return buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff; }},
  'image/png': {extension:'png', magic(buffer){ return buffer.length > 8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])); }},
  'image/webp': {extension:'webp', magic(buffer){ return buffer.length > 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP'; }}
};

function hash(value){ return crypto.createHash('sha256').update(value).digest('hex'); }
function hmac(key,value,encoding){ return crypto.createHmac('sha256',key).update(value).digest(encoding); }
function segment(value,fallback){
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  return clean || fallback;
}
function encodePath(value){ return String(value).split('/').map(encodeURIComponent).join('/'); }

function configuration(env){
  env = env || process.env;
  const accountId = String(env.R2_ACCOUNT_ID || '').trim();
  const bucket = String(env.R2_BUCKET || '').trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();
  const publicUrl = String(env.R2_PUBLIC_URL || '').trim().replace(/\/+$/,'');
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !/^https:\/\//i.test(publicUrl)) return null;
  return {accountId,bucket,accessKeyId,secretAccessKey,publicUrl};
}

function imageType(buffer,requested){
  requested = String(requested || '').toLowerCase().split(';')[0].trim();
  const type = TYPES[requested];
  return type && type.magic(buffer) ? {contentType:requested,extension:type.extension} : null;
}

function signingHeaders(config,key,contentType,body,now){
  now = now || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const day = amzDate.slice(0,8);
  const host = config.accountId + '.r2.cloudflarestorage.com';
  const canonicalUri = '/' + encodePath(config.bucket) + '/' + encodePath(key);
  const payloadHash = hash(body);
  const canonicalHeaders = 'content-type:' + contentType + '\n' +
    'host:' + host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT',canonicalUri,'',canonicalHeaders,signedHeaders,payloadHash].join('\n');
  const scope = day + '/auto/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256',amzDate,scope,hash(canonicalRequest)].join('\n');
  const dateKey = hmac(Buffer.from('AWS4' + config.secretAccessKey,'utf8'),day);
  const regionKey = hmac(dateKey,'auto');
  const serviceKey = hmac(regionKey,'s3');
  const signingKey = hmac(serviceKey,'aws4_request');
  const signature = hmac(signingKey,stringToSign,'hex');
  return {
    url:'https://' + host + canonicalUri,
    headers:{
      'Content-Type':contentType,
      'X-Amz-Content-Sha256':payloadHash,
      'X-Amz-Date':amzDate,
      'Authorization':'AWS4-HMAC-SHA256 Credential=' + config.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature
    }
  };
}

async function uploadProfileImage(buffer,options){
  options = options || {};
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PROFILE_IMAGE_BYTES) {
    const error = new Error('A foto deve ter no máximo 1,5 MB.'); error.statusCode = 413; throw error;
  }
  const detected = imageType(buffer,options.contentType);
  if (!detected) { const error = new Error('Use uma imagem JPG, PNG ou WEBP válida.'); error.statusCode = 415; throw error; }
  const config = configuration(options.env);
  if (!config) { const error = new Error('O armazenamento de fotos ainda não foi configurado.'); error.statusCode = 503; error.configured = false; throw error; }
  const uid = segment(options.uid,'anonymous');
  const profileId = segment(options.profileId,'principal');
  const key = 'profiles/' + uid + '/' + profileId + '/' + Date.now() + '-' + crypto.randomBytes(8).toString('hex') + '.' + detected.extension;
  const signed = signingHeaders(config,key,detected.contentType,buffer,options.now);
  const request = options.fetch || global.fetch;
  const response = await request(signed.url,{method:'PUT',headers:signed.headers,body:buffer});
  if (!response.ok) { const error = new Error('O R2 recusou o envio da foto (HTTP ' + response.status + ').'); error.statusCode = 502; throw error; }
  return {url:config.publicUrl + '/' + encodePath(key),key:key,contentType:detected.contentType,size:buffer.length};
}

function readImageBody(request,limit){
  limit = limit || MAX_PROFILE_IMAGE_BYTES;
  return new Promise((resolve,reject) => {
    const chunks=[]; let size=0; let settled=false;
    request.on('data',chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) { settled=true; const error=new Error('A foto deve ter no máximo 1,5 MB.'); error.statusCode=413; reject(error); return; }
      chunks.push(chunk);
    });
    request.on('end',() => { if (!settled) resolve(Buffer.concat(chunks)); });
    request.on('error',error => { if (!settled) reject(error); });
  });
}

module.exports = {MAX_PROFILE_IMAGE_BYTES,configuration,imageType,signingHeaders,uploadProfileImage,readImageBody};
