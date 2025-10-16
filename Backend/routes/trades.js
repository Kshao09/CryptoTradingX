// Backend/routes/trades.js
const express = require('express');
const { query, exec } = require('../db'); // uses your existing MySQL pool

const router = express.Router();

// ----- config -----
const FEE_BPS = 10; // 0.10%

// simple mid prices (replace with your price feed when ready)
const MID_USD = { BTC: 68000, ETH: 2800, SOL: 150, USDT: 1, USD: 1 };
function midUsd(asset) { return MID_USD[asset.toUpperCase()] ?? 0; }
function fee(usd) { return (usd * FEE_BPS) / 10000; }

// ----- schema helpers (safe to run repeatedly) -----
async function ensureSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      symbol VARCHAR(32) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id INT NOT NULL,
      asset_id INT NOT NULL,
      balance DECIMAL(38,18) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, asset_id),
      INDEX (asset_id),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      side ENUM('BUY','SELL') NOT NULL,
      type ENUM('MARKET','LIMIT') NOT NULL,
      qty DECIMAL(38,18) NOT NULL,
      price DECIMAL(38,18) NOT NULL,
      status ENUM('NEW','FILLED','REJECTED') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  await exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      user_id INT NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      price DECIMAL(38,18) NOT NULL,
      qty DECIMAL(38,18) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (order_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
}
ensureSchema().catch(err => console.error('[trades] ensureSchema', err));

// get balances as an object map { BTC: 0.12, USD: 100, ... }
async function getBalances(userId) {
  const rows = await query(`
    SELECT a.symbol AS asset, w.balance
      FROM wallets w JOIN assets a ON a.id=w.asset_id
     WHERE w.user_id=?`, [userId]);
  const out = {};
  rows.forEach(r => out[r.asset] = Number(r.balance));
  if (out.USD == null) out.USD = 0;
  return out;
}

// create asset if missing & add delta to wallet
async function upsertWallet(userId, asset, delta) {
  const sym = asset.toUpperCase();
  const ins = await exec(
    `INSERT INTO assets(symbol) VALUES (?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [sym]
  );
  const assetId = ins.insertId;
  await exec(
    `INSERT INTO wallets(user_id, asset_id, balance)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
    [userId, assetId, delta]
  );
}

// ---------- GET /api/balances ----------
router.get('/balances', async (req, res) => {
  try {
    const userId = req.user.id; // auth is applied at mount
    const balances = await getBalances(userId);
    res.json({ userId, balances });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- POST /api/trades/spot ----------
/**
 * Body: { side:'buy'|'sell', symbol:'BTC-USD', type:'market'|'limit', qty:number, price?:number }
 * Fills immediately at mid (or provided limit) and persists orders, trades, wallets.
 */
router.post('/trades/spot', async (req, res) => {
  try {
    const userId = req.user.id;
    const { side, symbol, type='market', qty, price } = req.body || {};
    if (!side || !symbol || !qty) return res.status(400).json({ error: 'Missing fields' });

    const [base, quote] = String(symbol).toUpperCase().split('-');
    if (quote !== 'USD') return res.status(400).json({ error: 'Only <COIN>-USD supported' });

    const q = Number(qty);
    if (!(q > 0)) return res.status(400).json({ error: 'qty must be > 0' });

    const mid = midUsd(base);
    if (!(mid > 0)) return res.status(400).json({ error: 'No price' });

    // execution price (very simple)
    let execPx = (String(type).toUpperCase() === 'LIMIT') ? Number(price || 0) : mid;
    if (!(execPx > 0)) execPx = mid;

    const notional = q * execPx;
    const f = fee(notional);

    // balances
    const bals = await getBalances(userId);
    const usd = Number(bals.USD || 0);
    const baseBal = Number(bals[base] || 0);

    if (String(side).toUpperCase() === 'BUY') {
      const need = notional + f;
      if (usd + 1e-12 < need) return res.status(400).json({ error: 'Insufficient USD' });
      await upsertWallet(userId, 'USD', -need);
      await upsertWallet(userId, base, q);
    } else {
      if (baseBal + 1e-12 < q) return res.status(400).json({ error: `Insufficient ${base}` });
      await upsertWallet(userId, base, -q);
      await upsertWallet(userId, 'USD', notional - f);
    }

    const order = await exec(
      `INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
       VALUES (?,?,?,?,?,?, 'FILLED', CURRENT_TIMESTAMP)`,
      [userId, `${base}-USD`, String(side).toUpperCase(), String(type).toUpperCase(), q, execPx]
    );
    await exec(
      `INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
       VALUES (?,?,?,?,?, CURRENT_TIMESTAMP)`,
      [order.insertId, userId, `${base}-USD`, execPx, q]
    );

    const balances = await getBalances(userId);
    res.json({
      orderId: order.insertId,
      side: String(side).toUpperCase(),
      symbol: `${base}-USD`,
      type: String(type).toUpperCase(),
      qty: q,
      price: execPx,
      feeUsd: f,
      filledUsd: notional,
      balances
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- POST /api/trades/exchange ----------
/**
 * Body: { from:'ETH', to:'BTC', amount:number, maxSlippagePct:number }
 * Swaps A→USD→B at mids (minus fee), slippage guard, persists as a BUY of <to>-USD.
 */
router.post('/trades/exchange', async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to, amount, maxSlippagePct = 0.5 } = req.body || {};
    if (!from || !to || !amount) return res.status(400).json({ error: 'Missing fields' });
    if (from === to) return res.status(400).json({ error: 'from and to must differ' });

    const a = Number(amount);
    if (!(a > 0)) return res.status(400).json({ error: 'amount must be > 0' });

    const pFrom = midUsd(from);
    const pTo = midUsd(to);
    if (!(pFrom > 0 && pTo > 0)) return res.status(400).json({ error: 'No price' });

    const bals = await getBalances(userId);
    const fromBal = Number(bals[from] || 0);
    if (fromBal + 1e-12 < a) return res.status(400).json({ error: `Insufficient ${from}` });

    const grossUsd = a * pFrom;
    const f = fee(grossUsd);
    const receive = (grossUsd - f) / pTo;
    const minReceive = receive * (1 - Number(maxSlippagePct) / 100);

    // (demo fills at mid, passes guard)
    if (!(receive >= minReceive)) return res.status(400).json({ error: 'Slippage too high' });

    await upsertWallet(userId, from, -a);
    await upsertWallet(userId, to, receive);

    // store as a single buy of the TO asset (you may also insert a synthetic sell of FROM if you want)
    const order = await exec(
      `INSERT INTO orders(user_id,symbol,side,type,qty,price,status,created_at)
       VALUES (?,?,?,?,?,?, 'FILLED', CURRENT_TIMESTAMP)`,
      [userId, `${to}-USD`, 'BUY', 'MARKET', receive, pTo]
    );
    await exec(
      `INSERT INTO trades(order_id,user_id,symbol,price,qty,created_at)
       VALUES (?,?,?,?,?, CURRENT_TIMESTAMP)`,
      [order.insertId, userId, `${to}-USD`, pTo, receive]
    );

    const balances = await getBalances(userId);
    res.json({
      swapId: 'swp_' + Math.random().toString(36).slice(2, 10),
      executedRate: pFrom / pTo,
      feeUsd: f,
      received: receive,
      minReceived,
      balances
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
