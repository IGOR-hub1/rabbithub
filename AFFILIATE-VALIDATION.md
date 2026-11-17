# Validação final de parceiros e afiliados

## Estado do sistema

Os links usam a origem atual do navegador e `?ref=CODIGO`. Após consentimento, a visita recebe um identificador aleatório de navegador; não é salvo IP completo. O backend vincula ao UID o último clique válido anterior à criação da conta no Firebase Authentication, dentro do prazo configurado (até 30 dias). Uma atribuição gravada não é substituída por outro link.

Administradores gerenciam parceiros, links, campanhas, regras, relatórios e o simulador. Parceiros aprovados ou suspensos consultam apenas seus próprios totais e eventos, sem dados pessoais dos indicados. O simulador guarda fluxos em `simulationFlows` com `isSimulation: true`; aprovação, pendência, recusa e estorno não alteram contas, planos, comissões reais, saques nem pagamentos. A limpeza confirmada remove os fluxos simulados e preserva um registro de auditoria. A autorização de contas de teste permanece para reutilização e pode ser revogada individualmente.

**Operações financeiras reais estão bloqueadas no backend.** Sem gateway validado, o servidor recusa registro manual de compra confirmada, cálculo de comissão real, solicitação de saque e aprovação ou marcação de pagamento. Dados históricos continuam visíveis e podem ser rejeitados pelo administrador. O painel desabilita as principais ações indisponíveis. `lib/payment-gateway.js` contém somente o contrato futuro; nenhuma credencial ou cobrança está configurada.

## Configuração necessária

1. No projeto Firebase `animes-64408`, publique somente `API ANIMES E CHAT/database.rules.json` com `firebase deploy --only database --project animes-64408` antes de publicar a API. O `firebase.json` contém apenas `database`. `firestore.rules` e `storage.rules` são preservados como arquivos de referência e não são publicados nem exigem ativação desses serviços. O sistema ativo usa **Realtime Database e Authentication**, sem Cloud Functions.
2. Configure `FIREBASE_SERVICE_ACCOUNT_JSON` no ambiente **servidor** da Vercel com o JSON de uma conta de serviço do mesmo projeto. `FIREBASE_PROJECT_ID` tem padrão `animes-64408`; `FIREBASE_DATABASE_URL` tem padrão `https://animes-64408-default-rtdb.firebaseio.com`. Se configurar valores explícitos, o projeto da credencial e a URL do Realtime Database devem corresponder ao projeto. Não coloque o JSON no frontend, no repositório ou em variáveis públicas.
3. Confirme o marcador `/admins/{uid}` e as contas com e-mail verificado. No painel, habilite `simulationEnabled` e autorize explicitamente os UIDs de teste. Solicitações de saque permanecem indisponíveis mesmo se uma configuração antiga as habilitou.
4. Na Vercel, o preset é `Other`, os arquivos estáticos vêm de `public`, e `api/affiliates.mjs` atende `/api/affiliates/:action` por meio de `vercel.json`. Publique primeiro em Preview e teste rotas, cookies seguros, autenticação e leitura/gravação no Realtime Database antes de disponibilizar o domínio principal.

Após publicar, execute `npm.cmd run test:affiliate:deploy -- https://SEU-DOMINIO/`. A verificação exige HTTP 200 nas páginas e HTTP 401 com JSON na API sem token. Um 404 HTML na API indica deployment incompleto ou projeto/root incorreto; a interface exibirá uma mensagem explícita, mas o backend precisa estar publicado para funcionar. Em 17/11/2026, `rabbithub-eight.vercel.app` ainda respondia 404 para `affiliates-admin.html` e `/api/affiliates/adminData`, embora `admin.html` estivesse publicado. Não considere esse deployment válido até o smoke test passar.

## Regras e proteção

- O Realtime Database bloqueia gravações diretas do cliente em `partners`, `referralLinks`, `referralClicks`, `referralVisitorClicks`, `referrals`, `conversions`, `commissions`, `payouts`, `payoutReservations`, `affiliateSettings`, `affiliateAudit`, `partnerCommissionRules`, `commissionBudgetUsage`, `simulationFlows` e `affiliateTestAccounts`.
- A API verifica o token Firebase e `/admins/{uid}` para todas as mutações administrativas. O endpoint público de clique exige consentimento; GPC, Do Not Track e recusa local impedem a captura no navegador.
- As gravações concorrentes de atribuição, cliques, links e simulações usam escrita condicional com ETag. IDs de compra simulada impedem repetição de uma transição. Os relatórios de parceiros eliminam UIDs, e-mails e identificadores de visitante dos indicados.
- Firestore e Storage permanecem fechados. Não há Cloud Functions neste projeto; as funções de backend são `server.js` e a função Node da Vercel.

## Testes locais executados

- `npm.cmd test`: **150 aprovados, 0 falhas**. Cobriu atribuição, último clique, isolamento, permissões, orçamento e comissão em fixture, duplicidade, estados do simulador, estorno, bloqueio financeiro sem gateway, regras, login, perfis, histórico, temas e planos.
- `npm.cmd run build`: build local e validação de sintaxe concluídos. O pacote local em `dist` é independente da publicação estática da Vercel.
- `npm.cmd run security:preflight`: aprovado para `animes-64408`.
- `npm.cmd run test:ui`: aprovado em Chrome headless para navegação, autenticação administrativa simulada, persistência de configuração, layouts mobile/desktop e exceções JavaScript. O teste visual geral não autentica uma conta real de parceiro.
- Adaptador da Vercel: importação sem abrir porta, roteamento HTTP local e rejeição de chamada sem token verificados em teste.

## Limitações e liberação

Não foram executados testes contra o Firebase remoto, contas reais ou um deployment Preview da Vercel: não há credencial de serviço nem acesso de implantação neste ambiente. Portanto, **a liberação em produção ainda depende** de publicar as regras, configurar os segredos, testar persistência e permissões com contas de teste reais, verificar o layout do painel autenticado em celular e desktop e executar o fluxo completo no Preview.

Para integrar pagamentos reais, implemente um gateway no servidor com checkout, validação criptográfica de webhook, consulta de status ao provedor, IDs idempotentes, tratamento de cancelamento/estorno, conciliação e auditoria. Só depois de testes de ponta a ponta com o provedor devem ser reabertas as operações financeiras reais e os saques. O simulador permanece separado durante essa integração.
