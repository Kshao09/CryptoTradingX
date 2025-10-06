(async function(){
  try{
    // Load account and summary
    const acct = await authed('/api/account');
    const summary = await authed('/api/account/summary');
    const txs = await authed('/api/transactions');

    document.getElementById('accountName').textContent = acct.email || '';
    document.getElementById('accountEmail').textContent = `Member since: ${new Date(acct.created_at).toLocaleDateString()}`;
    document.getElementById('accIncome').textContent = fmtPrice(summary.income || 0);
    document.getElementById('accExpenses').textContent = fmtPrice(summary.expenses || 0);

    // Render holdings chart (use wallets from summary)
    const holdings = (summary.wallets || []).map(r=>({ asset:r.asset, balance: Number(r.balance || 0) }));
    await ensureChartJsLoaded();
    const canvas = document.getElementById('portfolioChart'); if (!canvas) return;
    const labels = holdings.map(h=>h.asset); const values = holdings.map(h=>h.balance || 0);
    const colors = labels.map((_,i)=>`hsl(${(i*47)%360} 70% 50%)`);
    if (window._portfolioChart) window._portfolioChart.destroy();
    window._portfolioChart = new Chart(canvas.getContext('2d'), { type: 'doughnut', data:{ labels, datasets:[{ data: values, backgroundColor: colors }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } });
    const legendDiv = document.getElementById('portfolioLegend'); legendDiv.innerHTML=''; labels.forEach((lbl,i)=>{ const item=document.createElement('div'); item.className='legend-item'; const sw=document.createElement('span'); sw.className='legend-swatch'; sw.style.background=colors[i]; const l=document.createElement('div'); l.className='legend-label'; l.innerHTML=`<strong>${lbl}</strong> &nbsp; <span class="num-compact">${shortNumber(values[i])}</span>`; item.appendChild(sw); item.appendChild(l); legendDiv.appendChild(item); });

    // Render transactions
    const tb = document.querySelector('#transactionsTable tbody'); if (tb) { tb.innerHTML=''; (txs||[]).forEach(t=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${new Date(t.created_at).toLocaleString()}</td><td>${t.symbol}</td><td class="num">${Number(t.qty).toLocaleString()}</td><td class="num">${fmtPrice(t.price)}</td><td class="num">${fmtPrice((t.price||0)*(t.qty||0))}</td>`; tb.appendChild(tr); }); }

    // Compute a naive USD balance by fetching CoinGecko prices for base assets (if any)
    const ids = (labels.map(l => {
      // convert e.g. BTC-USD -> bitcoin, ETH-USD -> ethereum, fallback to empty
      if (l.endsWith('-USD')) return l.split('-')[0].toLowerCase(); return '';
    }).filter(Boolean)).join(',');
    if (ids) {
      try{
        const cg = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`);
        if (cg.ok){ const prices = await cg.json(); let total=0; holdings.forEach(h=>{ const id = h.asset.endsWith('-USD') ? h.asset.split('-')[0].toLowerCase() : null; const p = id && prices[id] ? prices[id].usd : null; if (p) total += p * (h.balance||0); }); document.getElementById('accountBalance').textContent = fmtPrice(total); }
      }catch(e){}
    }
  }catch(err){ /* silent */ }
  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{ localStorage.removeItem('token'); location.replace('../auth/auth.html'); });
})();
