// trade.js — buy with card, sell, and exchange (scoped white inputs for Buy)
const FALLBACK_PRICES = { BTC: 68000, ETH: 2800, SOL: 150, USDT: 1, USD: 1 };
const bc = new BroadcastChannel('ctx-sync');

// utils
const fmt = (n, d = 2) => (isFinite(n) ? Number(n).toFixed(d).replace(/\.0+$/, '').replace(/(\..*?)0+$/, '$1') : '—');
function priceFromMarkets(ticker) {
  const arr = JSON.parse(localStorage.getItem('lastMarkets') || '[]');
  const item = arr.find((x) => x.symbol === ticker);
  if (item && (item.last || item.price || item.mid)) return Number(item.last || item.price || item.mid);
  const base = ticker.split('-')[0];
  return FALLBACK_PRICES[base] ?? 0;
}
const coinMidUsd = (coin) => (coin === 'USD' ? 1 : priceFromMarkets(coin + '-USD'));

function setActiveTab(btn) {
  document.querySelectorAll('.toggle-tab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const target = btn.getAttribute('data-target');
  document.querySelectorAll('main .card').forEach((s) => s.classList.add('hidden'));
  document.querySelector(target).classList.remove('hidden');
}

// auth/logout
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  try { localStorage.removeItem('token'); } catch {}
  location.replace('/landing/landing.html');
});

// tab switching
document.querySelectorAll('.toggle-tab').forEach((btn) => btn.addEventListener('click', () => setActiveTab(btn)));

// ---------- balances ----------
let BALANCES = {}; // { BTC: 0.12, ETH: 1.5, ... }
async function loadBalances() {
  try {
    const r = await authed('/api/balances');
    BALANCES = r?.balances || {};
    localStorage.setItem('lastBalances', JSON.stringify(BALANCES));
  } catch {
    BALANCES = JSON.parse(localStorage.getItem('lastBalances') || '{}');
  }
  return BALANCES;
}
const ownedCoins = () => Object.entries(BALANCES).filter(([a, v]) => a !== 'USD' && Number(v) > 0).map(([a]) => a);

// ---------- BUY WITH CARD ----------
(function setupStripePurchase() {
  const purchaseForm = document.getElementById('purchaseForm');
  if (!purchaseForm) return;

  const purchaseCoinSel = document.getElementById('purchaseCoin');
  (function populateBuyList() {
    const tickers = JSON.parse(localStorage.getItem('lastMarkets') || '[]');
    const bases = new Set(['BTC', 'ETH', 'SOL', 'USDT']);
    tickers.forEach((t) => { const [b, q] = String(t.symbol).split('-'); if (q === 'USD') bases.add(b); });
    purchaseCoinSel.innerHTML = '';
    [...bases].forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; purchaseCoinSel.appendChild(o); });
  })();

  const payBtn = document.getElementById('payBtn');
  const purchaseMsg = document.getElementById('purchaseMsg');

  const stripePubKey = (window.CONFIG && window.CONFIG.STRIPE_PUBLISHABLE_KEY) || window.STRIPE_PUBLISHABLE_KEY;
  if (!stripePubKey || !window.Stripe) {
    purchaseMsg.textContent = 'Stripe is not configured. Add STRIPE_PUBLISHABLE_KEY in config.js and include Stripe.js.';
    purchaseMsg.classList.add('error');
    return;
  }

  const stripe = Stripe(stripePubKey);
  const elements = stripe.elements();

  // mount guard (avoid double mounting the card element)
  if (!window.__CTX_CARD_MOUNTED__) {
    const card = elements.create('card', {
      hidePostalCode: true,
      style: {
        base: {
          color: '#111827',            // dark text on white input
          iconColor: '#111827',
          fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial',
          fontSize: '16px',
          lineHeight: '28px',          // matches CSS iframe height
          '::placeholder': { color: '#9ca3af' },
          ':-webkit-autofill': { color: '#111827' }
        },
        invalid: { color: '#b91c1c', iconColor: '#b91c1c' }
      }
    });
    card.mount('#card-element');
    window.__CTX_CARD_MOUNTED__ = true;
    window.__CTX_CARD__ = card;

    card.on('change', (evt) => {
      const el = document.getElementById('card-errors');
      if (el) el.textContent = evt.error ? evt.error.message : '';
    });
  }

  purchaseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    purchaseMsg.textContent = '';
    purchaseMsg.className = 'msg';

    const coin = document.getElementById('purchaseCoin').value;
    const amountUsd = Math.floor(parseFloat(document.getElementById('amountUsd').value || '0'));
    const name = document.getElementById('buyerName').value.trim();
    const email = document.getElementById('buyerEmail').value.trim();

    if (!coin) { purchaseMsg.textContent = 'Please select a coin.'; purchaseMsg.className = 'msg error'; return; }
    if (!amountUsd || amountUsd < 1) { purchaseMsg.textContent = 'Enter a valid USD amount (min $1).'; purchaseMsg.className = 'msg error'; return; }
    if (!name) { purchaseMsg.textContent = 'Enter the cardholder name.'; purchaseMsg.className = 'msg error'; return; }
    if (!email) { purchaseMsg.textContent = 'Enter a valid email.'; purchaseMsg.className = 'msg error'; return; }

    payBtn.disabled = true; payBtn.textContent = 'Processing…';

    try {
      const intent = await authed('/api/payments/create-intent', {
        method: 'POST',
        body: JSON.stringify({ amountUsd, coin, receiptEmail: email })
      });
      if (!intent?.clientSecret) throw new Error('Failed to create payment.');

      const { error, paymentIntent } = await stripe.confirmCardPayment(intent.clientSecret, {
        payment_method: { card: window.__CTX_CARD__, billing_details: { name, email } }
      });
      if (error) throw new Error(error.message || 'Your card was declined.');

      if (paymentIntent?.status === 'succeeded') {
        purchaseMsg.textContent = 'Payment successful! Your coins will be credited shortly.';
        purchaseMsg.className = 'msg success';
        try {
          await authed('/api/payments/fulfill', {
            method: 'POST',
            body: JSON.stringify({ paymentIntentId: paymentIntent.id })
          });
        } catch {}
        purchaseForm.reset();
        window.__CTX_CARD__?.clear();
        await loadBalances();
        bc.postMessage({ type: 'orders-updated' });
      } else {
        purchaseMsg.textContent = 'Payment processing…';
        purchaseMsg.className = 'msg';
      }
    } catch (err) {
      purchaseMsg.textContent = err?.message || String(err);
      purchaseMsg.className = 'msg error';
    } finally {
      payBtn.disabled = false; payBtn.textContent = 'Pay with card';
    }
  });
})();

// ---------- SELL ----------
(async function setupSell() {
  const form = document.getElementById('sellSpot');
  if (!form) return;

  const coinSel = document.getElementById('sellCoin');
  const qtyInp = document.getElementById('sellQty');
  const msg = document.getElementById('sellMsg');
  const ownedLbl = document.getElementById('sellOwned');
  const sellBtn = document.getElementById('sellBtn');

  await loadBalances();

  function populate() {
    const list = ownedCoins();
    coinSel.innerHTML = '';
    list.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; coinSel.appendChild(o); });
    updateOwned();
  }
  function updateOwned() {
    const c = coinSel.value || ownedCoins()[0];
    if (!c) { ownedLbl.textContent = 'You own —'; qtyInp.max = ''; sellBtn.disabled = true; return; }
    const bal = Number(BALANCES[c] || 0);
    ownedLbl.textContent = `You own ${fmt(bal, 8)} ${c}`;
    qtyInp.max = String(bal);
    validate();
  }
  function updateSummary() {
    const c = coinSel.value;
    const q = Number(qtyInp.value || 0);
    const mid = coinMidUsd(c);
    const gross = q * mid;
    const fee = gross * 0.001;
    document.getElementById('sellMid').textContent = `${fmt(mid, 2)} USD`;
    document.getElementById('sellUsd').textContent = `${fmt(Math.max(gross - fee, 0), 2)} USD`;
    document.getElementById('sellFee').textContent = `${fmt(fee, 2)} USD`;
  }
  function validate() {
    const c = coinSel.value;
    const q = Number(qtyInp.value || 0);
    const bal = Number(BALANCES[c] || 0);
    sellBtn.disabled = !(q > 0 && q <= bal);
  }

  document.getElementById('sellMaxBtn')?.addEventListener('click', () => {
    const c = coinSel.value;
    qtyInp.value = BALANCES[c] || 0;
    updateSummary(); validate();
  });

  coinSel.addEventListener('change', () => { updateOwned(); updateSummary(); });
  qtyInp.addEventListener('input', () => { updateSummary(); validate(); });

  populate(); updateSummary(); validate();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = ''; msg.className = 'msg';

    const symbol = (coinSel.value || '') + '-USD';
    const qty = Number(qtyInp.value || 0);
    if (!qty || qty <= 0) { msg.textContent = 'Enter a valid amount.'; msg.className = 'msg error'; return; }

    try {
      await authed('/api/trades/spot', { method: 'POST', body: JSON.stringify({ symbol, side: 'SELL', type: 'MARKET', qty }) });
      msg.textContent = 'Sold successfully.'; msg.className = 'msg success';
      await loadBalances(); populate(); updateSummary(); validate();
      bc.postMessage({ type: 'orders-updated' });
      form.reset();
    } catch (err) {
      msg.textContent = err?.message || String(err); msg.className = 'msg error';
    }
  });
})();

// ---------- EXCHANGE ----------
(async function setupSwap() {
  const form = document.getElementById('swapForm');
  if (!form) return;

  const fromSel = document.getElementById('swapFrom');
  const toSel = document.getElementById('swapTo');
  const amtInp = document.getElementById('swapAmt');
  const slipInp = document.getElementById('slip');
  const rateEl = document.getElementById('swapRate');
  const recvEl = document.getElementById('swapReceive');
  const msg = document.getElementById('swapMsg');
  const ownedLbl = document.getElementById('swapOwned');
  const swapBtn = document.getElementById('swapBtn');

  await loadBalances();

  function refreshLists() {
    const have = ownedCoins();
    const all = new Set(['BTC', 'ETH', 'SOL', 'USDT']);
    JSON.parse(localStorage.getItem('lastMarkets') || '[]').forEach(t => { const [b,q] = String(t.symbol).split('-'); if (q==='USD') all.add(b); });

    fromSel.innerHTML = ''; have.forEach(c => { const o=document.createElement('option'); o.value=c; o.textContent=c; fromSel.appendChild(o); });

    toSel.innerHTML = '';
    [...all].forEach(c => {
      if (c !== fromSel.value) { const o=document.createElement('option'); o.value=c; o.textContent=c; toSel.appendChild(o); }
    });

    updateOwned(); updateRate(); validate();
  }
  function updateOwned() {
    const c = fromSel.value || ownedCoins()[0];
    if (!c) { ownedLbl.textContent = 'You own —'; amtInp.max=''; swapBtn.disabled = true; return; }
    const bal = Number(BALANCES[c] || 0);
    ownedLbl.textContent = `You own ${fmt(bal, 8)} ${c}`;
    amtInp.max = String(bal);
  }
  function updateRate() {
    const f = fromSel.value; const t = toSel.value;
    const rate = coinMidUsd(f) / coinMidUsd(t);
    rateEl.textContent = `1 ${f} ≈ ${fmt(rate, 6)} ${t}`;
    const amt = Number(amtInp.value || 0);
    const fee = (amt * coinMidUsd(f)) * 0.001;
    const receive = Math.max(((amt * coinMidUsd(f)) - fee) / coinMidUsd(t), 0);
    recvEl.textContent = `${fmt(receive, 8)} ${t}`;
  }
  function validate() {
    const f = fromSel.value; const amt = Number(amtInp.value || 0);
    swapBtn.disabled = !(f && amt > 0 && amt <= Number(BALANCES[f] || 0));
  }

  document.getElementById('swapMaxBtn')?.addEventListener('click', () => {
    const c = fromSel.value; amtInp.value = BALANCES[c] || 0; updateRate(); validate();
  });

  fromSel.addEventListener('change', () => { refreshLists(); });
  toSel.addEventListener('change', () => { updateRate(); });
  amtInp.addEventListener('input', () => { updateRate(); validate(); });
  slipInp.addEventListener('input', updateRate);

  refreshLists();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = ''; msg.className = 'msg';
    const from = fromSel.value, to = toSel.value, amount = Number(amtInp.value || 0);
    const maxSlippagePct = Number(slipInp.value || 0.5);
    if (!from || !to || !amount || amount <= 0) { msg.textContent = 'Enter a valid swap.'; msg.className = 'msg error'; return; }

    try {
      await authed('/api/trades/exchange', { method: 'POST', body: JSON.stringify({ from, to, amount, maxSlippagePct }) });
      msg.textContent = 'Swap complete.'; msg.className = 'msg success';
      await loadBalances(); refreshLists(); updateRate(); validate();
      bc.postMessage({ type: 'orders-updated' });
      form.reset();
    } catch (err) {
      msg.textContent = err?.message || String(err); msg.className = 'msg error';
    }
  });
})();
