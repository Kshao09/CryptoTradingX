const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- Auth gate ---------- */
let token = localStorage.getItem('token');
if (!token) {
  window.location.replace("/");
}

/* helper: authorized fetch with 401->login redirect */
async function authed(path, init = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    init.headers || {}
  );
  const r = await fetch(`${CTX.API}${path}`, Object.assign({}, init, { headers }));
  if (r.status === 401) {
    localStorage.removeItem('token');
    window.location.replace('/');
    return;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'Request failed');
  return data;
}

/* ---------- Sidebar view switching ---------- */
$$('.sidebar button').forEach(b => b.addEventListener('click', () => {
  $$('.sidebar button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const v = b.dataset.view;
  $$('.view').forEach(x => x.classList.remove('active'));
  $(`#view-${v}`).classList.add('active');
  if (v === 'orders') loadOrders();
  if (v === 'portfolio') loadPortfolio();
}));

/* ---------- Logout ---------- */
$('#logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.replace('/');
});

/* ---------- Price updates via WebSocket ---------- */
let ws;
function connectWS(){
  try {
    ws = new WebSocket(CTX.WS);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'tick') {
        if (m.symbol === 'BTC-USD') $('#btcPrice').textContent = m.price.toFixed(2);
        if (m.symbol === 'ETH-USD') $('#ethPrice').textContent = m.price.toFixed(2);
      }
    });
    ws.addEventListener('close', () => setTimeout(connectWS, 1500));
  } catch {}
}
connectWS();

/* ---------- Trade form ---------- */
$('#type').addEventListener('change', (e) => {
  const isLimit = e.target.value === 'LIMIT';
  $('#priceWrap').style.display = isLimit ? 'block' : 'none';
});
$('#priceWrap').style.display = 'none';

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#tradeMsg').textContent = 'Submitting...';
  try {
    const body = {
      symbol: $('#symbol').value,
      side:   $('#side').value,
      type:   $('#type').value,
      qty:    parseFloat($('#qty').value),
      price:  $('#type').value === 'LIMIT' ? parseFloat($('#price').value) : null
    };
    const d = await authed('/api/orders', { method:'POST', body: JSON.stringify(body) });
    $('#tradeMsg').textContent = `Order ${d.id} ${d.status}.`;
    loadOrders(); loadPortfolio();
  } catch (err) {
    $('#tradeMsg').textContent = err.message;
  }
});

/* ---------- Data loaders ---------- */
async function loadOrders(){
  const rows = await authed('/api/orders');
  const tbody = $('#ordersTable tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td><td>${r.symbol}</td><td>${r.side}</td>
                    <td>${r.type}</td><td>${+r.qty}</td><td>${r.price ?? '-'}</td><td>${r.status}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadPortfolio(){
  const rows = await authed('/api/portfolio');
  const tbody = $('#portfolioTable tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.asset}</td><td>${r.balance}</td>`;
    tbody.appendChild(tr);
  });
}

/* default landing view */
loadOrders();
loadPortfolio();
