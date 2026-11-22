'use strict';

const {publicPrices}=require('../lib/plan-pricing');

module.exports=function handler(request,response){
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options','nosniff');
  if(request.method!=='GET'){
    response.setHeader('Allow','GET');
    response.statusCode=405;
    return response.end(JSON.stringify({ok:false,error:'Método não permitido.'}));
  }
  response.statusCode=200;
  response.end(JSON.stringify({ok:true,plans:publicPrices()}));
};
