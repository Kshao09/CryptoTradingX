/* portfolio.js */
// portfolio.js
const API_BASE =
  (window.CONFIG && window.CONFIG.API_BASE) || 'https://localhost:3001';

const token = localStorage.getItem('token');
const $ = (id) => document.getElementById(id);

const fmtUSD = (n) =>
  typeof n === 'number' && !Number.isNaN(n)
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    : '--';

function fullName(acct) {
  return [acct.first_name, acct.middle_name, acct.last_name].filter(Boolean).join(' ');
}

// Logout
const logoutBtn = $('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    location.href = '../auth/auth.html';
  });
}

(async function init() {
  try {
    await Promise.all([loadAccount(), loadSummary(), loadTransactions()]);
  } catch (e) {
    console.error('init error', e);
  }
})();

async function authedGet(path, opts) {
  return authed(path, opts); // from utils.js
}

async function loadAccount() {
  try {
    const acct = await authedGet('/api/account');

    const name = fullName(acct) || acct.email || '—';
    const nameEl = $('acctName');
    if (nameEl) nameEl.textContent = name;

    const sinceEl = $('acctSince');
    if (sinceEl && acct.created_at) {
      const d = new Date(acct.created_at);
      sinceEl.textContent = d.toLocaleDateString();
    }
  } catch (e) {
    console.error('loadAccount error', e);
  }
}

async function loadSummary() {
  try {
    const sum = await authedGet('/api/account/summary');

    const bal = (Number(sum.income) || 0) - (Number(sum.expenses) || 0);
    $('balanceUSD').textContent = fmtUSD(bal);
    $('incomeUSD').textContent = fmtUSD(Number(sum.income) || 0);
    $('expensesUSD').textContent = fmtUSD(Number(sum.expenses) || 0);

    const wallets = Array.isArray(sum.wallets) ? sum.wallets : [];
    const parts = wallets
      .filter(w => Number(w.balance) > 0)
      .map(w => ({ label: String(w.asset), value: Number(w.balance) }));

    renderDonut(parts);
  } catch (e) {
    console.error('loadSummary error', e);
  }
}

async function loadTransactions() {
  try {
    const rows = await authedGet('/api/transactions');
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
        <td>${r.price ? fmtUSD(value) : '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('loadTransactions error', e);
  }
}

/* --------- Donut chart --------- */
let chart;
function renderDonut(parts) {
  const ctx = document.getElementById('portfolioChart');
  if (!ctx) return;

  if (chart) { chart.destroy(); chart = undefined; }

  if (!parts.length) {
    const legend = document.getElementById('chartLegend');
    if (legend) legend.textContent = 'No holdings yet';
    return;
  }

  const labels = parts.map(p => p.label);
  const data = parts.map(p => p.value);

  chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${labels[item.dataIndex]}: ${data[item.dataIndex]}` } }
      },
      cutout: '64%',
      animation: { duration: 450 }
    }
  });

  const legend = document.getElementById('chartLegend');
  if (legend) {
    legend.innerHTML = labels.map((l, i) => {
      const c = chart.data.datasets[0].backgroundColor?.[i] || '#8aa';
      return `
        <span class="legend-item" style="display:inline-flex;align-items:center;margin-right:12px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:6px;"></span>
          ${l}
        </span>`;
    }).join('');
  }
}
