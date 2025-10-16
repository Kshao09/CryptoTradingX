// Backend/server.js (CommonJS)
// -------------------------------------------------
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const Stripe = require('stripe');
const { createClient } = require('redis');
const { ethers } = require('ethers');

let openai = null;
try {
  const { OpenAI } = require('openai');
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch { /* optional */ }

const { query, exec } = require('./db');

// === Central mailer (uses /mail folder) ===
const {
  sendRegistrationEmail,
  sendBuyEmail,
  sendSellEmail,
  sendExchangeEmail,
} = require('./mail');

// ---------- Env ----------
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const USE_HTTPS = String(process.env.USE_HTTPS || '').toLowerCase() === 'true';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '';
const SSL_KEY_PATH  = process.env.SSL_KEY_PATH  || '';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const ETH_RPC_URL = process.env.ETH_RPC_URL || '';
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '';

// ---------- App ----------
const app = express();
app.use(
  cors({
    origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

app.get(['/api/health', '/health'], (_req, res) => res.json({ ok: true }));

// Stripe webhook BEFORE json
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe) return res.status(500).send('Stripe not configured');
    const sig = req.headers['stripe-signature'];
    try {
      if (!STRIPE_WEBHOOK_SECRET) return res.status(500).send('Webhook secret not configured');
      const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      if (event.type === 'payment_intent.succeeded') {
        await creditUserForPaymentIntent(event.data.object);
      }
      return res.json({ received: true });
    } catch (e) {
      console.error('Fulfillment error:', e);
      return res.json({ received: true, fulfillment: 'error' });
    }
  }
);

// other routes parse JSON
app.use(express.json());

// ---------- utils ----------
function signToken(u) {
  return jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '2h' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: 'No token' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: 'Invalid token' }); }
}

async function getUserBasic(userId) {
  const rows = await query(
    'SELECT id,email,first_name AS firstName,middle_name AS middleName,last_name AS lastName FROM users WHERE id=?',
    [userId]
  );
  return rows[0] || null;
}

// Minimal verification table
(async () => {
  try {
    await exec(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        user_id INT NOT NULL PRIMARY KEY,
        code_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        CONSTRAINT fk_ev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  } catch (e) { console.error('ensureVerificationTable error:', e); }
})();

// ---------- auth ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, middleName, lastName } = req.body || {};
    if (!email || !password || !firstName || !lastName) return res.status(400).json({ message: 'Missing fields' });

    const d = await query('SELECT id FROM users WHERE email=?', [email]);
    if (d.length) return res.status(409).json({ message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    await exec('INSERT INTO users(email, first_name, middle_name, last_name, password_hash) VALUES (?,?,?,?,?)',
      [email, firstName, middleName || null, lastName, hash]);
    const user = (await query('SELECT id,email,first_name FROM users WHERE email=?', [email]))[0];

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 8);
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await exec(
      `INSERT INTO email_verifications(user_id,code_hash,expires_at,attempts)
       VALUES(?,?,?,0)
       ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),attempts=0`,
      [user.id, codeHash, expires]
    );

    try {
      const mailRes = await sendRegistrationEmail(email, { firstName: user.first_name || 'Trader', code });
      console.log('[mail] REGISTRATION ->', email, mailRes);
    } catch (e) { console.warn('[mail] registration send failed:', e.message); }

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

    const ev = (await query('SELECT code_hash,expires_at,attempts FROM email_verifications WHERE user_id=?', [u.id]))[0];
    if (!ev) return res.status(409).json({ message: 'No verification pending' });
    if ((ev.attempts || 0) >= 10) return res.status(429).json({ message: 'Too many tries' });
    if (new Date(ev.expires_at).getTime() < Date.now()) return res.status(410).json({ message: 'Code expired' });

    const ok = await bcrypt.compare(String(code), ev.code_hash);
    if (!ok) {
      await exec('UPDATE email_verifications SET attempts=attempts+1 WHERE user_id=?', [u.id]);
      return res.status(401).json({ message: 'Invalid code' });
    }
    await exec('DELETE FROM email_verifications WHERE user_id=?', [u.id]);
    res.json({ ok: true, token: signToken(u) });
  } catch (e) {
    console.error('verify error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'email/password required' });
  const rows = await query('SELECT id,email,password_hash,first_name,middle_name,last_name FROM users WHERE email=?', [email]);
  const u = rows[0];
  if (!u) return res.status(401).json({ message: 'invalid credentials' });
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'invalid credentials' });
  res.json({ token: signToken(u) });
});

// ---------- data APIs ----------
app.get('/api/orders', auth, async (req, res) => {
  res.json(await query('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', [req.user.id]));
});
app.get('/api/portfolio', auth, async (req, res) => {
  const rows = await query(`
    SELECT a.symbol AS asset, w.balance
      FROM wallets w JOIN assets a ON a.id=w.asset_id
     WHERE w.user_id=?`, [req.user.id]);
  res.json(rows);
});
app.get('/api/account', auth, async (req, res) => {
  const rows = await query(
    'SELECT id,email,first_name,middle_name,last_name,created_at FROM users WHERE id=?',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'user not found' });
  res.json(rows[0]);
});
app.get('/api/transactions', auth, async (req, res) => {
  const rows = await query(`
    SELECT id,order_id,symbol,price,qty,created_at,user_id
      FROM trades
     WHERE user_id=? ORDER BY created_at DESC LIMIT 200`, [req.user.id]);
  res.json(rows);
});
app.get('/api/account/summary', auth, async (req, res) => {
  const wallets = await query(`
    SELECT a.symbol AS asset, w.balance
      FROM wallets w JOIN assets a ON a.id=w.asset_id
     WHERE w.user_id=?`, [req.user.id]);
  const sums = await query(`
    SELECT o.side, SUM(t.price*t.qty) AS total
      FROM trades t JOIN orders o ON t.order_id=o.id
     WHERE t.user_id=? GROUP BY o.side`, [req.user.id]);
  const summary = { wallets, income: 0, expenses: 0 };
  for (const s of sums) {
    if (s.side === 'SELL') summary.income = Number(s.total || 0);
    if (s.side === 'BUY') summary.expenses = Number(s.total || 0);
  }
  res.json(summary);
});

// ---------- NEW: balances ----------
app.get('/api/balances', auth, async (req, res) => {
  const rows = await query(`
    SELECT a.symbol, w.balance
      FROM wallets w JOIN assets a ON a.id=w.asset_id
     WHERE w.user_id=?`, [req.user.id]);
  const balances = { USD: 0 };
  rows.forEach(r => { balances[r.symbol] = Number(r.balance || 0); });
  res.json({ balances });
});

// ---------- place order (legacy example) ----------
app.post('/api/orders', auth, async (req, res) => {
  const { symbol, side, type, qty, price } = req.body || {};
  if (!symbol || !side || !type || !qty) return res.status(400).json({ message: 'missing fields' });

  const result = await exec(`
    INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [req.user.id, symbol, side, type, qty, price || null, 'NEW']
  );
  const orderId = result.insertId;

  const last = getSymbolPrice(symbol);
  const willFill =
    String(type).toUpperCase() === 'MARKET' ||
    (String(side).toUpperCase() === 'BUY'  && price != null && last <= price) ||
    (String(side).toUpperCase() === 'SELL' && price != null && last >= price);

  if (willFill) {
    await exec(`
      INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
      VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [orderId, req.user.id, symbol, last, qty]
    );
    await exec('UPDATE orders SET status=? WHERE id=?', ['FILLED', orderId]);

    const base = symbol.split('-')[0];
    await upsertWallet(req.user.id, base, String(side).toUpperCase() === 'BUY' ? qty : -qty);
  }
  res.json({ id: orderId, status: willFill ? 'FILLED' : 'NEW' });
});

// ---------- NEW: spot trade endpoint used by Trade page ----------
app.post('/api/trades/spot', auth, async (req, res) => {
  try {
    const { side, symbol, type = 'MARKET', qty } = req.body || {};
    if (!symbol || !qty || !side) return res.status(400).json({ error: 'symbol/side/qty required' });
    if (!/^[A-Z]+-USD$/.test(symbol)) return res.status(400).json({ error: 'symbol must be like BTC-USD' });

    const base = symbol.split('-')[0];
    if (String(side).toUpperCase() === 'SELL') {
      const bal = await getWalletBalance(req.user.id, base);
      if (Number(bal) < Number(qty)) return res.status(400).json({ error: 'insufficient balance' });
    }

    const px = getSymbolPrice(symbol) || 0;
    if (!px) return res.status(400).json({ error: `no price for ${symbol}` });

    const ord = await exec(
      `INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
       VALUES (?,?,?,?,?, ?, 'FILLED', CURRENT_TIMESTAMP)`,
      [req.user.id, symbol, String(side).toUpperCase(), String(type).toUpperCase(), qty, px]
    );
    const orderId = ord.insertId;
    await exec(
      `INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
       VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [orderId, req.user.id, symbol, px, qty]
    );
    await upsertWallet(req.user.id, base, String(side).toUpperCase() === 'BUY' ? qty : -qty);

    // send receipt email (log results)
    try {
      const u = await getUserBasic(req.user.id);
      if (u && u.email) {
        if (String(side).toUpperCase() === 'BUY') {
          const resMail = await sendBuyEmail(u.email, {
            firstName: u.firstName || 'Trader',
            symbol,
            qty: Number(qty),
            price: Number(px),
            amountUsd: Number(qty) * Number(px),
            orderId
          });
          console.log('[mail] BUY receipt ->', u.email, resMail);
        } else {
          const gross = Number(qty) * Number(px);
          const fee = gross * 0.001;
          const resMail = await sendSellEmail(u.email, {
            firstName: u.firstName || 'Trader',
            symbol,
            qty: Number(qty),
            price: Number(px),
            proceedsUsd: gross - fee,
            feeUsd: fee,
            orderId
          });
          console.log('[mail] SELL receipt ->', u.email, resMail);
        }
      } else {
        console.warn('[mail] user email missing for receipt');
      }
    } catch (e) {
      console.warn('[mail] spot trade email exception:', e?.message || e);
    }

    res.json({ ok: true, orderId, filledQty: qty, price: px });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- NEW: coin-to-coin exchange ----------
app.post('/api/trades/exchange', auth, async (req, res) => {
  try {
    const { from, to, amount, maxSlippagePct = 0 } = req.body || {};
    if (!from || !to || !amount) return res.status(400).json({ error: 'from/to/amount required' });
    if (from === to) return res.status(400).json({ error: 'from and to must differ' });

    const balFrom = await getWalletBalance(req.user.id, from);
    if (Number(balFrom) < Number(amount)) return res.status(400).json({ error: 'insufficient balance' });

    const pFrom = getSymbolPrice(`${from}-USD`);
    const pTo   = getSymbolPrice(`${to}-USD`);
    if (!pFrom || !pTo) return res.status(400).json({ error: 'missing price' });

    // fees/slippage
    const feeUsd = Number(amount) * pFrom * 0.001; // 0.10%
    const grossUsd = Number(amount) * pFrom;
    const netUsd = Math.max(grossUsd - feeUsd, 0);
    const minOut = netUsd * (1 - Number(maxSlippagePct) / 100);
    const qtyTo = +(minOut / pTo).toFixed(8);

    // Record as a sell then a buy
    const sellOrd = await exec(
      `INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
       VALUES (?,?,?,?,?, ?, 'FILLED', CURRENT_TIMESTAMP)`,
      [req.user.id, `${from}-USD`, 'SELL', 'MARKET', amount, pFrom]
    );
    await exec(
      `INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
       VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [sellOrd.insertId, req.user.id, `${from}-USD`, pFrom, amount]
    );

    const buyOrd = await exec(
      `INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
       VALUES (?,?,?,?,?, ?, 'FILLED', CURRENT_TIMESTAMP)`,
      [req.user.id, `${to}-USD`, 'BUY', 'MARKET', qtyTo, pTo]
    );
    await exec(
      `INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
       VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [buyOrd.insertId, req.user.id, `${to}-USD`, pTo, qtyTo]
    );

    // wallets
    await upsertWallet(req.user.id, from, -Number(amount));
    await upsertWallet(req.user.id, to, Number(qtyTo));

    // exchange receipt (log results)
    try {
      const u = await getUserBasic(req.user.id);
      if (u && u.email) {
        const resMail = await sendExchangeEmail(u.email, {
          firstName: u.firstName || 'Trader',
          from, to,
          amountFrom: Number(amount),
          amountTo: Number(qtyTo),
          priceFrom: Number(pFrom),
          priceTo: Number(pTo),
          feeUsd: Number(feeUsd),
          sellOrderId: sellOrd.insertId,
          buyOrderId: buyOrd.insertId,
        });
        console.log('[mail] EXCHANGE receipt ->', u.email, resMail);
      } else {
        console.warn('[mail] user email missing for exchange receipt');
      }
    } catch (e) {
      console.warn('[mail] exchange email exception:', e?.message || e);
    }

    res.json({
      ok: true,
      from, to,
      filledFrom: Number(amount),
      filledTo: qtyTo,
      priceFrom: pFrom, priceTo: pTo,
      feeUsd: +feeUsd.toFixed(2)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Stripe ----------
app.post('/api/payments/create-intent', auth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    let { amountUsd, amountCents, coin, receiptEmail } = req.body || {};
    if (!amountCents) {
      if (!amountUsd || Number(amountUsd) < 1) return res.status(400).json({ error: 'Invalid amount' });
      amountCents = Math.round(Number(amountUsd) * 100);
    }

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card'],
      receipt_email: receiptEmail || undefined,
      metadata: {
        userId: String(req.user.id),
        coin: coin || '',
        amountUsd: amountUsd ? String(amountUsd) : String(amountCents / 100),
      }
    });

    res.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
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

// ---------- Redis ----------
const redis = createClient({ url: REDIS_URL });
let redisReady = false;
(async () => {
  try { await redis.connect(); redisReady = true; console.log('[redis] connected:', REDIS_URL.split('@').pop()); }
  catch (e) { console.warn('[redis] connect failed', e.message); }
})();
async function cacheGet(k) { if (!redisReady) return null; try { return await redis.get(k); } catch { return null; } }
async function cacheSet(k, v, ttl = 15) { if (!redisReady) return; try { await redis.set(k, v, { EX: ttl }); } catch {} }

// ---------- blockchain ----------
const provider = ETH_RPC_URL ? new ethers.JsonRpcProvider(ETH_RPC_URL) : null;
let signer = null;
if (provider && WALLET_PRIVATE_KEY) {
  try { signer = new ethers.Wallet(WALLET_PRIVATE_KEY, provider); }
  catch (e) { console.warn('[eth] bad WALLET_PRIVATE_KEY:', e.message); }
}
app.get('/api/wallet/:address', async (req, res) => {
  try {
    if (!provider) return res.status(500).json({ error: 'ETH_RPC_URL not configured' });
    const { address } = req.params;
    if (!ethers.isAddress(address)) return res.status(400).json({ error: 'invalid address' });
    const wei = await provider.getBalance(address);
    const eth = Number(ethers.formatEther(wei));
    const net = await provider.getNetwork();
    res.json({ network: net.name, address, balanceETH: eth });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tx/send', auth, async (req, res) => {
  try {
    if (!signer) return res.status(400).json({ error: 'no signer configured (WALLET_PRIVATE_KEY)' });
    const { to, amountEth } = req.body || {};
    if (!ethers.isAddress(to)) return res.status(400).json({ error: 'invalid to address' });
    const value = ethers.parseEther(String(amountEth || '0'));
    const tx = await signer.sendTransaction({ to, value });
    res.json({ hash: tx.hash });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// prices (cached)
app.get('/api/prices/:symbol', async (req, res) => {
  try {
    if (typeof fetch !== 'function') return res.status(500).json({ error: 'fetch not available (Node 18+ required)' });
    const sym = (req.params.symbol || '').toLowerCase();
    const key = `price:${sym}`;
    const cached = await cacheGet(key); if (cached) return res.json(JSON.parse(cached));
    const map = { btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', xrp: 'ripple', sol: 'solana' };
    const id = map[sym] || sym;
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`);
    if (!r.ok) return res.status(r.status).json({ error: `price fetch failed: ${r.statusText}` });
    const j = await r.json();
    const out = { symbol: sym.toUpperCase(), usd: j[id]?.usd ?? null, ts: Date.now() };
    await cacheSet(key, JSON.stringify(out), 15);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- AI ----------
app.post('/api/ai/insights', auth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.positions)) return res.status(400).json({ error: 'positions[] required' });

    if (!openai) {
      const total = body.positions.reduce((s, p) => s + (p.qty * p.avgPrice), 0) + (body.cashUsd || 0);
      const top = [...body.positions]
        .sort((a, b) => b.qty * b.avgPrice - a.qty * a.avgPrice)
        .slice(0, 3)
        .map(p => p.symbol);
      return res.json({
        model: 'rule-based',
        summary: `Total exposure ~ $${total.toFixed(2)}. Concentration in ${top.join(', ')}.`,
        tips: [
          'Cap any single position at ≤ 25% of portfolio.',
          'Keep 6–12 months of cash runway.',
          'Prefer limit orders; avoid chasing breakouts.',
        ],
      });
    }

    const prompt = `
You are a trading coach. User portfolio (USD):
${JSON.stringify(body, null, 2)}
1) 2–3 sentence overview of concentration and cash runway.
2) 3 tactical suggestions (bullets).
3) 2 risk controls (bullets). No guarantees.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    res.json({ model: 'gpt-4o-mini', text: completion.choices[0].message.content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- wallet & price helpers ----------
async function upsertWallet(userId, baseSymbol, delta) {
  const sym = baseSymbol.toUpperCase();

  // get/create asset id
  const ins = await exec(
    `INSERT INTO assets(symbol) VALUES (?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [sym]
  );
  const assetId = ins.insertId;

  // create-or-increment wallet row
  await exec(
    `INSERT INTO wallets(user_id, asset_id, balance)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
    [userId, assetId, delta]
  );
}
async function getWalletBalance(userId, baseSymbol) {
  const rows = await query(`
    SELECT w.balance
      FROM wallets w
      JOIN assets a ON a.id = w.asset_id
     WHERE w.user_id=? AND a.symbol=?`,
    [userId, baseSymbol.toUpperCase()]
  );
  return Number(rows[0]?.balance || 0);
}

// idempotency guard table (ensures PaymentIntent is processed once)
async function ensurePaymentGuardTable() {
  await exec(`
    CREATE TABLE IF NOT EXISTS payments_processed (
      pi_id VARCHAR(255) PRIMARY KEY,
      processed_at DATETIME NOT NULL
    ) ENGINE=InnoDB
  `);
}
ensurePaymentGuardTable().catch(e => console.error('ensurePaymentGuardTable error:', e));

// Fulfillment (idempotent) — called by webhook or /fulfill
async function creditUserForPaymentIntent(pi) {
  if (!pi || pi.status !== 'succeeded') return;

  // idempotency guard
  const guard = await exec(
    `INSERT IGNORE INTO payments_processed (pi_id, processed_at)
     VALUES (?, NOW())`,
    [pi.id]
  );
  if (guard.affectedRows === 0) return; // already processed

  const meta = pi.metadata || {};
  const userId = Number(meta.userId);
  const symbol = (meta.coin || 'BTC-USD').toUpperCase();
  const amountUsd = Number(meta.amountUsd || (pi.amount / 100));
  if (!userId || !symbol || !amountUsd) return;

  const lastPrice = getSymbolPrice(symbol) || 1;
  const base = symbol.split('-')[0];
  const qty = +(amountUsd / lastPrice).toFixed(8);

  const orderRes = await exec(
    `INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
     VALUES (?,?, 'BUY','MARKET', ?, ?, 'FILLED', CURRENT_TIMESTAMP)`,
    [userId, symbol, qty, lastPrice]
  );
  const orderId = orderRes.insertId;

  await exec(
    `INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
     VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [orderId, userId, symbol, lastPrice, qty]
  );

  await upsertWallet(userId, base, qty);

  await exec(
    `INSERT INTO payments(pi_id,user_id,coin,amount_usd,status,created_at)
     VALUES (?,?,?,?, 'succeeded', CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE status='succeeded', amount_usd=VALUES(amount_usd)`,
    [pi.id, userId, symbol, amountUsd]
  ).catch(() => {});

  // Send buy receipt (log results)
  try {
    const u = await getUserBasic(userId);
    const toEmail =
      pi.receipt_email ||
      (pi.charges?.data?.[0]?.billing_details?.email) ||
      u?.email || null;
    if (toEmail) {
      const resMail = await sendBuyEmail(toEmail, {
        firstName: u?.firstName || 'Trader',
        symbol,
        qty,
        price: lastPrice,
        amountUsd,
        orderId,
        paymentIntentId: pi.id,
      });
      console.log('[mail] BUY receipt (Stripe) ->', toEmail, resMail);
    } else {
      console.warn('[mail] no recipient email found for Stripe receipt');
    }
  } catch (e) {
    console.warn('[mail] buy receipt (Stripe) failed:', e?.message || e);
  }
}

// ---------- price sim + ws ----------
const prices = {
  'BTC-USD': 30000,
  'ETH-USD': 2000,
  'BNB-USD': 400,
  'LTC-USD': 75,
  'XRP-USD': 0.6,
  'SOL-USD': 150,
  'USDT-USD': 1
};
function getSymbolPrice(sym) { return prices[sym] || 0; }

let server;
if (USE_HTTPS) {
  server = https.createServer(
    { key: fs.readFileSync(SSL_KEY_PATH), cert: fs.readFileSync(SSL_CERT_PATH) },
    app
  );
  console.log('HTTPS enabled with local certs');
} else {
  server = http.createServer(app);
  console.log('HTTP only (USE_HTTPS=false)');
}

const wss = new WebSocket.Server({ server, path: '/ws' });
setInterval(() => {
  for (const s of Object.keys(prices)) {
    const drift = (Math.random() - 0.5) * (s === 'BTC-USD' ? 50 : 5);
    prices[s] = Math.max(0.01, prices[s] + drift);
    const msg = JSON.stringify({ type: 'tick', symbol: s, price: +prices[s].toFixed(2) });
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
  }
}, 1250);
wss.on('connection', ws => {
  Object.entries(prices).forEach(([s, p]) =>
    ws.send(JSON.stringify({ type: 'tick', symbol: s, price: +p.toFixed(2) }))
  );
});

// ---------- start ----------
server.listen(PORT, () => {
  console.log(`Server listening on ${USE_HTTPS ? 'https' : 'http'}://localhost:${PORT}`);
});
