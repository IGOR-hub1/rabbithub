# Auditoria final — X-Bunny Animes

Data: 14/11/2026. **Status: correções locais verificadas; lançamento ainda não aprovado.**

O site, APIs Node/serverless, bibliotecas compartilhadas, regras locais e testes dos clientes foram revisados. Não houve publicação, migração ou alteração de registros do Firebase. O layout e as funcionalidades existentes foram preservados.

## Correções desta auditoria

| Arquivo | Correção |
| --- | --- |
| `public/index.html` | A tela Conta consulta a conta da sessão central também quando o serviço de perfil está indisponível. O caminho alternativo podia mostrar Free para um VIP; dados VIP antigos em localStorage não prevalecem sobre a conta atual. |
| `lib/firebase-auth.js` | A validação de revogação/bloqueio lê somente os três campos necessários, evitando baixar todo o perfil e histórico em cada autorização. Mantém rejeição de erros de permissão e indisponibilidade. |
| `server.js` | Disponibiliza `/api/proxy` e `/api/ai/{episode,anime,recommendations}`, antes ausentes no servidor Node; mantém validação de autenticação/VIP dos handlers. Carrega `.env` antes de inicializar a configuração Firebase. Captura rejeições das rotas assíncronas. |
| `server.js` | Corrige a distinção entre término da requisição e desconexão no streaming; preserva Range/HTTP 206 e cancela o upstream ao sair. Limita respostas externas em memória e sua descompressão a 4 MiB. |
| `server.js`, `api/proxy.js` | Adiciona CSP com sandbox às respostas dos proxies para impedir que documentos externos abertos diretamente executem como a origem do site. Não altera os documentos da interface. |
| `lib/http-body.js` | Leitura de upload com limite de tamanho, prazo e tratamento de interrupção. Usada nas novas rotas Node e no proxy existente. |
| `api/ai/[mode].js` | Interrompe chamadas Gemini após 20 segundos e retorna 504 para timeout, evitando espera indefinida. |
| `package.json`, `scripts/build.mjs`, `.gitignore` | Acrescenta build real do aplicativo Node e comando de teste visual. O pacote inclui somente `public`, `api`, `lib`, servidor e metadados gerados; exclui `.env`, banco, arquivos de desenvolvimento e projetos arquivados. Valida sintaxe, inclusive scripts inline, e registra hashes SHA-256. |
| `scripts/account-security.test.js` | Confere bloqueio e o uso de leituras restritas aos campos necessários. |
| `scripts/server-runtime.test.js` | Novos testes HTTP com servidor real: páginas, recursos, autenticação, tamanho de upload, paths privados, destinos proibidos e integridade do pacote. |
| `scripts/stream-runtime.test.js` | Novos testes de streaming com upstream HTTP local: Range, cancelamento e respostas grandes/comprimidas. Apenas o transporte externo é substituído por um servidor de teste. |
| `scripts/ui-regression.mjs` | Corrige inicialização CDP/sessão simulada, remove imposição artificial de tema, verifica Free/VIP/expiração contra cache antigo, destino de navegação e exceções JavaScript. Captura imagens após a transição e restringe a limpeza ao perfil temporário criado pelo teste. |
| `AUDITORIA-FINAL.md` | Relatório e critérios de liberação. |

A correção de streaming segue a distinção documentada entre o evento `close` da requisição e o fechamento do socket: [documentação HTTP do Node](https://nodejs.org/api/http.html#event-close_3).

## Evidências executadas

| Verificação | Resultado e alcance |
| --- | --- |
| `node --test scripts/*.test.js` | **103 testes passaram.** Inclui perfil/nickname, oito temas, histórico/progresso, contas/VIP, regras representativas, segurança, estrutura Android e HTTP. Os testes Firebase dessa suíte utilizam simulações; não são gravações no banco real. |
| `node --test windows-app/test/*.test.js` | **10 testes passaram.** Isolamento do renderer, navegação, autorização do servidor local, proxy e empacotamento configurado. |
| `npm run test:ui` | **60 combinações** de dez rotas/estados em seis resoluções, de 320 a 3840 px. Verificou ausência de overflow lateral, navegação, cabeçalhos, Drawer, dropdown e modais. Também verificou Conta nos estados Free, VIP expirado e VIP sem expiração. **Zero exceções JavaScript não tratadas no cenário simulado.** |
| `npm run check` | Sintaxe do servidor aprovada. |
| `npm run security:preflight` | Verificação local de configuração/regras aprovada. Não confirma regras implantadas. |
| `npm run build` | Pacote Node produzido: **67 arquivos de origem e 46 scripts validados**, além de package.json e manifesto gerados. Não há etapa de transpilar neste projeto de JavaScript puro. |
| HTTP contra o pacote produzido | **6 testes passaram**, incluindo as sete páginas, assets, APIs negando acesso anônimo, proteções de caminhos/upload e conferência de todos os hashes do manifesto. |

Saídas disponíveis em `.cache/final-web-tests.txt`, `.cache/final-desktop-tests.txt`, `.cache/final-build-tests.txt` e `.cache/final-ui-tests.txt`. Evidências visuais: `.cache/ui-regression/`; o arquivo `runtime-errors.json` contém `[]`.

O diretório exato do último pacote e seus hashes estão em `.cache/production-build.json`. Cada build cria uma pasta nova em `dist/web-*`, sem apagar builds anteriores. Para executar, use `node <pasta-do-build>/server.js` e forneça as configurações do serviço pelo ambiente. Esse pacote é destinado ao servidor Node; não é um instalador Windows/Android nem um deploy automático Vercel/Firebase.

## Integrações preservadas e limites da validação

- Perfil: testes confirmam escrita/erro/rehidratação do nickname e preferências no código de acesso ao banco.
- Temas: testes confirmam as oito cores, precedência do VIP sobre o global, retorno do Free ao global e reabertura/sincronização em clientes simulados. O Chrome exercitou o tema da sessão na interface.
- Reprodução: testes confirmam cálculo por segundos/duração, retomada, identidade de usuário/perfil/episódio, fila de sincronização e manutenção de progresso. O teste HTTP cobre transporte de mídia; não equivale a assistir a episódios dos provedores externos.
- Conta/VIP: testes confirmam interpretação canônica do plano e expiração, rejeição de escalada de privilégio e revogação/bloqueio. A interface foi exercitada com dados simulados, sem sessão Firebase real.

## Pendências que impedem aprovar o lançamento

1. **Firebase real:** não havia uma sessão autenticada de teste utilizável nesta auditoria. Falta comprovar gravação/leitura de nickname, tema e histórico no projeto real, reabertura e sincronização entre dois dispositivos, além de logout/revogação, verificação de e-mail e redefinição de senha. Nenhum envio real de e-mail foi executado.
2. **Regras:** não foram compiladas no emulador nem publicadas nesta execução. Java/Firebase CLI não foram encontrados no ambiente consultado. A avaliação local de expressões não substitui o compilador nem testes contra o RTDB. A documentação do Firebase recomenda [testar as regras no Emulator Suite antes da publicação](https://firebase.google.com/docs/rules/emulator-setup). Confirmar o administrador existente, validar as regras e publicá-las **antes** das APIs/clientes que dependem de `revokedSessions`.
3. **Serviços externos:** confirmar no ambiente de hospedagem Firebase, R2, Gemini e origens do catálogo/player. Faltam upload real, resposta autenticada de IA e reprodução/seek de um episódio real. Provedores em iframe sem comunicação de tempo não permitem comprovar progresso/retomada exatos.
4. **Histórico Free:** a restrição anterior de histórico em nuvem ao VIP foi mantida; o Free continua com histórico local. Se a sincronização em nuvem também for requisito para Free, isso permanece pendente e exige alinhar código e regras.
5. **Sessões antigas:** registros sem `authTime` precisam passar pelo cliente atualizado para permitir revogação pelo novo mecanismo. Logins da mesma conta no mesmo segundo compartilham `auth_time` e podem ser encerrados juntos.
6. **Empacotamentos e desempenho:** instaladores Windows/Android não foram compilados nesta auditoria do site. Não houve teste de carga, Lighthouse ou aparelhos físicos; a imagem principal de login permanece próxima de 1,96 MB. Não foi feita compressão visual ou redesenho.

Os relatórios anteriores `ACCOUNT-SETTINGS-VALIDATION.md`, `THEMES-VALIDATION.md`, `PLAYBACK-VALIDATION.md` e `ACCOUNT-SECURITY-VALIDATION.md` detalham as correções anteriores. O resultado desta auditoria comprova o funcionamento local dos cenários listados, mas as pendências de Firebase e serviços reais precisam ser encerradas antes da liberação pública.
