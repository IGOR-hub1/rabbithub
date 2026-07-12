/* =====================================================================
 * DRAKSYON • Configuração do Backend (LunesHost)
 * ---------------------------------------------------------------------
 * Preencha BACKEND_URL com a URL pública do seu servidor Node rodando
 * na LunesHost. Exemplo:
 *   window.BACKEND_URL = 'https://meu-servidor.luneshost.com';
 *
 * O frontend (este pacote de HTMLs) pode ficar hospedado gratuitamente
 * no Vercel/GitHub Pages. Todas as chamadas de /proxy, /stream e
 * /admin-api serão redirecionadas para o BACKEND_URL abaixo.
 * ===================================================================== */
(function () {
  window.BACKEND_URL = 'https://node62.lunes.host:3224.luneshost.com'; // <-- EDITE AQUI
  // Compat: usado por site-integration.js
  if (!window.DK_ADMIN_API_BASE) {
    window.DK_ADMIN_API_BASE = window.BACKEND_URL;
  }
})();
