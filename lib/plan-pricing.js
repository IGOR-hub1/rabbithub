'use strict';

// Valores provisórios em centavos. Uma futura cobrança deve receber apenas o
// identificador do plano e consultar esta tabela no servidor.
const PRICES = Object.freeze({
  vip: Object.freeze({id:'vip',name:'VIP',currency:'BRL',amountCents:990}),
  plus: Object.freeze({id:'plus',name:'Plus',currency:'BRL',amountCents:1990})
});

function getPlan(id){
  return Object.prototype.hasOwnProperty.call(PRICES,id) ? PRICES[id] : null;
}

function publicPrices(){
  return Object.values(PRICES).map(({id,name,currency,amountCents})=>({id,name,currency,amountCents}));
}

module.exports={getPlan,publicPrices};
