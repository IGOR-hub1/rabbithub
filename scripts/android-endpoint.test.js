const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

test('origem Android empacotada autentica e nao aparece legivel no fonte', () => {
  const sourceRoot = path.join(__dirname, '..', 'X-Bunny-AIDE-apk webview',
    'app', 'src', 'main', 'java', 'com', 'x', 'bunny');
  const endpoint = fs.readFileSync(path.join(sourceRoot, 'AppEndpoint.java'), 'utf8');
  const activity = fs.readFileSync(path.join(sourceRoot, 'MainActivity.java'), 'utf8');
  const field = (name) => {
    const match = endpoint.match(new RegExp('private static final String ' + name + ' = "([0-9a-f]+)"'));
    assert.ok(match, name + ' precisa estar definido');
    return Buffer.from(match[1], 'hex');
  };
  const encrypted = field('DATA');
  const decipher = crypto.createDecipheriv('aes-128-gcm', field('KEY'), field('IV'));
  decipher.setAuthTag(encrypted.subarray(-16));
  const url = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8');
  assert.equal(crypto.createHash('sha256').update(url).digest('hex'),
    'af0b2d0c352aa1e71899bf6a02496d96eeba6f66c49f69de7567dbb82866c531');
  assert.equal(new URL(url).protocol, 'https:');
  assert.ok(!endpoint.includes(url) && !activity.includes(url));
});
