(async function(){
  // populate symbols using markets last-known from localStorage if available
  const last = JSON.parse(localStorage.getItem('lastMarkets')||'[]');
  const sel = document.getElementById('symbol'); if (sel) { sel.innerHTML = ''; const list = (last.length?last: [{symbol:'BTC-USD'},{symbol:'ETH-USD'}]); list.forEach(m=>{ const opt=document.createElement('option'); opt.value=m.symbol; opt.textContent=m.symbol; sel.appendChild(opt); }); }

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
})();
