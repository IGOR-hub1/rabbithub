'use strict';
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'..','API ANIMES E CHAT','database.rules.json');
const source=fs.readFileSync(file,'utf8');
const parsed=JSON.parse(source);
const rule=parsed.rules.users.$uid['.write'];
const fields=['planActivatedAt','appliedPaymentOrders'];
let next=rule;
for(const field of fields){
  const creation="newData.child('"+field+"').val() === null";
  const existing="newData.child('"+field+"').val() === data.child('"+field+"').val()";
  if(next.includes(creation)&&next.includes(existing))continue;
  if(field==='planActivatedAt'){
    const anchor="newData.child('planUpdatedAt').val() === null";
    const other="newData.child('planUpdatedAt').val() === data.child('planUpdatedAt').val()";
    if(!next.includes(anchor)||!next.includes(other))throw Error('Plan rule structure changed');
    next=next.replace(anchor,anchor+' && '+creation).replace(other,other+' && '+existing);
  }else{
    const anchor="newData.child('planActivatedAt').val() === null";
    const other="newData.child('planActivatedAt').val() === data.child('planActivatedAt').val()";
    if(!next.includes(anchor)||!next.includes(other))throw Error('Plan rule structure changed');
    next=next.replace(anchor,anchor+' && '+creation).replace(other,other+' && '+existing);
  }
}
if(next!==rule){
  parsed.rules.users.$uid['.write']=next;
  fs.writeFileSync(file,JSON.stringify(parsed,null,2)+'\n');
}
console.log('Payment plan fields protected in Realtime Database rules.');
