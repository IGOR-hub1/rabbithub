'use strict';

const {verifyFirebaseRequest}=require('./firebase-auth');
const {normalize}=require('./account-plan');
const DATABASE_URL=String(process.env.FIREBASE_DATABASE_URL||'https://animes-64408-default-rtdb.firebaseio.com').replace(/\/+$/,'');

function bearer(request){
  const header=String(request&&request.headers&&request.headers.authorization||'');
  const match=header.match(/^Bearer\s+([^\s]+)$/i);
  return match?match[1]:'';
}
function entitlementError(message,statusCode){const error=new Error(message);error.statusCode=statusCode;return error;}
async function readOwnAccount(identity,token,options){
  options=options||{};
  const fetchFn=options.fetch||global.fetch;
  if(typeof fetchFn!=='function')throw entitlementError('Nao foi possivel validar o plano agora.',503);
  const controller=new AbortController();
  const timeout=setTimeout(function(){controller.abort();},Number(options.timeout)||6000);
  try{
    const response=await fetchFn(DATABASE_URL+'/users/'+encodeURIComponent(identity.sub)+'.json?auth='+encodeURIComponent(token),{
      method:'GET',headers:{Accept:'application/json'},signal:controller.signal
    });
    if(response.status===401||response.status===403)throw entitlementError('Sessao sem permissao para validar a conta.',403);
    if(!response.ok)throw entitlementError('Nao foi possivel validar o plano agora.',503);
    const account=await response.json();
    if(!account||typeof account!=='object')throw entitlementError('Conta nao encontrada.',403);
    if(account.banned===true||account.blocked===true)throw entitlementError('Conta bloqueada.',403);
    return account;
  }catch(error){
    if(error&&error.statusCode)throw error;
    throw entitlementError('Nao foi possivel validar o plano agora.',503);
  }finally{clearTimeout(timeout);}
}
async function requireVip(request,options){
  options=options||{};
  const identity=options.identity||await verifyFirebaseRequest(request);
  const token=bearer(request);
  if(!token)throw entitlementError('Autenticacao obrigatoria.',401);
  const account=await readOwnAccount(identity,token,options);
  const plan=normalize(account);
  if(!plan.isVip)throw entitlementError('Este recurso requer um plano VIP ativo.',403);
  return {identity,account,plan};
}

module.exports={requireVip,readOwnAccount,_test:{bearer,entitlementError}};
