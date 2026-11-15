# Temas — correção e validação

## Causas

- Free era forçado para azul em três pontos, ignorando `dk_broadcast/config/forcedTheme`.
- O botão aplicava uma escolha local, disparava uma gravação por evento e depois disparava outra gravação explícita.
- A hidratação regravava personalização durante a abertura de páginas, podendo promover um cache antigo ou um tema padrão.
- Alguns detalhes de CSS usavam azul literal em vez das variáveis compartilhadas.

## Comportamento corrigido

O tema global possui cache separado. Usuários Free e visitantes seguem o administrador; VIP com preferência salva usa a própria cor. VIP sem preferência usa o global. Uma escolha explícita de Azul também prevalece sobre o global. Perder VIP não apaga a preferência pessoal; recuperar VIP permite usá-la novamente.

Aplicar tema executa uma única atualização autenticada da conta. A sessão central usa PATCH HTTPS e leitura GET de confirmação; o tema efetivo deriva do estado remoto. Preferências continuam em `users/{uid}/profileCustomization/{profileId}/theme`, com o espelho em `profiles/{key}/theme`. Nenhuma regra de acesso foi alterada.

Abertura de telas não grava a preferência de tema. Alterar banner não altera tema. Eventos de sessão, plano, tema global, navegação e mudanças em outras abas recalculam a cor efetiva. O listener global também tem leitura HTTPS alternativa quando o transporte em tempo real demora.

Drawer, botões, modais, logos e detalhes de interface usam as variáveis de tema compartilhadas. Layout, dimensões e efeitos foram mantidos. Os scripts possuem nova versão nas páginas para invalidar caches antigos.

## Testes

`node --test scripts/*.test.js`: 87 testes aprovados.

Os testes de tema executam os scripts reais em contexto de navegador simulado e verificam as oito cores, uma gravação por aplicação, reabertura sem cache, atualização remota de sessão, prioridade VIP/global, downgrade e upgrade, falha de permissão e isolamento entre banner e tema. A suíte também verifica sintaxe, scripts inline e regressões existentes.

Não houve validação visual em navegador nem gravação autenticada no Firebase de produção: não há sessão de teste acessível neste ambiente. Os testes de persistência usam respostas simuladas do serviço de conta. Nenhum dado de produção foi modificado. A confirmação de ponta a ponta entre dois dispositivos reais permanece pendente.
