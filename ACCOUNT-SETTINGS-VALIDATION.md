# Configurações da conta — 14/11/2026

## Correções

- A sessão oferece uma gravação autenticada por HTTPS (PATCH em `users/{auth.uid}`), renova o token e relê a conta antes de atualizar o estado compartilhado. Isso atende também às conexões em que a leitura REST funciona, mas o transporte do SDK demora. Há limite de tempo e tratamento de permissão negada.
- Nickname, bio, avatar, personalização, preferências e gravação do backup usam essa operação. As alterações são parciais: não substituem a conta nem os planos. A edição de perfil preserva as chaves originais e os demais perfis.
- A foto escolhida na tela principal agora é gravada no perfil privado, além do espelho público. A bio é escrita também no perfil canônico; uma bio vazia permanece vazia.
- Preferências só atualizam o cache depois da confirmação; falhas são exibidas. Falhas de tema restauram o tema anterior. Falhas dos espelhos de nickname são distinguidas da gravação da conta.
- Sessão e caches são reconstruídos com os dados remotos ao reabrir. As referências aos scripts foram versionadas para invalidar versões antigas em cache.
- Nenhuma regra de acesso foi enfraquecida ou publicada. Nenhum dado existente foi alterado em produção. Nenhuma alteração de CSS/design.

## Validação executada

- `node --test scripts/*.test.js`: 85 testes.
- Fluxos simulados de PATCH seguido de GET, reabertura com cache antigo, permissão negada, preservação de plano e outros perfis, nickname, avatar, bio vazia e preferências.
- Sintaxe dos scripts e scripts inline, regras locais e verificações de segurança cobertas pela suíte.
- Corrigidos caminhos relativos antigos no teste de progresso para que a suíte rode a partir da raiz do projeto.
- Consulta HTTPS real a um caminho privado de teste sem autenticação: HTTP 401, `Permission denied`.

## Limite da validação

Não foi possível executar uma gravação autenticada seguida de leitura no Firebase real: não há sessão de teste ou navegador acessível neste ambiente. Os testes de sucesso usam respostas simuladas; eles não certificam as regras atualmente publicadas ou o funcionamento de ponta a ponta em produção. Ainda é necessário validar com uma conta de teste de e-mail verificado: alterar nickname, bio, foto e preferências, recarregar e reabrir o site, verificar os dados e restaurar os valores de teste. A interface também não foi inspecionada visualmente no navegador.

Referência técnica consultada: [Firebase — leitura, gravação e confirmação das operações](https://firebase.google.com/docs/database/web/read-and-write). Eventos locais do SDK podem ocorrer antes da confirmação no servidor.
