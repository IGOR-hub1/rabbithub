import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'http://localhost:8080/');
const get = (path, init) => fetch(new URL(path, base), {...init, signal: AbortSignal.timeout(10000), cache: 'no-store'});

for (const page of ['admin.html', 'partners.html', 'affiliates-admin.html', 'affiliate.html', 'simulator-admin.html']) {
  const response = await get(page);
  assert.equal(response.status, 200, `${page}: HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') || '', /text\/html/, `${page}: tipo de resposta`);
}

for (const init of [{}, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}]) {
  const response = await get('api/affiliates/adminData', init);
  assert.equal(response.status, 401, `API de afiliados (${init.method || 'GET'}): HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') || '', /application\/json/, 'API de afiliados deve responder JSON');
  const result = await response.json();
  assert.match(result.error || '', /Autenticação obrigatória/);
}
console.log(`Painel e API de afiliados publicados corretamente em ${base.origin}.`);
