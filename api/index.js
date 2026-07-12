// Vercel serverless entry: reutiliza o handler do server.js
// Exporta o listener HTTP existente para funcionar como Serverless Function.
const path = require('path');
process.env.DRAKSYON_CACHE_DIR = process.env.DRAKSYON_CACHE_DIR || '/tmp/draksyon-cache';

// Carrega o server.js sem chamar .listen() (Vercel gerencia isso)
const http = require('http');
const origCreate = http.createServer;
let handler;
http.createServer = function(cb){
  handler = cb;
  // devolve um server "fake" para não quebrar server.listen()
  return { listen: ()=>{}, on: ()=>{}, emit: ()=>{} };
};
require(path.join(__dirname, '..', 'server.js'));
http.createServer = origCreate;

module.exports = (req, res) => handler(req, res);
