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
  validateInlineScripts('public/detalhes.html');
  validateInlineScripts('public/player-animes.html');
});

test('login confirma a autenticação sem depender da sincronização remota e inicializa o admin proprietario', () => {
  const html = read('public/login.html');
  assert.match(html, /OWNER_ADMIN_EMAIL = 'krabelodesouza52@gmail\.com'/);
  assert.match(html, /function newAccountData\(uid,email,name,avatar\)/);
  assert.match(html, /function waitForFirebase\(timeoutMs\)/);
  assert.match(html, /function settleWithin\(promise,timeoutMs\)/);
  assert.match(html, /commitAuthenticatedUser\(user,\{\},fallback\)/);
  assert.match(html, /await settleWithin\(ref\.once\('value'\),3500\)/);
  assert.match(html, /if\(!data\)\{/);
  assert.match(html, /data=newAccountData\(uid,user\.email\|\|email,restoredName,restoredAvatar\)/);
  assert.match(html, /firebase\.database\(\)\.ref\('admins\/'\+uid\)\.set\(true\)/);
  assert.doesNotMatch(html, /createdUser\.delete\(\)/);
});

test('guardiao de sessao tem timeout e nao exige recarregar a pagina para concluir o login', () => {
  const guard = read('public/auth-guard.js');
  assert.match(guard, /settleWithin\(accountRef\.once\('value'\),5000\)/);
  assert.match(guard, /finishAuthenticatedUser\(db,user,base,restoredAccount,restoredProfile\)/);
  assert.doesNotMatch(guard, /location\.reload\(\)/);
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
  const home = read('public/index.html');
  assert.match(catalog, /var DEFAULTS = \[\]/);
  assert.doesNotMatch(catalog, /images\.unsplash\.com/);
  assert.doesNotMatch(catalog, /i\.pinimg\.com/);
  assert.match(catalog, /banners = normalizeCollection\(snapshot\.val\(\)\)/);
  assert.match(catalog, /CACHE_KEY = 'rh_profile_banners_cache_v1'/);
  assert.match(catalog, /if \(startAttempts < 80\) window\.setTimeout\(start,100\)/);
  assert.match(catalog, /Mantemos o cache/);
  assert.match(home, /refreshOpenProfileBannerSheet/);
  assert.match(home, /openSheetElement\.classList\.contains\('yc-config-dialog'\)/);
  assert.match(home, /profile-banners\.js\?v=20261101-4/);
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

test('layout responsivo mantém carrosséis arrastáveis, dropdowns em uma linha e retorno da pesquisa', () => {
  const refresh = read('public/app-refresh.js');
  const styles = read('public/app-refresh.css');
  const dropdownStyles = read('public/rh-dropdowns.css');
  const dropdownScript = read('public/rh-dropdowns.js');
  const details = read('public/detalhes.html');
  const home = read('public/index.html');
  assert.match(refresh, /function initHorizontalScroll\(root\)/);
  assert.match(refresh, /row\.scrollLeft=startLeft-distance/);
  assert.match(styles, /scraper-scroll\{\s*display:flex!important/);
  assert.doesNotMatch(styles, /scraper-scroll:not\(\.rh-resume-scroll\)[^{]*\{[^}]*display:grid!important/);
  assert.match(dropdownStyles, /rh-select__option[^{]*\{[^}]*white-space:nowrap/);
  assert.match(dropdownScript, /instance\.menu\.style\.width = 'max-content'/);
  assert.match(details, /id="detail-back"/);
  assert.match(details, /window\.history\.back\(\)/);
  assert.match(home, /rh_detail_return_v1/);
});

test('login mantém somente o painel de acesso centralizado', () => {
  const login = read('public/login.html');
  const styles = read('public/login-refresh.css');
  const server = read('server.js');
  assert.match(login, /<main class="auth-shell" id="acesso">/);
  assert.match(login, /class="auth-panel"/);
  assert.doesNotMatch(login, /id="landing-news-list"/);
  assert.doesNotMatch(login, /class="login-home login-showcase"/);
  assert.match(styles, /body\[data-page="login"\] \.auth-shell\{[^}]*align-items:center;justify-content:center/);
  assert.match(server, /cr-news-api-service\.prd\.crunchyrollsvc\.com\/v1\/pt-BR\/rss/);
  assert.match(server, /parsed\.pathname === '\/api\/anime-news'/);
  assert.match(server, /parsed\.pathname === '\/api\/anime-news-image'/);
  assert.match(server, /\['storyblok\.com','crunchyroll\.com'\]/);
});

test('painel preserva o cadastro administrativo de patrocinadores', () => {
  const admin = read('public/admin.html');
  const login = read('public/login.html');
  assert.match(admin, /id="sponsorForm"/);
  assert.match(admin, /SPONSORS_PATH = 'dk_broadcast\/config\/sponsors'/);
  assert.match(admin, /function addSponsor\(event\)/);
  assert.match(admin, /data-remove-sponsor/);
  assert.doesNotMatch(login, /id="landing-sponsor-grid"/);
});

test('Home mostra cache antigo imediatamente e prioriza o catálogo principal', () => {
  const adapter = read('public/meusanimes.js');
  const home = read('public/index.html');
  assert.match(adapter, /if \(stale\) \{\s*fetchText\(url/);
  assert.match(adapter, /if \(stale\) \{\s*fetchText\(ORIGIN \+ '\/'/);
  assert.match(adapter, /return stale;/);
  assert.match(home, /await loadMainCatalog\(\)\.catch/);
  assert.match(home, /requests\.slice\(0,2\)\.map\(loadGenre\)/);
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
