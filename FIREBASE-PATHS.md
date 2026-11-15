# Mapa Firebase do X-Bunny Animes

O site usa um único projeto: **`animes-64408`**. Todas as funções ativas abaixo usam o **Realtime Database** desse projeto e o Firebase Authentication do mesmo projeto.

O projeto não usa Firebase Storage nem Firestore. Os arquivos de banner permanecem em URLs HTTPS externas; somente nome, categoria e URL são gravados no banco. `storage.rules` e `firestore.rules` negam explicitamente toda leitura e escrita para que esses serviços não fiquem expostos por engano.

## Caminhos usados em produção

| Caminho | Leitura | Escrita | Função |
|---|---|---|---|
| `/admins/{uid}` | próprio usuário/admin | admin | marcador de administrador |
| `/users/{uid}` | dono/admin | dono com campos privilegiados protegidos; admin completo | conta, plano, bloqueio, perfis e preferências |
| `/users/{uid}/profiles` | dono/admin | dono/admin | perfil principal |
| `/users/{uid}/profileCustomization` | dono/admin | dono/admin | banner e tema escolhidos |
| `/users/{uid}/profileHistory` | dono/admin | dono/admin | histórico na nuvem para Free e VIP |
| `/users/{uid}/profileProgress` | dono/admin | dono/admin | progresso dos episódios |
| `/users/{uid}/profilePreferences` | dono/admin | dono/admin | preferências da interface |
| `/users/{uid}/devices` | dono/admin | dono/admin | dispositivos conectados |
| `/users/{uid}/animeAlerts` | dono/admin | dono/admin | alertas de novos episódios |
| `/users/{uid}/backups` | dono/admin | dono/admin | backup VIP |
| `/users/{uid}/notificationReads` | dono/admin | dono/admin | avisos já lidos |
| `/users/{uid}/supportRequests` | dono/admin | dono/admin | solicitações de suporte |
| `/dk_broadcast/current` | pública | admin; usuário somente incrementa `views` | comunicado atual |
| `/dk_broadcast/history` | autenticado | admin | histórico de comunicados |
| `/dk_broadcast/maintenance` | pública | admin | tela de manutenção, inclusive no login |
| `/dk_broadcast/config` | pública | admin | tema, contatos, chat do player e banners |
| `/dk_broadcast/homeFeatured` | pública | admin | fileiras e destaques da Home |
| `/dk_broadcast/skipSegments` | autenticado | admin | abertura e encerramento configurados |
| `/notifications/global` | autenticado | admin | avisos globais legados/central |
| `/notifications/user/{uid}` | dono/admin | dono/admin | avisos direcionados e alertas |
| `/rhSocialV1/animeChats` | autenticado | autor/admin | comentários dos animes |
| `/rhSocialV1/publicProfiles` | autenticado | dono/admin | perfil exibido no chat |
| `/rhSocialV1/userComments` | autenticado | dono/admin | índice de comentários do perfil |
| `/rhSocialV1/notifications` | destinatário/admin | autor, destinatário ou admin | respostas no chat |
| `/rhSocialV1/reports` | dono/admin | dono/admin | denúncias completas |
| `/rhSocialV1/reportLimits` | dono/admin | dono/admin | limite de denúncias |
| `/chatReports` | dono/admin; raiz para admin | dono/admin | espelho das denúncias no painel |
| `/dk_player_health` | autenticado | autenticado | sucessos, erros e relatórios do player |
| `/episodeReports` | admin | autenticado | problemas enviados sobre episódios |

`/.info/connected` é um caminho interno do Realtime Database e não precisa de regra personalizada.

## Código legado que não está ativo

`dk-realtime.js` e `site-status.js` contêm integrações antigas com Firestore/FCM, mas não são carregados pelas telas atuais. As funções ativas não dependem de Firestore nem de Firebase Storage.

Histórico e progresso são privados e disponíveis para Free e VIP. Os caminhos VIP (`animeAlerts`, `backups`, temas personalizados e quantidade adicional de perfis) também possuem validação de plano nas regras. O frontend não é a fronteira de segurança.

## Arquivos para publicar

### Revogacao de sessoes

`/revokedSessions/{auth.uid}/{auth_time}` armazena marcadores booleanos irreversiveis de revogacao. O dono verificado pode consultar seus marcadores e revogar suas autenticacoes; nao pode remover um marcador. As regras das areas privadas e as APIs verificam esse registro e o bloqueio da conta. O identificador vem do token assinado pelo Firebase, nao de um ID de dispositivo enviado em cabecalho.

As regras atualizadas devem ser publicadas **antes** das APIs e do frontend que usam esse caminho. Sem isso, as novas consultas de autorizacao falham de modo fechado. A geracao local pode ser reproduzida com `node scripts/harden-session-rules.cjs`; esse comando nao publica regras nem modifica dados.

Publique `API ANIMES E CHAT/database.rules.json`, `storage.rules` e `firestore.rules` pelo `firebase.json` no projeto `animes-64408`. Não use estas regras no projeto antigo `chat-4c99e`.
