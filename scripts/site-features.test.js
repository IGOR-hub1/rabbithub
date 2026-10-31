'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function validateInlineScripts(relative) {
  const html = read(relative);
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, relative + ' deve conter script inline');
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new Function(match[1]), relative + ' script ' + index);
  });
}

test('scripts inline das telas alteradas continuam válidos', () => {
  validateInlineScripts('public/admin.html');
  validateInlineScripts('public/login.html');
  validateInlineScripts('public/index.html');
  validateInlineScripts('public/player-animes.html');
});

test('login recupera conta autenticada sem perfil e inicializa o admin proprietario', () => {
  const html = read('public/login.html');
  assert.match(html, /OWNER_ADMIN_EMAIL = 'krabelodesouza52@gmail\.com'/);
  assert.match(html, /function newAccountData\(uid,email,name,avatar\)/);
  assert.match(html, /if\(!data\)\{/);
  assert.match(html, /data=newAccountData\(uid,signed\.user\.email\|\|email,restoredName,restoredAvatar\)/);
  assert.match(html, /firebase\.database\(\)\.ref\('admins\/'\+uid\)\.set\(true\)/);
});

test('admin cadastra links e filtra as três categorias de banner sem Storage', () => {
  const html = read('public/admin.html');
  assert.match(html, /id="profileBannerLinkCategory"/);
  assert.match(html, /id="profileBannerAdminFilter"/);
  assert.match(html, /category:category/);
  assert.doesNotMatch(html, /firebase-storage-compat/);
  assert.doesNotMatch(html, /profileBannerUploadForm/);
  assert.doesNotMatch(html, /firebase\.storage/);
});

test('catálogo do usuário oferece categoria e vídeo sem atalhos artificiais', () => {
  const html = read('public/index.html');
  assert.match(html, /data-banner-category/);
  assert.match(html, /<video src=/);
  assert.doesNotMatch(html, /settings-quick-nav/);
  assert.doesNotMatch(html, /data-config-jump/);
  assert.doesNotMatch(html, /id="cfg-backup-download" disabled/);
  assert.doesNotMatch(html, /id="cfg-backup-import" disabled/);
});

test('seletor usa apenas banners publicados pelo administrador', () => {
  const catalog = read('public/profile-banners.js');
  assert.match(catalog, /var DEFAULTS = \[\]/);
  assert.doesNotMatch(catalog, /images\.unsplash\.com/);
  assert.doesNotMatch(catalog, /i\.pinimg\.com/);
  assert.match(catalog, /banners = normalizeCollection\(snapshot\.val\(\)\)/);
});

test('chat mostra e persiste o número do episódio', () => {
  const chat = read('public/anime-chat.js');
  assert.match(chat, /function episodeLabel/);
  assert.match(chat, /className = 'rh-chat-episode'/);
  assert.match(chat, /episodeNumber:currentEpisodeNumber/);
  assert.match(chat, /seasonNumber:currentSeasonNumber/);
});

test('pré-carregamento do episódio sobrevive à navegação sem cache permanente', () => {
  const adapter = read('public/meusanimes.js');
  assert.match(adapter, /EPISODE_CACHE_PREFIX = 'ma_episode_v1_'/);
  assert.match(adapter, /root\.sessionStorage\.setItem/);
  assert.match(adapter, /episodeCacheRecord\(key\)/);
  assert.doesNotMatch(adapter, /localStorage\.setItem\(EPISODE_CACHE_PREFIX/);
  assert.match(adapter, /type !== 'slow-2g' && type !== '2g'/);
});

test('player automático adapta qualidade e recupera travamento com fonte menor', () => {
  const player = read('public/player-animes.html');
  assert.match(player, /function networkProfile\(\)/);
  assert.match(player, /type==='3g'\)ceiling=480/);
  assert.match(player, /capLevelToPlayerSize: true/);
  assert.match(player, /abrEwmaDefaultEstimate: networkProfile\(\)\.bandwidth/);
  assert.match(player, /var lower=qualityPreference==='auto'/);
  assert.match(player, /data-next-episode-prefetch/);
});

test('mídia decorativa fora da tela pausa e respeita economia de dados', () => {
  const refresh = read('public/app-refresh.js');
  const home = read('public/index.html');
  assert.match(refresh, /function allowsSpeculativeLoading\(\)/);
  assert.match(refresh, /type!=='slow-2g'&&type!=='2g'/);
  assert.match(refresh, /IntersectionObserver/);
  assert.match(refresh, /syncDecorativeVideo/);
  assert.match(home, /preload="none" data-visible-autoplay/);
});

test('arquivos Firebase apontam para regras separadas e válidas', () => {
  const config = JSON.parse(read('firebase.json'));
  const databaseRules = JSON.parse(read('API ANIMES E CHAT/database.rules.json'));
  assert.equal(config.database.rules, 'API ANIMES E CHAT/database.rules.json');
  assert.equal(config.storage, undefined);
  assert.ok(databaseRules.rules.rhSocialV1);
  assert.ok(databaseRules.rules.dk_broadcast);
  assert.equal(fs.existsSync(path.join(root, 'firebase', 'storage.rules')), false);
});
