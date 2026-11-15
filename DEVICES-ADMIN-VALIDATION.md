# Dispositivos conectados e painel administrativo — 15/11/2026

Correções feitas no projeto local. Não houve deploy nem alteração de registros ou regras em produção.

## Dispositivos

- A chave real de `/users/<uid>/devices/<chave>` passou a identificar o registro. Um campo `id` antigo e divergente não pode mais direcionar o encerramento à chave errada.
- A sessão/token é renovada antes da operação. Troca de usuário durante a solicitação cancela a gravação.
- Para registros com `authTime`, a mesma atualização multipath grava o marcador de revogação e `active:false`, preservando os metadados.
- A operação relê os dispositivos antes de confirmar sucesso. Registro ainda ativo ou erro de permissão não produz mensagem de sessão encerrada.
- Registros antigos sem `authTime` podem ser marcados como inativos e removidos da lista. A interface explica que o bloqueio depende da sincronização daquele cliente; não afirma que um token desconhecido foi revogado.
- O encerramento do aparelho atual usa o `auth_time` do token atual. Tokens da mesma autenticação são tratados juntos.

Arquivos: `public/auth-guard.js`, `public/index.html`; referências de cache do guard atualizadas nas páginas consumidoras.

## Admin

O painel abria após a verificação por REST, mas a leitura/edição permanecia dependente do SDK de banco e de transações de criação da estrutura. Sem retorno dessas transações, `bindRealtime()` nunca era executado. As gravações SDK também podiam aguardar reconexão sem concluir.

- A inicialização agora liga as leituras imediatamente. A criação da estrutura continua disponível pelo botão existente, sem bloquear a abertura ou escrever automaticamente ao entrar.
- `public/admin-database.js` fornece as operações usadas pelo painel por REST autenticado: leitura, gravação, atualização multipath, remoção, geração de chave, snapshots e transações condicionais por ETag.
- As transações repetem a leitura em conflito HTTP 412, preservando alterações concorrentes. Não há confirmação otimista de escrita.
- Token, requisição e corpo da resposta têm prazo de espera. Erros de autenticação/permissão são exibidos, sem contornar as regras.
- As consultas assinadas são atualizadas automaticamente a cada cinco segundos e após gravações. O indicador de conexão usa os resultados dessas requisições, não o estado de um WebSocket que o painel já não utiliza para dados.
- Configurações e manutenção só podem ser salvas após a leitura inicial, evitando publicar valores vazios quando o carregamento falha.
- O histórico administrativo é ordenado localmente e limitado aos 50 mais recentes, sem depender de um índice ausente nas regras existentes.
- Reabrir um painel já inicializado volta a exibi-lo corretamente.

Arquivos: `public/admin.html`, `public/admin-database.js`.

O transporte segue os mecanismos oficiais de [escrita REST e ETags](https://firebase.google.com/docs/database/rest/save-data) e [leitura REST](https://firebase.google.com/docs/database/rest/retrieve-data). As regras de autorização permanecem no Firebase.

## Testes

- **113 testes do site aprovados**: `.cache/devices-admin-tests.txt`.
- **10 testes do aplicativo Windows aprovados**: `.cache/devices-admin-desktop.txt`.
- Teste HTTP com servidor local: leitura, PATCH preservando outros campos, escrita multipath, notificações com chaves distintas, transação com conflito, remoção, leitura após gravação, 403, timeout e token sem resposta. Esse servidor simula as respostas RTDB; não é o Firebase Emulator nem o projeto real.
- Dispositivos: encerramento pelo caminho correto mesmo com ID antigo divergente, remoção de registro legado, confirmação de inatividade, rejeição de escrita negada e preservação do comportamento de logout.
- **Chrome aprovado**: carregamento do painel, configuração salva, campo não editado preservado e releitura da cor após reload. Acesso comum e erro 403 permaneceram bloqueados. Também passaram os percursos de navegação e a matriz de 60 combinações de páginas/resoluções. Firebase simulado, zero exceções JavaScript na execução final. Registro: `.cache/devices-admin-ui.txt`.
- **Build aprovado**: 68 arquivos de origem, 47 scripts validados. Diretório e hashes em `.cache/production-build.json`.
- A rotina de testes passou a encerrar o Chromium pelo protocolo antes de matar o processo. Um perfil temporário ainda bloqueado é preservado, sem ocultar o resultado original dos testes.

Testes adicionados/ajustados: `scripts/admin-database.test.js`, `scripts/account-security.test.js`, `scripts/security-audit.test.js`, `scripts/site-features.test.js`, `scripts/ui-regression.mjs`.

## O que ainda depende do ambiente real

Não havia sessão autenticada de teste disponível para confirmar gravações no projeto Firebase real. As regras publicadas de `users`, `admins` e `revokedSessions` precisam corresponder às regras do projeto. Um HTTP 401/403 não é resolvido por liberar acesso no cliente; agora a interface informa essa recusa.

Dispositivos antigos sem `authTime` não permitem identificar com segurança qual token revogar no registro central. Seu registro fica inativo, mas isso não equivale a revogar o token diretamente no Firebase Authentication.

O site publicado só receberá estas mudanças após publicar os arquivos atualizados. No servidor local, use esta pasta do projeto e atualize a página para carregar a versão nova dos scripts.
