// top of server.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');

const { query, exec } = require('./db');

// ---------- Environment ----------
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

const USE_HTTPS = String(process.env.USE_HTTPS || '').toLowerCase() === 'true';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || '';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

// ---------- App & CORS ----------
const app = express();
app.use(
  cors({
    origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN,
    credentials: true,
  })
);

/**
 * VERY IMPORTANT:
 * Stripe webhook needs the raw body for signature verification.
 * Register it BEFORE express.json()
 */
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe) return res.status(500).send('Stripe not configured');

    const sig = req.headers['stripe-signature'];
    let event;
    try {
      if (!STRIPE_WEBHOOK_SECRET) {
        return res.status(500).send('Webhook secret not configured');
      }
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object;
        await creditUserForPaymentIntent(pi);
      }
      res.json({ received: true });
    } catch (e) {
      console.error('Fulfillment error:', e);
      // Acknowledge anyway to avoid Stripe retry storms
      res.json({ received: true, fulfillment: 'error' });
    }
  }
);

// All other routes parse JSON
app.use(express.json());

// ---------- Utils ----------
function signToken(u) {
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

// ---------- Email (nodemailer) ----------
const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,                 // e.g. smtp.gmail.com
  port: Number(process.env.SMTP_PORT || 587),  // 465 for secure
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendVerificationEmail(to, code) {
  const from = process.env.SMTP_FROM || `CryptoTradingX <no-reply@cryptox.app>`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
      <h2>Verify your email</h2>
      <p>Your verification code is:</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</div>
      <p>This code expires in 10 minutes.</p>
    </div>
  `;
  await smtpTransporter.sendMail({ from, to, subject: 'Your verification code', html });
}

// Create lightweight table to store per-user verification code (hash + expiry)
async function ensureVerificationTable() {
  await exec(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      user_id INT NOT NULL PRIMARY KEY,
      code_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_ev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}
ensureVerificationTable().catch((e) => console.error('ensureVerificationTable error:', e));

// ---------- Health ----------
app.get(['/api/health', '/health'], (_req, res) => res.json({ ok: true }));

// ---------- Auth ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, middleName, lastName } = req.body || {};
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const dupe = await query('SELECT id FROM users WHERE email=?', [email]);
    if (dupe.length) return res.status(409).json({ message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    await exec(
      'INSERT INTO users(email, first_name, middle_name, last_name, password_hash) VALUES (?,?,?,?,?)',
      [email, firstName, middleName || null, lastName, hash]
    );
    const user = (await query('SELECT id,email FROM users WHERE email=?', [email]))[0];

    // Create 6-digit code and store its hash with 10-min expiry
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 8);
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await exec(
      `INSERT INTO email_verifications(user_id, code_hash, expires_at, attempts)
       VALUES(?,?,?,0)
       ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash), expires_at=VALUES(expires_at), attempts=0`,
      [user.id, codeHash, expires]
    );

    try {
      await sendVerificationEmail(email, code);
    } catch (e) {
      console.error('send mail error:', e);
      // If email fails, you can still allow login, but surface a message to the UI:
      return res.status(500).json({ message: 'failed_to_send_email' });
    }

    // Frontend can show a verify form now
    res.json({ ok: true, userId: user.id });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ message: 'Missing fields' });

    const u = (await query('SELECT id,email FROM users WHERE email=?', [email]))[0];
    if (!u) return res.status(404).json({ message: 'User not found' });

    const ev = (
      await query('SELECT code_hash, expires_at, attempts FROM email_verifications WHERE user_id=?', [u.id])
    )[0];
    if (!ev) return res.status(409).json({ message: 'No verification pending' });

    const tooMany = (ev.attempts || 0) >= 10;
    if (tooMany) return res.status(429).json({ message: 'Too many tries' });

    const expired = new Date(ev.expires_at).getTime() < Date.now();
    if (expired) return res.status(410).json({ message: 'Code expired' });

    const ok = await bcrypt.compare(String(code), ev.code_hash);
    if (!ok) {
      await exec('UPDATE email_verifications SET attempts=attempts+1 WHERE user_id=?', [u.id]);
      return res.status(401).json({ message: 'Invalid code' });
    }

    // Verified -> remove row (you could also add a users.is_verified if desired)
    await exec('DELETE FROM email_verifications WHERE user_id=?', [u.id]);

    // Issue JWT and return
    const token = signToken(u);
    res.json({ ok: true, token });
  } catch (e) {
    console.error('verify error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'email/password required' });

  const rows = await query(
    'SELECT id,email,password_hash,first_name,middle_name,last_name FROM users WHERE email=?',
    [email]
  );
  const u = rows[0];
  if (!u) return res.status(401).json({ message: 'invalid credentials' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'invalid credentials' });

  res.json({ token: signToken(u) });
});

// ---------- Orders / Portfolio ----------
app.get('/api/orders', auth, async (req, res) => {
  const rows = await query('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', [req.user.id]);
  res.json(rows);
});

app.get('/api/portfolio', auth, async (req, res) => {
  const rows = await query(
    `SELECT a.symbol AS asset, w.balance
       FROM wallets w
       JOIN assets a ON a.id=w.asset_id
      WHERE w.user_id=?`,
    [req.user.id]
  );
  res.json(rows);
});

// Account panel
app.get('/api/account', auth, async (req, res) => {
  const rows = await query(
    'SELECT id,email,first_name,middle_name,last_name,created_at FROM users WHERE id=?',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'user not found' });
  res.json(rows[0]);
});

app.get('/api/transactions', auth, async (req, res) => {
  const rows = await query(
    `SELECT id, order_id, symbol, price, qty, created_at, user_id
       FROM trades
      WHERE user_id=? ORDER BY created_at DESC LIMIT 200`,
    [req.user.id]
  );
  res.json(rows);
});

app.get('/api/account/summary', auth, async (req, res) => {
  const wallets = await query(
    `SELECT a.symbol AS asset, w.balance
       FROM wallets w
       JOIN assets a ON a.id=w.asset_id
      WHERE w.user_id=?`,
    [req.user.id]
  );
  const sums = await query(
    `SELECT o.side, SUM(t.price*t.qty) AS total
       FROM trades t
       JOIN orders o ON t.order_id = o.id
      WHERE t.user_id=?
      GROUP BY o.side`,
    [req.user.id]
  );
  const summary = { wallets, income: 0, expenses: 0 };
  for (const s of sums) {
    if (s.side === 'SELL') summary.income = Number(s.total || 0);
    if (s.side === 'BUY') summary.expenses = Number(s.total || 0);
  }
  res.json(summary);
});

// Place order (simulated fills)
app.post('/api/orders', auth, async (req, res) => {
  const { symbol, side, type, qty, price } = req.body || {};
  if (!symbol || !side || !type || !qty) {
    return res.status(400).json({ message: 'missing fields' });
  }

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

    // Update wallet (base asset)
    const base = symbol.split('-')[0];
    await upsertWallet(req.user.id, base, side === 'BUY' ? qty : -qty);
  }

  res.json({ id: orderId, status: willFill ? 'FILLED' : 'NEW' });
});

// ---------- Stripe: create/fulfill ----------
app.post('/api/payments/create-intent', auth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

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
        coin, // e.g., "BTC-USD"
        amountUsd: String(amountUsd),
      },
    });

    res.json({ clientSecret: intent.client_secret });
  } catch (e) {
    console.error('create-intent error', e);
    res.status(500).json({ error: e.message || 'Failed to create payment' });
  }
});

app.post('/api/payments/fulfill', auth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    const { paymentIntentId } = req.body || {};
    if (!paymentIntentId) return res.status(400).json({ error: 'Missing paymentIntentId' });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') return res.status(409).json({ error: 'Payment not succeeded yet' });

    await creditUserForPaymentIntent(pi);
    res.json({ ok: true });
  } catch (e) {
    console.error('fulfill error', e);
    res.status(500).json({ error: e.message || 'Fulfillment failed' });
  }
});

// ---------- Wallet/Price Helpers ----------
async function upsertWallet(userId, baseSymbol, delta) {
  const sym = baseSymbol.toUpperCase();
  let rows = await query('SELECT id FROM assets WHERE symbol=?', [sym]);
  if (!rows.length) {
    await exec('INSERT INTO assets(symbol) VALUES (?)', [sym]);
    rows = await query('SELECT id FROM assets WHERE symbol=?', [sym]);
  }
  const assetId = rows[0].id;

  const w = await query('SELECT balance FROM wallets WHERE user_id=? AND asset_id=?', [userId, assetId]);
  if (w.length) {
    const newBal = (+w[0].balance || 0) + (+delta);
    await exec('UPDATE wallets SET balance=? WHERE user_id=? AND asset_id=?', [newBal, userId, assetId]);
  } else {
    await exec('INSERT INTO wallets(user_id,asset_id,balance) VALUES(?,?,?)', [userId, assetId, delta]);
  }
}

/** Fulfillment from a PaymentIntent (simulated price feed) */
async function creditUserForPaymentIntent(paymentIntent) {
  const meta = paymentIntent.metadata || {};
  const userId = Number(meta.userId);
  const coin = meta.coin; // e.g., "BTC-USD"
  const usd = Number(meta.amountUsd);
  if (!userId || !coin || !usd) {
    throw new Error('Missing metadata on PaymentIntent');
  }

  const price = getSymbolPrice(coin); // USD per coin from our simulator
  if (!price || price <= 0) {
    throw new Error('Price unavailable for coin: ' + coin);
  }

  const base = coin.split('-')[0];
  const qty = usd / price;

  await upsertWallet(userId, base, qty);

  // Optional: you could log to a fiat_topups table here if desired.
}

// ---------- Price Simulator & WebSocket ----------
const prices = { 'BTC-USD': 30000, 'ETH-USD': 2000, 'BNB-USD': 400, 'LTC-USD': 75 };
function getSymbolPrice(sym) {
  return prices[sym] || 0;
}

// Create HTTP(S) server
let server;
if (USE_HTTPS) {
  const sslOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
  };
  server = https.createServer(sslOptions, app);
  console.log('HTTPS enabled with local certs');
} else {
  server = http.createServer(app);
  console.log('HTTP only (USE_HTTPS=false)');
}

// Attach WS to the same server so it becomes wss:// when HTTPS is on
const wss = new WebSocket.Server({ server, path: '/ws' });

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
server.listen(PORT, () => {
  console.log(`Server listening on ${USE_HTTPS ? 'https' : 'http'}://localhost:${PORT}`);
});
