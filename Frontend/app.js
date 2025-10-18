// app.js — SPA shell for Markets / Trade bar / Orders / Portfolio
// Uses authed() from utils.js and CONFIG from config.js

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

function fmtPrice(v){
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  const n = Number(v);
  return n >= 1 ? `$${n.toLocaleString(undefined,{maximumFractionDigits:2})}`
                : `$${n.toLocaleString(undefined,{maximumFractionDigits:6})}`;
}
function fmtPct(v){ if (v==null || Number.isNaN(v)) return '--'; return `${Number(v).toFixed(2)}%`; }
function shortNumber(n){
  if (n==null || Number.isNaN(n)) return '--';
  const abs = Math.abs(n);
  if (abs>=1e12) return (n/1e12).toFixed(2)+'T';
  if (abs>=1e9)  return (n/1e9).toFixed(2)+'B';
  if (abs>=1e6)  return (n/1e6).toFixed(2)+'M';
  if (abs>=1e3)  return (n/1e3).toFixed(2)+'K';
  return String(n);
}
async function ensureChartJsLoaded(){
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
  });
}

/* ---------- Auth gate ---------- */
const token = localStorage.getItem('token');
if (!token) window.location.replace('/landing/landing.html');

/* ---------- Tabs ---------- */
const tabButtons = $$('.tabs .tab');
function switchViewTo(v) {
  if (!v) return;
  $$('.view').forEach(x => x.classList.remove('active'));
  const target = $(`#view-${v}`); if (target) target.classList.add('active');
  tabButtons.forEach(t => t.classList.toggle('active', t.dataset.view === v));
  if (v === 'orders')    loadOrders();
  if (v === 'portfolio') loadPortfolio();
}
tabButtons.forEach(b => b.addEventListener('click', () => switchViewTo(b.dataset.view)));
switchViewTo(document.querySelector('.tabs .tab.active')?.dataset.view || 'markets');

/* ---------- Logout ---------- */
$('#logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.replace('/landing/landing.html');
});

/* ---------- Markets table (same mapping as before) ---------- */
const MARKETS = [
  ['BTC-USD','Bitcoin'], ['ETH-USD','Ethereum'], ['SOL-USD','Solana'], ['ADA-USD','Cardano'],
  ['BNB-USD','BNB'], ['XRP-USD','XRP'], ['DOT-USD','Polkadot'], ['DOGE-USD','Dogecoin'],
  ['AVAX-USD','Avalanche'], ['LTC-USD','Litecoin'], ['LINK-USD','Chainlink'], ['MATIC-USD','Polygon'],
  ['ATOM-USD','Cosmos'], ['TRX-USD','TRON'], ['NEAR-USD','NEAR Protocol'], ['FTM-USD','Fantom'],
  ['ALGO-USD','Algorand'], ['APE-USD','ApeCoin'], ['XLM-USD','Stellar'], ['VET-USD','VeChain'],
  ['SUSHI-USD','SushiSwap'], ['UNI-USD','Uniswap'], ['AAVE-USD','Aave'], ['ICP-USD','Internet Computer'],
  ['TFUEL-USD','Theta Fuel'], ['FIL-USD','Filecoin'], ['EGLD-USD','Elrond'], ['GRT-USD','The Graph']
];
const COINGECKO_MAP = {
  'BTC-USD':'bitcoin','ETH-USD':'ethereum','SOL-USD':'solana','ADA-USD':'cardano','BNB-USD':'binancecoin',
  'XRP-USD':'ripple','DOT-USD':'polkadot','DOGE-USD':'dogecoin','AVAX-USD':'avalanche-2','LTC-USD':'litecoin',
  'LINK-USD':'chainlink','MATIC-USD':'polygon','ATOM-USD':'cosmos','TRX-USD':'tron','NEAR-USD':'near',
  'FTM-USD':'fantom','ALGO-USD':'algorand','APE-USD':'apecoin','XLM-USD':'stellar','VET-USD':'vechain',
  'SUSHI-USD':'sushiswap','UNI-USD':'uniswap','AAVE-USD':'aave','ICP-USD':'internet-computer','TFUEL-USD':'theta-token',
  'FIL-USD':'filecoin','EGLD-USD':'elrond-erd-2','GRT-USD':'the-graph','WAVES-USD':'waves','BCH-USD':'bitcoin-cash'
};

let currentMarkets = [];
function renderMarkets(filter=''){
  const tbody = document.querySelector('#marketsTable tbody'); if (!tbody) return;
  const q = filter.trim().toLowerCase(); tbody.innerHTML = '';
  const source = (currentMarkets && currentMarkets.length) ? currentMarkets : MARKETS.map(([s,n]) => ({ symbol:s, name:n }));
  source.forEach(m => {
    const sym = m.symbol, name = m.name || '';
    if (q && !(sym.toLowerCase().includes(q) || name.toLowerCase().includes(q))) return;
    const tr = document.createElement('tr');
    tr.dataset.symbol = sym;
    tr.innerHTML = `
      <td class="col-symbol">${sym}</td>
      <td class="col-name">${name}</td>
      <td class="col-price">${fmtPrice(m.price)}</td>
      <td class="col-change">${fmtPct(m.change24h)}</td>
      <td class="col-7d">${fmtPct(m.change7d)}</td>
      <td class="col-30d">${fmtPct(m.change30d)}</td>
      <td class="col-vol">${m.volume ? shortNumber(m.volume) : '--'}</td>
      <td class="col-mcap">${m.marketCap ? shortNumber(m.marketCap) : '--'}</td>
    `;
    const c24 = tr.querySelector('.col-change'); if (c24 && typeof m.change24h === 'number') { c24.classList.toggle('price-up', m.change24h >= 0); c24.classList.toggle('price-down', m.change24h < 0); }
    const c7  = tr.querySelector('.col-7d');     if (c7  && typeof m.change7d  === 'number') { c7 .classList.toggle('price-up', m.change7d  >= 0); c7 .classList.toggle('price-down', m.change7d  < 0); }
    const c30 = tr.querySelector('.col-30d');    if (c30 && typeof m.change30d === 'number') { c30.classList.toggle('price-up', m.change30d >= 0); c30.classList.toggle('price-down', m.change30d < 0); }
    tbody.appendChild(tr);
  });
}

async function loadMarkets(){
  const ids = []; const idToSymbol = {};
  MARKETS.forEach(([s]) => { const id = COINGECKO_MAP[s]; if (id){ ids.push(id); idToSymbol[id]=s; } });
  try{
    if (ids.length){
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d,30d`;
      const resp = await fetch(url); const cg = await resp.json();
      if (Array.isArray(cg)){
        const next = [];
        MARKETS.forEach(([s,n]) => {
          const d = cg.find(x => idToSymbol[x.id] === s);
          next.push({
            symbol:s, name: n,
            price: d?.current_price ?? null,
            change24h: d?.price_change_percentage_24h_in_currency ?? null,
            change7d:  d?.price_change_percentage_7d_in_currency ?? null,
            change30d: d?.price_change_percentage_30d_in_currency ?? null,
            volume: d?.total_volume ?? null,
            marketCap: d?.market_cap ?? null
          });
        });
        currentMarkets = next;
      }
    }
  }catch(e){ console.warn('loadMarkets error', e); }
  renderMarkets($('#marketSearch')?.value || '');
  const symbolSel = $('#symbol');
  if (symbolSel){
    const prev = symbolSel.value;
    symbolSel.innerHTML = '';
    currentMarkets.forEach(m => { const opt = document.createElement('option'); opt.value=m.symbol; opt.textContent=m.symbol; symbolSel.appendChild(opt); });
    if (prev) symbolSel.value = prev;
  }
}
setInterval(loadMarkets, 30000);
$('#marketSearch')?.addEventListener('input', e => renderMarkets(e.target.value));
renderMarkets(); loadMarkets();

/* ---------- Orders & Portfolio ---------- */
$('#orderForm')?.addEventListener('submit', async (e) => {
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
    const d = await window.authed('/api/orders', { method:'POST', body: JSON.stringify(body) });
    $('#tradeMsg').textContent = `Order ${d.id} ${d.status}.`;
    loadOrders(); loadPortfolio();
  } catch (err) {
    $('#tradeMsg').textContent = err.message || 'Request failed';
  }
});

async function loadOrders(){
  try {
    const rows = await window.authed('/api/orders');
    const tbody = $('#ordersTable tbody'); if (!tbody) return;
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.symbol}</td><td>${r.side}</td>
                      <td>${r.type}</td><td>${+r.qty}</td><td>${r.price ?? '-'}</td><td>${r.status}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) { /* ignore */ }
}

async function loadPortfolio(){
  try {
    const holdings = await window.authed('/api/portfolio');
    await ensureChartJsLoaded();
    const canvas = document.getElementById('portfolioChart');
    const legendDiv = document.getElementById('portfolioLegend');
    if (!canvas || !legendDiv) return;

    const labels = holdings.map(h => h.asset);
    const values = holdings.map(h => h.valueUSD ?? (h.balance || 0));
    const colors = labels.map((_,i) => `hsl(${(i*47)%360} 70% 50%)`);
    if (window._portfolioChart) window._portfolioChart.destroy();
    window._portfolioChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend: { display:false }, tooltip:{ callbacks: { label: ctx => `${ctx.label}: $${Number(ctx.parsed).toLocaleString()}` } } } }
    });

    legendDiv.innerHTML = '';
    labels.forEach((lbl,i) => {
      const val = values[i];
      const item = document.createElement('div'); item.className = 'legend-item';
      const sw = document.createElement('span'); sw.className = 'legend-swatch'; sw.style.background = colors[i];
      const l = document.createElement('div'); l.className = 'legend-label'; l.innerHTML = `<strong>${lbl}</strong> &nbsp; <span class="num-compact">${shortNumber(val)}</span>`;
      item.appendChild(sw); item.appendChild(l); legendDiv.appendChild(item);
      item.addEventListener('click', () => {
        const meta = window._portfolioChart.getDatasetMeta(0);
        const newHidden = !meta.data[i].hidden;   // toggle
        meta.data[i].hidden = newHidden;
        window._portfolioChart.update();
        item.style.opacity = newHidden ? '0.4' : '1';
      });
    });
  } catch (e) { /* ignore */ }
}

loadOrders();
loadPortfolio();
