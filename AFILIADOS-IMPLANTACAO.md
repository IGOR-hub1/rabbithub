# Implantação de parceiros e afiliados

Infraestrutura deste projeto: **Firebase Authentication**, **Realtime Database** (`animes-64408-default-rtdb`) e **API Node.js na Vercel**. Firestore, Firebase Storage e Cloud Functions não são usados nem precisam ser ativados.

## 1. Publicar somente as regras do Realtime Database

Na raiz do repositório, confirme que `.firebaserc` aponta para `animes-64408` e que `firebase.json` contém apenas a seção `database`. Revise `API ANIMES E CHAT/database.rules.json`, pois o deploy substitui as regras atuais do banco, sem apagar os dados.

```powershell
firebase deploy --only database --project animes-64408
```

Se a Firebase CLI não estiver instalada/autenticada, instale-a pelo método oficial e execute `firebase login` antes do comando. Alternativamente, publique o conteúdo completo de `API ANIMES E CHAT/database.rules.json` em **Realtime Database → Regras** no Console. Não use a opção de importar dados JSON. `storage.rules` e `firestore.rules` continuam no repositório, mas não entram no deploy.

## 2. Configurar a API na Vercel

Publique a **raiz deste repositório** no projeto Vercel usado pelo site. `vercel.json` seleciona o preset `Other`, serve os arquivos de `public` e reescreve `/api/affiliates/:action` para a função Node `api/affiliates.mjs`. Não selecione `public` como *Root Directory* do projeto: isso deixaria a função e `vercel.json` fora do deployment. A API não é uma Cloud Function do Firebase.

Configure nas variáveis de ambiente **do servidor**:

| Variável | Necessidade | Valor |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Obrigatória | JSON integral da conta de serviço do projeto `animes-64408`; nunca usar prefixo público ou incluir no frontend. |
| `FIREBASE_PROJECT_ID` | Opcional | Padrão `animes-64408`; deve corresponder a `project_id` da credencial. |
| `FIREBASE_DATABASE_URL` | Opcional | Padrão `https://animes-64408-default-rtdb.firebaseio.com`; se definida, deve ser HTTPS e apontar para uma instância Realtime Database do mesmo projeto. |

A conta de serviço usa OAuth no servidor para chamar o REST do Realtime Database. O navegador usa Firebase Authentication e envia o ID token à API. A API valida o projeto, a sessão e o marcador `/admins/{uid}` para operações administrativas. A ausência ou divergência da credencial faz a API falhar com HTTP 503; não é necessário ativar outros produtos Firebase.

## 3. Conferir o deployment

Publique primeiro em Preview. A partir deste repositório, teste o domínio da Preview e depois o domínio principal:

```powershell
npm.cmd run test:affiliate:deploy -- https://SEU-DOMINIO/
```

O teste exige HTTP 200 para `admin.html`, `affiliates-admin.html`, `affiliate.html` e `simulator-admin.html`, além de **HTTP 401 com JSON** em `/api/affiliates/adminData` sem token. HTTP 404 nessa rota significa que a função ou a configuração de rewrite não foi publicada. Depois, entre com uma conta admin verificada, carregue o painel, crie um link de teste, confira a persistência no Realtime Database e teste a visão de outra conta parceira. Os testes autenticados dependem de credenciais e de um deployment real.

Não publique cobranças reais: compras, comissões financeiras e saques reais permanecem bloqueados até a integração e validação de um gateway. O simulador fica separado dos registros financeiros reais.

Documentação oficial: [deploy parcial do Firebase](https://firebase.google.com/docs/cli#deploy_specific_firebase_services), [regras do Realtime Database](https://firebase.google.com/docs/rules/manage-deploy#realtime_database), [funções Node na Vercel](https://vercel.com/docs/functions/runtimes/node-js) e [rewrites da Vercel](https://vercel.com/docs/routing/rewrites).
