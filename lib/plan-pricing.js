'use strict';

// Valores provisórios em centavos. Uma futura cobrança deve receber apenas o
// identificador do plano e consultar esta tabela no servidor.
const PRICES = Object.freeze({
  vip: Object.freeze({id:'vip',name:'VIP',currency:'BRL',amountCents:100,priceRevision:'vip-test-1'}),
  plus: Object.freeze({id:'plus',name:'Plus',currency:'BRL',amountCents:1990,priceRevision:'plus-1'})
});
// Pedidos criados antes desta revisão não tinham priceRevision. A validação do
// Webhook deve continuar reconhecendo exatamente o preço gravado nesses pedidos.
const LEGACY_PRICES=Object.freeze({vip:990,plus:1990});

function getPlan(id){
  return Object.prototype.hasOwnProperty.call(PRICES,id) ? PRICES[id] : null;
}

function isOrderPrice(record){
  const plan=getPlan(record?.planId);
  if(!plan||!Number.isSafeInteger(record.amountCents)||record.amountCents<=0)return false;
  if(record.priceRevision===plan.priceRevision)return record.amountCents===plan.amountCents;
  return record.priceRevision===undefined&&record.amountCents===LEGACY_PRICES[record.planId];
}

function publicPrices(){
  return Object.values(PRICES).map(({id,name,currency,amountCents})=>({id,name,currency,amountCents}));
}

module.exports={getPlan,publicPrices,isOrderPrice};
