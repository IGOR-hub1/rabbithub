# Draksyon — Autenticação, Perfis e Painel Admin (Firebase)

Este pacote adiciona ao Draksyon:

- Registro automático dos usuários no **Realtime Database** ao logar.
- Perfis (`Quem está assistindo?`) salvos no **Realtime Database** por usuário — assim toda vez que o usuário faz login, seus perfis são carregados de volta.
- **Painel admin** em `/admin.html` (sem tela de login, apenas para teste) para gerenciar usuários: banir/desbanir, redefinir senha, deletar registro do banco, excluir perfis individuais.
- Guarda de autenticação que **força logout automático** de usuários banidos.

## Como funciona

Estrutura no Realtime Database (projeto `animes-64408`):

```
/users/{uid}/
    email:        string
    displayName:  string
    photoURL:     string | null
    createdAt:    timestamp
    lastLoginAt:  timestamp
    banned:       bool
    profiles/
        {profileId}/
            name:      string
            createdAt: timestamp
```

## Configuração no Firebase

1. **Authentication → Sign-in method** → habilite **E-mail/Senha**.
2. **Realtime Database → Regras** (modo teste — libera leitura/escrita para o app):

```json
{
  "rules": {
    "users": {
      ".read": true,
      "$uid": {
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

> ⚠️ Estas regras permitem ao **painel admin (sem login)** ler tudo em `/users`.
> Cada usuário só pode escrever no seu próprio nó. Para produção, restrinja a leitura a admins reais.

## Rodando

```bash
node server.js
```

- Site: <http://localhost:8080/>
- Painel admin: <http://localhost:8080/admin.html>

## Limitações do painel admin (modo teste)

- **Deletar conta do Firebase Auth** exige o **Admin SDK** (backend com service-account key). O botão *"Deletar registro"* remove apenas o nó `/users/{uid}` — o usuário conseguiria logar novamente e recriaria o registro. Para bloqueio permanente, use **Banir**.
- Como não há tela de login no painel, qualquer pessoa com a URL pode operá-lo — use apenas em ambiente local/de teste.
