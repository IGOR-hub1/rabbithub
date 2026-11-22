'use strict';

function timestamp(value){
  if(value==null||value==='')return 0;
  if(value&&typeof value==='object')value=value.seconds||value._seconds||value.value||0;
  const number=Number(value);
  if(Number.isFinite(number)){
    if(number<=0)return 0;
    return number<100000000000?number*1000:number;
  }
  const parsed=Date.parse(String(value));
  return Number.isNaN(parsed)?0:parsed;
}
function first(values){for(const value of values)if(value!==undefined&&value!==null&&String(value).trim()!=='')return value;return '';}
function owns(object,key){return !!object&&Object.prototype.hasOwnProperty.call(object,key);}
function expiry(user,account,subscription){
  for(const key of ['premiumUntil','vipUntil'])if(user[key]!=null)return typeof user[key]==='number'&&Number.isFinite(user[key])&&user[key]>=0?user[key]:-1;
  return 0;
}
function normalize(user,now){
  user=user&&typeof user==='object'?user:{};
  const account=user.account&&typeof user.account==='object'?user.account:{};
  const subscription=user.subscription&&typeof user.subscription==='object'?user.subscription:{};
  const raw=String(first([user.plan,user.currentPlan,user.planName,user.tier,account.plan,account.currentPlan,account.planName,account.tier,subscription.plan,subscription.name,subscription.tier])).trim();
  const status=String(first([user.subscriptionStatus,user.planStatus,account.subscriptionStatus,account.planStatus,subscription.status])).trim().toLowerCase();
  const expiresAt=expiry(user,account,subscription);
  const explicit=user.premium===true||user.vip===true||user.isPremium===true;
  const current=Number(now)||Date.now();
  const expired=expiresAt!==0&&expiresAt<=current;
  const isVip=!expired&&explicit&&user.banned!==true&&user.blocked!==true;
  const isPlus=isVip&&/^plus$/i.test(raw);
  return {key:isPlus?'plus':isVip?'vip':'free',name:isPlus?'Plus':isVip?'VIP':'Free',isVip,isPlus,expiresAt:Math.max(0,expiresAt),status,raw};
}

module.exports={timestamp,normalize};
