# Histórico e retomada — 15/11/2026

## Causa confirmada no localhost: relógio adiantado

Na investigação de Radiant Dublado, o horário local estava aproximadamente **10.804 segundos (3 horas) adiantado** em relação às respostas HTTPS de dois servidores Google. O backend comparava `exp` dos tokens Firebase com `Date.now()` local e rejeitava tokens dentro do prazo do emissor. Um teste negativo no processo original confirmou HTTP 401 “Sua sessão expirou” antes da verificação de assinatura.

`lib/firebase-auth.js` agora obtém a referência temporal dos cabeçalhos `Date` e `Age` da resposta HTTPS dos certificados Google, avançando essa referência por relógio monotônico. A hora não é derivada de dados do cliente ou do JWT. Assinatura, projeto, identidade, expiração real, e-mail verificado, bloqueio e revogação continuam obrigatórios. Data de servidor inválida causa recusa, sem liberar acesso. O relógio do Windows não foi alterado.

O servidor da porta 8080 foi reiniciado com a correção. O mesmo teste negativo passou a chegar à checagem de assinatura, retornando corretamente HTTP 401 “Assinatura da sessão inválida”, sem conceder acesso ao token de teste. **132 testes passaram**, incluindo seis regressões para relógio adiantado/atrasado, mudança do horário do sistema, expiração real, assinatura e revogação. A referência de validação está documentada em [Firebase: verificar tokens de ID](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

Os parágrafos abaixo registram as etapas anteriores da investigação; a causa de rejeição temporal do backend foi confirmada posteriormente, conforme esta seção.

**Status após novo teste do usuário:** a sessão pessoal ainda apresentou “Não foi possível preparar o vídeo”. A correção não está confirmada nessa sessão. Os testes isolados abaixo permanecem válidos, mas não comprovam o funcionamento da autorização do proxy com a conta real.

A versão 4.9.9 conserva o status e o motivo de falhas do proxy, antes descartados e substituídos por um timeout genérico. Também renova o token uma vez após HTTP 401 e limita a espera pelo token. Os três testes novos passaram (126 no total). A consulta pública com os mesmos cabeçalhos do servidor encontrou fontes válidas, e `/stream` respondeu HTTP 206 em 360p e 720p. Aguarda-se o erro detalhado da sessão afetada para determinar a causa, sem remover autenticação ou restrições do Firebase.

Implementação local verificada com o player nativo e com o episódio real **Dreamland, temporada 1, episódio 1**, indicado pelo usuário no localhost. Não houve publicação do site, alteração de dados de contas reais ou publicação das regras Firebase.

## Investigação do episódio informado

O episódio usa a cadeia Meus Animes → `serv01.meusdoramas.club` → Blogger → MP4 do Googlevideo. Os endereços MP4 válidos respondem com HTTP 206 e são reproduzíveis pela rota `/stream` do servidor em `localhost:8080`.

- O leitor antigo procurava extensões/`videoplayback` em qualquer parte de uma string, aceitando também a URL do wrapper HTML com outra URL embutida e o endpoint SABR/UMP, que não é um MP4. A versão 4.9.8 valida o caminho da URL e os formatos progressivos do Googlevideo, decodificando os delimitadores HTML antes da extração.
- A espera de 18 segundos pela resolução era menor que duas tentativas do proxy de até 15 segundos cada. Uma resposta válida tardia era descartada e a tela passava ao iframe. A espera agora cobre a segunda tentativa (45 segundos); Blogger não é mais usado como fallback silencioso porque não implementa o protocolo de tempo/seek `player.js` usado pelo aplicativo.
- Se todas as URLs assinadas forem rejeitadas, o player solicita URLs novas uma vez, preservando a posição real. Se a fonte continuar indisponível, mostra o erro e “Tentar novamente”, em vez de reproduzir num iframe sem histórico.
- Uma camada visual sobre um iframe de outro domínio não oferece acesso a `currentTime`. Neste episódio, os controles existentes do X-Bunny envolvem um `<video>` nativo, que fornece os tempos reais. Não há cronômetro simulado.

O leitor antigo também passou no teste com resposta rápida: portanto, a classificação incorreta de fontes não é, sozinha, prova da causa na sessão pessoal do usuário. O caminho de descarte por atraso foi identificado no código e a versão corrigida foi validada com atraso adicional deliberado de 19 segundos. O conector não conseguiu acessar a aba pessoal; a autenticação do teste é isolada. Também foi confirmado por comparação de conteúdo que os quatro scripts/HTML principais servidos em `localhost:8080` correspondem aos arquivos desta pasta.

### Evidência com Dreamland real

`node scripts/history-browser.mjs --dreamland --slow-source` usa o adaptador real, página real do episódio, detalhes/capa reais, API real do intermediário, HTML real do Blogger e a rota real `/stream` de `localhost:8080`. A identidade, a nuvem offline e o feed da Home são isolados no teste. O transporte de HTML do teste consulta as fontes públicas sem alterar ou remover a autenticação do `/proxy` de produção.

- Vídeo 1280×720, duração 1.380,008345 s, nenhum iframe externo.
- Reprodução contínua por mais de 31 s, sem usar seek como substituto da espera: pausa em 31,013234 s e gravação em 31,013 s.
- Histórico com **1 item**, capa real, Dreamland, T1/EP1, barra **2,24731%** e link de retomada.
- Clique real em “Continuar”, seek confirmado com diferença inferior a 0,05 s e mais seis segundos de reprodução.
- Atualização durante a reprodução: registro preservado em **37,472 s**, diálogo aberto novamente e posição não sobrescrita por zero.
- Reinício explícito, isolamento de UID/perfil e fechamento/reabertura da aba também passaram.
- Relatório e capturas: `.cache/history-dreamland/report.json`, `01-playback.png`, `02-history.png`, `03-resume.png`, `04-after-reload.png`.

O comando `node scripts/history-browser.mjs --dreamland --reject-first-sources --quick` também passou: os dois primeiros links de mídia foram rejeitados com HTTP 403; uma segunda consulta ao Blogger renovou as fontes e iniciou o vídeo real em 720p, sem iframe. Histórico, retomada, atualização e reabertura passaram novamente. Evidências em `.cache/history-dreamland-renewal`.

## Falhas identificadas e corrigidas

- `dk:userready` reconstruía o Perfil mesmo com a subtela Histórico aberta, removendo a tela. A falha apareceu durante o teste em Chrome. Agora a subtela permanece aberta e relê os dados atuais.
- A inspeção visual e o teste com mouse identificaram controles de retomada com `visibility:hidden` mesmo após o diálogo abrir. A visibilidade do diálogo e de seus filhos é explicitada depois do boot, preservando a proteção da tela de inicialização. A retomada passou a ser testada por eventos reais de mouse, além da posição do vídeo.
- A tela mantinha uma cópia de `hist` e podia reaplicar uma lista vazia de uma leitura remota antiga. Cada renderização passa a ler o histórico local atual; o timeout também devolve a versão atual.
- A retomada podia aguardar indefinidamente `readAccount()`/token, mantendo `resumeDecisionPending` ativo e impedindo o salvamento. Dados locais são usados imediatamente; leituras de retomada têm prazo de 2,5 segundos, e a obtenção de token tem timeout.
- O player podia fixar UID/perfil provisórios antes da autenticação e depois rejeitar todos os salvamentos por divergência de contexto. A identidade só é fixada com sessão autenticada; a chegada tardia da sessão inicia a retomada.
- Um registro com `resetAt` antigo podia substituir uma posição válida por zero. Somente um reinício explícito ou remoto mais recente autoriza esse comportamento.
- A gravação local aguardava a Promise da sincronização; a API alternativa de progresso podia não salvar localmente sem o serviço central. Ambos os caminhos agora persistem localmente antes de qualquer operação de rede.
- A sincronização era VIP no frontend e nas regras. Os arquivos agora permitem histórico/progresso para Free e VIP, preservando autenticação, propriedade da conta, e-mail verificado e restrições de sessão.

## Comportamento atual

O primeiro avanço real do vídeo cria o registro. O player salva `currentTime`, `duration`, anime, título, capa, temporada, episódio e data a cada 5 segundos, além de pausa, seek concluído, término, `visibilitychange`, `pagehide` e `beforeunload`. O registro é único por anime/temporada/episódio. Não é fabricado progresso de 5%.

O localStorage usa `rh_profile_history_v3_<UID codificado>|<perfil codificado>` e a fila `rh_playback_pending_v2_<UID codificado>|<perfil codificado>`, evitando colisões entre pares de UID/perfil. Há migração dos caches e filas anteriores já associados à conta/perfil; o histórico global sem dono conhecido não é atribuído a uma conta arbitrária. A fila também permite recuperar registros se o cache principal estiver ausente.

A sincronização é executada em segundo plano por PATCH autenticado em `users/{uid}/profileHistory/{profileId}/{episodeKey}` e `profileProgress/{profileId}/{episodeKey}`. Falhas mantêm a fila local; reconexão, reabertura e troca de perfil tentam enviá-la novamente. Uma troca de conta entre enfileirar e enviar não pode redirecionar a escrita ao novo UID. Leituras remotas mesclam os dados atuais, sem apagar o progresso local mais recente.

O diálogo exibe **“Deseja continuar de onde parou?”**, com **Continuar** e **Começar do início**. A retomada usa os segundos fracionários salvos depois de `loadedmetadata` e aguarda confirmação do seek antes de reproduzir. CSS e layout foram preservados.

## Verificação reproduzível

- `npm test`: **123 testes aprovados**, incluindo falha de rede, escrita pendente, dois clientes com caches separados, isolamento por UID/perfil, colisões de chaves, migração, reinício, troca de conta durante envio, sessão tardia e extração do HTML atual do Blogger. No Windows com política restrita para scripts PowerShell, use `npm.cmd test`.
- `npm run test:history`: Chrome/Brave headless em perfil temporário isolado. O teste carrega os HTML/JS reais do aplicativo, gera um WebM VP8 de 90 segundos e deixa o elemento `<video>` reproduzir por mais de 31 segundos de tempo real, sem saltar o tempo para substituir a reprodução.
- O percurso verifica salvamento periódico e na pausa; navegação para Histórico com capa/título/episódio/porcentagem/barra; diálogo e seek exato; mais 6 segundos de reprodução; recarregamento enquanto reproduz; reinício explícito; separação de perfis/UIDs; troca para episódio 2; fechamento e reabertura da aba.
- O teste de navegador deixa a leitura de nuvem pendente e rejeita escritas para verificar a independência do localStorage. Autenticação, catálogo e nuvem são fixtures; vídeo, relógio, eventos de mídia, páginas, localStorage e navegação são reais.
- Evidências: `.cache/history-browser/report.json`, `01-playback.png`, `02-history.png`, `03-resume.png`, `04-after-reload.png`. O relatório JSON registra tempos e resultados de cada etapa.
- `npm run build`: valida sintaxe dos scripts e empacota os arquivos de runtime.

## Limitações e publicação

As regras em `API ANIMES E CHAT/database.rules.json` foram alteradas somente no projeto. Para habilitar a sincronização de contas Free no banco publicado, publique essas regras conforme `PUBLICAR-REGRAS-FIREBASE.md`. Até isso acontecer, uma recusa do Firebase preserva o histórico e a fila locais. A sincronização entre dois dispositivos autenticados no Firebase de produção não foi executada; os testes de dois clientes usam o serviço de conta simulado. Dreamland foi validado com mídia real; a sessão autenticada pessoal do usuário não foi acessada.

Um iframe de outro domínio que não exponha os eventos e comandos compatíveis de `player.js` não permite ao site obter `currentTime`/`duration` ou confirmar seek. A resolução de mídia direta existente continua sendo preferida; para iframes compatíveis há consulta periódica e salvamento dos tempos informados pelo provedor. Não é inventado tempo para provedores incompatíveis. Eliminar essa limitação exige uma fonte de mídia acessível ao player nativo ou uma API oficial do provedor.

Encerramento abrupto pode impedir o último evento de saída: permanece a última posição persistida, normalmente com até 5 segundos de diferença em reprodução ativa. Limpeza manual de dados do navegador e o fluxo explícito existente de logout apagam os dados locais. Registros antigos com apenas os 5% artificiais não permitem reconstruir segundos nunca medidos.

Referências técnicas: [persistência offline do Firebase Web](https://firebase.google.com/docs/database/web/offline-capabilities) e [evento loadedmetadata](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/loadedmetadata_event).
