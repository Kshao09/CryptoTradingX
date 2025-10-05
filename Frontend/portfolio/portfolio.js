(async function(){
  try{
    const rows = await authed('/api/portfolio');
    const holdings = rows.map(r=>({ asset:r.asset, balance:r.balance, valueUSD:r.valueUSD||null }));
    await ensureChartJsLoaded();
    const canvas = document.getElementById('portfolioChart'); if (!canvas) return;
    const labels = holdings.map(h=>h.asset); const values = holdings.map(h=>h.valueUSD || h.balance || 0);
    const colors = labels.map((_,i)=>`hsl(${(i*47)%360} 70% 50%)`);
    if (window._portfolioChart) window._portfolioChart.destroy();
    window._portfolioChart = new Chart(canvas.getContext('2d'), { type: 'doughnut', data:{ labels, datasets:[{ data: values, backgroundColor: colors }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } });
    const legendDiv = document.getElementById('portfolioLegend'); legendDiv.innerHTML=''; labels.forEach((lbl,i)=>{ const item=document.createElement('div'); item.className='legend-item'; const sw=document.createElement('span'); sw.className='legend-swatch'; sw.style.background=colors[i]; const l=document.createElement('div'); l.className='legend-label'; l.innerHTML=`<strong>${lbl}</strong> &nbsp; <span class="num-compact">${shortNumber(values[i])}</span>`; item.appendChild(sw); item.appendChild(l); legendDiv.appendChild(item); });
  }catch(err){ console.warn('portfolio load', err); }
  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{ localStorage.removeItem('token'); location.replace('../auth/auth.html'); });
})();
