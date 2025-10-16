// orders.js — reloads when trades happen via BroadcastChannel

const bc = new BroadcastChannel('ctx-sync');

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  try { localStorage.removeItem('token'); } catch {}
  location.replace('./auth/auth.html');
});

const $ = (s) => document.querySelector(s);
const tbody = document.querySelector('#ordersTable tbody');
const msg = document.getElementById('ordersMsg');

async function loadOrders() {
  try {
    const rows = await authed('/api/orders');
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${r.id}</td>
         <td>${r.symbol}</td>
         <td>${r.side}</td>
         <td>${r.type}</td>
         <td>${Number(r.qty)}</td>
         <td>${r.price ?? '-'}</td>
         <td>${r.status}</td>`;
      tbody.appendChild(tr);
    });
    if (msg) msg.textContent = '';
  } catch (e) {
    if (msg) { msg.textContent = e?.message || String(e); msg.className = 'msg error'; }
  }
}
loadOrders();

// refresh when any page completes a trade
bc.addEventListener('message', (ev) => {
  if (ev.data?.type === 'orders-updated') loadOrders();
});
