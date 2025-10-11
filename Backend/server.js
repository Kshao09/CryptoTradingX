// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const WebSocket = require('ws');
const Stripe = require('stripe');
const { query, exec } = require('./db');

const app = express();
app.use(cors());

// ---------- Stripe (webhook MUST see raw body) ----------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20',
});

// Webhook BEFORE express.json()
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const sig = req.headers['stripe-signature'];
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return res.status(500).send('Webhook secret not configured');

      const event = stripe.webhooks.constructEvent(req.body, sig, secret);

      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object;
        await creditUserForPaymentIntent(pi); // idempotent
      }
      // (Add other event types if you need)
      res.json({ received: true });
    } catch (err) {
      console.error('Webhook error:', err);
      // 400 tells Stripe signature verification failed
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// All other routes parse JSON
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

// ---------- Helpers ----------
function sign(u) {
  return jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '2h' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}
// Allow letters (incl. accents), spaces, hyphens, apostrophes; 2–100 chars
const NAME_RE = /^[\p{L}][\p{L}\p{M}'\- ]{1,99}$/u;

// ---------- Health ----------
app.get(['/api/health', '/health'], (_req, res) => res.json({ ok: true }));

// ---------- Auth ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { firstName, middleName, lastName, email, password } = req.body || {};

    // Validate fields
    if (!NAME_RE.test((firstName || '').trim()))
      return res.status(400).json({ message: 'Invalid first name' });
    if (middleName && !NAME_RE.test((middleName || '').trim()))
      return res.status(400).json({ message: 'Invalid middle name' });
    if (!NAME_RE.test((lastName || '').trim()))
      return res.status(400).json({ message: 'Invalid last name' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ message: 'Invalid email' });
    if (!password || password.length < 8 || !/[0-9]/.test(password) || !/[A-Za-z]/.test(password))
      return res.status(400).json({ message: 'Weak password' });

    const exists = await query('SELECT id FROM users WHERE email=?', [email.trim()]);
    if (exists.length) return res.status(409).json({ message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    await exec(
      `INSERT INTO users (email, first_name, middle_name, last_name, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [email.trim(), firstName.trim(), (middleName || '').trim() || null, lastName.trim(), hash]
    );

    const user = (await query('SELECT id,email FROM users WHERE email=?', [email.trim()]))[0];
    return res.status(201).json({ message: 'ok', token: sign(user) });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Email already registered' });
    console.error('register error', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'email/password required' });

  const rows = await query('SELECT id,email,password_hash FROM users WHERE email=?', [email]);
  const u = rows[0];
  if (!u) return res.status(401).json({ message: 'invalid credentials' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'invalid credentials' });

  res.json({ token: sign(u) });
});

// ---------- Orders & Portfolio ----------
app.get('/api/orders', auth, async (req, res) => {
  const rows = await query('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', [req.user.id]);
  res.json(rows);
});

app.get('/api/portfolio', auth, async (req, res) => {
  const rows = await query(
    `SELECT a.symbol AS asset, w.balance
     FROM wallets w JOIN assets a ON a.id=w.asset_id
     WHERE w.user_id=?`,
    [req.user.id]
  );
  res.json(rows);
});

// Account info (now includes names)
app.get('/api/account', auth, async (req, res) => {
  const rows = await query(
    'SELECT id,email,first_name,middle_name,last_name,created_at FROM users WHERE id=?',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'user not found' });
  res.json(rows[0]);
});

// Transactions (trades)
app.get('/api/transactions', auth, async (req, res) => {
  const rows = await query(
    `SELECT id, order_id, symbol, price, qty, created_at, user_id
     FROM trades
     WHERE user_id=? ORDER BY created_at DESC LIMIT 200`,
    [req.user.id]
  );
  res.json(rows);
});

// Account summary: wallets + income/expenses computed from trades
app.get('/api/account/summary', auth, async (req, res) => {
  const wallets = await query(
    `SELECT a.symbol AS asset, w.balance
     FROM wallets w JOIN assets a ON a.id=w.asset_id
     WHERE w.user_id=?`,
    [req.user.id]
  );
  const sums = await query(
    `SELECT o.side, SUM(t.price*t.qty) AS total
     FROM trades t JOIN orders o ON t.order_id = o.id
     WHERE t.user_id=? GROUP BY o.side`,
    [req.user.id]
  );
  const summary = { wallets, income: 0, expenses: 0 };
  for (const s of sums) {
    if (s.side === 'SELL') summary.income = Number(s.total || 0);
    if (s.side === 'BUY') summary.expenses = Number(s.total || 0);
  }
  res.json(summary);
});

// Place order (simulated fill at last price)
app.post('/api/orders', auth, async (req, res) => {
  const { symbol, side, type, qty, price } = req.body || {};
  if (!symbol || !side || !type || !qty) return res.status(400).json({ message: 'missing fields' });

  const result = await exec(
    `INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
     VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [req.user.id, symbol, side, type, qty, price || null, 'NEW']
  );
  const orderId = result.insertId;

  const last = getSymbolPrice(symbol);
  const willFill =
    type === 'MARKET' ||
    (side === 'BUY' && price != null && last <= price) ||
    (side === 'SELL' && price != null && last >= price);

  if (willFill) {
    await exec(
      `INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
       VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [orderId, req.user.id, symbol, last, qty]
    );
    await exec('UPDATE orders SET status=? WHERE id=?', ['FILLED', orderId]);

    // Update wallet for the BASE asset (e.g., BTC from BTC-USD)
    const base = symbol.split('-')[0];
    await upsertWallet(req.user.id, base, side === 'BUY' ? Number(qty) : -Number(qty));
  }

  res.json({ id: orderId, status: willFill ? 'FILLED' : 'NEW' });
});

// ---------- Stripe: Create PaymentIntent ----------
app.post('/api/payments/create-intent', auth, async (req, res) => {
  try {
    const { amountUsd, coin, receiptEmail } = req.body || {};
    if (!amountUsd || Number(amountUsd) < 1) return res.status(400).json({ error: 'Invalid amount' });
    if (!coin) return res.status(400).json({ error: 'Missing coin' });

    const amount = Math.round(Number(amountUsd) * 100); // cents

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method_types: ['card'],
      receipt_email: receiptEmail || undefined,
      metadata: {
        userId: String(req.user.id),
        coin, // e.g., BTC-USD
        amountUsd: String(amountUsd),
      },
    });

    res.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (e) {
    console.error('create-intent error', e);
    res.status(500).json({ error: e.message || 'Failed to create payment' });
  }
});

// Optional: verify & fulfill without waiting for webhook
app.post('/api/payments/fulfill', auth, async (req, res) => {
  try {
    const { paymentIntentId } = req.body || {};
    if (!paymentIntentId) return res.status(400).json({ error: 'Missing paymentIntentId' });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') return res.status(409).json({ error: 'Payment not succeeded yet' });

    await creditUserForPaymentIntent(pi); // idempotent
    res.json({ ok: true });
  } catch (e) {
    console.error('fulfill error', e);
    res.status(500).json({ error: e.message || 'Fulfillment failed' });
  }
});

// List own top-ups (nice for a UI table)
app.get('/api/payments/topups', auth, async (req, res) => {
  const rows = await query(
    `SELECT id, coin, usd_amount, coin_qty,
            stripe_payment_intent_id AS payment_intent_id, status, created_at
     FROM fiat_topups
     WHERE user_id=?
     ORDER BY created_at DESC
     LIMIT 200`,
    [req.user.id]
  );
  res.json(rows);
});

// ---------- Wallet & fulfillment helpers ----------
async function ensureAssetSymbol(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return;
  const r = await query('SELECT id FROM assets WHERE symbol=?', [sym]);
  if (!r.length) await exec('INSERT INTO assets(symbol) VALUES (?)', [sym]);
}

async function upsertWallet(userId, baseSymbol, delta) {
  const sym = String(baseSymbol || '').toUpperCase();
  if (!sym) return;
  await ensureAssetSymbol(sym);

  // Find asset id
  let rows = await query('SELECT id FROM assets WHERE symbol=?', [sym]);
  const assetId = rows[0].id;

  const w = await query('SELECT balance FROM wallets WHERE user_id=? AND asset_id=?', [userId, assetId]);
  if (w.length) {
    const newBal = (+w[0].balance || 0) + (+delta || 0);
    await exec('UPDATE wallets SET balance=? WHERE user_id=? AND asset_id=?', [newBal, userId, assetId]);
  } else {
    await exec('INSERT INTO wallets(user_id,asset_id,balance) VALUES(?,?,?)', [userId, assetId, delta || 0]);
  }
}

/**
 * Credit user from a Stripe PaymentIntent (idempotent via UNIQUE PI id).
 * Uses simple simulated prices; replace getSymbolPrice with your real price source if available.
 */
async function creditUserForPaymentIntent(paymentIntent) {
  const meta = paymentIntent?.metadata || {};
  const userId = Number(meta.userId);
  const coin = String(meta.coin || '');
  const usd = Number(meta.amountUsd);
  if (!userId || !coin || !usd) throw new Error('Missing metadata on PaymentIntent');

  // Ensure the pair (e.g., BTC-USD) exists for FK on fiat_topups.coin
  await ensureAssetSymbol(coin);

  const price = getSymbolPrice(coin); // USD per coin
  if (!price || price <= 0) throw new Error('Price unavailable for coin: ' + coin);

  const base = coin.split('-')[0];
  const qty = usd / price;

  // Credit the wallet in base asset
  await upsertWallet(userId, base, qty);

  // Log the top-up (idempotent on payment_intent_id)
  await exec(
    `INSERT INTO fiat_topups
       (user_id, coin, usd_amount, coin_qty, stripe_payment_intent_id, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status     = VALUES(status),
       usd_amount = VALUES(usd_amount),
       coin_qty   = VALUES(coin_qty)`,
    [userId, coin, usd, qty, paymentIntent.id, paymentIntent.status || 'succeeded']
  );
}

// ---------- WebSocket price simulator (for demo) ----------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const prices = { 'BTC-USD': 30000, 'ETH-USD': 2000 };
function getSymbolPrice(sym) {
  return prices[sym] || 0;
}

setInterval(() => {
  for (const s of Object.keys(prices)) {
    const drift = (Math.random() - 0.5) * (s === 'BTC-USD' ? 50 : 5);
    prices[s] = Math.max(1, prices[s] + drift);
    const msg = JSON.stringify({ type: 'tick', symbol: s, price: +prices[s].toFixed(2) });
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  }
}, 1250);

wss.on('connection', (ws) => {
  Object.entries(prices).forEach(([s, p]) =>
    ws.send(JSON.stringify({ type: 'tick', symbol: s, price: +p.toFixed(2) }))
  );
});

// ---------- Start ----------
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
