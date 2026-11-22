import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputs = ['public', 'api', 'lib', 'server.js'];
const files = [];
function collect(relative) {
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Link simbólico fora do pacote: ' + relative);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(source).sort()) collect(path.join(relative, name));
  } else if (stat.isFile()) files.push(relative);
}
inputs.forEach(collect);

// The web app uses plain JavaScript: validate sources and inline scripts,
// then package the exact runtime tree without credentials or development data.
let scripts = 0;
for (const file of files) {
  if (!/\.(?:js|html)$/.test(file)) continue;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.js')) {
    new vm.Script(source, { filename: file });
    scripts++;
  } else {
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
      const type = match[1].match(/\btype\s*=\s*["']([^"']+)/i);
      if (type && !/^(?:text|application)\/javascript$/i.test(type[1])) continue;
      new vm.Script(match[2], { filename: file + ':inline' });
      scripts++;
    }
  }
}
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const output = fs.mkdtempSync(path.join(dist, 'web-'));
const manifest = { format: 1, scriptsValidated: scripts, files: [] };
for (const file of files) {
  const data = fs.readFileSync(path.join(root, file));
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data);
  manifest.files.push({ path: file.replace(/\\/g, '/'), bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex') });
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, private: true, main: 'server.js',
  engines: pkg.engines, scripts: { start: 'node server.js' }
}, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
fs.writeFileSync(path.join(root, '.cache', 'production-build.json'), JSON.stringify({ output, ...manifest }, null, 2));
console.log(`Build concluído: ${path.relative(root, output)} (${files.length} arquivos; ${scripts} scripts validados).`);
console.log('Executar: node "' + path.join(output, 'server.js') + '". Configure os segredos no ambiente de hospedagem.');
