const API = 'http://localhost:3001';
let token = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// Sidebar navigation
$$('.sidebar button').forEach((b) => {
  b.addEventListener('click', () => {
    $$('.sidebar button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');

    const v = b.dataset.view;
    $$('.view').forEach((x) => x.classList.remove('active'));
    document.getElementById(v).classList.add('active');

    if (v === 'orders') loadOrders();
    if (v === 'portfolio') loadPortfolio();
    if (v === 'trade') $('#tradeMsg').textContent = '';
  });
});

// Show/hide limit price input
$('#otype').addEventListener('change', (e) => {
  if (e.target.value === 'LIMIT') {
    $('#priceWrap').classList.remove('hidden');
  } else {
    $('#priceWrap').classList.add('hidden');
  }
});

// Sign up
$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    email: $('#suEmail').value.trim(),
    password: $('#suPass').value,
  };

  const r = await fetch(API + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const d = await r.json();
  $('#suMsg').textContent = d.message || (r.ok ? 'Created!' : 'Error');
});

// Login
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    email: $('#liEmail').value.trim(),
    password: $('#liPass').value,
  };

  const r = await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const d = await r.json();
  if (r.ok) {
    token = d.token;
    $('#liMsg').textContent = 'Logged in!';
  } else {
    $('#liMsg').textContent = d.message || 'Login failed';
  }
});

// Submit trade order
$('#tradeForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!token) {
    $('#tradeMsg').textContent = 'Please login first.';
    return;
  }

  const payload = {
    symbol: $('#symbol').value,
    side: $('#side').value,
    type: $('#otype').value,
    qty: parseFloat($('#qty').value),
    price: $('#otype').value === 'LIMIT' ? parseFloat($('#price').value) : null,
  };

  const r = await fetch(API + '/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const d = await r.json();
  $('#tradeMsg').textContent = r.ok ? 'Order ' + d.id + ' accepted.' : d.message || 'Error';

  if (r.ok) {
    loadOrders();
    loadPortfolio();
  }
});

// Load orders into table
async function loadOrders() {
  if (!token) return;

  const r = await fetch(API + '/api/orders', {
    headers: { Authorization: 'Bearer ' + token },
  });

  const d = await r.json();
  const tb = $('#ordersTable tbody');
  tb.innerHTML = '';

  (d || []).forEach((o) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${o.id}</td>
      <td>${o.symbol}</td>
      <td>${o.side}</td>
      <td>${o.type}</td>
      <td>${o.qty}</td>
      <td>${o.price ?? ''}</td>
      <td>${o.status}</td>
      <td>${new Date(o.created_at).toLocaleString()}</td>
    `;
    tb.appendChild(tr);
  });
}

// Load portfolio into table
async function loadPortfolio() {
  if (!token) return;

  const r = await fetch(API + '/api/portfolio', {
    headers: { Authorization: 'Bearer ' + token },
  });

  const d = await r.json();
  const tb = $('#portfolioTable tbody');
  tb.innerHTML = '';

  (d || []).forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.asset}</td><td>${p.balance}</td>`;
    tb.appendChild(tr);
  });
}

// WebSocket for live ticks
const ws = new WebSocket('ws://localhost:3001/ws');
ws.onmessage = (ev) => {
  try {
    const m = JSON.parse(ev.data);
    if (m.type === 'tick') {
      if (m.symbol === 'BTC-USD') $('#btcPrice').textContent = m.price.toFixed(2);
      if (m.symbol === 'ETH-USD') $('#ethPrice').textContent = m.price.toFixed(2);
    }
  } catch (err) {
    // ignore malformed messages
    console.warn('ws parse error', err);
  }
};
