# Draksyon — Alterações (modo teste sem Firebase Authentication)

## O que mudou nesta versão

O **Firebase Authentication foi removido**. Os usuários agora ficam
registrados **apenas no Realtime Database**, em `users/{uid}`.

- `uid` = e-mail normalizado (letras minúsculas, caracteres não alfanuméricos viram `_`).
- A senha é armazenada como `passwordHash` (SHA-256).
- A sessão do usuário fica em `localStorage.dk_session = {uid,email,displayName}`.

> Aviso importante: sem o Authentication real, as senhas ficam **no banco em
> hash SHA-256**, e a segurança depende apenas das regras do Realtime DB
> e do código do cliente. Use somente como teste.

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `login.html` | Cadastro/entrada agora gravam e leem `users/{uid}` no DB. "Esqueci a senha" pede uma nova senha e a grava diretamente. |
| `auth-guard.js` | Não usa mais `firebase.auth()`. Verifica sessão no localStorage e o campo `banned` no DB. |
| `perfis.html` | Lê o UID da sessão em vez do Authentication. Perfis continuam sincronizando em `users/{uid}/profiles`. |
| `admin.html` | Painel funcional sem Auth. Ações: banir/desbanir, redefinir senha (grava novo hash), apagar conta (`remove()` do nó do usuário). |
| `dk-auth-shim.js` (novo) | Emula `firebase.auth()` a partir da sessão para manter compatíveis os módulos `dk-notice`, `dk-realtime`, `site-integration`, `site-status` etc. sem alterar seu código. |
| `index.html`, `detalhes.html`, `player-animes.html` | Trocaram `firebase-auth-compat.js` por `dk-auth-shim.js`. |

## Regras sugeridas do Realtime Database (modo teste)

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Em produção você precisará restringir; sem Authentication não há `auth.uid`
disponível nas regras.

## Fluxo resumido

1. Usuário cria conta em `login.html` → registro em `users/{uid}` com
   `passwordHash` e `banned=false`.
2. Login checa hash, checa `banned`, grava `dk_session` no localStorage.
3. `auth-guard.js` roda em cada página, revalida `banned` no DB e redireciona
   se necessário.
4. `perfis.html` sincroniza a lista de perfis em `users/{uid}/profiles`.
5. `admin.html` (sem login) gerencia todos os usuários.
