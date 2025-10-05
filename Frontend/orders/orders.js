(async function(){
  try{
    const rows = await authed('/api/orders');
    const tbody = document.querySelector('#ordersTable tbody'); tbody.innerHTML = '';
    rows.forEach(r=>{ const tr = document.createElement('tr'); tr.innerHTML = `<td>${r.id}</td><td>${r.symbol}</td><td>${r.side}</td><td>${r.type}</td><td>${+r.qty}</td><td>${r.price??'-'}</td><td>${r.status}</td>`; tbody.appendChild(tr); });
  }catch(err){ console.warn('orders load', err); }
  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{ localStorage.removeItem('token'); location.replace('../auth/auth.html'); });
})();
