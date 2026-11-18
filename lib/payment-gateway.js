'use strict';

// Contract for a future, separately reviewed payment integration. The app does
// not instantiate a gateway or accept payment credentials in simulation mode.
class PaymentGateway {
  async createCheckout(_order) { throw new Error('Gateway de pagamento não configurado.'); }
  async verifyWebhook(_request) { throw new Error('Gateway de pagamento não configurado.'); }
  async getPayment(_paymentId) { throw new Error('Gateway de pagamento não configurado.'); }
}

module.exports={PaymentGateway};
