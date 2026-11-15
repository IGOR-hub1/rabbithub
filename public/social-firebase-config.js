/*
 * Compatibilidade: a camada social agora usa o Firebase principal
 * animes-64408 por meio de social-firebase.js. O projeto chat-4c99e não é
 * inicializado pelo site porque os tokens de Auth não atravessam projetos.
 */
window.DK_SOCIAL_FIREBASE_PROJECT_ID='animes-64408';
window.DK_SOCIAL_TEST_FALLBACK=false;

window.DK_SUPPORT_CONTACTS=window.DK_SUPPORT_CONTACTS||{
  instagramUrl:'',
  whatsappUrl:''
};
