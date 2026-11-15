# X-Bunny Animes — estado atual

## Correções de interface — 02/11/2026

- A barra lateral do desktop permanece fixa durante a rolagem.
- O layout desktop é definido antes da primeira pintura, sem piscar o botão de menu mobile.
- A logo do tema é aplicada enquanto o HTML é criado, evitando a troca visual tardia.
- O avatar compartilhado reconhece `profileAvatar` da sessão e do usuário autenticado.
- Dropdowns abrem junto ao gatilho, usam a altura real da lista e permanecem abertos ao rolar as próprias opções.
- A animação de entrada deixou de transformar o `body`, preservando todos os elementos fixos e clicáveis.
- O teste `scripts/ui-regression.mjs` valida esses comportamentos em Chromium nas larguras desktop e mobile.
- O servidor local agora interpreta requisições com a API WHATWG `URL`, removendo o uso obsoleto de `url.parse()`.

## Firebase

- Firebase Authentication por e-mail e senha está ativo.
- Contas ficam em `users/{firebaseAuthUid}` no Realtime Database.
- Chat, perfis públicos e notificações usam o mesmo projeto `animes-64408`, sob `rhSocialV1`.
- O projeto não usa Firebase Storage; banners guardam somente links HTTPS.
- As regras de produção estão em `API ANIMES E CHAT/database.rules.json`.

Nunca publique regras globais com `".read": true` e `".write": true`. Isso permitiria que qualquer visitante alterasse contas, planos e configurações administrativas.

## Painel

O painel reconhece `/admins/UID = true`, `users/UID/isAdmin = true` ou `users/UID/role = "admin"`. Em localhost a interface pode ser aberta sem a verificação visual, mas as escritas online continuam protegidas pelas regras do Firebase.

## Publicação

Consulte `FIREBASE-PUBLISH.md` para publicar as regras e `FIREBASE-PATHS.md` para conferir o mapa de todas as dependências.
