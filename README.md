# Draksyon — versão com servidor local

Esta versão corrige o erro **`Net::ERR_BLOCKED_BY_RESPONSE`** que acontecia
quando o player tentava carregar vídeos de servidores externos com cabeçalho
`Cross-Origin-Resource-Policy: same-origin`.

A solução: você roda um **servidor Node.js leve** que faz o papel de proxy.
O HTML do site é servido pelo próprio servidor, então tudo passa a estar
**na mesma origem** — sem CORS, sem CORP, sem Cloudflare bloqueando.

---

## ▶ Rodando no Termux (Android)

```bash
pkg update && pkg install nodejs -y
cd draksyon
node server.js
```

Depois abra no navegador do celular:

```
http://localhost:8080
```

> Para acessar de outro aparelho na mesma rede Wi‑Fi, use o IP do celular
> (ex.: `http://192.168.0.10:8080`). O servidor já escuta em `0.0.0.0`.

---

## ▶ Rodando no PC (Windows / Linux / macOS)

1. Instale Node.js 18+ em https://nodejs.org
2. No terminal, dentro da pasta `draksyon`:

```bash
node server.js
```

3. Abra `http://localhost:8080`

---

## Como funciona

| Rota                       | O que faz                                                                                                  |
|----------------------------|-------------------------------------------------------------------------------------------------------------|
| `/`                        | Serve `public/index.html` (e os outros HTMLs)                                                              |
| `/proxy?url=<URL>`         | Baixa HTML/JSON do AnimeFire com User‑Agent e Referer corretos. Cache em disco de 30 min em `.cache/`.     |
| `/stream?url=<URL>`        | Faz **stream** de mp4 / m3u8 / .ts. Repassa `Range` para permitir seek. Reescreve playlists `.m3u8` para passarem pelo próprio `/stream` (resolve CORP). |
| `/health`                  | Status do servidor                                                                                         |

### Por que isso resolve o erro

- **Antes:** o navegador tentava buscar a imagem/vídeo direto no CDN externo.
  O CDN responde com `Cross-Origin-Resource-Policy: same-origin` → Chrome
  bloqueia → `ERR_BLOCKED_BY_RESPONSE`.
- **Agora:** o navegador pede para o **seu** servidor (`/stream?url=...`).
  Seu servidor busca o arquivo **server‑to‑server** (sem regras de CORS) e
  devolve para o navegador adicionando `Access-Control-Allow-Origin: *` e
  `Cross-Origin-Resource-Policy: cross-origin`. Como tudo vem da mesma origem
  do site, **nenhuma política do navegador é violada**.

### Cache

- Listagens, detalhes e páginas de episódio são cacheadas por **30 minutos**
  em `.cache/`. Pode apagar essa pasta a qualquer momento.
- Vídeos **não** são cacheados (ocupariam muito espaço).

---

## Estrutura

```
draksyon/
├── server.js          ← servidor Node (zero dependências)
├── package.json
├── README.md
├── public/            ← HTMLs do site (servidos pelo Node)
│   ├── index.html
│   ├── detalhes.html
│   └── player-animes.html
└── .cache/            ← cache em disco (criado automaticamente)
```

---

## Solução de problemas

- **`pkg: command not found`** → você não está no Termux. Use `apt`/`brew`/instalador do Node.
- **Porta 8080 ocupada** → `PORT=3000 node server.js`
- **Algum anime ainda não carrega** → pode ser que o player original do
  AnimeFire seja um iframe de terceiros (ex.: Blogger). Iframes externos não
  passam pelo proxy (eles precisam rodar com o JS do próprio site
  embedado). Esses casos são limitação do site de origem, não do proxy.
- **Cloudflare bloqueando** → o servidor tenta detectar e devolve 503.
  Aguarde alguns minutos ou troque a sua rede/IP.

---

Pronto para usar 🎌
