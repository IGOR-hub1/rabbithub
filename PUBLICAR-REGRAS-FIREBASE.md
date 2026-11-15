# Publicar as regras do X-Bunny Animes

Projeto: **animes-64408**. Banco principal: **animes-64408-default-rtdb**.

## 1. Realtime Database: regras utilizadas pelo site e pelo admin

1. Abra o projeto no Console Firebase.
2. Entre em **Build → Realtime Database → Regras** e confira o banco acima.
3. Abra o arquivo [API ANIMES E CHAT/database.rules.json](API%20ANIMES%20E%20CHAT/database.rules.json) deste projeto.
4. Copie **todo o conteúdo**, incluindo o objeto externo `{"rules": ...}`, e substitua o conteúdo do editor de regras.
5. Clique em **Publicar**. O Console valida a sintaxe ao publicar; se apresentar um erro, guarde o texto e a linha indicada.

Este JSON é de **regras**, não de dados. Não use “Importar JSON” na aba Dados. A publicação das regras não substitui nem apaga contas, histórico ou configurações existentes.

| Caminho | Uso e acesso previsto |
| --- | --- |
| `admins/{uid}` | Marcador administrativo. Conta própria pode consultar seu marcador; administradores autorizados podem gerenciar permissões. |
| `users/{uid}` | Perfil, nickname, dispositivos, preferências e assinatura. Leitura/escrita da própria conta e administração; usuário comum não pode promover a própria conta ou alterar validade/VIP/bloqueio. |
| `users/{uid}/profiles` e `profileCustomization` | Perfis e temas, com restrições de plano existentes. |
| `users/{uid}/profileHistory`, `profileProgress` | Histórico e progresso privados para Free e VIP; escrita da própria conta/admin, mantendo as exigências de autenticação e e-mail verificado. |
| `users/{uid}/animeAlerts`, `backups` | Dados privados, mantendo as restrições VIP atuais do projeto. |
| `revokedSessions/{uid}/{auth_time}` | Encerramento das próprias sessões; o registro de revogação não pode ser apagado pelo cliente. |
| `dk_broadcast/current`, `maintenance`, `config`, `homeFeatured` | Leitura pública necessária à inicialização; alterações administrativas. Contador de visualizações tem regra específica. |
| `dk_broadcast/history` | Comunicados para contas autenticadas e verificadas; gestão administrativa. |
| `dk_broadcast/skipSegments` | Leitura VIP/admin e escrita administrativa. |
| `maintenance` | Compatibilidade com o caminho antigo de manutenção. |
| `notifications/global`, `notifications/user/{uid}` | Avisos globais e avisos da conta. |
| `rhSocialV1` | Chat, perfis públicos, índices de comentários, respostas e denúncias, com permissões por caminho. |
| `chatReports`, `episodeReports` | Envio de denúncias pela própria conta e consulta/gestão pelo admin. |
| `dk_player_health` | Leitura autenticada e contadores de funcionamento do player. |

A raiz continua sem leitura ou escrita pública. Acesso privado exige conta autenticada, e-mail verificado e sessão válida; contas bloqueadas/banidas são recusadas. Os índices incluem `users/email`, `dk_broadcast/history/updatedAt` e `rhSocialV1/userComments/{uid}/{profile}/createdAt`.

## 2. Autorizar sua conta no admin

Publicar regras não transforma uma conta comum em administradora. O painel verifica o marcador **`admins/UID_DA_CONTA = true`** no banco; somente `users/UID/isAdmin` ou um nome de usuário não substitui esse marcador.

1. Em **Authentication → Users**, localize sua conta e copie o **UID** completo.
2. Em **Realtime Database → Dados**, abra ou crie o nó `admins` sem substituir os filhos existentes.
3. Adicione nesse nó um filho cuja chave seja o UID copiado e cujo valor seja o booleano **true**, sem aspas.
4. Confirme que o e-mail da conta está verificado. Entre novamente no site e abra `admin.html`.

Exemplo ilustrativo do caminho: `/admins/UID_COPIADO_DO_AUTHENTICATION` → `true`. Não cole o texto de exemplo como UID nem importe um JSON sobre a raiz.

O código existente também permite a inicialização do marcador pela conta de e-mail verificado `krabelodesouza52@gmail.com`. Para qualquer outra conta administrativa, use o UID real pelo Console conforme acima. Não conceda acesso público para contornar um erro de permissão.

## 3. Firestore e Storage

O fluxo atual usa Realtime Database. Os uploads de perfil usam o backend R2, não Firebase Storage. Os arquivos abaixo mantêm Firestore e Storage fechados, pois não são os serviços usados por esses fluxos:

- [firestore.rules](firestore.rules): cole somente em **Firestore Database → Regras**, caso esse serviço esteja habilitado.
- [storage.rules](storage.rules): cole somente em **Storage → Regras**, caso esse serviço esteja habilitado.

Não é necessário habilitar esses serviços para corrigir o Realtime Database. Não cole o JSON do Realtime Database nos editores de Firestore ou Storage. `firebase.json` já aponta para os três arquivos corretos.

## 4. Conferência após publicar

- Publique também os arquivos corrigidos do site, incluindo `public/admin-database.js` e a versão atual de `admin.html` e `auth-guard.js`; regras não atualizam o código hospedado.
- Com a conta admin verificada, confira carregamento de usuários/configurações e faça uma alteração reversível, recarregando para confirmar a leitura do valor salvo.
- Entre com a mesma conta em outro navegador, encerre essa sessão em Dispositivos conectados e confirme o bloqueio no navegador encerrado.
- Confira que uma conta comum não entra no painel nem altera plano ou permissões administrativas.
- Confira nickname, tema VIP e progresso após recarregar a página.

Os testes locais e o preflight não substituem a validação do compilador do Firebase nem testes autenticados no banco publicado. Nenhuma regra ou dado remoto foi publicado por esta preparação.

Referências oficiais: [sintaxe das regras](https://firebase.google.com/docs/database/security/core-syntax) e [índices do Realtime Database](https://firebase.google.com/docs/database/security/indexing-data).
