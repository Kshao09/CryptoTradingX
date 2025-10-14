// Backend/payments.js
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) console.warn('[stripe] STRIPE_SECRET_KEY missing');
const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: '2024-06-20' }) : null;

const router = express.Router();

// Webhook path exported so server can mount raw-body BEFORE json
const webhookPath = '/webhooks/stripe';

/** Webhook (raw body) */
router.post(webhookPath, bodyParser.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.warn('[stripe] webhook verify failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const orderId = pi.metadata?.orderId;
      console.log('[stripe] succeeded:', pi.id, 'orderId=', orderId);
      // TODO: mark order paid in DB (orderId -> pi.id)
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      console.log('[stripe] failed:', pi.id, 'reason=', pi.last_payment_error?.message);
      break;
    }
    default:
      break;
  }
  res.json({ received: true });
});

/** Create PaymentIntent (idempotent per orderId) */
router.post('/payments/create-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    const { orderId, amountCents, currency = 'usd', customerEmail } = req.body || {};
    if (!orderId || !Number.isInteger(amountCents)) {
      return res.status(400).json({ error: 'orderId and amountCents required' });
    }
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency,
        receipt_email: customerEmail,
        automatic_payment_methods: { enabled: true },
        metadata: { orderId },
      },
      { idempotencyKey: `pi_${orderId}` }
    );
    res.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, webhookPath };
