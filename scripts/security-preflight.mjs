import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedProject = 'animes-64408';
const failures = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

let rules;
let projectAliases;
try { rules = JSON.parse(read('API ANIMES E CHAT/database.rules.json')); }
catch (error) { failures.push('API ANIMES E CHAT/database.rules.json não é um JSON válido: ' + error.message); }
try { projectAliases = JSON.parse(read('.firebaserc')); }
catch (error) { failures.push('.firebaserc não é um JSON válido: ' + error.message); }

const webConfig = read('public/firebase-config.js');
if (!webConfig.includes('projectId:         "' + expectedProject + '"')) {
  failures.push('firebase-config.js não aponta para ' + expectedProject + '.');
}
if (/appId:\s*"1:887589860807:web:0{16,}"/.test(webConfig)) {
  failures.push('firebase-config.js ainda usa o appId Web marcador; copie o appId real do Console Firebase.');
}
if (projectAliases && projectAliases.projects && projectAliases.projects.default !== expectedProject) {
  failures.push('.firebaserc aponta para um projeto diferente de ' + expectedProject + '.');
}
if (rules && (!rules.rules || rules.rules['.read'] !== false || rules.rules['.write'] !== false)) {
  failures.push('as regras precisam manter leitura e escrita negadas na raiz.');
}
if (rules && JSON.stringify(rules).includes('".write":true')) {
  failures.push('foi encontrada escrita pública sem autenticação.');
}
if (rules && rules.rules) {
  const broadcast = rules.rules.dk_broadcast || {};
  if (!broadcast.current || broadcast.current['.read'] !== true ||
      !broadcast.maintenance || broadcast.maintenance['.read'] !== true ||
      !broadcast.config || broadcast.config['.read'] !== true ||
      !broadcast.homeFeatured || broadcast.homeFeatured['.read'] !== true) {
    failures.push('comunicado, manutenção, configuração e Home precisam estar legíveis antes do login.');
  }
  if (!rules.rules.chatReports || typeof rules.rules.chatReports['.read'] !== 'string') {
    failures.push('o painel precisa de leitura administrativa na raiz de chatReports.');
  }
}
if (rules && JSON.stringify(rules).includes('PRIMARY_ADMIN_EMAIL')) {
  failures.push('foi encontrada autoelevação administrativa por e-mail.');
}

if (process.argv.includes('--deploy')) {
  const confirmedUid = String(process.env.RABBITHUB_ADMIN_UID_CONFIRMED || '').trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(confirmedUid)) {
    failures.push('confirme o admin existente definindo RABBITHUB_ADMIN_UID_CONFIRMED com o UID real antes do deploy.');
  }
}

if (failures.length) {
  console.error('\nPreflight de segurança recusado:\n- ' + failures.join('\n- ') + '\n');
  process.exitCode = 1;
} else {
  console.log('Preflight local aprovado para o projeto ' + expectedProject + '.');
  if (!process.argv.includes('--deploy')) {
    console.log('Antes do deploy, confirme a conta krabelodesouza52@gmail.com no Authentication ou um marcador administrativo existente.');
  }
}
