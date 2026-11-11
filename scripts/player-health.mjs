import { createRequire } from 'node:module';

const id = String(process.argv[2] || '').trim();
const season = String(process.argv[3] || '1').trim();
const episode = String(process.argv[4] || '1').trim();
if (!/^\d+$/.test(id) || !/^\d+$/.test(season) || !/^\d+$/.test(episode)) {
  throw new Error('Use: node scripts/player-health.mjs <tmdb> [temporada] [episodio]');
}

let tokenRequestedForOwnProxy = false;
const authUser = {
  emailVerified:true,
  async getIdToken() { tokenRequestedForOwnProxy = true; return 'diagnostico-local-sem-transmissao'; }
};
globalThis.firebase = {auth() { return {currentUser:authUser}; }};
globalThis.RabbitHubSession = {
  async ready() { return {status:'authenticated',ready:true,authUser}; }
};

const require = createRequire(import.meta.url);
const adapter = require('../public/meusanimes.js');
const serviceIframe = `https://serv01.meusdoramas.club/#/video/${id}/${season}/${episode}/`;
const startedAt = Date.now();
const provider = await adapter._test.resolveServiceProvider(serviceIframe);
console.log(JSON.stringify({
  serviceIframe,
  coordinates:adapter._test.serviceCoordinates(serviceIframe),
  provider,
  providerIsIntermediate:adapter._test.isIntermediatePlayer(provider),
  elapsedMs:Date.now()-startedAt,
  tokenRequestedForOwnProxy
}, null, 2));
