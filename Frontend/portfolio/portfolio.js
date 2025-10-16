/* portfolio.js — shows account + donut; live refresh via BroadcastChannel */

const bc = new BroadcastChannel('ctx-sync');
const $ = (id) => document.getElementById(id);
const fmtUSD = (n) =>
  typeof n === 'number' && !Number.isNaN(n)
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    : '--';

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  try { localStorage.removeItem('token'); } catch {}
  location.href = './auth/auth.html';
});

(async function init() {
  await Promise.all([loadAccount(), loadSummary(), loadTransactions()]);
})();

async function loadAccount() {
  const acct = await authed('/api/account');
  const name = [acct.first_name, acct.middle_name, acct.last_name].filter(Boolean).join(' ') || acct.email || '—';
  $('acctName').textContent = name;
  if (acct.created_at) $('acctSince').textContent = new Date(acct.created_at).toLocaleDateString();
}

async function loadSummary() {
  const sum = await authed('/api/account/summary');
  const bal = (Number(sum.income) || 0) - (Number(sum.expenses) || 0);
  $('balanceUSD').textContent = fmtUSD(bal);
  $('incomeUSD').textContent = fmtUSD(Number(sum.income) || 0);
  $('expensesUSD').textContent = fmtUSD(Number(sum.expenses) || 0);

  // Use /api/balances for actual holdings; value them in USD using lastMarkets (fallbacks if needed)
  const b = await authed('/api/balances');
  const balances = b?.balances || {};
  const markets = JSON.parse(localStorage.getItem('lastMarkets') || '[]');
  const price = (base) => {
    const t = markets.find(m => m.symbol === `${base}-USD`);
    return t?.price ?? t?.last ?? (base === 'USDT' ? 1 : (base === 'USD' ? 1 : (base === 'BTC' ? 68000 : base === 'ETH' ? 2800 : base === 'SOL' ? 150 : 0)));
  };

  const parts = Object.entries(balances)
    .filter(([, v]) => Number(v) > 0)
    .map(([asset, qty]) => ({ label: asset, value: Number(qty) * Number(price(asset)) }));

  renderDonut(parts);
}

async function loadTransactions() {
  const rows = await authed('/api/transactions');
  const tbody = $('txTableBody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const created = new Date(r.created_at);
    const value = Number(r.price) * Number(r.qty);
    tr.innerHTML = `
      <td>${created.toLocaleString()}</td>
      <td>${r.symbol}</td>
      <td>${Number(r.qty).toFixed(12)}</td>
      <td>${r.price ? fmtUSD(Number(r.price)) : '-'}</td>
      <td>${r.price ? fmtUSD(value) : '-'}</td>`;
    tbody.appendChild(tr);
  });
}

/* Donut */
let chart;
function renderDonut(parts) {
  const ctx = document.getElementById('portfolioChart');
  const legend = document.getElementById('chartLegend');
  if (!ctx) return;

  const labels = parts.map(p => p.label);
  const values = parts.map(p => p.value);
  const colors = labels.map((_, i) => `hsl(${(i * 47) % 360} 70% 50%)`);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
    options: { plugins: { legend: { display: false } } }
  });

  legend.innerHTML = labels.map((l, i) => `<div><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${colors[i]};margin-right:6px"></span>${l}</div>`).join('');
}

// live refresh after trades
bc.addEventListener('message', (ev) => {
  if (ev.data?.type === 'orders-updated') {
    loadSummary();
    loadTransactions();
  }
});
