'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const castWatch = require('../XBunny-Cast-Server/api/watch.js')._test;

const source = fs.readFileSync(path.join(__dirname, '../public/cast-share.js'), 'utf8');

function environment() {
  const elements = new Map();
  const writes = [];
  const records = new Map();
  const clipboard = [];
  const document = {
    readyState: 'complete', activeElement: null, listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        hidden: id === 'dk-cast-modal', disabled: false, value: '', textContent: '', attrs: {}, listeners: {},
        addEventListener(type, callback) { this.listeners[type] = callback; },
        setAttribute(name, value) { this.attrs[name] = value; },
        focus() { document.activeElement = this; }, select() { this.selected = true; }
      });
      return elements.get(id);
    },
    execCommand() { return true; }
  };
  const user = { uid: 'owner_1', emailVerified: true, async getIdToken() { return 'test-token'; } };
  const db = { ref(key) { return {
    async once() { assert.equal(key, '.info/serverTimeOffset'); return { val: () => 0 }; },
    async transaction(update) {
      const value = update(records.get(key) ?? null);
      if (value === undefined) return { committed: false };
      writes.push([key, value]); records.set(key, value);
      return { committed: true };
    },
    async set(value) { writes.push([key, value]); if (key.endsWith('/status')) records.get(key.slice(0, -7)).status = value; else records.set(key, value); }
  }; } };
  const firebase = { auth: () => ({ currentUser: user }), database: () => db };
  firebase.database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  const navigator = { onLine: true, clipboard: { async writeText(value) { clipboard.push(value); } } };
  const window = {
    crypto: webcrypto, btoa, navigator, firebase,
    RabbitHubSession: { get: () => ({ status: 'authenticated', uid: user.uid }) },
    XBUNNY_CAST_SHARE_CONFIG: {
      origin: 'https://cast.example',
      entries: [{ animeSlug: 'a/demo', episodeLink: 'https://meusanimes.blog/e/demo',
        sourceUrls: ['https://media.example/demo.mp4'], animeId: 'demo', episodeId: 'ep_1', sourceId: 'public_1' }]
    }
  };
  vm.runInNewContext(source, { window, document, firebase, navigator, URL, Uint8Array, Uint32Array, Date, Number, String, Math });
  return { api: window.XBunnyCastShare, document, element: id => document.getElementById(id), writes, records, clipboard, window };
}

test('gera, copia, permite consulta independente e encerra um link Cast', async () => {
  const ui = environment();
  ui.api.setContext({ animeSlug: 'a/demo', episodeLink: 'https://meusanimes.blog/e/demo?x=1',
    sourceUrl: 'https://media.example/demo.mp4', animeTitle: 'Anime Demo', episodeTitle: 'Episódio 1' });
  await ui.api.create();
  const [key, payload] = ui.writes[0];
  assert.match(key, /^castSessions\/[1-9][0-9]{6}$/);
  assert.equal(payload.ownerUid, 'owner_1');
  assert.equal(payload.animeId, 'demo');
  assert.equal(payload.episodeId, 'ep_1');
  assert.equal(payload.sourceId, 'public_1');
  assert.equal(payload.status, 'active');
  assert(!JSON.stringify(payload).includes('https://media.example'));
  const link = ui.element('dk-cast-link').value;
  assert.equal(link, 'https://cast.example/assistir/' + payload.id);
  await ui.api.copy();
  assert.equal(ui.clipboard[0], link);
  assert.equal(castWatch.sessionState(ui.records.get(key), payload.id, Date.now()).episodeId, 'ep_1');
  await ui.api.end();
  assert.equal(ui.records.get(key).status, 'ended');
  assert.equal(castWatch.sessionState(ui.records.get(key), payload.id, Date.now()).state, 'ended');
  assert.equal(ui.element('dk-cast-copy').disabled, true);
});

test('não cria sessão para domínio ou fonte sem configuração', async () => {
  const ui = environment();
  ui.api.setContext({ animeSlug: 'a/demo', episodeLink: 'https://meusanimes.blog/e/demo',
    sourceUrl: 'https://blocked.example/private.mp4', animeTitle: 'Anime Demo', episodeTitle: 'Episódio 1' });
  await ui.api.create();
  assert.equal(ui.writes.length, 0);
  assert.match(ui.element('dk-cast-status').textContent, /não foi autorizada/);
  ui.window.XBUNNY_CAST_SHARE_CONFIG.origin = '';
  await ui.api.create();
  assert.match(ui.element('dk-cast-status').textContent, /domínio HTTPS/);
});

test('WebView copia pelo fallback e informa falta de conexão', async () => {
  const ui = environment();
  ui.api.setContext({ animeSlug: 'a/demo', episodeLink: 'https://meusanimes.blog/e/demo',
    sourceUrl: 'https://media.example/demo.mp4', animeTitle: 'Anime Demo', episodeTitle: 'Episódio 1' });
  await ui.api.create();
  ui.window.navigator.clipboard = null;
  await ui.api.copy();
  assert.equal(ui.element('dk-cast-link').selected, true);
  assert.match(ui.element('dk-cast-status').textContent, /Link copiado/);
  await ui.api.end();
  ui.window.navigator.onLine = false;
  await ui.api.create();
  assert.match(ui.element('dk-cast-status').textContent, /Sem conexão/);
});

test('compartilha a rota pública do iframe pelo Firebase sem catálogo local', async () => {
  const ui = environment();
  ui.window.XBUNNY_CAST_SHARE_CONFIG.entries = [];
  ui.api.setContext({ animeSlug: 'anime', episodeLink: 'https://meusanimes.blog/e/ep',
    iframeUrl: 'https://serv01.meusdoramas.club/#/video/126971/1/3/',
    animeTitle: 'Anime', episodeTitle: 'Episódio 3' });
  await ui.api.create();
  assert.equal(ui.writes.length, 1);
  const payload = ui.writes[0][1];
  assert.equal(payload.animeId, 'md_126971');
  assert.equal(payload.episodeId, 's1_e3');
  assert.equal(payload.sourceId, 'serv01_iframe');
  assert.equal(payload.iframeUrl, 'https://serv01.meusdoramas.club/#/video/126971/1/3/');
  assert.equal(castWatch.sessionState(ui.records.get(ui.writes[0][0]), payload.id, Date.now()).url, payload.iframeUrl);
  await ui.api.end();
  assert.equal(ui.records.get(ui.writes[0][0]).status, 'ended');
  ui.api.setContext({ animeSlug: 'anime', episodeLink: 'https://meusanimes.blog/e/ep',
    iframeUrl: 'https://evil.example/#/video/126971/1/3/' });
  await ui.api.create();
  assert.equal(ui.writes.length, 2);
  assert.match(ui.element('dk-cast-status').textContent, /não foi autorizada/);
});

test('código numérico ocupado não sobrescreve outra sessão', async () => {
  const ui = environment();
  const occupied = { id: '1234567', ownerUid: 'other' };
  ui.records.set('castSessions/1234567', occupied);
  const samples = [234567, 1345678];
  ui.window.crypto = { getRandomValues(target) { target[0] = samples.shift(); return target; } };
  ui.api.setContext({ animeSlug: 'a/demo', episodeLink: 'https://meusanimes.blog/e/demo',
    sourceUrl: 'https://media.example/demo.mp4', animeTitle: 'Anime Demo', episodeTitle: 'Episódio 1' });
  await ui.api.create();
  assert.equal(ui.element('dk-cast-link').value, 'https://cast.example/assistir/2345678');
  assert.equal(ui.records.get('castSessions/1234567'), occupied);
  assert.equal(ui.records.get('castSessions/2345678').id, '2345678');
});
