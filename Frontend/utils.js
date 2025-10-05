// Shared small helpers used across frontend pages
(function(window){
  window.$ = (s) => document.querySelector(s);
  window.$$ = (s) => Array.from(document.querySelectorAll(s));
  window.normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'');

  window.shortNumber = function(n){
    if (n === null || n === undefined || Number.isNaN(n)) return '--';
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return Number(n).toLocaleString();
  };

  window.fmtPrice = function(v){ return (v === null || v === undefined) ? '--' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  window.fmtPct = function(v){ return (v === null || v === undefined) ? '--' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%'; };

  window.ensureChartJsLoaded = async function(){
    if (window.Chart) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/chart.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  };

  // Authorized fetch helper used across pages (uses CTX and token in localStorage)
  window.authed = async function(path, init = {}){
    const token = localStorage.getItem('token');
    if (!token) { window.location.replace('../auth/auth.html'); return; }
    const headers = Object.assign({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, init.headers || {});
    const r = await fetch(`${window.CTX.API}${path}`, Object.assign({}, init, { headers }));
    if (r.status === 401) { localStorage.removeItem('token'); window.location.replace('../auth/auth.html'); return; }
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(data.message || 'Request failed');
    return data;
  };
})(window);
