// markets page script: uses global helpers from utils.js
(async function(){
  // Larger MARKETS list (symbol, display name)
  const MARKETS = [
    ['BTC-USD','Bitcoin'], ['ETH-USD','Ethereum'], ['USDT-USD','Tether'], ['USDC-USD','USD Coin'],
    ['BNB-USD','BNB'], ['XRP-USD','XRP'], ['DOGE-USD','Dogecoin'], ['ADA-USD','Cardano'],
    ['SOL-USD','Solana'], ['DOT-USD','Polkadot'], ['MATIC-USD','Polygon'], ['LTC-USD','Litecoin'],
    ['LINK-USD','Chainlink'], ['AVAX-USD','Avalanche'], ['TRX-USD','TRON'], ['SHIB-USD','Shiba Inu'],
    ['UNI-USD','Uniswap'], ['ATOM-USD','Cosmos'], ['NEAR-USD','NEAR Protocol'], ['ALGO-USD','Algorand'],
    ['BCH-USD','Bitcoin Cash'], ['FIL-USD','Filecoin'], ['SUI-USD','Sui'], ['APT-USD','Aptos'],
    ['APE-USD','ApeCoin'], ['EGLD-USD','Elrond'], ['GRT-USD','The Graph'], ['VET-USD','VeChain'],
    ['ICP-USD','Internet Computer'], ['XLM-USD','Stellar'], ['MANA-USD','Decentraland'], ['AXS-USD','Axie Infinity'],
    ['SAND-USD','The Sandbox'], ['AAVE-USD','Aave'], ['WAVES-USD','Waves'], ['BTT-USD','BitTorrent']
  ];

  // CoinGecko id mapping for our symbols (used to build the API query)
  const COINGECKO_MAP = {
    'BTC-USD':'bitcoin','ETH-USD':'ethereum','USDT-USD':'tether','USDC-USD':'usd-coin',
    'BNB-USD':'binancecoin','XRP-USD':'ripple','DOGE-USD':'dogecoin','ADA-USD':'cardano',
    'SOL-USD':'solana','DOT-USD':'polkadot','MATIC-USD':'polygon','LTC-USD':'litecoin',
    'LINK-USD':'chainlink','AVAX-USD':'avalanche-2','TRX-USD':'tron','SHIB-USD':'shiba-inu',
    'UNI-USD':'uniswap','ATOM-USD':'cosmos','NEAR-USD':'near','ALGO-USD':'algorand',
    'BCH-USD':'bitcoin-cash','FIL-USD':'filecoin','SUI-USD':'sui','APT-USD':'aptos',
    'APE-USD':'apecoin','EGLD-USD':'elrond-erd-2','GRT-USD':'the-graph','VET-USD':'vechain',
    'ICP-USD':'internet-computer','XLM-USD':'stellar','MANA-USD':'decentraland','AXS-USD':'axie-infinity',
    'SAND-USD':'the-sandbox','AAVE-USD':'aave','WAVES-USD':'waves','BTT-USD':'bittorrent'
  };

  let currentMarkets = JSON.parse(localStorage.getItem('lastMarkets')||'[]');
  // Ensure currentMarkets covers all configured MARKETS immediately (merge cached values)
  try{
    const cachedMap = (currentMarkets || []).reduce((acc, cm) => { acc[cm.symbol] = cm; return acc; }, {});
    currentMarkets = MARKETS.map(([s,n]) => Object.assign({ symbol: s, name: n, price: null, change24h: null, change7d: null, change30d: null, change1y: null, image: null, rank: null, marketCap: null }, cachedMap[s]||{}));
  }catch(e){ /* ignore parse errors, leave as-is */ }

  // Diagnostic status element
  // Intentionally silent: we don't show a status line or log to console in production view
  function setStatus(msg){ /* no-op to avoid on-page status and console logs */ }
  setStatus('Initializing...');

  function renderMarkets(filter=''){
    const tbody = document.querySelector('#marketsTable tbody'); if (!tbody) return;
    tbody.innerHTML = '';
    const q = normalize(filter);
    const source = (currentMarkets && currentMarkets.length) ? currentMarkets : MARKETS.map(([s,n])=>({ symbol:s, name:n }));
    source.forEach(m => {
      const sym = m.symbol; const name = m.name||'';
      const symNorm = normalize(sym); const nameNorm = normalize(name);
      if (q && !(symNorm.includes(q) || nameNorm.includes(q))) return;
      const tr = document.createElement('tr'); tr.dataset.symbol = sym;
      tr.innerHTML = `
        <td class="col-logo"><img src="${m.image||''}" alt="" width="20" height="20" onerror="this.style.display='none'"/></td>
        <td class="col-symbol">${sym}</td>
        <td class="col-rank">${m.rank ?? '--'}</td>
        <td class="col-name">${name}</td>
        <td class="col-price">${fmtPrice(m.price)}</td>
        <td class="col-change">${fmtPct(m.change24h)}</td>
        <td class="col-7d">${fmtPct(m.change7d)}</td>
        <td class="col-30d">${fmtPct(m.change30d)}</td>
        <td class="col-1y">${fmtPct(m.change1y)}</td>
        <td class="col-mcap">${m.marketCap?shortNumber(m.marketCap):'--'}</td>
      `;
      // apply coloring classes
      const c24 = tr.querySelector('.col-change'); if (c24 && typeof m.change24h === 'number') c24.classList.toggle('price-up', m.change24h >= 0), c24.classList.toggle('price-down', m.change24h < 0);
      const c7 = tr.querySelector('.col-7d'); if (c7 && typeof m.change7d === 'number') c7.classList.toggle('price-up', m.change7d >= 0), c7.classList.toggle('price-down', m.change7d < 0);
      const c30 = tr.querySelector('.col-30d'); if (c30 && typeof m.change30d === 'number') c30.classList.toggle('price-up', m.change30d >= 0), c30.classList.toggle('price-down', m.change30d < 0);

      // open MarketModal on row click (if modal is available)
      tr.addEventListener('click', async () => {
        if (!window.MarketModal) return;
        try{
          await MarketModal.open(sym, {
            initialRange: '7d',
            fetchHistory: async (range) => {
              const id = COINGECKO_MAP[sym];
              if (!id) return { labels: [], prices: [] };
              const days = range === '1d' ? 1 : (range === '7d' ? 7 : (range === '30d' ? 30 : 365));
              const rr = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
              if (!rr.ok) return { labels: [], prices: [] };
              const jd = await rr.json();
              return { labels: jd.prices.map(p => new Date(p[0]).toLocaleString()), prices: jd.prices.map(p => p[1]) };
            }
          });
  }catch(e){ /* open modal failed - suppressed console output */ }
      });
      tbody.appendChild(tr);
    });
  }

  async function loadMarkets(){
    const ids = MARKETS.map(([s])=>COINGECKO_MAP[s]).filter(Boolean);
    if (!ids.length) { renderMarkets(); return; }
    try{
      setStatus('Fetching CoinGecko...');
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d,30d,1y`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('cg fail');
      const data = await r.json();
      const by = {};
  data.forEach(i=>{ const s = Object.keys(COINGECKO_MAP).find(k=>COINGECKO_MAP[k]===i.id); if (!s) return; by[s]={ symbol:s, name:i.name, price:i.current_price, change24h:i.price_change_percentage_24h_in_currency, change7d:i.price_change_percentage_7d_in_currency, change30d:i.price_change_percentage_30d_in_currency, change1y:i.price_change_percentage_1y_in_currency, image:i.image, rank:i.market_cap_rank, marketCap:i.market_cap }; });
      // Build a full list from MARKETS and merge: cached values -> API values -> defaults
      const existingMap = (currentMarkets || []).reduce((acc, cm) => { acc[cm.symbol] = cm; return acc; }, {});
      currentMarkets = MARKETS.map(([s, n]) => {
        const api = by[s] || {};
        const cached = existingMap[s] || {};
        return Object.assign(
          { symbol: s, name: n, price: null, change24h: null, change7d: null, change30d: null, change1y: null, image: null, rank: null, marketCap: null },
          cached,
          api
        );
      });
    localStorage.setItem('lastMarkets', JSON.stringify(currentMarkets));
    // show counts: configured vs fetched and a short sample to aid debugging
  const totalConfigured = MARKETS.length;
  const fetchedCount = Array.isArray(data) ? data.length : 0;
  const sample = currentMarkets[0] ? `${currentMarkets[0].symbol} ${fmtPrice(currentMarkets[0].price)}` : 'n/a';
  setStatus(`CoinGecko OK — configured ${totalConfigured} — fetched ${fetchedCount} — sample: ${sample} — last updated: ${new Date().toLocaleTimeString()}`);
  }catch(err){ /* markets load error - suppressed console output */ setStatus(''); }
    renderMarkets(document.getElementById('marketSearch')?.value||'');
    // show how many rows were rendered
    try{ const rendered = document.querySelectorAll('#marketsTable tbody tr').length; setStatus((document.getElementById('marketStatus')?.textContent||'') + ` — displayed ${rendered} rows`); }catch(e){}
  }

  document.getElementById('marketSearch')?.addEventListener('input', (e)=>renderMarkets(e.target.value));

  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{ localStorage.removeItem('token'); location.replace('../auth/auth.html'); });

  renderMarkets();
  await loadMarkets();
  setInterval(loadMarkets, 30000);
})();
