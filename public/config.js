/* =========================================================
 * CONFIG • Aponta o site para o backend na LunesHost
 * ---------------------------------------------------------
 * - /proxy? passa pelo FIREBASE (firebase-bridge.js)
 * - /stream? continua indo direto pro backend HTTP abaixo
 *   (vídeo não passa pelo Firebase — arquivo grande demais)
 *
 * Troque a URL abaixo se seu servidor mudar de endereço.
 * ========================================================= */
window.LUNES_BACKEND = "http://node62.lunes.host:3224";
