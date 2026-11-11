'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const publicRoot = path.join(root, 'public');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

function filesBelow(directory, extension) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(target, extension));
    else if (!extension || entry.name.endsWith(extension)) result.push(target);
  }
  return result;
}

test('todos os JavaScripts locais têm sintaxe válida', () => {
  const roots = ['public', 'api', 'lib'].map(name => path.join(root, name));
  const files = roots.flatMap(directory => filesBelow(directory, '.js')).concat(path.join(root, 'server.js'));
  for (const file of files) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }), path.relative(root, file));
  }
});

test('scripts e folhas de estilo locais referenciados pelas telas existem', () => {
  for (const file of filesBelow(publicRoot, '.html')) {
    const html = fs.readFileSync(file, 'utf8');
    const references = [
      ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
      ...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)
    ].map(match => match[1].split(/[?#]/)[0]).filter(value => value && !/^(?:https?:)?\/\//i.test(value));
    for (const reference of references) {
      const target = reference.startsWith('/') ? path.join(publicRoot, reference.slice(1)) : path.resolve(path.dirname(file), reference);
      assert.ok(fs.existsSync(target), path.relative(root, file) + ' referencia arquivo ausente: ' + reference);
    }
  }
});

test('painel aceita marcador canônico e conta administrativa antiga', () => {
  const admin = read('public/admin.html');
  assert.match(admin, /OWNER_ADMIN_EMAIL = 'krabelodesouza52@gmail\.com'/);
  assert.match(admin, /account\.isAdmin===true/);
  assert.match(admin, /String\(account\.role\|\|''\)\.toLowerCase\(\)==='admin'/);
  assert.match(admin, /db\.ref\('admins\/'\+result\.uid\)\.set\(true\)/);
});

test('painel administrativo não possui bypass local', () => {
  const admin = read('public/admin.html');
  const activeGuard = admin.slice(admin.indexOf('function verifyAdminSafe'), admin.indexOf('function openApplication'));
  assert.match(admin, /if\(!authUser\|\|authorized!==true\)/);
  assert.doesNotMatch(admin, /isLocalAdminHost/);
  assert.doesNotMatch(admin, /openLocalAdmin\(null/);
  assert.match(activeGuard, /if\(!authUser\)/);
  assert.match(activeGuard, /failGate\('Acesso restrito'/);
});

test('admin possui conexão Firebase interna e só inicia listeners autorizado', () => {
  const admin = read('public/admin.html');
  assert.match(admin, /id="firebaseConnectForm"/);
  assert.match(admin, /databaseURL:'https:\/\/animes-64408-default-rtdb\.firebaseio\.com'/);
  assert.match(admin, /signInWithEmailAndPassword\(email,password\)/);
  assert.match(admin, /currentAdmin\.firebaseAuthorized!==true/);
  assert.match(admin, /firebaseBindingsStarted=true;\s*bootstrapFirebaseStructure\(true\)/);
  assert.match(admin, /\.then\(bindRealtime\)/);
  assert.match(admin, /function ensureAdminMarker\(authUser,result\)/);
  assert.match(admin, /function bootstrapFirebaseStructure\(silent\)/);
  assert.match(admin, /'bootstrapFirebase'\)\.addEventListener\('click'/);
  assert.match(admin, /apiKey:'AIzaSyBqjU_05Lo8w-XOhB_r41Bcj3aQvgh51_4'/);
  assert.match(admin, /appId:'1:887589860807:web:aadc4bcd88f121cae695e2'/);
});

test('configuracao web usa o aplicativo Firebase informado pelo proprietario', () => {
  const config = read('public/firebase-config.js');
  const serviceWorker = read('public/firebase-messaging-sw.js');
  for (const source of [config, serviceWorker]) {
    assert.match(source, /AIzaSyBqjU_05Lo8w-XOhB_r41Bcj3aQvgh51_4/);
    assert.match(source, /1:887589860807:web:aadc4bcd88f121cae695e2/);
    assert.doesNotMatch(source, /AIzaSyD4tBKUiCjfeCMFfaZ8ROs5F7UoQ25HrrI/);
  }
});

test('sessão autenticada recria o perfil ausente no Realtime Database', () => {
  const session = read('public/user-session.js');
  assert.match(session, /function defaultAccount\(user\)/);
  assert.match(session, /plan:'Free',currentPlan:'Free',premium:false,vip:false/);
  assert.match(session, /function createAccount\(\)/);
  assert.match(session, /accountRestRequest\(user,'PUT',created,'null_etag'\)/);
  assert.match(session, /watchedRef\.transaction\(function\(current\)\{return current\|\|created;\}\)/);
  assert.doesNotMatch(session, /plan:'VIP',currentPlan:'VIP'/);
});

test('regras protegem privilégios e autorizam os caminhos usados pelo site', () => {
  const rules = JSON.parse(read('API ANIMES E CHAT/database.rules.json')).rules;
  const serialized = JSON.stringify(rules);
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  assert.ok(rules.notifications.global);
  assert.ok(rules.maintenance);
  assert.equal(rules.dk_broadcast.current['.read'], true);
  assert.equal(rules.dk_broadcast.maintenance['.read'], true);
  assert.equal(rules.dk_broadcast.config['.read'], true);
  assert.equal(rules.dk_broadcast.homeFeatured['.read'], true);
  assert.equal(rules.dk_broadcast.history['.read'], 'auth != null && auth.token.email_verified === true');
  assert.match(rules.dk_broadcast.skipSegments['.read'], /premiumUntil/);
  assert.match(rules.chatReports['.read'], /admins/);
  assert.equal(rules.dk_player_health['.read'], 'auth != null && auth.token.email_verified === true');
  assert.match(rules.users.$uid['.write'], /newData\.child\('isAdmin'\)\.val\(\) === data\.child\('isAdmin'\)\.val\(\)/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('planName'\)\.val\(\) === data\.child\('planName'\)\.val\(\)/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('planStatus'\)\.val\(\) === data\.child\('planStatus'\)\.val\(\)/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('account'\)\.val\(\) === data\.child\('account'\)\.val\(\)/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('subscription'\)\.val\(\) === data\.child\('subscription'\)\.val\(\)/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('isPremium'\)\.val\(\) !== true/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('email'\)\.val\(\) === auth\.token\.email/);
  assert.match(rules.users.$uid.profileHistory['.validate'], /premium/);
  assert.match(rules.users.$uid.profiles.$profile['.validate'], /\$profile === '4'/);
  assert.doesNotMatch(serialized, /numChildren/);
  assert.match(rules.users.$uid.profileProgress['.validate'], /premium/);
  assert.match(rules.users.$uid.backups['.validate'], /premium/);
  assert.match(rules.users.$uid.animeAlerts['.validate'], /premium/);
  assert.doesNotMatch(rules.admins.$uid['.write'], /!root\.child\('admins'\)\.exists\(\)/);
  assert.match(rules.admins.$uid['.write'], /auth\.uid === \$uid && auth\.token\.email === 'krabelodesouza52@gmail\.com' && newData\.val\(\) === true/);
  assert.equal(rules.dk_player_health['.write'], undefined);
  assert.match(serialized, /users.*isAdmin/);
  assert.doesNotMatch(serialized, /"\.write":true/);
});

test('mapa documenta todos os grupos do Realtime Database', () => {
  const paths = read('FIREBASE-PATHS.md');
  [
    '/admins', '/users', '/dk_broadcast/current', '/dk_broadcast/history',
    '/dk_broadcast/maintenance', '/dk_broadcast/config', '/dk_broadcast/homeFeatured',
    '/dk_broadcast/skipSegments', '/notifications/global', '/notifications/user',
    '/rhSocialV1/animeChats', '/rhSocialV1/publicProfiles', '/rhSocialV1/userComments',
    '/rhSocialV1/notifications', '/rhSocialV1/reports', '/rhSocialV1/reportLimits',
    '/chatReports', '/dk_player_health', '/episodeReports'
  ].forEach(pathName => assert.ok(paths.includes(pathName), pathName));
});

test('documentação antiga não recomenda regras globais abertas', () => {
  const changes = read('CHANGES.md');
  assert.doesNotMatch(changes, /"\.read"\s*:\s*true\s*,\s*"\.write"\s*:\s*true/);
  assert.match(changes, /Firebase Authentication por e-mail e senha está ativo/);
});

test('verificador Firebase rejeita chamadas sem Bearer antes de acessar a rede', async () => {
  const auth = require('../lib/firebase-auth');
  await assert.rejects(() => auth.verifyFirebaseRequest({ headers: {} }), error => error && error.statusCode === 401);
  const now = Math.floor(Date.now() / 1000);
  assert.throws(() => auth._test.validateClaims({
    aud:'animes-64408',iss:'https://securetoken.google.com/animes-64408',sub:'uid-test',
    exp:now + 3600,iat:now,auth_time:now,email_verified:false
  }), error => error && error.statusCode === 403);
  assert.doesNotThrow(() => require('../api/proxy.js'));
  assert.doesNotThrow(() => require('../api/ai/[mode].js'));
});

test('regras Firebase também recusam tokens com e-mail não verificado', () => {
  const rules = read('API ANIMES E CHAT/database.rules.json');
  assert.match(rules, /auth\.token\.email_verified === true/);
  assert.ok((rules.match(/auth\.token\.email_verified === true/g) || []).length >= 20);
  assert.doesNotMatch(rules, /auth != null(?! && auth\.token\.email_verified === true)/);
});

test('proxy publicado aceita as duas origens conhecidas sem liberar CORS global', () => {
  const proxy = read('api/proxy.js');
  assert.match(proxy, /https:\/\/jogo-bbzk\.vercel\.app/);
  assert.match(proxy, /https:\/\/rabbithub-7dvf\.vercel\.app/);
  assert.match(proxy, /SITE_ORIGINS\.has\(requestOrigin\)/);
  assert.doesNotMatch(proxy, /Access-Control-Allow-Origin','\*'/);
});

test('servidor local usa o parser WHATWG e rejeita URL malformada', () => {
  const server = read('server.js');
  assert.match(server, /new URL\(String\(req\.url \|\| '\/'\), 'http:\/\/localhost'\)/);
  assert.match(server, /Object\.fromEntries\(requestedUrl\.searchParams\.entries\(\)\)/);
  assert.match(server, /error:'URL inválida'/);
  assert.doesNotMatch(server, /require\(['"]url['"]\)/);
  assert.doesNotMatch(server, /url\.parse\(/);
});

test('dropdown atualiza selectedIndex e dispara input/change', () => {
  const dropdown = read('public/rh-dropdowns.js');
  assert.match(dropdown, /selectedIndex = option\.index/);
  assert.match(dropdown, /emit\(instance\.select, 'input'\)/);
  assert.match(dropdown, /emit\(instance\.select, 'change'\)/);
});

test('backend de recursos VIP consulta a conta protegida e recusa Free', async () => {
  const entitlements = require('../lib/firebase-entitlements');
  const request = {headers:{authorization:'Bearer token-valido'}};
  const identity = {sub:'uid-test'};
  const response = account => async () => ({ok:true,status:200,json:async () => account});
  await assert.rejects(
    () => entitlements.requireVip(request,{identity,fetch:response({plan:'Free',premium:false})}),
    error => error && error.statusCode === 403
  );
  const allowed = await entitlements.requireVip(request,{identity,fetch:response({plan:'VIP',premium:true,premiumUntil:0})});
  assert.equal(allowed.plan.isVip,true);
});

test('telas privadas carregam uma unica fonte de sessao antes de plano e guarda', () => {
  for (const page of ['index.html','detalhes.html','player-animes.html','perfis.html','chat.html']) {
    const html=read('public/'+page);
    const session=html.indexOf('user-session.js');
    const plan=html.indexOf('plan-access.js');
    const guard=html.indexOf('auth-guard.js');
    assert.ok(session>0&&session<plan&&plan<guard,page);
    assert.equal((html.match(/user-session\.js/g)||[]).length,1,page);
  }
  assert.doesNotMatch(read('public/plan-access.js'),/firebase\.database\(/);
  assert.doesNotMatch(read('public/auth-guard.js'),/onAuthStateChanged/);
  assert.doesNotMatch(read('public/chat-inbox.js'),/onAuthStateChanged/);
});

test('proxy local exige token e limita destinos externos', () => {
  const server=read('server.js');
  const serverless=read('api/proxy.js');
  const auth=read('lib/firebase-auth.js');
  assert.match(server,/async function handleProxy[\s\S]*verifyFirebaseRequest\(req,\{checkActive:false\}\)/);
  assert.match(serverless,/verifyFirebaseRequest\(request,\{checkActive:false\}\)/);
  assert.match(auth,/if\(options\.checkActive!==false\)await verifyActiveAccount/);
  assert.match(server,/handleProfilePhotoUpload[\s\S]*verifyFirebaseRequest\(req\)/);
  assert.match(server,/function allowedExternalUrl\(value\)/);
  assert.match(server,/!hostnameAllowed\(parsed\.hostname\)/);
  assert.doesNotMatch(server,/Access-Control-Allow-Origin':\s+'\*'/);
  assert.match(server,/Arquivo não encontrado\.<\/p>/);
  assert.doesNotMatch(server,/Arquivo não encontrado:' \+ file/);
  assert.match(server,/log\(req\.method, parsed\.pathname\.slice/);
});
