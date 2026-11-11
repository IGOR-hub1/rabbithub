'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const adapter = require('../public/meusanimes.js');

const api = adapter._test;
const serviceIframe = 'https://serv01.meusdoramas.club/#/video/119495/1/3';

test('reconhece as coordenadas do iframe registrado no JSON', () => {
  assert.deepEqual(api.serviceCoordinates(serviceIframe), {
    id: '119495', season: '1', episode: '3'
  });
});

test('ordena episódios por temporada e número sem misturar sequências', () => {
  const sorted = api.sortEpisodes([
    { temporada:2, numero:3, nome:'T2 E3' },
    { temporada:1, numero:4, nome:'T1 E4' },
    { temporada:2, numero:4, nome:'T2 E4' },
    { temporada:0, numero:1, nome:'Especial' },
    { temporada:1, numero:1, nome:'T1 E1' }
  ]);
  assert.deepEqual(sorted.map(item => item.nome), [
    'T1 E1','T1 E4','T2 E3','T2 E4','Especial'
  ]);
  assert.equal(api.compareEpisodeOrder(sorted[2], sorted[3]) < 0, true);
});

test('classifica os formatos web reproduzíveis', () => {
  const formats = {
    'https://cdn.example/video.mp4': 'video/mp4',
    'https://cdn.example/video.webm': 'video/webm',
    'https://cdn.example/video.ogv': 'video/ogg',
    'https://cdn.example/video.mov': 'video/quicktime',
    'https://cdn.example/video.m4v': 'video/x-m4v',
    'https://cdn.example/master.m3u8?token=1': 'application/vnd.apple.mpegurl',
    'https://cdn.example/manifest.mpd#stream': 'application/dash+xml'
  };
  for (const [url, type] of Object.entries(formats)) {
    assert.equal(api.directSource(url).type, type, url);
  }
});

test('extrai mídia de objetos e embeds aninhados', () => {
  const payload = {
    data: { player: { sources: [
      { file: 'https://media.example/master.m3u8?sig=abc' },
      { src: 'https://media.example/manifest.mpd' }
    ] } }
  };
  assert.deepEqual(
    api.collectDirectSources(payload).map(item => item.type).sort(),
    ['application/dash+xml', 'application/vnd.apple.mpegurl']
  );
  assert.equal(
    api.providerFromPayload({ iframe_url: '<iframe src="https://embed.example/e/123"></iframe>' }),
    'https://embed.example/e/123'
  );
  assert.equal(
    api.providerFromPayload({
      url: 'https://api.example/request/123',
      poster: 'https://img.example/poster.jpg',
      data: { player_url: 'https://embed.example/e/final' }
    }),
    'https://embed.example/e/final'
  );
});

test('resolve API intermediária e encontra mídia no provedor final', async () => {
  api.setFetch(async target => {
    if (target.includes('/posts/get-video.php')) {
      return JSON.stringify({ data: { iframe_url: 'https://embed.example/watch/abc' } });
    }
    if (target === 'https://embed.example/watch/abc') {
      return '<script>window.player={file:"https://media.example/master.m3u8?token=1"}</script>';
    }
    return '<html></html>';
  });
  try {
    const result = await adapter.resolvePlayerMedia({
      iframe: serviceIframe,
      sources: [],
      referer: 'https://meusanimes.blog/e/exemplo/'
    });
    assert.equal(result.provider, 'https://embed.example/watch/abc');
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].type, 'application/vnd.apple.mpegurl');
    assert.equal(result.serviceIframe, serviceIframe);
  } finally {
    api.clearFetch();
    api.clearMemory();
  }
});

test('usa videoplayback já presente no HTML do Blogger sem batchexecute extra', async () => {
  const calls = [];
  const blogger = 'https://www.blogger.com/video.g?token=token-teste';
  const media = 'https://redirector.googlevideo.com/videoplayback?id=abc&itag=22';
  api.setFetch(async target => {
    calls.push(target);
    if (target.includes('/posts/get-video.php')) return JSON.stringify({success:true,videoUrl:blogger});
    if (target === blogger) return '<script>window.__media={url:"' + media.replace(/&/g,'\\u0026') + '"}</script>';
    if (target.includes('/batchexecute')) throw new Error('batchexecute não deveria ser chamado');
    return '<html></html>';
  });
  try {
    const result = await adapter.resolvePlayerMedia({iframe:serviceIframe,sources:[]});
    assert.equal(result.sources.length,1);
    assert.equal(result.sources[0].url,media);
    assert.equal(result.sources[0].height,720);
    assert.equal(calls.some(target => target.includes('/batchexecute')),false);
  } finally {
    api.clearFetch();
    api.clearMemory();
  }
});

test('preserva a SPA original quando a API não entrega outro provedor', async () => {
  api.setFetch(async target => target.includes('/posts/get-video.php') ? '{}' : '<html></html>');
  try {
    const result = await adapter.resolvePlayerMedia({ iframe: serviceIframe, sources: [] });
    assert.equal(result.iframe, serviceIframe);
    assert.equal(result.serviceIframe, serviceIframe);
    assert.deepEqual(result.sources, []);
  } finally {
    api.clearFetch();
    api.clearMemory();
  }
});

test('player não transforma falha da API intermediária em erro fatal', async () => {
  const episodeUrl = 'https://meusanimes.blog/e/episodio-de-teste/';
  api.setFetch(async target => {
    if (target === episodeUrl) {
      return '<div id="playex"><iframe src="' + serviceIframe + '"></iframe></div>' +
        '<div class="pag_episodes"></div><div id="info"></div>';
    }
    return target.includes('/posts/get-video.php') ? '{}' : '<html></html>';
  });
  try {
    const result = await adapter.player(episodeUrl, {
      resolveProvider: true,
      requireProvider: true,
      direct: false
    });
    assert.equal(result.erro, undefined);
    assert.equal(result.iframe, serviceIframe);
    assert.equal(result.providerPending, true);
  } finally {
    api.clearFetch();
    api.clearMemory();
  }
});

test('scripts inline do player continuam com sintaxe válida', () => {
  const filename = path.join(__dirname, '..', 'public', 'player-animes.html');
  const html = fs.readFileSync(filename, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new Function(match[1]), 'script inline ' + index);
  });
  assert.match(html, /dashjs@4\.7\.4/);
});
