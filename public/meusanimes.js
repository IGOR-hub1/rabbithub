/* global DOMParser, fetch, localStorage, btoa, atob */
/* ============================================================================
 * RabbitHub Meus Animes adapter v4.1
 *
 * Fonte atual:
 *   catálogo  https://meusanimes.blog/a/
 *   gêneros   https://meusanimes.blog/g/<slug>/
 *   detalhes  https://meusanimes.blog/a/<slug>/
 *   episódio  https://meusanimes.blog/e/<slug>/
 *
 * A interface antiga usa window.AF. O alias é preservado para favoritos,
 * histórico e telas existentes continuarem funcionando durante a migração.
 * ========================================================================== */
(function (root, factory) {
    var api = factory(root || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && root.document) {
        root.MA = api;
        root.AF = api;
        root.MeusAnimesScraper = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    var ORIGIN = 'https://meusanimes.blog';
    var VERSION = '4.1.0';
    // v3 invalida cards que ainda guardavam miniaturas de baixa resolução.
    var CACHE_PREFIX = 'ma_cache_v3_';
    var CACHE_TTL = 1000 * 60 * 10;
    var INFLIGHT = Object.create(null);
    var injectedFetch = null;

    var CATEGORIES = [
        ['Ação', 'acao'], ['Animação', 'animacao'], ['Artes Marciais', 'artes-marciais'], ['Aventura', 'aventura'],
        ['Comédia', 'comedia'], ['Demônios', 'demonios'], ['Drama', 'drama'],
        ['Crime', 'crime'],
        ['Desenho', 'desenho'], ['Donghua', 'donghua'], ['Ecchi', 'ecchi'],
        ['Escolar', 'escolar'], ['Esporte', 'esporte'], ['Fantasia', 'fantasia'],
        ['Família', 'familia'],
        ['Ficção Científica', 'ficcao-cientifica'], ['Harém', 'harem'], ['Jogo', 'jogo'],
        ['Histórico', 'historico'], ['Josei', 'josei'], ['Magia', 'magia'], ['Mecha', 'mecha'], ['Militar', 'militar'],
        ['Mistério', 'misterio'], ['Musical', 'musical'], ['Paródia', 'parodia'],
        ['Psicológico', 'psicologico'], ['Romance', 'romance'], ['Samurai', 'samurai'], ['Seinen', 'seinen'],
        ['Shoujo', 'shoujo'], ['Shoujo-ai', 'shoujo-ai'], ['Shounen', 'shounen'],
        ['Slice of Life', 'slice-of-life'], ['Sobrenatural', 'sobrenatural'],
        ['Super Poderes', 'super-poderes'], ['Suspense', 'suspense'], ['Terror', 'terror'],
        ['Vampiros', 'vampiros']
    ].map(function (item) { return { nome: item[0], slug: item[1] }; });

    var GENRE_ALIASES = {
        'superpoder': 'super-poderes', 'super-poder': 'super-poderes',
        'vida-escolar': 'escolar', 'horror': 'terror', 'jogos': 'jogo',
        'esportes': 'esporte', 'musica': 'musical'
    };

    function decodeEntities(value) {
        value = String(value || '');
        if (root && root.document) {
            var area = root.document.createElement('textarea');
            area.innerHTML = value;
            return area.value;
        }
        return value
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
            .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); })
            .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(Number(n)); });
    }

    function clean(value) {
        return decodeEntities(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' '))
            .replace(/\s+/g, ' ').trim();
    }

    function absolute(value, base) {
        value = decodeEntities(String(value || '').trim()).replace(/\\\//g, '/');
        if (!value || /^(?:data|javascript|blob):/i.test(value)) return '';
        if (value.indexOf('//') === 0) return 'https:' + value;
        try { return new URL(value, base || ORIGIN + '/').toString(); }
        catch (_) { return value; }
    }

    /* O WordPress conserva o arquivo enviado e acrescenta -LARGURAxALTURA nas
       miniaturas geradas. A remoção é deliberadamente restrita a uploads
       WordPress e formatos raster para não alterar URLs externas que apenas
       tenham números parecidos no nome. Query string e hash são preservados. */
    function qualityImageUrl(value, base) {
        var raw = decodeEntities(String(value || '').trim()).replace(/\\\//g, '/');
        if (!raw || /^(?:data|javascript|blob):/i.test(raw)) return '';
        /* Capas antigas podem já estar apontando ao proxy local. Nesse caso a
           URL interna e sua estratégia de fallback não devem ser reescritas. */
        if (/^\/(?:proxy|stream)\?/i.test(raw)) return raw;
        var result = absolute(raw, base);
        if (!result) return '';
        try {
            var parsed = new URL(result);
            var pathname = parsed.pathname;
            if (!/\/wp-content\/uploads\//i.test(pathname) ||
                !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(pathname)) return result;
            parsed.pathname = pathname.replace(
                /-\d{2,5}x\d{2,5}(?=\.(?:avif|gif|jpe?g|png|webp)$)/i,
                ''
            );
            return parsed.toString();
        } catch (_) { return result; }
    }

    function attr(tag, name) {
        var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var match = String(tag || '').match(new RegExp('\\b' + escaped + '\\s*=\\s*(["\\\x27])([\\s\\S]*?)\\1', 'i'));
        return match ? decodeEntities(match[2]) : '';
    }

    function classList(tag) { return (' ' + attr(tag, 'class') + ' ').replace(/\s+/g, ' '); }
    function hasClass(tag, name) { return classList(tag).indexOf(' ' + name + ' ') !== -1; }

    function unique(values, keyFn) {
        var seen = Object.create(null), result = [];
        (values || []).forEach(function (value) {
            var key = String(keyFn ? keyFn(value) : value || '');
            if (!key || seen[key]) return;
            seen[key] = true;
            result.push(value);
        });
        return result;
    }

    function identifierFromUrl(value) {
        value = decodeEntities(String(value || '').trim());
        var match = value.match(/(?:^|\/)\b([ae])\/([^/?#]+)(?:[/?#]|$)/i);
        if (!match) return '';
        var slug = match[2].replace(/^\/+|\/+$/g, '');
        if (!slug || /^(?:page|feed|search|genero)$/i.test(slug)) return '';
        return match[1].toLowerCase() + '/' + slug;
    }

    function normalizeIdentifier(value, kind) {
        value = decodeEntities(String(value || '').trim());
        var fromUrl = identifierFromUrl(value);
        if (fromUrl) return fromUrl;
        value = value.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
        if (/^[ae]\//i.test(value)) return value.toLowerCase().charAt(0) + '/' + value.slice(2);
        if (value.indexOf('/') !== -1) value = value.split('/').filter(Boolean).pop() || '';
        return (kind === 'episode' ? 'e/' : 'a/') + value;
    }

    function pageUrl(path, page) {
        path = '/' + String(path || '').replace(/^\/+|\/+$/g, '') + '/';
        page = Number(page || 1);
        if (page > 1) path += 'page/' + page + '/';
        return ORIGIN + path;
    }

    function animeUrl(identifier) {
        var normalized = normalizeIdentifier(identifier, 'anime');
        if (normalized.indexOf('e/') === 0) return ORIGIN + '/' + normalized + '/';
        return ORIGIN + '/' + normalized.replace(/^a\//, 'a/') + '/';
    }

    function episodeUrl(identifier) {
        var normalized = normalizeIdentifier(identifier, 'episode');
        return ORIGIN + '/' + normalized.replace(/^e\//, 'e/') + '/';
    }

    function cacheGet(key) {
        try {
            if (!root.localStorage) return null;
            var saved = JSON.parse(root.localStorage.getItem(CACHE_PREFIX + key) || 'null');
            if (!saved || !saved.ts || Date.now() - saved.ts > (saved.ttl || CACHE_TTL)) return null;
            return saved.value;
        } catch (_) { return null; }
    }

    function cacheSet(key, value, ttl) {
        try {
            if (root.localStorage) root.localStorage.setItem(CACHE_PREFIX + key,
                JSON.stringify({ ts: Date.now(), ttl: ttl || CACHE_TTL, value: value }));
        } catch (_) { /* cache é somente otimização */ }
    }

    function isBlocked(text) {
        var sample = String(text || '').slice(0, 5000).toLowerCase();
        return !sample || sample.indexOf('sorry, you have been blocked') !== -1 ||
            sample.indexOf('attention required! | cloudflare') !== -1 ||
            sample.indexOf('checking your browser before') !== -1 ||
            sample.indexOf('cf-error-details') !== -1;
    }

    function proxyUrls(target, referer, noCache) {
        var local = '/proxy?url=' + encodeURIComponent(target);
        if (referer) local += '&referer=' + encodeURIComponent(referer);
        if (noCache) local += '&nocache=1';
        return [
            local,
            'https://corsproxy.io/?' + encodeURIComponent(target),
            'https://api.allorigins.win/raw?url=' + encodeURIComponent(target)
        ];
    }

    async function fetchTextUncached(target, options) {
        options = options || {};
        var fetchFn = root.fetch || (typeof fetch === 'function' && fetch);
        if (!fetchFn) throw new Error('Fetch não está disponível neste navegador.');
        var attempts = options.localOnly ? proxyUrls(target, options.referer, options.noCache).slice(0, 1) : proxyUrls(target, options.referer, options.noCache);
        var lastError;
        for (var i = 0; i < attempts.length; i++) {
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = controller ? setTimeout(function () { controller.abort(); }, options.timeout || (i === 0 ? 15000 : 8000)) : null;
            try {
                var response = await fetchFn(attempts[i], {
                    method: options.method || 'GET', body: options.body,
                    headers: options.headers || { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
                    signal: controller ? controller.signal : undefined,
                    credentials: 'same-origin'
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                var text = await response.text();
                if (isBlocked(text)) throw new Error('Resposta vazia ou bloqueada pela origem.');
                return text;
            } catch (error) {
                lastError = error;
            } finally {
                // O timeout cobre também o download do corpo. Detalhes com
                // centenas de episódios não podem ficar presos após headers.
                if (timer) clearTimeout(timer);
            }
        }
        throw lastError || new Error('Não foi possível consultar o Meus Animes.');
    }

    async function fetchText(target, options) {
        options = options || {};
        if (injectedFetch) return injectedFetch(target, options);
        var key = (options.method || 'GET') + '|' + target + '|' + (options.body || '') + '|' + (options.referer || '');
        if (INFLIGHT[key]) return INFLIGHT[key];
        INFLIGHT[key] = fetchTextUncached(target, options);
        try { return await INFLIGHT[key]; }
        finally { delete INFLIGHT[key]; }
    }

    function allArticles(html) {
        return String(html || '').match(/<article\b[^>]*>[\s\S]*?<\/article>/gi) || [];
    }

    function srcsetCandidates(value, base) {
        var candidates = [];
        String(value || '').split(',').forEach(function (part, index) {
            part = part.trim();
            if (!part) return;
            var match = part.match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?\s*$/i);
            if (!match) return;
            var url = qualityImageUrl(match[1], base);
            if (!url) return;
            var unit = String(match[3] || '').toLowerCase();
            candidates.push({
                url: url,
                rank: unit === 'w' ? 2 : (unit === 'x' ? 1 : 0),
                size: Number(match[2] || 1),
                index: index
            });
        });
        return candidates.sort(function (left, right) {
            return right.rank - left.rank || right.size - left.size || right.index - left.index;
        });
    }

    function imageCandidates(tag, base) {
        var result = [];
        ['data-srcset', 'data-lazy-srcset', 'srcset'].forEach(function (name) {
            srcsetCandidates(attr(tag, name), base).forEach(function (candidate) {
                result.push(candidate.url);
            });
        });
        ['data-src', 'data-lazy-src', 'data-original', 'src'].forEach(function (name) {
            var url = qualityImageUrl(attr(tag, name), base);
            if (url) result.push(url);
        });
        return unique(result);
    }

    function firstImage(block, base) {
        var images = String(block || '').match(/<img\b[^>]*>/gi) || [];
        for (var i = 0; i < images.length; i++) {
            var candidates = imageCandidates(images[i], base || ORIGIN + '/');
            for (var candidate = 0; candidate < candidates.length; candidate++) {
                if (!/logo|avatar|gravatar/i.test(candidates[candidate])) return candidates[candidate];
            }
        }
        return '';
    }

    function firstAnimeLink(block) {
        var links = String(block || '').match(/<a\b[^>]*>/gi) || [];
        for (var i = 0; i < links.length; i++) {
            var href = absolute(attr(links[i], 'href'));
            var id = identifierFromUrl(href);
            if (id && id.indexOf('a/') === 0) return { href: href, slug: id };
        }
        return null;
    }

    function audioFrom(value, fallback) {
        value = clean(value);
        if (/dublad/i.test(value)) return 'Dublado';
        if (/legendad/i.test(value)) return 'Legendado';
        return fallback || '';
    }

    function parseCard(block, defaults) {
        defaults = defaults || {};
        var open = (String(block).match(/^<article\b[^>]*>/i) || [])[0] || '';
        var link = firstAnimeLink(block);
        if (!link) return null;
        var heading = String(block).match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
        var image = String(block).match(/<img\b[^>]*>/i);
        var title = clean(heading ? heading[1] : '') || clean(image ? attr(image[0], 'alt') : '');
        if (!title || /^(?:logo|search|buscar|in[ií]cio)$/i.test(title)) return null;
        var rating = String(block).match(/class=(["\x27])[^"\x27]*\brating\b[^"\x27]*\1[^>]*>([\s\S]*?)<\//i);
        var date = String(block).match(/<div\b[^>]*class=(["\x27])[^"\x27]*\bdata\b[^"\x27]*\1[^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i);
        var rawScore = rating ? clean(rating[2]).replace(',', '.') : '';
        var scoreMatch = rawScore.match(/\d+(?:\.\d+)?/);
        var score = scoreMatch && Number(scoreMatch[0]) > 0 ? scoreMatch[0] : '';
        var year = String(block).match(/class=(["\x27])[^"\x27]*\byear\b[^"\x27]*\1[^>]*>([\s\S]*?)<\//i);
        var published = date ? clean(date[2]) : clean(year ? year[2] : '');
        var yearMatch = published.match(/\b(19|20)\d{2}\b/);
        var content = String(block).match(/<div\b[^>]*class=(["\x27])[^"\x27]*\bcontenido\b[^"\x27]*\1[^>]*>([\s\S]*?)<\/div>/i);
        var description = clean(content ? content[2] : '');
        var audio = audioFrom(title + ' ' + defaults.audio, defaults.audio || 'Legendado');
        var info = [audio, defaults.status || '', published].filter(Boolean).join(' • ');
        return {
            slug: link.slug, titulo: title, capa: firstImage(block), info: info,
            audio: audio, status: defaults.status || '', score: score,
            ano: yearMatch ? yearMatch[0] : '', publicadoEm: published,
            descricao: description,
            formato: /\b(?:filme|movie)\b/i.test(title + ' ' + description) ? 'Filme' : '',
            url: link.href, postId: (attr(open, 'id').match(/\d+/) || [])[0] || ''
        };
    }

    function parseCards(html, defaults) {
        var result = [];
        allArticles(html).forEach(function (block) {
            var open = (block.match(/^<article\b[^>]*>/i) || [])[0] || '';
            if (!hasClass(open, 'item') || !hasClass(open, 'tvshows')) return;
            var card = parseCard(block, defaults);
            if (card) result.push(card);
        });
        return unique(result, function (card) { return card.slug; });
    }

    function episodeTitleToAnime(value) {
        return clean(value)
            .replace(/\s+(?:\d+\s+)?epis[oó]dio\s+\d+(?:\.\d+)?(?:\s+online)?\s*$/i, '')
            .replace(/\s*[-–:]\s*$/, '').trim();
    }

    function episodeSlugToAnime(value) {
        value = String(value || '').replace(/^e\//, '');
        /* O Meus Animes inclui a temporada antes de "episodio" em URLs como
           rick-e-morty-1-episodio-1, mas a página pai é /a/rick-e-morty/. */
        return value.replace(/(?:-\d+)?-episodio-\d+(?:-\d+)?$/i, '');
    }

    function parseLatestEpisodeCards(html) {
        var result = [];
        allArticles(html).forEach(function (block) {
            var open = (block.match(/^<article\b[^>]*>/i) || [])[0] || '';
            if (!hasClass(open, 'episodes')) return;
            var links = block.match(/<a\b[^>]*>/gi) || [], episode = null;
            for (var i = 0; i < links.length; i++) {
                var href = absolute(attr(links[i], 'href'));
                var id = identifierFromUrl(href);
                if (id && id.indexOf('e/') === 0) { episode = { href: href, slug: id }; break; }
            }
            if (!episode) return;
            var image = (block.match(/<img\b[^>]*>/i) || [])[0] || '';
            var data = block.match(/<div\b[^>]*class=(["\x27])[^"\x27]*\bdata\b[^"\x27]*\1[^>]*>([\s\S]*?)<\/div>/i);
            var quality = block.match(/class=(["\x27])[^"\x27]*\bquality\b[^"\x27]*\1[^>]*>([\s\S]*?)<\//i);
            var rawTitle = clean(attr(image, 'alt')) || clean(data ? data[2] : '');
            var title = episodeTitleToAnime(rawTitle);
            var animeSlug = episodeSlugToAnime(episode.slug);
            if (!title || !animeSlug) return;
            var audio = audioFrom((quality ? quality[2] : '') + ' ' + title, 'Legendado');
            result.push({
                slug: 'a/' + animeSlug, titulo: title, capa: firstImage(block),
                info: audio + ' • Novo episódio', audio: audio, status: 'Novo episódio',
                /* `slug` mantém a chave visual/deduplicação; a navegação usa
                   o episódio real porque certos arcos têm um slug diferente
                   da página pai. `detalhes(e/...)` descobre o /a/ canônico. */
                detailsIdentifier: episode.slug,
                episodeLink: episode.href, url: episode.href,
                animeUrlGuess: ORIGIN + '/a/' + animeSlug + '/'
            });
        });
        return unique(result, function (card) { return card.slug; });
    }

    function mergeCards(groups) {
        var output = [], bySlug = Object.create(null);
        (groups || []).forEach(function (group) {
            (group || []).forEach(function (card) {
                if (!card || !card.slug) return;
                var old = bySlug[card.slug];
                if (!old) {
                    old = Object.assign({}, card);
                    bySlug[card.slug] = old;
                    output.push(old);
                } else {
                    Object.keys(card).forEach(function (key) {
                        if (!old[key] && card[key]) old[key] = card[key];
                    });
                    if (card.status === 'Novo episódio') old.status = card.status;
                    if (card.audio) old.audio = card.audio;
                    old.info = [old.audio, old.status, old.publicadoEm].filter(Boolean).join(' • ');
                }
            });
        });
        return output;
    }

    function sliceBetween(html, startExpression, endExpression) {
        var source = String(html || '');
        var start = source.search(startExpression);
        if (start < 0) return '';
        var rest = source.slice(start);
        var end = rest.slice(1).search(endExpression);
        return end < 0 ? rest : rest.slice(0, end + 1);
    }

    function parseHome(html) {
        var newSection = sliceBetween(html, /id=(["\x27])dt-tvshows\1/i, /<h2[^>]*>\s*[ÚU]ltimos Epis[oó]dios/i);
        var episodeSection = sliceBetween(html, /class=(["\x27])[^"\x27]*\banimation-2\b[^"\x27]*\1/i, /<h2[^>]*>\s*Em Lan[cç]amento/i);
        var releaseSection = sliceBetween(html, /id=(["\x27])genre_em-lancamento\1/i, /class=(["\x27])[^"\x27]*\bsidebar\b/i);
        var recent = parseCards(newSection || html, { status: 'Novo no catálogo' });
        var releases = parseCards(releaseSection, { status: 'Em lançamento' });
        var episodeCards = parseLatestEpisodeCards(episodeSection);
        var catalog = mergeCards([recent, releases, episodeCards]);
        var dubbed = catalog.filter(function (card) { return /dublad/i.test(card.audio || card.titulo); });
        var subtitled = catalog.filter(function (card) { return /legendad/i.test(card.audio || '') && !/dublad/i.test(card.audio || ''); });
        return {
            catalogo: catalog,
            lancamentos: releases.length ? releases : episodeCards,
            dublados: dubbed,
            legendados: subtitled,
            ultimosEpisodios: episodeCards
        };
    }

    async function cachedListing(key, url, defaults) {
        var saved = cacheGet(key);
        if (saved) return saved;
        var cards = parseCards(await fetchText(url, { referer: ORIGIN + '/' }), defaults);
        if (!cards.length) throw new Error('Nenhum anime foi encontrado nessa seção.');
        cacheSet(key, cards);
        return cards;
    }

    async function home() {
        var saved = cacheGet('home');
        if (saved) return saved;
        var result = parseHome(await fetchText(ORIGIN + '/', { referer: ORIGIN + '/' }));
        if (!result.catalogo.length) throw new Error('A página inicial não retornou animes.');
        cacheSet('home', result, 1000 * 60 * 5);
        return result;
    }

    function catalogo(page) {
        page = Number(page || 1);
        return cachedListing('catalog:' + page, pageUrl('a', page), {});
    }

    function lancamentos(page) {
        page = Number(page || 1);
        return cachedListing('launch:' + page, pageUrl('g/em-lancamento', page), { status: 'Em lançamento' });
    }

    function dublados(page) {
        page = Number(page || 1);
        return cachedListing('dub:' + page, pageUrl('g/dublado', page), { audio: 'Dublado' });
    }

    function legendados(page) {
        page = Number(page || 1);
        return cachedListing('sub:' + page, pageUrl('g/legendado', page), { audio: 'Legendado' });
    }

    function genero(slug, page) {
        slug = String(slug || '').toLowerCase().trim();
        slug = GENRE_ALIASES[slug] || slug;
        page = Number(page || 1);
        return cachedListing('genre:' + slug + ':' + page, pageUrl('g/' + encodeURIComponent(slug), page), {});
    }

    function metaContent(html, property) {
        var tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
        for (var i = 0; i < tags.length; i++) {
            if (attr(tags[i], 'property') === property || attr(tags[i], 'name') === property) return attr(tags[i], 'content');
        }
        return '';
    }

    function parseEpisodes(html, animeAudio) {
        var source = String(html || '');
        var seasonStarts = [], re = /<div\b[^>]*class=(["\x27])[^"\x27]*\bse-c\b[^"\x27]*\1[^>]*>/gi, match;
        while ((match = re.exec(source))) seasonStarts.push(match.index);
        if (!seasonStarts.length) seasonStarts.push(source.search(/<ul\b[^>]*class=(["\x27])[^"\x27]*\bepisodios\b/i));
        seasonStarts = seasonStarts.filter(function (position) { return position >= 0; });
        var stop = source.search(/class=(["\x27])[^"\x27]*\bsrelacionados\b/i);
        var episodes = [];
        seasonStarts.forEach(function (start, index) {
            var end = seasonStarts[index + 1] || (stop > start ? stop : source.length);
            var block = source.slice(start, end);
            var seasonMatch = block.match(/class=(["\x27])[^"\x27]*\bse-t\b[^"\x27]*\1[^>]*>([\s\S]*?)<\/span>/i);
            var seasonText = clean(seasonMatch ? seasonMatch[2] : '');
            var seasonNumber = seasonText.match(/\d+/);
            var season = seasonNumber ? Number(seasonNumber[0]) :
                (/\b(?:especial|special|ova|ona)\b/i.test(seasonText) ? 0 : index + 1);
            var items = block.match(/<li\b[^>]*class=(["\x27])[^"\x27]*\bmark-[^"\x27]*\1[^>]*>[\s\S]*?<\/li>/gi) || [];
            items.forEach(function (item, itemIndex) {
                var anchorTags = item.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [], anchor = null;
                for (var a = 0; a < anchorTags.length; a++) {
                    var open = (anchorTags[a].match(/^<a\b[^>]*>/i) || [])[0] || '';
                    var href = absolute(attr(open, 'href'));
                    var id = identifierFromUrl(href);
                    if (id && id.indexOf('e/') === 0) { anchor = { href: href, html: anchorTags[a] }; break; }
                }
                if (!anchor) return;
                var numbering = item.match(/class=(["\x27])[^"\x27]*\bnumerando\b[^"\x27]*\1[^>]*>([\s\S]*?)<\//i);
                var pair = clean(numbering ? numbering[2] : '').match(/(\d+)\s*-\s*(\d+(?:\.\d+)?)/);
                var number = pair ? Number(pair[2]) : itemIndex + 1;
                var date = item.match(/class=(["\x27])[^"\x27]*\bdate\b[^"\x27]*\1[^>]*>([\s\S]*?)<\//i);
                episodes.push({
                    numero: number,
                    temporada: pair ? Number(pair[1]) : season,
                    nome: clean(anchor.html) || 'Episódio ' + number,
                    link: anchor.href,
                    descricao: clean(date ? date[2] : ''),
                    capa: firstImage(item),
                    audio: animeAudio || audioFrom(anchor.href, '')
                });
            });
        });
        return unique(episodes, function (episode) { return episode.link; });
    }

    function cleanSynopsis(value, title) {
        var synopsis = clean(value);
        if (!synopsis) return '';
        synopsis = synopsis.replace(/^Assistir\s+[\s\S]{0,220}?Todos\s+(?:os\s+)?Epis[oó]dios\s*[,.:;-]?\s*/i, '');
        if (title) {
            /* Alguns H1 têm vírgulas que não existem na sinopse (e vice-versa).
               Comparamos as palavras e aceitamos somente pontuação entre elas. */
            var variants = [title, title.replace(/\b(?:Dublado|Legendado)\b/gi, ' ')];
            for (var i = 0; i < variants.length; i++) {
                var words = clean(variants[i]).replace(/\s+Online$/i, '').split(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ]+/).filter(Boolean);
                if (!words.length) continue;
                var loose = words.map(function (word) {
                    return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                }).join('[^0-9A-Za-zÀ-ÖØ-öø-ÿ]*');
                var before = synopsis;
                synopsis = synopsis.replace(new RegExp(
                    '^Assistir\\s+' + loose + '(?:\\s+(?:Dublado|Legendado))?(?:\\s+Online(?:\\s+Gr[aá]tis)?)?\\s*[,.:;-]?\\s*', 'i'
                ), '');
                if (synopsis !== before) break;
            }
        }
        /* Remove chamadas SEO adicionais, sem tocar no primeiro período
           narrativo real. A fonte alterna "Online Grátis" e "Filme Completo". */
        for (var promo = 0; promo < 3; promo++) {
            var cleaned = synopsis.replace(
                /^Assistir\s+[\s\S]{1,220}?\b(?:Todos\s+(?:os\s+)?Epis[oó]dios|Online(?:\s+Gr[aá]tis)?|Filme\s+Completo)\b\s*[,.:;!?-]*\s*/i,
                ''
            );
            if (cleaned === synopsis) break;
            synopsis = cleaned;
        }
        synopsis = synopsis.replace(/^Sinopse\s*:\s*/i, '');
        return synopsis.trim();
    }

    function parseDetails(html, identifier, page) {
        html = String(html || '');
        var header = sliceBetween(html, /class=(["\x27])[^"\x27]*\bsheader\b[^"\x27]*\1/i, /class=(["\x27])[^"\x27]*\bsingle_tabs\b/i);
        var h1 = header.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
        var title = clean(h1 ? h1[1] : metaContent(html, 'og:title'))
            .replace(/^Assistir\s+/i, '').replace(/\s+Online(?:\s*-\s*Meus Animes)?$/i, '').replace(/\s+Todos Epis[oó]dios.*$/i, '').trim();
        var canonical = metaContent(html, 'og:url') || page || animeUrl(identifier);
        var slug = identifierFromUrl(canonical) || normalizeIdentifier(identifier, 'anime');
        var poster = firstImage(header, page) || qualityImageUrl(metaContent(html, 'og:image'), page);
        var backdrop = qualityImageUrl(metaContent(html, 'og:image'), page) || poster;
        var date = header.match(/class=(["\x27])[^"\x27]*\bdate\b[^"\x27]*\1[^>]*>([\s\S]*?)<\//i);
        var published = clean(date ? date[2] : '');
        var year = (published.match(/\b(?:19|20)\d{2}\b/) || [])[0] || '';
        var rating = header.match(/itemprop=(["\x27])ratingValue\1[^>]*>([\s\S]*?)<\//i);
        var score = clean(rating ? rating[2] : '');
        if (!score || Number(score) === 0) score = '';
        var genresBlock = html.match(/<div\b[^>]*class=(["\x27])[^"\x27]*\bsgeneros\b[^"\x27]*\1[^>]*>([\s\S]*?)<\/div>/i);
        var rawGenres = [], linkRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi, genreMatch;
        while (genresBlock && (genreMatch = linkRe.exec(genresBlock[2]))) rawGenres.push(clean(genreMatch[1]));
        rawGenres = unique(rawGenres.filter(Boolean));
        var audio = audioFrom(rawGenres.join(' ') + ' ' + title, '');
        var status = rawGenres.some(function (genre) { return /em lan[cç]amento/i.test(genre); }) ? 'Em lançamento' : '';
        var genres = rawGenres.filter(function (genre) {
            return !/^(?:dublado|legendado|em lan[cç]amento|letra\s+[a-z]|animes?)$/i.test(genre);
        });
        var synopsisArea = sliceBetween(html, /class=(["\x27])[^"\x27]*\bsingle_tabs\b[^"\x27]*\1/i, /id=(["\x27])episodes\1/i);
        var paragraphs = synopsisArea.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
        var synopsis = cleanSynopsis(paragraphs.map(clean).join(' '), title);
        /* Em páginas com vários títulos alternativos, o meta description
           indica explicitamente onde a sinopse narrativa começa. */
        var descriptionMeta = clean(metaContent(html, 'description'));
        var synopsisHint = descriptionMeta.match(/\bSinopse\s*:\s*([\s\S]{12,100}?)(?:\.{3}|$)/i);
        if (synopsisHint) {
            var hint = clean(synopsisHint[1]).slice(0, 48).toLowerCase();
            var hintIndex = synopsis.toLowerCase().indexOf(hint);
            if (hintIndex > 0) synopsis = synopsis.slice(hintIndex);
        }
        var episodes = parseEpisodes(html, audio);
        var seasons = unique(episodes.map(function (episode) { return episode.temporada; })).length;
        return {
            slug: slug, titulo: title, tituloOriginal: '', capa: poster, backdrop: backdrop,
            sinopse: synopsis, generos: genres, episodios: episodes, score: score,
            status: status, audio: audio, ano: year, publicadoEm: published,
            temporadas: seasons || '', classificacao: '',
            formato: /\b(?:filme|movie)\b/i.test(title + ' ' + synopsis.slice(0, 100)) ? 'Filme' : '',
            duracao: '', trailer: '', proximoEpisodio: '', url: canonical
        };
    }

    function parseEpisodePage(html, page) {
        html = String(html || '');
        var playerArea = sliceBetween(html, /id=(["\x27])playex\1/i, /class=(["\x27])[^"\x27]*\bpag_episodes\b/i) || html;
        var navigationArea = sliceBetween(
            html,
            /class=(["\x27])[^"\x27]*\bpag_episodes\b[^"\x27]*\1/i,
            /id=(["\x27])info\1/i
        );
        var iframeTag = (playerArea.match(/<iframe\b[^>]*>/i) || [])[0] || '';
        var iframe = absolute(attr(iframeTag, 'src'), page);
        var parent = '', previousEpisode = null, nextEpisode = null;
        var navRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi, navMatch, navIndex = 0;
        while ((navMatch = navRe.exec(navigationArea))) {
            var navTag = navMatch[0];
            var rawHref = attr(navTag, 'href');
            var navClass = attr(navTag, 'class');
            if (!rawHref || rawHref === '#' || /\bnonex\b/i.test(navClass)) { navIndex++; continue; }
            var navHref = absolute(rawHref, page);
            var navId = identifierFromUrl(navHref);
            var navText = clean(navMatch[1]);
            if (navId.indexOf('a/') === 0) {
                parent = navId;
            } else if (navId.indexOf('e/') === 0) {
                var navEpisode = {
                    slug: navId,
                    link: navHref,
                    nome: clean(attr(navTag, 'title')) || navText || 'Episódio'
                };
                if (/anterior/i.test(navText) || navIndex === 0) previousEpisode = navEpisode;
                if (/pr[oó]ximo/i.test(navText) || navIndex >= 2) nextEpisode = navEpisode;
            }
            navIndex++;
        }
        var links = html.match(/<a\b[^>]*>/gi) || [];
        for (var i = 0; i < links.length; i++) {
            var href = absolute(attr(links[i], 'href'), page);
            var id = identifierFromUrl(href);
            if (!parent && id && id.indexOf('a/') === 0) { parent = id; break; }
        }
        var h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
        var quality = playerArea.match(/<span\b[^>]*class=(["\x27])[^"\x27]*\bqualidade\b[^"\x27]*\1[^>]*>([\s\S]*?)<\/span>/i);
        var sources = [], mediaRe = /https?:\\?\/\\?\/[^\s"\x27<>]+(?:videoplayback\?|\.(?:mp4|m3u8|webm)(?:[?#]|$))[^\s"\x27<>]*/gi, media;
        while ((media = mediaRe.exec(playerArea))) {
            var mediaUrl = decodeEntities(media[0]).replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
            sources.push({
                url: mediaUrl,
                label: 'HD',
                type: /\.m3u8(?:[?#]|$)/i.test(mediaUrl) ? 'application/vnd.apple.mpegurl' : 'video/mp4',
                height: 0
            });
        }
        return {
            title: clean(h1 ? h1[1] : ''), animeSlug: parent, iframe: iframe,
            sources: unique(sources, function (source) { return source.url; }),
            audio: audioFrom(quality ? quality[2] : '', ''), referer: page,
            previousEpisode: previousEpisode, nextEpisode: nextEpisode
        };
    }

    function balancedJsonAfter(text, marker) {
        text = String(text || '');
        marker.lastIndex = 0;
        var found = marker.exec(text);
        if (!found) return '';
        var start = text.indexOf('{', found.index + found[0].length);
        if (start < 0) return '';
        var depth = 0, quote = '', escaped = false;
        for (var i = start; i < text.length; i++) {
            var character = text.charAt(i);
            if (quote) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === quote) quote = '';
                continue;
            }
            if (character === '"' || character === "'") { quote = character; continue; }
            if (character === '{') depth++;
            else if (character === '}' && --depth === 0) return text.slice(start, i + 1);
        }
        return '';
    }

    var ITAG_HEIGHTS = { 7: 240, 18: 360, 22: 720, 37: 1080 };
    function directSource(url, fallbackItag) {
        url = decodeEntities(String(url || '')).replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=')
            .replace(/\\\//g, '/').trim();
        if (!/^https?:\/\//i.test(url) || !(/googlevideo\.com\/videoplayback/i.test(url) ||
            /\/videoplayback\?/i.test(url) || /\.(?:mp4|m3u8|webm)(?:[?#]|$)/i.test(url))) return null;
        var itag = Number(fallbackItag || 0);
        try { itag = Number(new URL(url).searchParams.get('itag')) || itag; } catch (_) {}
        var height = ITAG_HEIGHTS[itag] || 0;
        return {
            url: url,
            label: height ? height + 'p' : 'Auto',
            type: /\.m3u8(?:[?#]|$)/i.test(url) ? 'application/vnd.apple.mpegurl' :
                /\.webm(?:[?#]|$)/i.test(url) ? 'video/webm' : 'video/mp4',
            height: height,
            itag: itag || ''
        };
    }

    function collectDirectSources(value, output, depth, contextItag) {
        output = output || [];
        depth = depth || 0;
        if (depth > 12 || value === null || value === undefined) return output;
        if (typeof value === 'string') {
            var source = directSource(value, contextItag);
            if (source) output.push(source);
            var trimmed = value.trim();
            if (/^[\[{]/.test(trimmed)) {
                try { collectDirectSources(JSON.parse(trimmed), output, depth + 1, contextItag); } catch (_) {}
            }
            var decoded = trimmed.replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\\//g, '/');
            var matches = decoded.match(/https?:\/\/[^\s"\x27<>\\]+(?:googlevideo\.com\/videoplayback|\/videoplayback\?|\.(?:mp4|m3u8|webm)(?:[?#]|$))[^\s"\x27<>\\]*/gi) || [];
            matches.forEach(function (url) {
                var item = directSource(url, contextItag);
                if (item) output.push(item);
            });
            return output;
        }
        if (typeof value !== 'object') return output;
        var itag = contextItag;
        if (!Array.isArray(value)) itag = value.itag || value.format_id || value.formatId || contextItag;
        if (Array.isArray(value) && typeof value[1] === 'number' && ITAG_HEIGHTS[value[1]]) itag = value[1];
        Object.keys(value).forEach(function (key) { collectDirectSources(value[key], output, depth + 1, itag); });
        return output;
    }

    function normalizeSources(values) {
        return unique((values || []).filter(Boolean), function (source) { return source.url; })
            .sort(function (left, right) { return Number(right.height || 0) - Number(left.height || 0); });
    }

    function parseLegacyBlogger(html) {
        var json = balancedJsonAfter(html, /(?:var\s+)?VIDEO_CONFIG\s*=/i);
        if (!json) return [];
        try { return normalizeSources(collectDirectSources(JSON.parse(json))); }
        catch (_) { return normalizeSources(collectDirectSources(json)); }
    }

    function findBloggerRpcPayload(value) {
        var found = null;
        function visit(node, depth) {
            if (found || depth > 15 || node === null || node === undefined) return;
            if (Array.isArray(node)) {
                if (node[0] === 'wrb.fr' && node[1] === 'WcwnYd' && typeof node[2] === 'string') {
                    try { found = JSON.parse(node[2]); } catch (_) {}
                    return;
                }
                node.forEach(function (child) { visit(child, depth + 1); });
            }
        }
        visit(value, 0);
        return found;
    }

    function parseBloggerRpc(text) {
        var lines = String(text || '').split(/\r?\n/), payload = null;
        for (var i = 0; i < lines.length && !payload; i++) {
            var line = lines[i].trim();
            if (line.charAt(0) !== '[') continue;
            try { payload = findBloggerRpcPayload(JSON.parse(line)); } catch (_) {}
        }
        if (!payload) {
            var start = String(text || '').indexOf('[[');
            if (start >= 0) {
                try { payload = findBloggerRpcPayload(JSON.parse(String(text).slice(start))); } catch (_) {}
            }
        }
        if (!payload || !Array.isArray(payload[2])) return [];
        return normalizeSources(payload[2].map(function (stream) {
            return directSource(Array.isArray(stream) ? stream[0] : '', Array.isArray(stream) ? stream[1] : 0);
        }));
    }

    async function resolveBloggerSources(videoUrl) {
        var html = await fetchText(videoUrl, {
            referer: videoUrl, noCache: true, localOnly: true, timeout: 12000
        });
        var legacy = parseLegacyBlogger(html);
        if (legacy.length) return legacy;
        var wizText = balancedJsonAfter(html, /window\.WIZ_global_data\s*=/i);
        if (!wizText) return [];
        var wiz;
        try { wiz = JSON.parse(wizText); } catch (_) { return []; }
        var token = '';
        try { token = new URL(videoUrl).searchParams.get('token') || ''; } catch (_) {}
        if (!token || !wiz.FdrFJe || !wiz.cfb2h) return [];
        var inner = JSON.stringify([token, null, 0]);
        var request = JSON.stringify([[['WcwnYd', inner, null, 'generic']]]);
        var endpoint = 'https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute' +
            '?bl=' + encodeURIComponent(wiz.cfb2h) + '&f.sid=' + encodeURIComponent(wiz.FdrFJe) + '&rpcids=WcwnYd';
        var response = await fetchText(endpoint, {
            method: 'POST', body: 'f.req=' + encodeURIComponent(request), noCache: true, localOnly: true,
            referer: videoUrl, timeout: 12000,
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'X-Same-Domain': '1'
            }
        });
        return parseBloggerRpc(response);
    }

    function serviceCoordinates(iframe) {
        var match = String(iframe || '').match(/#\/video\/([^/]+)\/(\d+)\/(\d+)\/?/i);
        return match ? { id: match[1], season: match[2], episode: match[3] } : null;
    }

    async function resolveServiceProvider(iframe) {
        var coordinates = serviceCoordinates(iframe);
        if (!coordinates) return '';
        var endpoint;
        try {
            endpoint = new URL('/posts/get-video.php', iframe).toString() +
                '?episode_number=' + encodeURIComponent(coordinates.episode) +
                '&season_number=' + encodeURIComponent(coordinates.season) +
                '&tmdb=' + encodeURIComponent(coordinates.id);
        } catch (_) { return ''; }
        var response = await fetchText(endpoint, {
            referer: String(iframe).split('#')[0] || iframe,
            noCache: true,
            localOnly: true,
            timeout: 6000
        });
        var json;
        try { json = JSON.parse(response); } catch (_) { return ''; }
        var provider = json.videoUrl || json.video_url || json.url ||
            (json.data && (json.data.videoUrl || json.data.video_url || json.data.url)) || '';
        return absolute(provider, iframe);
    }

    async function resolvePlayerSources(data) {
        data = data || {};
        if (data.sources && data.sources.length) return normalizeSources(data.sources);
        var provider = data.provider || data.iframe || '';
        if (/blogger\.com\/video\.g/i.test(provider)) {
            try { return await resolveBloggerSources(provider); } catch (_) { return []; }
        }
        var direct = directSource(provider, 0);
        return direct ? [direct] : [];
    }

    async function detalhes(identifier) {
        var normalized = normalizeIdentifier(identifier, 'anime');
        if (normalized.indexOf('e/') === 0) {
            var episodePage = episodeUrl(normalized);
            var episodeHtml = await fetchText(episodePage, { referer: ORIGIN + '/' });
            var parent = parseEpisodePage(episodeHtml, episodePage).animeSlug;
            if (!parent) throw new Error('Não foi possível localizar o anime deste episódio.');
            normalized = parent;
        }
        var key = 'details:' + normalized;
        var saved = cacheGet(key);
        if (saved) return saved;
        var url = animeUrl(normalized);
        var data = parseDetails(await fetchText(url, { referer: ORIGIN + '/' }), normalized, url);
        if (!data.titulo && !data.episodios.length) throw new Error('O Meus Animes não retornou os detalhes deste anime.');
        cacheSet(key, data, 1000 * 60 * 20);
        return data;
    }

    async function player(link, options) {
        options = options || {};
        if (link && typeof link === 'object') {
            if (link.sources || link.iframe) return link;
            link = link.link || link.url || '';
        }
        link = String(link || '');
        if (/^ma:v1:/.test(link)) {
            try { link = JSON.parse(base64Decode(link.slice(6))).episodeUrl || ''; }
            catch (_) { link = ''; }
        }
        if (!link) return { erro: 'Episódio inválido.' };
        var url = /^https?:\/\//i.test(link) ? link : episodeUrl(link);
        try {
            var data = parseEpisodePage(await fetchText(url, { referer: ORIGIN + '/', timeout: 12000 }), url);
            /* O iframe do episódio é o caminho mais rápido e já resolve o
               provedor dinamicamente. Só aguardamos a API intermediária
               quando a tela solicitar uma fonte/provedor direto. */
            if ((options.resolveProvider || options.direct) && data.iframe && serviceCoordinates(data.iframe)) {
                try {
                    var provider = await resolveServiceProvider(data.iframe);
                    if (provider) {
                        data.serviceIframe = data.iframe;
                        data.provider = provider;
                        data.iframe = provider;
                        data.referer = provider;
                    }
                } catch (_) { /* a SPA original continua sendo o fallback */ }
            }
            if (options.requireProvider && data.iframe && serviceCoordinates(data.iframe) && !data.provider) {
                return { erro: 'O provedor intermediário não liberou o player final. Tente novamente em instantes.' };
            }
            if (options.direct && data.iframe && !data.sources.length) {
                data.sources = await resolvePlayerSources(data);
            }
            if (data.sources.length || data.iframe) return data;
            return { erro: 'O Meus Animes não publicou um player para este episódio.' };
        } catch (error) {
            return { erro: 'Não foi possível abrir este episódio agora: ' + (error && error.message || 'falha de conexão') };
        }
    }

    function normalizeSearch(value) {
        return clean(value).normalize ? clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : clean(value).toLowerCase();
    }

    async function pesquisar(query, options) {
        query = clean(query);
        if (!query) return [];
        options = options || {};
        var page = Number(options.page || 1);
        var path = page > 1 ? '/page/' + page + '/' : '/';
        var url = ORIGIN + path + '?s=' + encodeURIComponent(query);
        var key = 'search:raw2:' + normalizeSearch(query) + ':' + page;
        var cards = cacheGet(key);
        if (!cards) {
            var html = await fetchText(url, { referer: ORIGIN + '/' });
            cards = parseCards(html, {});
            if (!cards.length) {
                cards = allArticles(html).map(function (block) { return parseCard(block, {}); }).filter(Boolean);
            }
            cards = unique(cards, function (card) { return card.slug; });
            cacheSet(key, cards, 1000 * 60 * 5);
        }
        if (options.filterTitle === false) return cards.slice();
        var words = normalizeSearch(query).split(/\s+/).filter(Boolean);
        return cards.filter(function (card) {
            var title = normalizeSearch(card.titulo);
            return words.every(function (word) { return title.indexOf(word) !== -1; });
        });
    }

    async function filmes(page, audio) {
        page = Number(page || 1);
        /* A fonte não publica uma taxonomia exclusiva para filmes e usa tanto
           "Filme" quanto "Movie" nos títulos. Consultamos os dois termos e
           unimos os resultados para não perder obras em inglês. */
        var searches = await Promise.all([
            pesquisar('filme', { page: page, filterTitle: false }).then(function (value) {
                return { ok: true, value: value };
            }, function (error) { return { ok: false, error: error }; }),
            pesquisar('movie', { page: page, filterTitle: false }).then(function (value) {
                return { ok: true, value: value };
            }, function (error) { return { ok: false, error: error }; })
        ]);
        var successful = searches.filter(function (result) { return result.ok; });
        if (!successful.length) throw searches[0].error || searches[1].error || new Error('Pesquisa de filmes indisponível.');
        var cards = mergeCards(successful.map(function (result) { return result.value; }));
        var wanted = String(audio || '');
        return cards.filter(function (card) {
            var isDub = /dublad/i.test(card.audio + ' ' + card.titulo);
            var isMovie = card.formato === 'Filme' || /\b(?:filme|movie)\b/i.test(card.titulo + ' ' + card.descricao);
            return isMovie && (wanted === 'Dublado' ? isDub : !isDub);
        });
    }

    function base64Encode(value) {
        var json = JSON.stringify(value);
        if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64url');
        return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function base64Decode(value) {
        value = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
        while (value.length % 4) value += '=';
        if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf8');
        return decodeURIComponent(escape(atob(value)));
    }

    function encodeEpisode(value) { return 'ma:v1:' + base64Encode(value); }
    function streamUrl(url, referer) {
        if (!url || /^\/(?:stream|proxy)\?/.test(url)) return url;
        var result = '/stream?url=' + encodeURIComponent(url);
        if (referer) result += '&referer=' + encodeURIComponent(referer);
        return result;
    }

    var api = {
        version: VERSION,
        source: 'Meus Animes',
        origin: ORIGIN,
        home: home,
        catalogo: catalogo,
        lancamentos: lancamentos,
        dublados: dublados,
        legendados: legendados,
        filmesLegendados: function (page) { return filmes(page, 'Legendado'); },
        filmesDublados: function (page) { return filmes(page, 'Dublado'); },
        genero: genero,
        categorias: function () { return Promise.resolve(CATEGORIES.slice()); },
        detalhes: detalhes,
        player: player,
        resolvePlayerSources: resolvePlayerSources,
        pesquisar: pesquisar,
        streamUrl: streamUrl,
        qualityImageUrl: qualityImageUrl,
        _test: {
            clean: clean, cleanSynopsis: cleanSynopsis, attr: attr, absolute: absolute,
            qualityImageUrl: qualityImageUrl, srcsetCandidates: srcsetCandidates,
            imageCandidates: imageCandidates, firstImage: firstImage,
            identifierFromUrl: identifierFromUrl, normalizeIdentifier: normalizeIdentifier,
            animeUrl: animeUrl, episodeUrl: episodeUrl,
            parseCards: parseCards, parseLatestEpisodeCards: parseLatestEpisodeCards,
            episodeSlugToAnime: episodeSlugToAnime,
            parseHome: parseHome, parseEpisodes: parseEpisodes,
            parseDetails: parseDetails, parseEpisodePage: parseEpisodePage,
            balancedJsonAfter: balancedJsonAfter, parseLegacyBlogger: parseLegacyBlogger,
            parseBloggerRpc: parseBloggerRpc, serviceCoordinates: serviceCoordinates,
            resolveServiceProvider: resolveServiceProvider,
            encodeEpisode: encodeEpisode,
            decodeEpisode: function (link) { return JSON.parse(base64Decode(String(link).replace(/^ma:v1:/, ''))); },
            fetchTextUncached: fetchTextUncached,
            setFetch: function (fn) { injectedFetch = fn; },
            clearFetch: function () { injectedFetch = null; },
            clearMemory: function () { INFLIGHT = Object.create(null); }
        }
    };

    if (root && root.document) root.__DRAKSYON_STREAM__ = streamUrl;
    return api;
});
