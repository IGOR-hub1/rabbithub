'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const pages = [
  'admin.html',
  'chat.html',
  'detalhes.html',
  'index.html',
  'login.html',
  'perfis.html',
  'player-animes.html'
];

test('todas as telas carregam a camada responsiva central por ultimo', () => {
  for (const page of pages) {
    const html = read(path.join('public', page));
    const references = html.match(/viewport-responsive\.css\?v=20261111-1/g) || [];
    assert.equal(references.length, 1, `${page} deve carregar a camada responsiva uma vez`);
    assert.match(html, /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*viewport-fit=cover[^"]*"/i);
    assert.ok(
      html.indexOf('viewport-responsive.css?v=20261111-1') > html.lastIndexOf('site-motion.css'),
      `${page} deve carregar a camada responsiva depois dos estilos da pagina`
    );
  }
});

test('camada responsiva cobre celular, tablet, desktop, TV e orientacao horizontal', () => {
  const css = read('public/viewport-responsive.css');
  assert.match(css, /@media\s*\(max-width:\s*380px\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-width:\s*1099px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1100px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1920px\)/);
  assert.match(css, /max-height:\s*520px[\s\S]*orientation:\s*landscape/);
  assert.match(css, /hover:\s*none/);
  assert.match(css, /pointer:\s*coarse/);
});

test('camada responsiva protege areas seguras, modais, foco e overflow lateral', () => {
  const css = read('public/viewport-responsive.css');
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /100dvh/);
  assert.match(css, /focus-visible/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /\.user-table-panel[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\[role="dialog"\][\s\S]*max-height:/);
});

test('CSS responsivo tem blocos balanceados', () => {
  const css = read('public/viewport-responsive.css').replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const char of css) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    assert.ok(depth >= 0, 'CSS nao pode fechar um bloco inexistente');
  }
  assert.equal(depth, 0, 'CSS deve fechar todos os blocos');
});

test('regressao visual cobre resolucoes de celular a TV 4K', () => {
  const audit = read('scripts/ui-regression.mjs');
  assert.match(audit, /name:'small-mobile',width:320,height:568/);
  assert.match(audit, /name:'mobile',width:390,height:844/);
  assert.match(audit, /name:'tablet',width:768,height:1024/);
  assert.match(audit, /name:'laptop',width:1366,height:768/);
  assert.match(audit, /name:'full-hd',width:1920,height:1080/);
  assert.match(audit, /name:'tv-4k',width:3840,height:2160/);
  assert.match(audit, /documentOverflow<=1/);
  assert.match(audit, /bodyOverflow<=1/);
});
