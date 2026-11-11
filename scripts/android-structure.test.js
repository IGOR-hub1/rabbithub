'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const androidRoot = path.join(root, 'PROJETO AIDE');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes:true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function javaCode(source) {
  let output = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === '\n') { lineComment = false; output += '\n'; }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') { blockComment = false; index++; }
      continue;
    }
    if (quote) {
      if (current === '\\') { index++; continue; }
      if (current === quote) quote = '';
      continue;
    }
    if (current === '/' && next === '/') { lineComment = true; index++; continue; }
    if (current === '/' && next === '*') { blockComment = true; index++; continue; }
    if (current === '"' || current === "'") { quote = current; continue; }
    output += current;
  }
  return output;
}

test('fontes Java do APK mantêm delimitadores estruturais válidos', () => {
  const files = walk(path.join(androidRoot, 'app', 'src', 'main', 'java')).filter((file) => file.endsWith('.java'));
  assert.ok(files.length >= 1);
  for (const file of files) {
    const source = javaCode(fs.readFileSync(file, 'utf8'));
    for (const [open, close] of [['{','}'], ['(',')'], ['[',']']]) {
      let balance = 0;
      for (const character of source) {
        if (character === open) balance++;
        if (character === close) balance--;
        assert.ok(balance >= 0, path.relative(root, file) + ' fecha ' + close + ' antes de abrir ' + open);
      }
      assert.equal(balance, 0, path.relative(root, file) + ' possui ' + open + close + ' desbalanceado');
    }
  }
});

test('APK usa a introdução nativa e carrega o site pela Vercel', () => {
  const assetsRoot = path.join(androidRoot, 'app', 'src', 'main', 'assets');
  const assets = fs.existsSync(assetsRoot) ? walk(assetsRoot).map((file) => path.basename(file)) : [];
  ['index.html','login.html','detalhes.html','player-animes.html','perfis.html','chat.html'].forEach((name) => {
    assert.equal(assets.includes(name), false, name + ' não pode ser empacotado no APK');
  });
  const activity = fs.readFileSync(path.join(androidRoot, 'app', 'src', 'main', 'java', 'com', 'x', 'bunny', 'MainActivity.java'), 'utf8');
  assert.match(activity, /HOME_URL = "https:\/\/rabbithub-eight\.vercel\.app\/"/);
  assert.match(activity, /setContentView\(R\.layout\.activity_main\)/);
  assert.doesNotMatch(activity, /loadData(?:WithBaseURL)?\s*\(/);
});
