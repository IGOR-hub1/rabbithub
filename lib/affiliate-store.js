'use strict';
const crypto = require('crypto');

function createStore(options = {}) {
  const fetchFn = options.fetch || fetch;
  const unavailable = message => Object.assign(new Error(message), {statusCode:503});
  const projectId = String(options.projectId || process.env.FIREBASE_PROJECT_ID || 'animes-64408').trim();
  let account;
  try { account = options.account || (process.env.FIREBASE_SERVICE_ACCOUNT_JSON && JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)); }
  catch (_) { throw unavailable('FIREBASE_SERVICE_ACCOUNT_JSON inválido no servidor.'); }
  if (!account || !account.client_email || !account.private_key) throw unavailable('Configure FIREBASE_SERVICE_ACCOUNT_JSON no servidor.');
  if (account.project_id !== projectId) throw unavailable('Credencial de serviço pertence a outro projeto Firebase.');
  const configuredURL = String(options.databaseURL || process.env.FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.firebaseio.com`);
  let databaseURL;
  try { databaseURL = new URL(configuredURL); }
  catch (_) { throw unavailable('FIREBASE_DATABASE_URL inválida.'); }
  const host = databaseURL.hostname.toLowerCase();
  if (databaseURL.protocol !== 'https:' || databaseURL.username || databaseURL.password || databaseURL.port || databaseURL.pathname !== '/' || databaseURL.search || databaseURL.hash ||
      !(host === projectId + '.firebaseio.com' || host.startsWith(projectId + '-') && (host.endsWith('.firebaseio.com') || host.endsWith('.firebasedatabase.app')))) {
    throw unavailable('FIREBASE_DATABASE_URL deve apontar para o Realtime Database do projeto configurado.');
  }
  const base = databaseURL.origin;
  async function timedFetch(url,init){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{return await fetchFn(url,{...init,signal:controller.signal});}finally{clearTimeout(timer);}}
  let token = '', expires = 0;
  async function accessToken() {
    if (token && Date.now() < expires - 60000) return token;
    const now = Math.floor(Date.now()/1000);
    const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signing = enc({alg:'RS256',typ:'JWT'}) + '.' + enc({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const assertion = signing + '.' + crypto.sign('RSA-SHA256',Buffer.from(signing),account.private_key).toString('base64url');
    const response = await timedFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
    if (!response.ok) throw Object.assign(new Error('Credencial de serviço do Firebase indisponível.'),{statusCode:503});
    const data = await response.json(); token=data.access_token; expires=Date.now()+Number(data.expires_in||3600)*1000;
    if (!token) throw Object.assign(new Error('Credencial de serviço do Firebase inválida.'),{statusCode:503});
    return token;
  }
  async function request(path,method='GET',value,etag) {
    if (path!==''&&!/^[A-Za-z0-9_/-]+$/.test(path)) throw new Error('Caminho inválido.');
    const bearer=await accessToken();
    const headers={Authorization:'Bearer '+bearer};
    if (value!==undefined) headers['Content-Type']='application/json';
    if (method==='GET' && etag===true) headers['X-Firebase-ETag']='true';
    else if (typeof etag==='string') headers['if-match']=etag;
    const response=await timedFetch(base+'/'+path+'.json',{method,headers,body:value===undefined?undefined:JSON.stringify(value)});
    if (response.status===412) return {conflict:true};
    if (!response.ok) throw Object.assign(new Error('Falha ao acessar o Firebase.'),{statusCode:503});
    return {value:await response.json(),etag:response.headers.get('etag')};
  }
  return {request};
}
module.exports={createStore};
