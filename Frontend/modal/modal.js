// MarketModal component
// Exposes MarketModal.open(symbol, { initialRange }) and MarketModal.close()
(function(window){
  const CDN_CHART = 'https://cdn.jsdelivr.net/npm/chart.js';
  let overlay, modal, chart, ctx, chartInstance;

  function createModal(){
    overlay = document.createElement('div'); overlay.className = 'mt-modal-overlay hidden';
    modal = document.createElement('div'); modal.className = 'mt-modal';

    modal.innerHTML = `
      <div class="mt-header">
        <div class="mt-title" id="mtTitle">Market Chart</div>
        <div class="mt-actions">
          <div class="mt-ranges">
            <button data-range="1d">1D</button>
            <button data-range="7d" class="active">7D</button>
            <button data-range="30d">30D</button>
            <button data-range="1y">1Y</button>
          </div>
          <button id="mtClose" class="btn outline">Close</button>
        </div>
      </div>
      <canvas id="mtCanvas"></canvas>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    ctx = document.getElementById('mtCanvas').getContext('2d');

    overlay.querySelector('#mtClose').addEventListener('click', close);
    overlay.querySelectorAll('.mt-ranges button').forEach(b => b.addEventListener('click', () => {
      overlay.querySelectorAll('.mt-ranges button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const range = b.dataset.range;
      // dispatch custom event to notify requester
      overlay.dispatchEvent(new CustomEvent('range.change', { detail:{ range } }));
    }));
  }

  async function ensureChartJs(){
    if (window.Chart) return;
    // load Chart.js dynamically
    await new Promise((resolve,reject)=>{
      const s = document.createElement('script'); s.src = CDN_CHART; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }

  async function open(symbol, opts={ initialRange:'7d', fetchHistory:null }){
    if (!overlay) createModal();
    overlay.classList.remove('hidden');
    overlay.querySelector('#mtTitle').textContent = symbol + ' • Price History';

    await ensureChartJs();

    // attach range buttons behavior: when clicked, request data via fetchHistory
    const rangeButtons = overlay.querySelectorAll('.mt-ranges button');
    rangeButtons.forEach(btn => btn.addEventListener('click', async () => {
      rangeButtons.forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      const range = btn.dataset.range;
      if (typeof opts.fetchHistory === 'function'){
        try{
          const data = await opts.fetchHistory(range);
          renderChart(data.labels, data.prices, symbol, range);
        }catch(err){
          // on error, simulate minimal data
          const labels = []; const prices = []; const pts = range === '1y' ? 365 : (range === '30d' ? 30 : (range === '7d' ? 7 : 90));
          let p = 100; for (let i=pts-1;i>=0;--i){ labels.push(`-${i}`); p = p * (1 + (Math.random()-0.5)*0.02); prices.push(parseFloat(p.toFixed(2))); }
          renderChart(labels, prices, symbol, range);
        }
      }
    }));

    // trigger initial fetch for initialRange
    const initial = opts.initialRange || '7d';
    const initialBtn = overlay.querySelector(`.mt-ranges button[data-range="${initial}"]`);
    if (initialBtn) initialBtn.click();

    return { close };
  }

  function close(){
    if (!overlay) return;
    overlay.classList.add('hidden');
    if (chartInstance) { chartInstance.destroy(); chartInstance = null }
  }

  function renderChart(labels, prices, label){
    if (!overlay) return;
    const canvas = overlay.querySelector('#mtCanvas');
    if (!canvas) return;
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: [{ label: label, data: prices, borderColor: 'rgba(34,211,238,0.95)', backgroundColor:'rgba(34,211,238,0.06)', tension:0.15 }] },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { tooltip: { callbacks: { label: (ctx) => `$${Number(ctx.parsed.y).toLocaleString()}` } } },
        scales:{ x:{ display:true }, y:{ display:true, ticks:{ callback: v => `$${Number(v).toLocaleString()}` } } }
      }
    });
  }

  window.MarketModal = { open, close };
})(window);
