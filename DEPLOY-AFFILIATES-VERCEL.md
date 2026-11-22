# Publicação dos afiliados na Vercel

O projeto usa Firebase Authentication, Realtime Database e uma função Node.js na Vercel. A interface está em `public/`; a função está em `api/affiliates.mjs` e usa `server.js` e `lib/affiliate-*.js`.

## Configuração do projeto Vercel

- Repositório: `IGOR-hub1/rabbithub`, na branch que contém **todos** os arquivos abaixo.
- Root Directory: raiz do repositório (campo vazio ou `.`), nunca `public/`.
- Framework Preset: **Other**.
- Output Directory: `public` (definido em `vercel.json`).
- Build Command: `node scripts/verify-affiliate-deploy.mjs` (definido em `vercel.json`). Esse passo falha se a função ou suas dependências estiverem ausentes.
- Node.js: versão suportada pela Vercel, 18 ou superior conforme `package.json`.
- Variáveis do projeto: `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON completo da conta de serviço do projeto `animes-64408`; `FIREBASE_PROJECT_ID=animes-64408`; `FIREBASE_DATABASE_URL` com a URL HTTPS exata do Realtime Database ativo. Configure para o ambiente de produção e faça um novo deploy após alterações.

O arquivo `vercel.json` encaminha `/api/affiliates/:action` para a função `/api/affiliates?action=:action` e `/stream` para a função `/api/stream`. O player usa `/stream` para MP4, HLS e DASH; publicar apenas os arquivos de `public/` deixa todos os vídeos sem fonte. Não coloque as funções dentro de `public/`, nem configure uma regra genérica que capture `/api/*` antes desses encaminhamentos.

## Arquivos que precisam entrar no commit

`vercel.json`, `api/affiliates.mjs`, `api/stream.mjs`, `server.js`, `lib/affiliate-service.js`, `lib/affiliate-store.js`, `lib/firebase-auth.js`, `lib/account-plan.js`, `scripts/verify-affiliate-deploy.mjs`, os arquivos `public/partners*`, `public/affiliates-admin*`, `public/affiliate*` e `public/simulator-admin*`.

Em 18/11/2026, a branch pública `main` tinha `vercel.json` e as páginas, mas não tinha `api/affiliates.mjs`, `lib/affiliate-service.js` nem `lib/affiliate-store.js`. Confirme que esses arquivos aparecem no commit implantado; uma alteração local isolada não muda o deployment.

## Verificação após o deploy

Execute `node scripts/affiliate-deploy-smoke.mjs https://SEU-DOMINIO/`. O teste exige que as páginas respondam 200 e que `GET` e `POST /api/affiliates/adminData` sem token respondam **401 JSON**. Um 404 HTML indica função ou rota ausente. Com um token Firebase de administrador válido e o marcador `admins/<uid> = true` no Realtime Database, `POST /api/affiliates/adminData` deve retornar os dados permitidos. Nunca publique o token ou o JSON da conta de serviço no repositório.

O sistema continua em modo de simulação; não há gateway de pagamento real configurado. Firestore, Storage e Cloud Functions não são necessários para esta implantação.
