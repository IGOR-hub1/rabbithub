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

  function normalize(user){
    user = user && typeof user === 'object' ? user : {};
    var subscription = user.subscription && typeof user.subscription === 'object' ? user.subscription : {};
    var raw = String(first([
      user.plan,user.currentPlan,user.planName,user.tier,
      subscription.plan,subscription.name,subscription.tier
    ])).trim();
    var status = String(first([user.subscriptionStatus,subscription.status,user.planStatus])).trim().toLowerCase();
    var expiry = timestamp(first([
      user.premiumUntil,user.vipUntil,user.planExpiresAt,user.planExpiration,user.expiresAt,
      subscription.expiresAt,subscription.endAt,subscription.currentPeriodEnd
    ]));
    var expired = expiry > 0 && expiry < Date.now();
    var inactive = /^(?:expired|inactive|cancelled|canceled|revoked)$/.test(status);
    var paidSignal = user.premium === true || user.vip === true || user.isPremium === true ||
      subscription.active === true || /^(?:active|trialing|paid)$/.test(status) ||
      /(?:^|[\s_-])(vip|pro|premium)(?:[\s_-]|$)/i.test(raw);
    var isVip = paidSignal && !expired && !inactive;
    return {
      key:isVip ? 'vip' : 'free',
      name:isVip ? 'VIP' : 'Free',
      isVip:isVip,
      premium:isVip,
      expiresAt:isVip ? expiry : 0,
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
