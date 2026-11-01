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

test('bypass do painel existe somente em endereços locais', () => {
  const admin = read('public/admin.html');
  assert.match(admin, /host==='localhost'\|\|host==='127\.0\.0\.1'\|\|host==='::1'/);
  assert.match(admin, /if\(isLocalAdminHost\(\)\)\{/);
  assert.match(admin, /openLocalAdmin\(null,\{\},false\)/);
  assert.doesNotMatch(admin, /host\.endsWith/);
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
  const guard = read('public/auth-guard.js');
  assert.match(guard, /if\(!data\)\{\s*var restoredProfile=normalizeProfile/);
  assert.match(guard, /plan:'Free',currentPlan:'Free',premium:false/);
  assert.match(guard, /settleWithin\(accountRef\.set\(restoredAccount\),5000\)/);
  assert.match(guard, /finishAuthenticatedUser\(db,user,base,restoredAccount,restoredProfile\)/);
  assert.doesNotMatch(guard, /if\(!data\)\{\s*leaving=true;clearLocalSession\(\)/);
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
  assert.equal(rules.dk_broadcast.history['.read'], 'auth != null');
  assert.match(rules.chatReports['.read'], /admins/);
  assert.equal(rules.dk_player_health['.read'], 'auth != null');
  assert.match(rules.users.$uid['.write'], /newData\.child\('isAdmin'\)\.val\(\) === data\.child\('isAdmin'\)\.val\(\)/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('planName'\)\.val\(\) === data\.child\('planName'\)\.val\(\)/);
  assert.match(rules.users.$uid['.write'], /newData\.child\('email'\)\.val\(\) === auth\.token\.email/);
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
  assert.doesNotThrow(() => require('../api/proxy.js'));
  assert.doesNotThrow(() => require('../api/ai/[mode].js'));
});

test('proxy publicado aceita as duas origens conhecidas sem liberar CORS global', () => {
  const proxy = read('api/proxy.js');
  assert.match(proxy, /https:\/\/jogo-bbzk\.vercel\.app/);
  assert.match(proxy, /https:\/\/rabbithub-7dvf\.vercel\.app/);
  assert.match(proxy, /SITE_ORIGINS\.has\(requestOrigin\)/);
  assert.doesNotMatch(proxy, /Access-Control-Allow-Origin','\*'/);
});

test('dropdown atualiza selectedIndex e dispara input/change', () => {
  const dropdown = read('public/rh-dropdowns.js');
  assert.match(dropdown, /selectedIndex = option\.index/);
  assert.match(dropdown, /emit\(instance\.select, 'input'\)/);
  assert.match(dropdown, /emit\(instance\.select, 'change'\)/);
});
