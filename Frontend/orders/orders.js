// orders.js — scrollable table + filters
(function(){
  const state = {
    all: [],       // all rows from API
    view: [],      // filtered rows
    symbols: []    // unique symbol list for dropdown
  };

  const el = {
    tbody: document.querySelector('#ordersTable tbody'),
    msg: document.getElementById('ordersMsg'),
    fSymbol: document.getElementById('fSymbol'),
    fSide: document.getElementById('fSide'),
    fType: document.getElementById('fType'),
    fStatus: document.getElementById('fStatus'),
    fSearch: document.getElementById('fSearch'),
    btnReset: document.getElementById('btnReset')
  };

  function fmtPrice(v){
    if (v == null || v === '' || isNaN(Number(v))) return '-';
    const n = Number(v);
    const abs = Math.abs(n);
    let max = 2;
    if (abs < 1) max = 4;
    if (abs < 0.01) max = 8;
    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: max });
  }

  function normalize(s){
    return (s ?? '').toString().toLowerCase().trim();
  }

  function render(){
    const rows = state.view;
    el.tbody.innerHTML = '';
    for (const r of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.id}</td>
        <td>${r.symbol}</td>
        <td>${r.side}</td>
        <td>${r.type}</td>
        <td>${r.qty}</td>
        <td>${r.price != null ? fmtPrice(r.price) : '-'}</td>
        <td>${r.status}</td>
      `;
      el.tbody.appendChild(tr);
    }
    el.msg.textContent = rows.length ? '' : 'No orders match your filters.';
  }

  function applyFilters(){
    const fSym = normalize(el.fSymbol?.value || '');
    const fSide = normalize(el.fSide?.value || '');
    const fType = normalize(el.fType?.value || '');
    const fStatus = normalize(el.fStatus?.value || '');
    const fSearch = normalize(el.fSearch?.value || '');

    const out = [];
    for (const r of state.all){
      if (fSym && normalize(r.symbol) !== fSym) continue;
      if (fSide && normalize(r.side) !== fSide) continue;
      if (fType && normalize(r.type) !== fType) continue;
      if (fStatus && normalize(r.status) !== fStatus) continue;
      if (fSearch){
        const hay = `${r.id} ${r.symbol} ${r.side} ${r.type} ${r.status}`.toLowerCase();
        if (!hay.includes(fSearch)) continue;
      }
      out.push(r);
    }
    state.view = out;
    render();
  }

  function populateSymbols(){
    const set = new Set();
    state.all.forEach(r => set.add(r.symbol));
    const arr = Array.from(set).sort();
    state.symbols = arr;
    const sel = el.fSymbol;
    if (!sel) return;
    // keep first option (All)
    sel.innerHTML = '<option value="">All</option>' + arr.map(s => `<option value="${s}">${s}</option>`).join('');
  }

  async function loadOrders(){
    try{
      const rows = await authed('/api/orders');
      // normalize data types
      state.all = (rows || []).map(r => ({
        id: r.id,
        symbol: r.symbol,
        side: r.side,
        type: r.type,
        qty: r.qty,
        price: r.price ?? null,
        status: r.status
      }));
      populateSymbols();
      applyFilters();
    }catch(err){
      el.msg.textContent = (err && err.message) ? err.message : String(err);
    }
  }

  // Bind filter events
  ['change','input'].forEach(evt => {
    el.fSymbol?.addEventListener(evt, applyFilters);
    el.fSide  ?.addEventListener(evt, applyFilters);
    el.fType  ?.addEventListener(evt, applyFilters);
    el.fStatus?.addEventListener(evt, applyFilters);
    el.fSearch?.addEventListener(evt, applyFilters);
  });

  el.btnReset?.addEventListener('click', (e)=>{
    e.preventDefault();
    if (el.fSymbol) el.fSymbol.value = '';
    if (el.fSide) el.fSide.value = '';
    if (el.fType) el.fType.value = '';
    if (el.fStatus) el.fStatus.value = '';
    if (el.fSearch) el.fSearch.value = '';
    applyFilters();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{
    try{ localStorage.removeItem('token'); }catch{}
    location.replace('../auth/auth.html');
  });

  loadOrders();
})();
