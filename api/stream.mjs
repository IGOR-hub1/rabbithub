import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const server = require('../server.js');

export default function handler(request, response) {
  const parsed = new URL(request.url || '/', 'http://localhost');
  request.url = '/stream' + parsed.search;
  server.emit('request', request, response);
}
