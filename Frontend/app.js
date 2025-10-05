// small DOM helpers moved to utils.js (loaded before app.js)

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

/* ---------- Tab / view switching (header tabs) ---------- */
const tabButtons = $$('.tabs .tab');

function switchViewTo(v) {
  if (!v) return;
  // toggle views
  $$('.view').forEach(x => x.classList.remove('active'));
  const target = $(`#view-${v}`);
  if (target) target.classList.add('active');

  // toggle tab active state
  tabButtons.forEach(t => t.classList.toggle('active', t.dataset.view === v));

  // lazy-load data for heavier views
  if (v === 'orders') loadOrders();
  if (v === 'portfolio') loadPortfolio();
}

// attach click handlers if tabs exist
tabButtons.forEach(b => b.addEventListener('click', () => switchViewTo(b.dataset.view)));

// ensure an initial view is shown based on the active tab or default to markets
const initial = document.querySelector('.tabs .tab.active')?.dataset.view || 'markets';
switchViewTo(initial);

/* ---------- Logout ---------- */
const logoutBtn = $('#logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.replace('/');
  });
}

/* ---------- Price updates via WebSocket ---------- */
let ws;
function connectWS(){
  try {
    ws = new WebSocket(CTX.WS);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'tick') {
            // Update currentMarkets data array if present
            const idx = currentMarkets.findIndex(x => x.symbol === m.symbol);
            if (idx >= 0) {
              const item = currentMarkets[idx];
              // Do not let backend/websocket override CoinGecko-populated prices.
              // Only apply WS price if we don't yet have a price for this symbol.
              if ((item.price === null || item.price === undefined) && typeof m.price === 'number') {
                item.price = m.price;
              }
              // similarly only set change fields if they are not present
              if ((item.change24h === null || item.change24h === undefined) && typeof m.change24h === 'number') item.change24h = m.change24h;
              if ((item.change7d === null || item.change7d === undefined) && typeof m.change7d === 'number') item.change7d = m.change7d;
              if ((item.change30d === null || item.change30d === undefined) && typeof m.change30d === 'number') item.change30d = m.change30d;
              // update DOM row quickly if present
              const row = document.querySelector(`#marketsTable tbody tr[data-symbol="${m.symbol}"]`);
              if (row) {
                const priceCell = row.querySelector('.col-price'); if (priceCell) priceCell.textContent = fmtPrice(item.price);
                const changeCell = row.querySelector('.col-change'); if (changeCell) { changeCell.textContent = fmtPct(item.change24h); changeCell.classList.toggle('price-up', item.change24h >= 0); changeCell.classList.toggle('price-down', item.change24h < 0); }
                const change7 = row.querySelector('.col-7d'); if (change7) { change7.textContent = fmtPct(item.change7d); change7.classList.toggle('price-up', item.change7d >= 0); change7.classList.toggle('price-down', item.change7d < 0); }
                const change30 = row.querySelector('.col-30d'); if (change30) { change30.textContent = fmtPct(item.change30d); change30.classList.toggle('price-up', item.change30d >= 0); change30.classList.toggle('price-down', item.change30d < 0); }
              }
            }
        }
    });
    ws.addEventListener('close', () => setTimeout(connectWS, 1500));
  } catch {}
}
connectWS();

/* ---------- Markets data & rendering ---------- */
// A larger list of common markets. For simplicity we use USD pairs and a name mapping.
const MARKETS = [
  ['BTC-USD','Bitcoin'], ['ETH-USD','Ethereum'], ['SOL-USD','Solana'], ['ADA-USD','Cardano'],
  ['BNB-USD','BNB'], ['XRP-USD','XRP'], ['DOT-USD','Polkadot'], ['DOGE-USD','Dogecoin'],
  ['AVAX-USD','Avalanche'], ['LTC-USD','Litecoin'], ['LINK-USD','Chainlink'], ['MATIC-USD','Polygon'],
  ['ATOM-USD','Cosmos'], ['TRX-USD','TRON'], ['NEAR-USD','NEAR Protocol'], ['FTM-USD','Fantom'],
  ['ALGO-USD','Algorand'], ['APE-USD','ApeCoin'], ['XLM-USD','Stellar'], ['VET-USD','VeChain'],
  ['SUSHI-USD','SushiSwap'], ['UNI-USD','Uniswap'], ['AAVE-USD','Aave'], ['ICP-USD','Internet Computer'],
  ['TFUEL-USD','Theta Fuel'], ['FIL-USD','Filecoin'], ['EGLD-USD','Elrond'], ['GRT-USD','The Graph']
];

// use global normalize from utils.js

// currentMarkets holds the live market objects (symbol,name,price,change24h,change7d,change30d,volume,marketCap)
let currentMarkets = [];

// Mapping from local symbol to CoinGecko id. Keep this central so all fetches use CoinGecko only.
const COINGECKO_MAP = {
  'BTC-USD':'bitcoin','ETH-USD':'ethereum','SOL-USD':'solana','ADA-USD':'cardano','BNB-USD':'binancecoin',
  'XRP-USD':'ripple','DOT-USD':'polkadot','DOGE-USD':'dogecoin','AVAX-USD':'avalanche-2','LTC-USD':'litecoin',
  'LINK-USD':'chainlink','MATIC-USD':'polygon','ATOM-USD':'cosmos','TRX-USD':'tron','NEAR-USD':'near',
  'FTM-USD':'fantom','ALGO-USD':'algorand','APE-USD':'apecoin','XLM-USD':'stellar','VET-USD':'vechain',
  'SUSHI-USD':'sushiswap','UNI-USD':'uniswap','AAVE-USD':'aave','ICP-USD':'internet-computer','TFUEL-USD':'theta-token',
  'FIL-USD':'filecoin','EGLD-USD':'elrond-erd-2','GRT-USD':'the-graph','WAVES-USD':'waves','BCH-USD':'bitcoin-cash'
};

// Poll top symbols (BTC, ETH) frequently to keep UI snappy.
async function refreshTopSymbols(){
  try{
    const topIds = [COINGECKO_MAP['BTC-USD'], COINGECKO_MAP['ETH-USD']].filter(Boolean);
    if (!topIds.length) return;
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${topIds.join(',')}&price_change_percentage=24h,7d,30d`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('coingecko refresh failed');
    const data = await res.json();
    data.forEach(d => {
      const sym = (typeof idToSymbol !== 'undefined' && idToSymbol[d.id]) ? idToSymbol[d.id] : null;
      // try to find existing market entry and update
      const s = (sym || Object.keys(COINGECKO_MAP).find(k=>COINGECKO_MAP[k]===d.id));
      if (!s) return;
      const idx = currentMarkets.findIndex(m=>m.symbol===s);
      const mObj = {
        symbol: s,
        name: d.name,
        price: d.current_price,
        change24h: d.price_change_percentage_24h,
        change7d: d.price_change_percentage_7d_in_currency,
        change30d: d.price_change_percentage_30d_in_currency,
        volume: d.total_volume,
        marketCap: d.market_cap
      };
      if (idx >= 0) {
        currentMarkets[idx] = Object.assign(currentMarkets[idx], mObj);
        updateMarketRow(s, currentMarkets[idx]);
      }
    });
  }catch(err){
    console.warn('refreshTopSymbols error', err);
  }
}

// start polling BTC/ETH every 10s
setInterval(refreshTopSymbols, 10000);

// use fmtPrice/fmtPct from utils.js

// Safely update a single market row in the DOM
function updateMarketRow(symbol, item){
  try{
    const row = document.querySelector(`#marketsTable tbody tr[data-symbol="${symbol}"]`);
    if (!row) return;
    const priceCell = row.querySelector('.col-price'); if (priceCell) priceCell.textContent = fmtPrice(item.price);
    const changeCell = row.querySelector('.col-change'); if (changeCell) { changeCell.textContent = fmtPct(item.change24h); changeCell.classList.toggle('price-up', item.change24h >= 0); changeCell.classList.toggle('price-down', item.change24h < 0); }
    const change7 = row.querySelector('.col-7d'); if (change7) { change7.textContent = fmtPct(item.change7d); change7.classList.toggle('price-up', item.change7d >= 0); change7.classList.toggle('price-down', item.change7d < 0); }
    const change30 = row.querySelector('.col-30d'); if (change30) { change30.textContent = fmtPct(item.change30d); change30.classList.toggle('price-up', item.change30d >= 0); change30.classList.toggle('price-down', item.change30d < 0); }
    const vol = row.querySelector('.col-vol'); if (vol) vol.textContent = item.volume ? window.shortNumber(item.volume) : '--';
    const mc = row.querySelector('.col-mcap'); if (mc) mc.textContent = item.marketCap ? window.shortNumber(item.marketCap) : '--';
  }catch(e){ console.warn('updateMarketRow error', e); }
}

function renderMarkets(filter = ''){
  const tbody = document.querySelector('#marketsTable tbody');
  if (!tbody) return;
  const q = normalize(filter);
  tbody.innerHTML = '';

  const source = (currentMarkets && currentMarkets.length) ? currentMarkets : MARKETS.map(([s,n]) => ({ symbol:s, name:n }));

  source.forEach(m => {
    const sym = m.symbol;
    const name = m.name || '';
    const symNorm = normalize(sym);
    const nameNorm = normalize(name);
    if (q && !(symNorm.includes(q) || nameNorm.includes(q))) return;

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

    // set up classes for change coloring
    const c24 = tr.querySelector('.col-change'); if (c24 && typeof m.change24h === 'number') c24.classList.toggle('price-up', m.change24h >= 0), c24.classList.toggle('price-down', m.change24h < 0);
    const c7 = tr.querySelector('.col-7d'); if (c7 && typeof m.change7d === 'number') c7.classList.toggle('price-up', m.change7d >= 0), c7.classList.toggle('price-down', m.change7d < 0);
    const c30 = tr.querySelector('.col-30d'); if (c30 && typeof m.change30d === 'number') c30.classList.toggle('price-up', m.change30d >= 0), c30.classList.toggle('price-down', m.change30d < 0);

    tbody.appendChild(tr);
  });
}

// Fetch live markets from CoinGecko for the MARKETS list
async function loadMarkets(){
  const ids = [];
  const idToSymbol = {};
  MARKETS.forEach(([s,n]) => { if (COINGECKO_MAP[s]) { ids.push(COINGECKO_MAP[s]); idToSymbol[COINGECKO_MAP[s]] = s; } });

  try {
    if (ids.length) {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d,30d`;
      const resp = await fetch(url);
      const cg = await resp.json();
      if (Array.isArray(cg)){
        const bySymbol = {};
        cg.forEach(item => {
          const sym = idToSymbol[item.id];
          if (!sym) return;
          bySymbol[sym] = {
            symbol: sym,
            name: item.name || sym,
            price: item.current_price ?? null,
            change24h: item.price_change_percentage_24h_in_currency ?? null,
            change7d: item.price_change_percentage_7d_in_currency ?? null,
            change30d: item.price_change_percentage_30d_in_currency ?? null,
            volume: item.total_volume ?? null,
            marketCap: item.market_cap ?? null
          };
        });
        // Merge into existing array to avoid wiping out live values with nulls
        if (!currentMarkets || !currentMarkets.length) {
          currentMarkets = MARKETS.map(([s,n]) => bySymbol[s] ?? ({ symbol:s, name:n, price:null, change24h:null, change7d:null, change30d:null, volume:null, marketCap:null }));
        } else {
          currentMarkets = currentMarkets.map(cm => {
            const updated = bySymbol[cm.symbol];
            if (!updated) return cm; // keep existing
            return Object.assign({}, cm, Object.fromEntries(Object.entries(updated).filter(([k,v]) => v !== null && v !== undefined)));
          });
        }
      } else {
        throw new Error('coingecko returned non-array');
      }
    } else {
      if (!currentMarkets || !currentMarkets.length) {
        currentMarkets = MARKETS.map(([s,n]) => ({ symbol:s, name:n, price:null, change24h:null, change7d:null, change30d:null, volume:null, marketCap:null }));
      }
    }
  } catch (err) {
    console.warn('loadMarkets failed, keeping previous market values', err);
    // keep existing currentMarkets (do not overwrite with nulls) so live UI does not flash to placeholders
    if (!currentMarkets || !currentMarkets.length) {
      currentMarkets = MARKETS.map(([s,n]) => ({ symbol:s, name:n, price:null, change24h:null, change7d:null, change30d:null, volume:null, marketCap:null }));
    }
  }

  renderMarkets(marketSearch?.value || '');

  // populate trade symbol select
  const symbolSel = $('#symbol');
  if (symbolSel){
    const prev = symbolSel.value;
    symbolSel.innerHTML = '';
    currentMarkets.forEach(m => { const opt = document.createElement('option'); opt.value = m.symbol; opt.textContent = m.symbol; symbolSel.appendChild(opt); });
    if (prev) symbolSel.value = prev;
  }
}

// refresh markets periodically
setInterval(loadMarkets, 30_000);

// wire up search input
const marketSearch = $('#marketSearch');
if (marketSearch) {
  marketSearch.addEventListener('input', (e) => renderMarkets(e.target.value));
}

// initial render
renderMarkets();
// load live markets from API (or fallback)
loadMarkets();

// On row click, open the MarketModal component which handles chart rendering and range changes
document.querySelector('#marketsTable tbody')?.addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-symbol]');
  if (!tr) return;
  const sym = tr.dataset.symbol;
  if (!window.MarketModal) {
    // fallback: still try to open inline chart if modal not loaded
    return;
  }

  // open modal and provide a fetchHistory callback that the modal will call for ranges
  const handle = await MarketModal.open(sym, {
    initialRange: '7d',
    fetchHistory: async (range) => {
      const id = COINGECKO_MAP[sym];
      if (!id) return {labels:[],prices:[]};
      const days = range==='1d'?1: (range==='7d'?7: (range==='30d'?30:365));
      const rr = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
      if (!rr.ok) return {labels:[],prices:[]};
      const jd = await rr.json();
      const labels = jd.prices.map(p=> new Date(p[0]).toLocaleString());
      const prices = jd.prices.map(p=>p[1]);
      return {labels,prices};
    }
  });
});

/* ---------- Trade form ---------- */
const typeSel   = $('#type');
const priceWrap = $('#priceWrap');
const priceInp  = $('#price'); // optional, if you want to disable it when hidden

function updateLimitVisibility() {
  const isLimit = typeSel && typeSel.value === 'LIMIT';
  if (priceWrap) priceWrap.classList.toggle('hidden', !isLimit);
  if (priceInp) priceInp.toggleAttribute('disabled', !isLimit);
}

if (typeSel) {
  typeSel.addEventListener('change', updateLimitVisibility);
}
updateLimitVisibility(); // set initial state on load
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
  // If server returns array of holdings: [{ asset: 'BTC', balance: 0.5, valueUSD: 12345 }, ...]
  try {
    // Build data for chart
    const holdings = rows.map(r => ({ asset: r.asset, balance: r.balance, valueUSD: r.valueUSD ?? null }));
    await renderPortfolioChart(holdings);
  } catch (err) {
    // fallback: if rows is not array, keep old table rendering
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.asset}</td><td>${r.balance}</td>`;
      tbody.appendChild(tr);
    });
  }
}

// small helper: compact number like 1.2M, 45.8B
// use shortNumber and ensureChartJsLoaded from utils.js (global)

async function renderPortfolioChart(holdings){
  await ensureChartJsLoaded();
  const canvas = document.getElementById('portfolioChart');
  const legendDiv = document.getElementById('portfolioLegend');
  if (!canvas || !legendDiv) return;
  // prepare data
  const labels = holdings.map(h => h.asset);
  const values = holdings.map(h => h.valueUSD ?? (h.balance || 0));
  const colors = labels.map((_,i) => `hsl(${(i*47)%360} 70% 50%)`);
  if (window._portfolioChart) window._portfolioChart.destroy();
  window._portfolioChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend: { display:false }, tooltip:{ callbacks: { label: ctx => `${ctx.label}: $${Number(ctx.parsed).toLocaleString()}` } } } }
  });

  // build legend
  legendDiv.innerHTML = '';
  labels.forEach((lbl,i) => {
    const val = values[i];
    const item = document.createElement('div'); item.className = 'legend-item';
    const sw = document.createElement('span'); sw.className = 'legend-swatch'; sw.style.background = colors[i];
    const l = document.createElement('div'); l.className = 'legend-label'; l.innerHTML = `<strong>${lbl}</strong> &nbsp; <span class="num-compact">${shortNumber(val)}</span>`;
    item.appendChild(sw); item.appendChild(l);
    legendDiv.appendChild(item);
    // add click to toggle visibility
    item.addEventListener('click', () => {
      const meta = window._portfolioChart.getDatasetMeta(0);
      const visible = !meta.data[i].hidden;
      meta.data[i].hidden = visible ? false : true;
      window._portfolioChart.update();
      item.style.opacity = visible ? '1' : '0.4';
    });
  });
}

/* default landing view */
loadOrders();
loadPortfolio();
