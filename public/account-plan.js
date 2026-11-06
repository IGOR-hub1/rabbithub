/* X-Bunny Animes - fonte unica para interpretar o plano salvo na conta. */
(function(){
  'use strict';

  function timestamp(value){
    if (value == null || value === '') return 0;
    if (value && typeof value === 'object') value = value.seconds || value._seconds || value.value || 0;
    var numeric = Number(value);
    if (isFinite(numeric) && numeric > 0) return numeric < 100000000000 ? numeric * 1000 : numeric;
    var parsed = Date.parse(String(value));
    return isNaN(parsed) ? 0 : parsed;
  }

  function first(values){
    for (var index=0;index<values.length;index++) {
      if (values[index] !== undefined && values[index] !== null && String(values[index]).trim() !== '') return values[index];
    }
    return '';
  }

  function owns(object,key){
    return !!object && Object.prototype.hasOwnProperty.call(object,key);
  }

  /* premiumUntil é o campo canônico usado pelo painel. Se ele existir com
     null/0, significa VIP sem expiração e deve neutralizar aliases antigos
     como vipUntil ou planExpiresAt que ainda possam conter uma data vencida. */
  function planExpiry(user,account,subscription){
    var sources = [
      [user,['premiumUntil','vipUntil','planExpiresAt','planExpiration','expiresAt']],
      [account,['premiumUntil','vipUntil','planExpiresAt','planExpiration','expiresAt']],
      [subscription,['expiresAt','endAt','currentPeriodEnd']]
    ];
    for (var sourceIndex=0;sourceIndex<sources.length;sourceIndex++) {
      var object = sources[sourceIndex][0] || {};
      var keys = sources[sourceIndex][1];
      for (var keyIndex=0;keyIndex<keys.length;keyIndex++) {
        if (owns(object,keys[keyIndex])) return timestamp(object[keys[keyIndex]]);
      }
    }
    return 0;
  }

  function normalize(user){
    user = user && typeof user === 'object' ? user : {};
    var account = user.account && typeof user.account === 'object' ? user.account : {};
    var subscription = user.subscription && typeof user.subscription === 'object' ? user.subscription : {};
    var raw = String(first([
      user.plan,user.currentPlan,user.planName,user.tier,
      account.plan,account.currentPlan,account.planName,account.tier,
      subscription.plan,subscription.name,subscription.tier
    ])).trim();
    var status = String(first([
      user.subscriptionStatus,user.planStatus,account.subscriptionStatus,account.planStatus,subscription.status
    ])).trim().toLowerCase();
    var expiry = planExpiry(user,account,subscription);
    var explicitPaid = user.premium === true || user.vip === true || user.isPremium === true ||
      account.premium === true || account.vip === true || account.isPremium === true;
    var planUpdatedAt = timestamp(first([
      user.planUpdatedAt,account.planUpdatedAt,subscription.updatedAt
    ]));
    /* Uma concessão manual mais recente que uma expiração antiga deve vencer.
       Isso recupera contas às quais o painel deu VIP depois que uma assinatura
       antiga já havia expirado. */
    var manualGrantAfterExpiry = explicitPaid && planUpdatedAt > 0 &&
      expiry > 0 && planUpdatedAt >= expiry;
    var expired = expiry > 0 && expiry < Date.now() && !manualGrantAfterExpiry;
    var inactive = /^(?:expired|inactive|cancelled|canceled|revoked)$/.test(status);
    var inferredPaid = subscription.active === true || /^(?:active|trialing|paid)$/.test(status) ||
      /(?:^|[\s_-])(vip|pro|premium)(?:[\s_-]|$)/i.test(raw);
    /* O painel grava premium/vip=true ao conceder acesso. Esse sinal explícito
       prevalece sobre um subscriptionStatus antigo que tenha ficado salvo. */
    var isVip = !expired && (explicitPaid || (!inactive && inferredPaid));
    return {
      key:isVip ? 'vip' : 'free',
      name:isVip ? 'VIP' : 'Free',
      isVip:isVip,
      premium:isVip,
      expiresAt:isVip ? expiry : 0,
      updatedAt:planUpdatedAt,
      raw:raw,
      status:status
    };
  }

  function mergeSession(session,user){
    session = session && typeof session === 'object' ? session : {};
    user = user && typeof user === 'object' ? user : {};
    var plan = normalize(user);
    session.plan = plan.name;
    session.currentPlan = plan.name;
    session.planName = plan.name;
    session.premium = plan.isVip;
    session.vip = plan.isVip;
    session.premiumUntil = plan.expiresAt || 0;
    session.vipUntil = plan.expiresAt || 0;
    session.planExpiresAt = plan.expiresAt || 0;
    if (plan.status) session.subscriptionStatus = plan.status;
    return session;
  }

  window.RabbitHubAccountPlan = {timestamp:timestamp,normalize:normalize,mergeSession:mergeSession};
})();
