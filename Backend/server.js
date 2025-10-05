require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const WebSocket = require('ws');
const { query, exec } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

/* ---------- Helpers ---------- */
function sign(u) {
  return jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '2h' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: 'No token' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: 'Invalid token' }); }
}

/* ---------- Health ---------- */
app.get(['/api/health', '/health'], (_req, res) => res.json({ ok: true }));

/* ---------- Auth ---------- */
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'email/password required' });

  const exists = await query('SELECT id FROM users WHERE email=?', [email]);
  if (exists.length) return res.status(409).json({ message: 'email already registered' });

  const hash = await bcrypt.hash(password, 10);
  await exec('INSERT INTO users(email,password_hash) VALUES(?,?)', [email, hash]);
  const user = (await query('SELECT id,email FROM users WHERE email=?', [email]))[0];
  res.json({ message: 'ok', token: sign(user) });
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

/* ---------- Orders & Portfolio ---------- */
app.get('/api/orders', auth, async (req, res) => {
  const rows = await query('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', [req.user.id]);
  res.json(rows);
});

app.get('/api/portfolio', auth, async (req, res) => {
  const rows = await query(
    'SELECT a.symbol AS asset, w.balance ' +
    'FROM wallets w JOIN assets a ON a.id=w.asset_id ' +
    'WHERE w.user_id=?',
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/orders', auth, async (req, res) => {
  const { symbol, side, type, qty, price } = req.body || {};
  if (!symbol || !side || !type || !qty) return res.status(400).json({ message: 'missing fields' });

  // Insert order; MySQL will assign INT AUTO_INCREMENT id
  const result = await exec(
    'INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at) ' +
    'VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
    [req.user.id, symbol, side, type, qty, price || null, 'NEW']
  );
  const orderId = result.insertId;

  // Determine fill using current simulated price
  const last = getSymbolPrice(symbol);
  const willFill =
    type === 'MARKET' ||
    (side === 'BUY' && price != null && last <= price) ||
    (side === 'SELL' && price != null && last >= price);

  if (willFill) {
    await exec(
      'INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at) ' +
      'VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)',
      [orderId, req.user.id, symbol, last, qty]
    );
    await exec('UPDATE orders SET status=? WHERE id=?', ['FILLED', orderId]);

    // Update wallet (base asset)
    const base = symbol.split('-')[0];
    await upsertWallet(req.user.id, base, side === 'BUY' ? qty : -qty);
  }

  res.json({ id: orderId, status: willFill ? 'FILLED' : 'NEW' });
});

/* ---------- Wallet helper ---------- */
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

/* ---------- WebSocket price simulator ---------- */
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const prices = { 'BTC-USD': 30000, 'ETH-USD': 2000 };
function getSymbolPrice(sym) { return prices[sym] || 0; }

setInterval(() => {
  for (const s of Object.keys(prices)) {
    const drift = (Math.random() - 0.5) * (s === 'BTC-USD' ? 50 : 5);
    prices[s] = Math.max(1, prices[s] + drift);
    const msg = JSON.stringify({ type: 'tick', symbol: s, price: +prices[s].toFixed(2) });
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
  }
}, 1250);

wss.on('connection', ws => {
  Object.entries(prices).forEach(([s, p]) =>
    ws.send(JSON.stringify({ type: 'tick', symbol: s, price: +p.toFixed(2) }))
  );
});

/* ---------- Start ---------- */
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
