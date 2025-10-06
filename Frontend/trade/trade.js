(async function(){
  // populate symbols using markets last-known from localStorage if available
  const last = JSON.parse(localStorage.getItem('lastMarkets')||'[]');
  const sel = document.getElementById('symbol'); if (sel) {
    sel.innerHTML = '';
    const list = (last.length?last: [{symbol:'BTC-USD',name:'Bitcoin'},{symbol:'ETH-USD',name:'Ethereum'}]);
    list.forEach(m=>{
      const opt=document.createElement('option'); opt.value=m.symbol; opt.textContent = m.name ? `${m.symbol} — ${m.name}` : m.symbol; sel.appendChild(opt);
    });
  }

  // Small CoinGecko id map for common symbols used in the app. Keeps the trade converter fast and reliable.
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

  const typeSel = document.getElementById('type'); const priceWrap = document.getElementById('priceWrap'); const priceInp = document.getElementById('price');
  function updateLimitVisibility(){ const isLimit = typeSel && typeSel.value === 'LIMIT'; if (priceWrap) priceWrap.classList.toggle('hidden', !isLimit); if (priceInp) priceInp.toggleAttribute('disabled', !isLimit); }
  typeSel?.addEventListener('change', updateLimitVisibility); updateLimitVisibility();

  document.getElementById('orderForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault(); document.getElementById('tradeMsg').textContent='Submitting...';
    try{ const body={ symbol: document.getElementById('symbol').value, side: document.getElementById('side').value, type: document.getElementById('type').value, qty: parseFloat(document.getElementById('qty').value), price: document.getElementById('type').value==='LIMIT'?parseFloat(document.getElementById('price').value):null };
      const d = await authed('/api/orders', { method:'POST', body: JSON.stringify(body) }); document.getElementById('tradeMsg').textContent = `Order ${d.id} ${d.status}`; location.reload();
    }catch(err){ document.getElementById('tradeMsg').textContent = err.message; }
  });

  document.getElementById('submitOrderBtn')?.addEventListener('click', (e)=>{ e.preventDefault(); document.getElementById('orderForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); });
  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{ localStorage.removeItem('token'); location.replace('../auth/auth.html'); });

  // Live exchange rate and USD conversion (result only)
  const convEl = document.getElementById('rateResult');
  // avoid errors if element missing
  if (!convEl) return;
  const rateQty = document.getElementById('rateQty');
  const rateCoin = document.getElementById('rateCoin');
  // price cache populated once from CoinGecko for mapped ids
  const priceCache = {};
  const preloadPromise = (async function preloadPrices(){
    try{
      const ids = Array.from(new Set(Object.values(COINGECKO_MAP).filter(Boolean))).join(',');
      if (!ids) return;
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`);
      if (!r.ok) return;
      const jd = await r.json();
      Object.keys(jd).forEach(k=>{ if (jd[k] && jd[k].usd != null) priceCache[k] = jd[k].usd; });
    }catch(e){ /* preload failed silently */ }
  })();
  async function updateRate(){
    // wait for preload so cache is available on first run
    if (preloadPromise) {
      try{ convEl.textContent = 'Loading...'; await preloadPromise; }catch(e){}
    }
  // use the dedicated exchange controls
  let raw = rateCoin?.value || document.getElementById('symbol')?.value || 'BTC-USD';
  // normalize: option values can include friendly text, extract the base symbol (e.g. 'ETH-USD' from 'ETH-USD — Ethereum')
  const baseMatch = (raw || '').toString().match(/^[A-Z0-9-]+/);
  const baseSym = baseMatch ? baseMatch[0] : raw;
  // use normalized base symbol for lookups
  const sym = baseSym;
  // Prefer explicit map lookup using baseSym; fallback to base token id lowercased
  const idFromMap = COINGECKO_MAP[baseSym] || COINGECKO_MAP[raw];
  let id = idFromMap || ((baseSym||'').split('-')[0]||'').toLowerCase();
    try{
      // prefer cached price
      let p = priceCache[id] != null ? priceCache[id] : null;
      let jd = null;
      if (p == null) {
        let r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`);
        if (r.ok) { jd = await r.json(); p = jd[id] ? jd[id].usd : null; }
      }
      // If initial lookup failed (id not found), try a CoinGecko search by symbol/name
      if (p == null && !idFromMap) {
        try{
          const qs = encodeURIComponent(sym.split('-')[0]);
          const sr = await fetch(`https://api.coingecko.com/api/v3/search?query=${qs}`);
          if (sr.ok){ const sj = await sr.json(); const match = (sj.coins||[]).find(c => (c.symbol||'').toLowerCase() === (sym.split('-')[0]||'').toLowerCase());
            if (match) { id = match.id; if (priceCache[id] != null) p = priceCache[id]; else { const rr = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`); if (rr.ok){ const jj = await rr.json(); p = jj[id] ? jj[id].usd : null; } } }
          }
        }catch(e){}
      }
      if (p==null){ convEl.textContent='--'; return; }
      const q = parseFloat(rateQty?.value) || 0;
      convEl.textContent = q ? fmtPrice(p * q) : '--';
    }catch(e){ convEl.textContent='--'; }
  }
  document.getElementById('symbol')?.addEventListener('change', () => { updateRate(); });
  document.getElementById('qty')?.addEventListener('input', updateRate);
  // populate rateCoin select using same list as symbol select (friendly labels)
  if (rateCoin && sel){ rateCoin.innerHTML=''; Array.from(sel.options).forEach(o=>{ const opt=document.createElement('option'); opt.value=o.value; opt.textContent=o.textContent; rateCoin.appendChild(opt); }); }
  rateCoin?.addEventListener('change', updateRate);
  rateQty?.addEventListener('input', updateRate);
  // initial
  updateRate();
})();
