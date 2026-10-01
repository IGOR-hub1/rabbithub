/* RabbitHub • projeto Firebase exclusivo para perfis públicos e comentários.
 *
 * Projeto esperado: chat-4c99e.
 * Copie a configuração do aplicativo Web em:
 * Firebase Console > chat > Configurações do projeto > Geral > Seus apps.
 * A URL do Realtime Database deve ser copiada da tela do próprio banco,
 * pois ela muda conforme a região escolhida.
 *
 * A apiKey do Firebase Web identifica o projeto e pode ficar no cliente.
 * Senhas, e-mails e hashes nunca devem ser adicionados a este objeto/banco.
 */
window.DK_SOCIAL_FIREBASE_PROJECT_ID = 'chat-4c99e';

window.DK_SOCIAL_FIREBASE_CONFIG = window.DK_SOCIAL_FIREBASE_CONFIG || {
  apiKey:'AIzaSyBHtTwz1ci2Y4FVzsIVb7zjCg3QuKvKjjc',
  authDomain:'chat-4c99e.firebaseapp.com',
  databaseURL:'https://chat-4c99e-default-rtdb.firebaseio.com',
  projectId:'chat-4c99e',
  storageBucket:'chat-4c99e.firebasestorage.app',
  messagingSenderId:'496931086245',
  appId:'1:496931086245:web:56c0cf3dba46cc57e6d24c',
  measurementId:'G-3SZ3V0WT69'
};

/* Nunca grave dados sociais no Firebase principal em produção. Para um
 * teste local deliberado, defina true ANTES de carregar este arquivo. */
if (typeof window.DK_SOCIAL_TEST_FALLBACK !== 'boolean') {
  window.DK_SOCIAL_TEST_FALLBACK = false;
}

/* Contatos usados até que os endereços sejam publicados pelo painel admin. */
window.DK_SUPPORT_CONTACTS = window.DK_SUPPORT_CONTACTS || {
  instagramUrl:'',
  whatsappUrl:''
};
