# Pix de teste — Orders API

Esta etapa publica `POST /api/pix-order`. O corpo aceito é somente `{"planId":"vip"}` ou `{"planId":"plus"}`. Envie o ID token do Firebase Authentication em `Authorization: Bearer ...`. A rota lê o valor em centavos de `lib/plan-pricing.js` e responde com `orderId`, `mercadoPagoOrderId`, `paymentId`, `status`, `gatewayStatus`, `qrCode`, `qrCodeBase64`, `pixCopyPaste` e `ticketUrl`. `qrCode` e `pixCopyPaste` contêm o mesmo payload Pix; a imagem Base64 pode não vir no ambiente de teste. Não envie preço nem credenciais do navegador.

Configure **somente no servidor**, nas variáveis de ambiente da Vercel para o ambiente de teste:

- `MERCADO_PAGO_TEST_ACCESS_TOKEN`: Access Token da aplicação Mercado Pago com o seletor **Teste** ativo. Não há fallback para token de produção.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: JSON completo de uma conta de serviço do projeto Firebase `animes-64408`, com permissão de acesso ao Firestore. A mesma variável já é usada no backend de afiliados.
- `FIREBASE_PROJECT_ID=animes-64408` se o projeto usar configuração explícita. O código usa esse projeto por padrão.

Ative o banco Cloud Firestore `(default)` no projeto Firebase antes de chamar a rota. `firestore.rules` continua negando acesso direto do cliente; somente a conta de serviço do backend grava em `paymentOrders`. O documento é reservado antes da chamada ao Mercado Pago e passa a `pending` após uma resposta Pix válida. Há um pedido corrente por UID e plano: tentativas enquanto ele estiver pendente reutilizam a referência e a chave de idempotência. Um pedido recusado, cancelado ou expirado é arquivado no histórico por commit atômico antes da criação de outro pedido. Um pedido aprovado não gera segunda cobrança para o mesmo plano.

A regra existente de concessão de VIP usa validade `0` (sem expiração). Como não há outro prazo de assinatura Pix definido, pagamentos aprovados de VIP e PLUS seguem essa mesma regra; `planActivatedAt` registra a ativação e `premiumUntil`, `vipUntil` e `planExpiresAt` ficam em `0`. Os preços oficiais atuais são R$ 9,90 e R$ 19,90. A documentação do Mercado Pago informa que os testes Pix podem exigir valores de teste predefinidos; a rota não altera os preços oficiais para acomodar esses cenários.

Referências: [Pix no Checkout Transparente Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix), [teste Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix) e [criação de documentos Firestore](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/createDocument).

## Confirmação automática por Webhook

Antes de publicar as funções, aplique `firestore.rules` com `firebase deploy --only firestore:rules --project animes-64408`. O `firebase.json` inclui essa regra, que nega acesso direto do navegador aos pedidos. Publique também `API ANIMES E CHAT/database.rules.json` com `firebase deploy --only database --project animes-64408`.

Configure `MERCADO_PAGO_WEBHOOK_SECRET_TEST` na Vercel com a chave secreta gerada nas configurações de Webhooks da aplicação Mercado Pago em **Teste**. Mantenha `MERCADO_PAGO_TEST_ACCESS_TOKEN` e `FIREBASE_SERVICE_ACCOUNT_JSON` no mesmo ambiente. Não exponha essas variáveis ao navegador.

No painel Mercado Pago, habilite **Order (Mercado Pago)** e cadastre a URL HTTPS `https://<dominio-publicado-na-vercel>/api/mercado-pago-webhook`. O repositório não identifica com segurança qual domínio Vercel está ativo; copie o domínio de produção no painel Vercel. O caminho da rota é `/api/mercado-pago-webhook`.

A rota aceita somente notificações `order` de teste com assinatura HMAC válida, consulta `GET /v1/orders/{id}` e grava o estado confirmado em `paymentOrders`. A consulta autenticada `GET /api/pix-status?orderId=<uuid>` retorna apenas pedidos do usuário do ID token Firebase. A página de planos consulta o status enquanto a janela Pix está aberta; o Webhook continua a confirmar pagamentos com a página fechada.

Estados persistidos: `pending`, `approved`, `rejected`, `canceled`, `expired` e `reversed`. `approved` exige Pix `processed/accredited`, valor integral, moeda `BRL` na notificação autenticada, país `BRA` na order consultada e moeda `BRL` também na order quando esse campo existir, além de plano e referência interna correspondentes. A referência GET da Orders API documenta `country_code`, mas não `currency_id`; a checagem de moeda da notificação assinada complementa a consulta. O commit do Firestore usa a versão do documento como precondição. A ativação usa uma atualização condicional por ETag no Realtime Database e grava o identificador do pedido na conta. Uma repetição do Webhook conclui qualquer registro pendente no Firestore sem conceder o plano duas vezes. O histórico autenticado está em `GET /api/pix-orders`. Publique `API ANIMES E CHAT/database.rules.json` antes das funções atualizadas: a regra impede o cliente de alterar `planActivatedAt` e `appliedPaymentOrders`. A conta de serviço também precisa ter acesso ao Realtime Database do mesmo projeto. Produção exigirá credenciais e chave secreta próprias e a revisão da restrição de `live_mode`.

Referências: [Webhooks da Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications), [status de pedidos](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status) e [commit do Firestore](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit).
