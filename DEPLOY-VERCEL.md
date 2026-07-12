# Deploy grátis no Vercel

## Correção aplicada
O erro **"Cannot read properties of undefined (reading 'digest')"** acontecia porque
`window.crypto.subtle` só existe em contexto seguro (HTTPS ou localhost). Em HTTP
comum o navegador deixa `crypto.subtle` como `undefined`.

Foi adicionado um **fallback puro em JavaScript de SHA-256** em `public/login.html`
e `public/admin.html`. Agora o hash da senha funciona em qualquer contexto.

No Vercel o site é servido em HTTPS por padrão, então nem o fallback será usado —
mas o código fica robusto para qualquer hospedagem.

## Como publicar no Vercel (100% grátis)

1. Crie uma conta em https://vercel.com (login com GitHub recomendado).
2. Suba esta pasta em um repositório do GitHub (ou use o Vercel CLI).
   - CLI: `npm i -g vercel` e depois, dentro da pasta, `vercel` e siga o assistente.
3. No painel do Vercel: **Add New → Project → Import Git Repository**.
4. Nas opções do projeto:
   - Framework Preset: **Other**
   - Build Command: *(deixe vazio)*
   - Output Directory: *(deixe vazio)*
   - Install Command: *(deixe vazio)*
5. Clique em **Deploy**. Pronto — seu site fica em `https://seu-projeto.vercel.app`.

O `vercel.json` já está configurado para:
- Servir a pasta `public/` como arquivos estáticos.
- Rodar `server.js` como Serverless Function em `/api/index.js`, cobrindo as
  rotas `/proxy` e `/stream` usadas pelo player.

## Observações do plano gratuito
- Serverless Functions no Hobby: 10s de execução por request. Streams longos
  de vídeo (`/stream`) podem cortar em vídeos muito grandes; para uso pessoal
  costuma funcionar bem.
- Bandwidth grátis: 100 GB/mês.
- HTTPS e domínio `.vercel.app` inclusos.
