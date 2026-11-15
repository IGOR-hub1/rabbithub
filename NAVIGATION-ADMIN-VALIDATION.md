# Navegação e acesso administrativo — correção de 14/11/2026

Correções locais implementadas. Nenhum dado de produção ou regra Firebase foi alterado/publicado. O desenho das páginas foi preservado; a tela de inicialização ganhou uma ação de tentar novamente em caso de conexão inconclusiva.

## Causas identificadas

1. **URL e aba divergentes:** o Drawer chamava `renderMain('home')`, mas mantinha `?tab=perfil` na URL. Uma atualização carregava novamente o Perfil.
2. **Inicialização atrasada:** a conclusão de `RabbitHubFeatures.ready()` podia executar `renderMain(_initialTab)` depois de uma navegação manual. A aba inicial antiga prevalecia sobre a escolha recente.
3. **Liberação prematura da interface:** `requestAnimationFrame(finishAppBoot)` passava o timestamp como argumento `force`. Esse número era interpretado como verdadeiro e ignorava as esperas de autenticação, perfil e preferências.
4. **Atualizações redundantes:** notificações do histórico sem mudança real podiam reconstruir o Perfil. Havia também callbacks de Perfil já agendados que não conferiam novamente a aba atual.
5. **Admin:** a abertura exigia regravar campos administrativos no cadastro mesmo quando `admins/<uid>` já estava confirmado. O login acessado pelo bloqueio do painel não preservava `next=admin.html`. A verificação dependia de leituras SDK e não renovava explicitamente as informações de verificação/token antes de consultar permissões.

## Alterações

- `public/index.html`: URL acompanha a aba, Home remove `tab=perfil`, suporte a voltar/avançar, inicialização única que respeita navegação manual, proteção de callbacks tardios e correção de referências fora do escopo na atualização do diálogo Conta.
- `public/theme.js`: callback de animação não força liberação; removido atraso mínimo artificial; conexão inconclusiva permite tentar novamente na mesma rota sem revelar a página privada. As rotas com e sem `.html` são reconhecidas.
- `public/user-session.js`: geração de autenticação impede que rejeições antigas sobrescrevam uma sessão nova; refresh não reconecta a conta anterior depois de troca de usuário.
- `public/auth-guard.js`: tratamento consistente de aliases e barras finais de login/admin, preservando os controles de sessão existentes.
- `public/profile-data.js`: liberação visual após o perfil autenticado já estar disponível, sem aguardar sincronizações secundárias; não dispara reconstrução do histórico quando os dados são iguais.
- `public/user-features.js`: utiliza preferências já recebidas no snapshot autenticado, evitando uma nova leitura/gravação de inicialização desnecessária.
- `public/admin.html`: renova usuário/token, consulta permissões pelo REST oficial autenticado com timeout, recusa conta bloqueada/sem permissão e resultados de sessões antigas. Administradores com marcador confirmado entram sem regravar o perfil. Só o proprietário já previsto nas regras pode criar seu próprio marcador ausente, com confirmação de leitura. Login retorna ao painel. Erros exibem a causa recebida, sem bypass local.
- `public/login.html`, `public/perfis.html`, `public/detalhes.html`, `public/player-animes.html`, `public/chat.html` e as duas páginas acima: versões dos scripts atualizadas para invalidar cache antigo.
- `scripts/navigation-regression.test.js`: novos testes de rotas, corrida da inicialização, bloqueio de boot, concorrência de autenticação, administração e notificações redundantes.
- `scripts/ui-regression.mjs`: percursos de navegação, reload confirmado em novo documento, reabertura de aba e cenários administrativos em Chrome com Firebase simulado.
- `scripts/security-audit.test.js`, `scripts/site-features.test.js`: expectativas atualizadas para o marcador administrativo e versões dos scripts.

## Testes executados

| Verificação | Resultado |
| --- | --- |
| `node --test scripts/*.test.js` | **111 testes aprovados**, incluindo as regressões de Firebase, temas, histórico, contas/VIP, navegação e admin. |
| `node --test windows-app/test/*.test.js` | **10 testes aprovados**. |
| `node scripts/ui-regression.mjs` | **Aprovado**, incluindo 60 combinações de páginas/resoluções e os percursos abaixo; zero exceções JavaScript não tratadas na execução final. |
| Perfil → Home → atualizar | Permaneceu na Home; o teste exige um documento novo após o reload. |
| Home → Perfil → Home | Aba e URL permaneceram coerentes. |
| Home → Anime → Player → Perfil | As rotas carregaram sem retorno indevido; detalhes/player utilizaram um anime de teste sem reprodução externa. |
| Player → atualizar | Permaneceu no player, preservando anime, episódio e temporada da URL. |
| Fechar aba e reabrir o site | Player reaberto no mesmo perfil isolado do Chrome, com sessão simulada. |
| Inicialização lenta | Clicar Home antes da conclusão das preferências não voltou ao Perfil. |
| Voltar/avançar do navegador | Aba e URL acompanharam o histórico de navegação. |
| Admin com marcador válido | Painel abriu na execução do HTML real com Firebase simulado. |
| Admin sem permissão / resposta 403 | Painel permaneceu bloqueado e mostrou o erro. |
| `npm run build` | Pacote produzido, 67 arquivos de origem e 46 scripts validados. |
| HTTP do pacote gerado | **6 testes aprovados**, cobrindo páginas, APIs privadas, uploads, caminhos e hashes. |

Registros: `.cache/navigation-all-tests.txt`, `.cache/navigation-ui-tests.txt`, `.cache/navigation-desktop-tests.txt`, `.cache/navigation-build-tests.txt`. O último pacote está indicado em `.cache/production-build.json`.

## Limites e pendências reais

Os testes de navegador utilizam uma sessão controlada e serviços Firebase simulados; os testes de autenticação exercitam o código central com respostas controladas. Não foi possível comprovar a restauração de uma sessão Firebase real após fechar completamente o navegador, nem entrar na conta administrativa real: não há sessão/credenciais de teste autenticadas disponíveis nesta execução. Não houve reprodução de um episódio externo nesta validação de navegação.

Se a conta administrativa continuar recebendo `permission-denied` no ambiente publicado, é necessário conferir as regras efetivamente publicadas e o marcador `admins/<UID>`. O código não contorna essa negativa. Um cadastro antigo que tenha apenas `role: admin`/`isAdmin`, sem o marcador canônico, precisa receber autorização de um administrador já reconhecido; usuários comuns não podem conceder esse acesso a si próprios.

As alterações estão no projeto local e precisam ser publicadas na hospedagem para afetar o site online. Não foi feito deploy nesta execução.
