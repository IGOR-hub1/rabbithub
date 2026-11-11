import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const adapter = require('../public/meusanimes.js');
async function inspect(path) {
  const response = await fetch(adapter.origin + path, {
    headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      Origin: 'http://localhost:8080'
    }
  });
  const html = await response.text();
  return {path,response,html};
}

const results = await Promise.all(['/','/a/','/g/dublado/'].map(inspect));
const home = adapter._test.parseHome(results[0].html);
const firstAnime = home.catalogo[0];
let playback = null;
if (firstAnime) {
  const animePath = '/' + firstAnime.slug.replace(/^\/+/, '') + '/';
  const animePage = await inspect(animePath);
  const details = adapter._test.parseDetails(animePage.html, firstAnime.slug, adapter.origin + animePath);
  const episode = details.episodios[0];
  if (episode && episode.link) {
    const episodeUrl = new URL(episode.link, adapter.origin).toString();
    const episodeResponse = await fetch(episodeUrl, {headers:{Origin:'http://localhost:8080'}});
    const episodeHtml = await episodeResponse.text();
    const metadata = adapter._test.parseEpisodePage(episodeHtml, episodeUrl);
    let iframeHeaders = null;
    let providerApi = null;
    if (metadata.iframe) {
      const response = await fetch(metadata.iframe, {redirect:'manual',headers:{Referer:episodeUrl}});
      iframeHeaders = {
        status:response.status,
        location:response.headers.get('location'),
        frame:response.headers.get('x-frame-options'),
        csp:response.headers.get('content-security-policy'),
        cors:response.headers.get('access-control-allow-origin')
      };
      const coordinates = adapter._test.serviceCoordinates(metadata.iframe);
      const servicePage = metadata.iframe.split('#')[0];
      const warmup = await fetch(servicePage, {headers:{Referer:adapter.origin + '/'}});
      await warmup.arrayBuffer();
      const cookies = typeof warmup.headers.getSetCookie === 'function'
        ? warmup.headers.getSetCookie().map(line => line.split(';')[0]).join('; ')
        : String(warmup.headers.get('set-cookie') || '').split(';')[0];
      const endpoint = new URL('/posts/get-video.php', servicePage);
      endpoint.searchParams.set('episode_number', coordinates.episode);
      endpoint.searchParams.set('season_number', coordinates.season);
      endpoint.searchParams.set('tmdb', coordinates.id);
      const apiHeaders = {
        Referer:servicePage, 'X-Requested-With':'XMLHttpRequest',
        Accept:'application/json,text/plain,*/*'
      };
      if (cookies) apiHeaders.Cookie = cookies;
      const getResponse = await fetch(endpoint, {headers:apiHeaders});
      const getBody = await getResponse.text();
      const postResponse = await fetch(endpoint, {
        method:'POST', headers:{...apiHeaders,'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:new URLSearchParams({episode_number:coordinates.episode,season_number:coordinates.season,tmdb:coordinates.id})
      });
      const postBody = await postResponse.text();
      providerApi = {
        cookies:!!cookies,
        get:{status:getResponse.status,bytes:Buffer.byteLength(getBody),provider:adapter._test.providerFromPayload(getBody)},
        post:{status:postResponse.status,bytes:Buffer.byteLength(postBody),provider:adapter._test.providerFromPayload(postBody)}
      };
    }
    playback = {
      anime:firstAnime.slug, episodes:details.episodios.length,
      episode:episode.link, iframe:metadata.iframe,
      coordinates:adapter._test.serviceCoordinates(metadata.iframe), iframeHeaders, providerApi
    };
  }
}
console.log(JSON.stringify({
  pages: results.map(({path,response,html}) => ({
    path, status:response.status, bytes:Buffer.byteLength(html),
    cors:response.headers.get('access-control-allow-origin'),
    cards:adapter._test.parseCards(html,{}).length
  })),
  home: {
    catalogo:home.catalogo.length, lancamentos:home.lancamentos.length,
    dublados:home.dublados.length, legendados:home.legendados.length
  },
  playback
}, null, 2));
