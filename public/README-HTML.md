# HTMLs — RabbitHub / Draksyon

Estes HTMLs foram adaptados para consumir a **API pública** hospedada
na LunesHost (pasta `api/` deste zip). Você pode hospedar estes
arquivos em qualquer servidor estático (Netlify, Vercel, GitHub Pages,
InfinityFree, um segundo servidor Node, Nginx, etc).

## Configurar o endereço da API

No topo de cada HTML há este bloco:

```html
<script>
  var DEFAULT = 'https://REPLACE-ME.lunes.host';
  ...
</script>
```

Troque `https://REPLACE-ME.lunes.host` pelo endereço público do seu
servidor LunesHost (algo como `https://node62.lunes.host:3224` ou
`https://seu-dominio.com`). Faça isso nos 3 arquivos:

- `index.html`
- `detalhes.html`
- `player-animes.html`

Ou, sem reeditar nada, abra o site uma vez e rode no console:

```js
localStorage.setItem('RABBITHUB_API_BASE', 'https://SEU-ENDERECO');
location.reload();
```

## Como funciona

O bootstrap injetado no `<head>` define:

- `window.API_BASE`  — URL raiz da API
- `window.API_PROXY(u)`  → `<API_BASE>/proxy?url=<encoded>`
- `window.API_STREAM(u)` → `<API_BASE>/stream?url=<encoded>`

Os helpers originais que apontavam para `/proxy?url=...` e
`/stream?url=...` na mesma origem foram trocados para chamar esses
wrappers. Nada mais no fluxo do site muda — busca, detalhes, player
HLS e imagens continuam funcionando exatamente como antes, só que
consultando a API na LunesHost.

## Fallbacks públicos

O array `PROXIES` original mantém os 3 fallbacks (`corsproxy.io`,
`allorigins`, `codetabs`) caso a LunesHost esteja fora. O primeiro
item da lista sempre bate na sua API.
