# Histórico e progresso — validação

Relatório da implementação anterior. A validação atual, com reprodução real no Chrome e sincronização para Free/VIP, está em [PLAYBACK-VALIDATION-20261115.md](PLAYBACK-VALIDATION-20261115.md).

## Correções

- A página de detalhes gravava `progresso: 5` em dois handlers de clique, antes da reprodução. Essas gravações foram removidas.
- O progresso deriva da posição e duração informadas pelo vídeo. Registros antigos sem tempo medido não são usados para inventar uma posição a partir da porcentagem.
- O player salva posição fracionária, duração, anime, episódio, temporada, porcentagem e data. Histórico e posição são atualizados juntos, por PATCH autenticado, nos caminhos `users/{uid}/profileHistory/{profileId}/{episodeKey}` e `users/{uid}/profileProgress/{profileId}/{episodeKey}`.
- Uma fila por conta e perfil agrupa as atualizações periódicas, mantém alterações pendentes em armazenamento local e tenta novamente ao recuperar conexão ou reabrir o perfil. Pausa, saída, ocultação e conclusão solicitam sincronização. Uma interrupção abrupta ainda pode impedir o último envio; nesse caso a fila é recuperada quando o mesmo perfil volta a ser aberto.
- As chaves usam anime, temporada e número do episódio, com compatibilidade para índices antigos. Duplicatas reconhecidas do mesmo episódio são consolidadas sem confundir temporadas ou perfis.
- O diálogo oferece continuar ou começar do início. O player nativo mantém a precisão da posição salva e só reproduz após confirmar o seek. Uma falha mantém o diálogo, sem fingir retomada.
- Reinício em zero é persistido junto ao histórico. A leitura remota respeita reinícios mais recentes. A tela de histórico recebe alterações remotas enquanto está aberta e deixa de considerar 98% como conclusão.
- CSS e layout foram preservados; apenas os rótulos dos dois botões de decisão foram explicitados. Os scripts modificados receberam nova versão de cache.

## Política de plano

Foi mantida a política existente: progresso e histórico na nuvem são VIP; contas Free continuam com histórico e retomada locais. A pergunta sobre ampliar a sincronização para todas as contas não recebeu resposta específica. Nenhuma regra de acesso foi alterada ou publicada.

## Testes executados

- Suíte completa: 92 testes aprovados.
- Depois do último ajuste de identificação de episódios: 51 testes focados aprovados.
- Cobertura: porcentagem real substituindo 5%, posição de 300,375 segundos, gravação atômica de histórico e posição, segundo cliente sem cache, isolamento de perfis, reinício, falha de rede, fila após reabertura, migração de duplicatas, temporadas especiais, links compartilhados, URL de retomada do histórico e seek rejeitado.
- Testes do código do player com vídeo/DOM simulados confirmam a retomada de 30,375 segundos e o protocolo de mensagens de iframe. A sintaxe e os demais testes do projeto também passaram.

## Limitações verificadas

O serviço de acesso ao navegador está indisponível e não há conta de teste autenticada acessível. Não foi executada reprodução real, inspeção visual ou gravação autenticada no Firebase de produção. Os testes de sincronização usam um serviço de conta simulado; não comprovam as regras publicadas ou a integração de ponta a ponta em produção.

Vídeos externos em iframe só fornecem posição e permitem seek quando implementam uma API compatível. Não é possível medir ou controlar o vídeo de outra origem sem esse suporte. O código evita gerar porcentagem fictícia e não confirma retomada sem resposta do provedor.

Dados antigos que contêm somente os 5% artificiais não permitem recuperar quanto foi realmente assistido. A próxima reprodução passa a registrar o tempo medido.
