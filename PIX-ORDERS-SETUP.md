# Pix de teste — Orders API

`POST /api/pix-order` aceita somente `{"planId":"vip"}` ou `{"planId":"plus"}`. `GET /api/pix-order?planId=vip` (ou `plus`) consulta o pedido reutilizável sem criar cobrança e devolve `{ "ok": true, "order": null }` quando não há Pix pendente. Ambas exigem o ID token do Firebase Authentication em `Authorization: Bearer ...`. A rota lê o valor em centavos de `lib/plan-pricing.js` e responde com `orderId`, `mercadoPagoOrderId`, `paymentId`, `status`, `gatewayStatus`, `qrCode`, `qrCodeBase64`, `pixCopyPaste`, `pixExpiresAt` e `ticketUrl`. `qrCode` e `pixCopyPaste` contêm o mesmo payload Pix; a imagem Base64 pode não vir no ambiente de teste. Não envie preço nem credenciais do navegador.

Configure **somente no servidor**, nas variáveis de ambiente da Vercel para o ambiente de teste:

- `MERCADO_PAGO_TEST_ACCESS_TOKEN`: Access Token da aplicação Mercado Pago com o seletor **Teste** ativo. Não há fallback para token de produção.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: JSON completo de uma conta de serviço do projeto Firebase `animes-64408`, com permissão de acesso ao Firestore. A mesma variável já é usada no backend de afiliados.
- `FIREBASE_PROJECT_ID=animes-64408` se o projeto usar configuração explícita. O código usa esse projeto por padrão.

Ative o banco Cloud Firestore `(default)` no projeto Firebase antes de chamar a rota. `firestore.rules` continua negando acesso direto do cliente; somente a conta de serviço do backend grava em `paymentOrders`. O documento é reservado antes da chamada ao Mercado Pago e passa a `pending` após uma resposta Pix válida. Uma reserva de 30 segundos no documento impede POSTs simultâneos de instâncias da Vercel; uma retomada após falha repete a mesma chave de idempotência. Há um pedido corrente por UID e plano. Antes de devolver o QR pendente, o backend consulta a order no Mercado Pago e confere status, transação, código Pix e vencimento. A criação pede validade Pix `P1D` (24 horas); se o prazo local terminou mas o gateway ainda não confirmou o fim do pagamento, a rota responde conflito e não abre outra cobrança. Um pedido recusado, cancelado ou expirado é arquivado no histórico por commit atômico antes da criação de outro pedido. Um pedido aprovado não gera segunda cobrança para o mesmo plano. Ao abrir a página de planos, o navegador consulta os pedidos pendentes pelo UID e recupera o mais recente; fechar a janela Pix não cancela a cobrança.

A regra existente de concessão de VIP usa validade `0` (sem expiração). Como não há outro prazo de assinatura Pix definido, pagamentos aprovados de VIP e PLUS seguem essa mesma regra; `planActivatedAt` registra a ativação e `premiumUntil`, `vipUntil` e `planExpiresAt` ficam em `0`. Os preços oficiais provisórios atuais são VIP R$ 1,00 para teste e PLUS R$ 19,90. Pedidos VIP antigos de R$ 9,90 continuam elegíveis à confirmação pelo valor registrado originalmente. Enquanto um Pix antigo estiver pendente, o backend não abre outro com o novo preço até o Mercado Pago confirmar seu estado terminal. A documentação do Mercado Pago informa que o teste de aprovação automática do Pix na Orders API exige dados predefinidos de R$ 50,00; R$ 1,00 não comprova esse fluxo no sandbox.

Referências: [Pix no Checkout Transparente Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix), [teste Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix) e [criação de documentos Firestore](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/createDocument).

## Confirmação automática por Webhook

Antes de publicar as funções, aplique `firestore.rules` com `firebase deploy --only firestore:rules --project animes-64408`. O `firebase.json` inclui essa regra, que nega acesso direto do navegador aos pedidos. Publique também `API ANIMES E CHAT/database.rules.json` com `firebase deploy --only database --project animes-64408`.

Configure `MERCADO_PAGO_WEBHOOK_SECRET_TEST` na Vercel com a chave secreta gerada nas configurações de Webhooks da aplicação Mercado Pago em **Teste**. Mantenha `MERCADO_PAGO_TEST_ACCESS_TOKEN` e `FIREBASE_SERVICE_ACCOUNT_JSON` no mesmo ambiente. Não exponha essas variáveis ao navegador.

No painel Mercado Pago, habilite **Order (Mercado Pago)** e cadastre a URL HTTPS `https://<dominio-publicado-na-vercel>/api/mercado-pago-webhook`. O repositório não identifica com segurança qual domínio Vercel está ativo; copie o domínio de produção no painel Vercel. O caminho da rota é `/api/mercado-pago-webhook`.

A rota aceita somente notificações `order` de teste com assinatura HMAC válida, consulta `GET /v1/orders/{id}` e grava o estado confirmado em `paymentOrders`. A consulta autenticada `GET /api/pix-status?orderId=<uuid>` retorna apenas pedidos do usuário do ID token Firebase. A página de planos consulta o status enquanto a janela Pix está aberta; o Webhook continua a confirmar pagamentos com a página fechada.

Estados persistidos: `pending`, `approved`, `rejected`, `canceled`, `expired` e `reversed`. `approved` exige Pix `processed/accredited`, valor integral, moeda `BRL` na notificação autenticada, país `BRA` na order consultada e moeda `BRL` também na order quando esse campo existir, além de plano e referência interna correspondentes. A referência GET da Orders API documenta `country_code`, mas não `currency_id`; a checagem de moeda da notificação assinada complementa a consulta. O commit do Firestore usa a versão do documento como precondição. A ativação usa uma atualização condicional por ETag no Realtime Database e grava o identificador do pedido na conta. Uma repetição do Webhook conclui qualquer registro pendente no Firestore sem conceder o plano duas vezes. O histórico autenticado está em `GET /api/pix-orders`. Publique `API ANIMES E CHAT/database.rules.json` antes das funções atualizadas: a regra impede o cliente de alterar `planActivatedAt` e `appliedPaymentOrders`. A conta de serviço também precisa ter acesso ao Realtime Database do mesmo projeto. Produção exigirá credenciais e chave secreta próprias e a revisão da restrição de `live_mode`.

Referências: [Webhooks da Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications), [status de pedidos](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status) e [commit do Firestore](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit).

## Rate limit dos endpoints Pix

Os contadores ficam na coleção `paymentRateLimits` do Firestore, fechada ao cliente pelas regras atuais. Cada requisição usa documentos separados por UID e IP; as duas cotas são verificadas e gravadas no mesmo commit condicional. Os documentos guardam apenas um hash do identificador, os horários recentes e a versão do Firestore. O servidor usa `x-vercel-forwarded-for` (ou `x-forwarded-for`) somente quando `VERCEL=1`; fora da Vercel usa o IP da conexão.

Limites padrão por janela móvel de 10 minutos:

| Operação | Por UID | Por IP |
| --- | ---: | ---: |
| Criar novo Pix | 5 | 20 |
| Recuperar Pix pendente | 120 | 600 |
| Consultar status ou histórico | 120 | 3000 |
| Webhook com assinatura inválida | — | 30 |

`POST /api/pix-order` consulta primeiro o pedido existente. Uma recuperação não consome a cota de criação, mas consome a cota de consulta. `GET /api/pix-order`, `GET /api/pix-status` e `GET /api/pix-orders` também têm proteção. Ao atingir a cota, o servidor responde `429` com `Retry-After`; a interface mostra o tempo de espera e respeita esse cabeçalho antes da próxima consulta de status. Webhooks com assinatura válida, inclusive reenvios, não entram nos limites de usuários nem na cota de assinaturas inválidas. A validação HMAC e a consulta ao Mercado Pago permanecem obrigatórias.

Variáveis opcionais na Vercel, todas inteiras positivas (os valores abaixo são os padrões):

- `PIX_RATE_LIMIT_WINDOW_SECONDS=600`
- `PIX_CREATE_LIMIT_PER_UID=5`
- `PIX_CREATE_LIMIT_PER_IP=20`
- `PIX_LOOKUP_LIMIT_PER_UID=120`
- `PIX_LOOKUP_LIMIT_PER_IP=600`
- `PIX_STATUS_LIMIT_PER_UID=120`
- `PIX_STATUS_LIMIT_PER_IP=3000`
- `PIX_INVALID_WEBHOOK_LIMIT_PER_IP=30`

O rate limit exige a mesma `FIREBASE_SERVICE_ACCOUNT_JSON` já usada pelos pedidos. Falhas do Firestore impedem a criação e as consultas dos usuários; notificações sem assinatura continuam rejeitadas mesmo se o armazenamento do limite estiver indisponível. Não configure `VERCEL` manualmente fora da plataforma.
