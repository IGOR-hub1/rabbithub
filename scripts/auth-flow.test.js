'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('sessao usa HTTPS oficial quando o listener do Firebase demora na TV', async () => {
  const values = new Map();
  let restCalls = 0;
  let transactions = 0;
  const restMethods = [];
  const user = {
    uid: 'tv-user',
    email: 'tv@example.com',
    emailVerified: true,
    displayName: 'Perfil TV',
    photoURL: '',
    getIdTokenResult: async () => ({ claims: { email_verified: true } }),
    getIdToken: async () => 'token-tv'
  };
  const account = {
    uid: user.uid,
    email: user.email,
    displayName: 'Perfil TV',
    profileName: 'Perfil TV',
    profileAvatar: 'img/logo-blue.jpg',
    profile: { id: 'principal', name: 'Perfil TV', avatar: 'img/logo-blue.jpg', theme: 'blue' },
    profiles: [{ id: 'principal', name: 'Perfil TV', avatar: 'img/logo-blue.jpg', theme: 'blue' }],
    plan: 'VIP',
    currentPlan: 'VIP',
    premium: true,
    vip: true,
    banned: false,
    blocked: false
  };
  const accountRef = {
    on(_event, callback) { setTimeout(() => callback({ val: () => null }), 0); },
    off() {},
    set: async () => {},
    transaction: async (update) => { transactions += 1; return { snapshot: { val: () => update(null) } }; },
    child() { return { set: async () => {} }; }
  };
  const database = () => ({
    ref(name) {
      if (name === 'users/tv-user') return accountRef;
      return { set: async () => {}, on() {}, off() {}, child() { return this; } };
    }
  });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  const authObject = {
    currentUser: user,
    setPersistence: async () => {},
    onAuthStateChanged(callback) { setTimeout(() => callback(user), 0); return () => {}; },
    signOut: async () => {}
  };
  const auth = () => authObject;
  auth.Auth = { Persistence: { LOCAL: 'local' } };
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const context = {
    console,
    Promise,
    JSON,
    Date,
    Math,
    Error,
    Object,
    Array,
    String,
    Number,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    localStorage: storage,
    document: { dispatchEvent() {} },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    fetch: async (_url, options) => {
      restCalls += 1;
      restMethods.push(options && options.method || 'GET');
      return { ok: true, status: 200, json: async () => account };
    },
    firebase: { apps: [{}], auth, database, initializeApp() {} },
    DK_FIREBASE_CONFIG: { databaseURL: 'https://animes-64408-default-rtdb.firebaseio.com' },
    RabbitHubUid: { safeSegment(value) { return String(value); } },
    RabbitHubAccountPlan: {
      normalize(value) { return { key: value && value.premium ? 'vip' : 'free', expiresAt: 0 }; },
      mergeSession(target, value) {
        target.plan = value && value.premium ? 'VIP' : 'Free';
        target.currentPlan = target.plan;
        target.premium = Boolean(value && value.premium);
        target.vip = target.premium;
        return target;
      }
    }
  };
  context.window = context;
  vm.runInNewContext(read('public/user-session.js'), context, { filename: 'user-session.js' });

  const state = await Promise.race([
    context.RabbitHubSession.ready(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('sessao nao concluiu')), 3000))
  ]);

  assert.equal(restCalls, 1);
  assert.deepEqual(restMethods, ['GET']);
  assert.equal(transactions, 0, 'snapshot vazio inicial nao pode sobrescrever uma conta existente');
  assert.equal(state.status, 'authenticated');
  assert.equal(state.ready, true);
  assert.equal(state.account.plan, 'VIP');
  assert.equal(JSON.parse(values.get('dk_session')).plan, 'VIP');
  context.RabbitHubSession.stop();
});

test('login nao espera Realtime Database depois de autenticar', () => {
  const login = read('public/login.html');
  assert.match(login, /signInWithEmailAndPassword\(email,pass\)/);
  assert.match(login, /rememberAuthHandoff\(authenticatedUser\)/);
  assert.match(login, /window\.location\.replace\(destinationAfterLogin\(\)\)/);
  assert.doesNotMatch(login, /syncSignedInAccount/);
  assert.doesNotMatch(login, /Firebase demorou para sincronizar sua conta/);
});
