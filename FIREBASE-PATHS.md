# Mapa Firebase do X-Bunny Animes

## Parceiros e indicações (primeira etapa)

O sistema de parceiros usa o **Realtime Database** do projeto `animes-64408`, assim como as contas e o painel ativos. O Firestore continua fechado em `firestore.rules`; não é necessário ativá-lo. `partners/{uid}` vincula o parceiro ao UID do Firebase Authentication. `referralLinks/{code}` associa o código ao parceiro; `referralClicks/{id}` registra código, UID do parceiro, identificador aleatório de visitante e horário, sem IP; `referralVisitorClicks/{visitorId}` permite verificar qual foi o último clique válido do mesmo navegador antes do cadastro; `referrals/{uid}` fixa a atribuição na conta; `conversions/{uid}_{planUpdatedAt}` registra a concessão de VIP. `commissions`, `payouts` e `affiliateSettings` ficam reservados e fechados para etapas futuras.

Publique `API ANIMES E CHAT/database.rules.json` antes do novo servidor. As regras impedem gravação direta nesses caminhos. Apenas o titular autenticado pode ler seu registro em `partners/{uid}` e `referrals/{uid}`; relatórios completos passam pelo endpoint administrativo.

No servidor, configure `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON completo de uma conta de serviço **do mesmo projeto** e, se a URL do banco diferir da configuração padrão, `FIREBASE_DATABASE_URL`. Conceda à conta de serviço acesso ao Realtime Database. Nunca exponha essa variável ao navegador, ao build ou ao repositório. Os endpoints falham com 503 se a credencial faltar. A URL compartilhável é montada com a origem atual do site (`location.origin`), sem domínio fixo.

O painel em `partners.html`, acessado pelo menu Comunidade, cria, aprova, suspende e remove logicamente parceiros. A remoção preserva os registros históricos e impede novos cliques e reativação. O visitante recebe uma escolha de consentimento ao abrir `?ref=CODIGO`; GPC e Do Not Track desativam a captura. O último clique válido consentido no mesmo navegador em até 30 dias antes da criação no Authentication pode ser vinculado ao UID após a verificação do e-mail. O cookie aleatório HttpOnly precisa estar presente na reivindicação; uma atribuição já gravada não é substituída. Cliques e visitantes únicos são estimativas, pois o visitante pode limpar o identificador. O painel registra conversão quando concede VIP; o plano Plus permanece em desenvolvimento e não gera conversão nesta etapa.

## Área do parceiro (segunda etapa)

`affiliate.html` consulta `/api/affiliates/report` com o token Firebase. O servidor usa o UID do token para parceiros aprovados ou suspensos; somente administradores podem indicar outro UID para consulta. A resposta inclui eventos próprios sem UID, e-mail, identificador de visitante ou dados financeiros dos usuários indicados; apenas os totais de visitantes únicos saem do servidor. Os gráficos e filtros usam horários reais dos eventos. Conversões sem valor confirmado somam zero na receita atribuída. Comissões e pagamentos exibem somente lançamentos existentes; nenhuma comissão é criada automaticamente nesta etapa.

Em `affiliateSettings`, o administrador pode definir pelo painel `partners.html` os campos `allowPartnerLinks`, `payoutsEnabled`, `minPayout` (número não negativo), `currency` (código ISO de três letras) e `commissionDescription` (texto público). Sem ativação explícita, parceiros não podem criar links nem pedir saque. Solicitações de saque usam `payouts/{id}` e uma reserva com comparação de versão em `payoutReservations/{uid}` para impedir solicitações simultâneas acima do saldo aprovado. A aprovação e a liquidação permanecem administrativas.

## Administração de afiliados (terceira etapa)

O Drawer de `admin.html` abre `affiliates-admin.html` na própria seção Parceiros e Afiliados. A API `adminData` e todas as mutações verificam token e marcador `/admins/{uid}` no servidor. `partnerCommissionRules/{uid}` guarda percentual, valor fixo por cadastro e orçamento individual; `affiliateSettings` guarda padrões, prazo de atribuição de 1 a 30 dias, limite de links, antifraude e suspensão global. Os links podem ter código personalizado, campanha, validade e regras textuais. O servidor rejeita cliques após a validade e cliques repetidos do mesmo visitante e código em 30 segundos quando o antifraude está ativo.

`recordPurchase` registra uma compra confirmada ou simulada, sem cobrar ninguém. `settle` cria uma comissão pendente a partir de cadastro ou compra, respeitando orçamento e impedindo duplicação por origem. `commissionBudgetUsage/{uid}` reserva o orçamento com comparação de versão para concorrência. `financialAction` valida transições e grava a alteração junto com `affiliateAudit` em uma atualização atômica do Realtime Database. O estado `paid` registra apenas a confirmação administrativa de um pagamento externo; não executa transferência. A exportação CSV é feita no navegador a partir do relatório autenticado. Publique também as regras fechadas de `affiliateAudit`, `partnerCommissionRules` e `commissionBudgetUsage` antes de disponibilizar esta etapa.

## Simulador de compras (quarta etapa)

Ative `simulationEnabled` em Configurações e autorize explicitamente um UID existente em `affiliateTestAccounts/{uid}`. A área “Simulador de Compras” cria um percurso em `simulationFlows/{id}` com visita e cadastro **simulados**, ambos marcados `isSimulation: true`. A compra de VIP ou Plus pode ficar pendente, ser recusada, aprovada ou estornada. A comissão simulada é calculada a partir da regra percentual do parceiro ou padrão; somente uma compra aprovada mantém valor de comissão. Cada atualização exige um `requestId` único, usa comparação de versão do Firebase e devolve a mesma resposta quando o identificador é repetido. A limpeza requer a frase `LIMPAR SIMULACOES`, apaga somente `simulationFlows` e registra o ato na auditoria.

Os fluxos simulados não alteram `users`, planos, `conversions`, `commissions`, `payouts` ou reservas financeiras. O parceiro recebe apenas seus próprios resultados simulados em uma aba separada, sem UID dos usuários de teste e sem saldo sacável. Registros antigos com `status: simulated` nas conversões reais são excluídos das estatísticas e das comissões reais. `lib/payment-gateway.js` define apenas uma interface para integração futura; nenhum gateway, chave ou webhook está ativo. Publique a regra fechada de `affiliateTestAccounts` e `simulationFlows` antes de disponibilizar o simulador.

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

