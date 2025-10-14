// Backend/blockchain.js
const express = require('express');
const fetch = require('node-fetch'); // if Node >=18, you can use global fetch
const { ethers } = require('ethers');
const { cacheGet, cacheSet } = require('./redisClient');

const router = express.Router();

// Provider & (optional) signer (testnets recommended)
const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
let signer = null;
if (process.env.WALLET_PRIVATE_KEY) {
  try { signer = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider); }
  catch (e) { console.warn('[eth] bad WALLET_PRIVATE_KEY:', e.message); }
}

// GET /api/wallet/:address
router.get('/wallet/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) return res.status(400).json({ error: 'invalid address' });
    const wei = await provider.getBalance(address);
    const eth = Number(ethers.formatEther(wei));
    const net = await provider.getNetwork();
    res.json({ network: net.name, address, balanceETH: eth });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/tx/send  { to, amountEth }  — testnet only
router.post('/tx/send', async (req, res) => {
  try {
    if (!signer) return res.status(400).json({ error: 'no signer configured (WALLET_PRIVATE_KEY)' });
    const { to, amountEth } = req.body || {};
    if (!ethers.isAddress(to)) return res.status(400).json({ error: 'invalid to address' });
    const value = ethers.parseEther(String(amountEth || '0'));
    const tx = await signer.sendTransaction({ to, value });
    res.json({ hash: tx.hash });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/prices/:symbol — cached CoinGecko lookup
router.get('/prices/:symbol', async (req, res) => {
  try {
    const sym = (req.params.symbol || '').toLowerCase(); // btc / eth / etc
    const key = `price:${sym}`;
    const cached = await cacheGet(key);
    if (cached) return res.json(JSON.parse(cached));

    const map = { btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', xrp: 'ripple', sol: 'solana' };
    const id = map[sym] || sym;
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`;
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: `price fetch failed: ${r.statusText}` });
    const j = await r.json();
    const out = { symbol: sym.toUpperCase(), usd: j[id]?.usd ?? null, ts: Date.now() };
    await cacheSet(key, JSON.stringify(out), 15);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
