/* config.js — frontend config */
window.CONFIG = {
  // Backend base URL (your Express server)
  API_BASE: 'https://localhost:3001',
  WS_URL:   'wss://localhost:3001/ws',

  // Publishable (client-side) Stripe key — replace with your own
  STRIPE_PUBLISHABLE_KEY: "pk_test_XXXXXXXXXXXXXXXXXXXXXXXX"
};
