import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const required = [
  'api/affiliates.mjs',
  'api/stream.mjs',
  'server.js',
  'lib/affiliate-service.js',
  'lib/affiliate-store.js',
  'lib/firebase-auth.js',
  'lib/account-plan.js',
  'public/admin.html',
  'public/partners.html',
  'public/affiliates-admin.html',
  'public/affiliate.html',
  'public/simulator-admin.html'
];
const missing = required.filter(file => !fs.statSync(path.join(root, file), {throwIfNoEntry: false})?.isFile());
if (missing.length) throw new Error('Deploy incompleto. Arquivos ausentes: ' + missing.join(', '));
if (config.framework !== null || config.outputDirectory !== 'public' ||
    !config.functions?.['api/affiliates.mjs'] || !config.functions?.['api/stream.mjs'] ||
    !config.rewrites?.some(route => route.source === '/api/affiliates/:action' && route.destination === '/api/affiliates?action=:action') ||
    !config.rewrites?.some(route => route.source === '/stream' && route.destination === '/api/stream')) {
  throw new Error('Configuração Vercel incompatível com a API de afiliados e os arquivos estáticos.');
}
console.log('Deploy verificado: funções de afiliados e streaming, dependências e arquivos públicos presentes.');
