# X-Bunny Animes

Site web de animes com interface em `public/`, API e lógica de servidor em `api/`, `lib/` e `server.js`. O X-Bunny Cast é um projeto independente e não faz parte deste pacote.

## Executar localmente

Requer Node.js 18 ou superior. Não há dependências npm para instalar.

```bash
node server.js
```

No próprio computador, abra `http://localhost:8080`. Para outro aparelho no mesmo Wi-Fi, use o endereço de rede mostrado no terminal ao iniciar o servidor.

## Publicação

O arquivo `vercel.json` publica `public/` e as rotas em `api/`. As regras do Realtime Database ficam em `API ANIMES E CHAT/database.rules.json`, apontadas por `firebase.json`. Consulte `PUBLICAR-REGRAS-FIREBASE.md` antes de atualizar as regras: a publicação substitui o conjunto atual.

Configure os segredos necessários como variáveis de ambiente na hospedagem. O arquivo local `.env` não faz parte deste pacote e não deve ser enviado ao GitHub. As configurações Firebase no JavaScript do navegador contêm apenas identificadores públicos do aplicativo web.

## Verificação

```bash
node --check server.js
node --test scripts/*.test.js
```

No Windows PowerShell, use `npm.cmd start` se quiser iniciar pelo `package.json`.
