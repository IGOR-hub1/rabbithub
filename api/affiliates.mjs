import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const server=require('../server.js');

export default function handler(request,response){
  const original=new URL(request.url||'/', 'http://localhost');
  const action=original.searchParams.get('action')||'';
  if(!/^[A-Za-z]+$/.test(action)){response.statusCode=404;response.end('Not found');return;}
  request.url='/api/affiliates/'+action;
  server.emit('request',request,response);
}
