const CONFIG = Object.assign(
  { API_BASE_URL: "", WS_URL: "", DEMO: true },   // sensible defaults
  window.CONFIG || {}
);

// --- UTILITIES ---
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function showToast(msg, type = 'info', timeout = 4200){
  const wrap = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.borderColor = type==='error' ? 'var(--err)' : type==='warn' ? 'var(--warn)' : 'var(--border)';
  t.innerHTML = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-4px)'; }, timeout - 300);
  setTimeout(() => wrap.removeChild(t), timeout);
}
function setDot(id, state){
  const el = $(id);
  el.className = 'dot ' + (state==='ok' ? 'ok' : state==='warn' ? 'warn' : 'err');
}

// --- YEAR ---
$('#year').textContent = new Date().getFullYear();

// --- THEME / DEMO ---
const demoToggle = $('#demoToggle');
const demoState = $('#demoState');
demoToggle.addEventListener('click', () => {
  CONFIG.DEMO = !CONFIG.DEMO;
  demoState.textContent = CONFIG.DEMO ? 'ON' : 'OFF';
  $('#chartHint').textContent = CONFIG.DEMO ? 'Live demo feed' : 'Live server feed';
  init(); // re-init connections
});

// --- TICKERS (demo or ws) ---
const coins = {
  BTC: { price: 67850.00, prev: 67850.00 },
  ETH: { price: 3125.00, prev: 3125.00 },
  SOL: { price: 178.00, prev: 178.00 }
};

function renderTicker(){
  const wrap = $('#ticker');
  wrap.innerHTML = '';
  Object.entries(coins).forEach(([sym, {price, prev}]) => {
    const delta = price - prev;
    const pct = (delta / prev) * 100;
    const el = document.createElement('div');
    el.className = 'coin';
    el.innerHTML = `
      <div class="left">
        <span class="badge">${sym}</span>
        <strong>$${price.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</strong>
      </div>
      <div class="delta ${delta>=0 ? 'up' : 'down'}">${delta>=0?'+':''}${pct.toFixed(2)}%</div>
    `;
    wrap.appendChild(el);
  });
  $('#btcNow').textContent = `$${coins.BTC.price.toLocaleString(undefined,{maximumFractionDigits:2})}`;
}

function randomWalk(v, scale){
  const step = (Math.random() - 0.5) * scale; // symmetric walk
  return Math.max(1, v + step);
}

// --- SPARKLINE ---
const chart = $('#chart');
const ctx = chart.getContext('2d');
const data = new Array(120).fill(coins.BTC.price);

function draw(){
  const w = chart.width, h = chart.height;
  ctx.clearRect(0,0,w,h);
  // grid
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = '#94a3b8';
  [0.25, 0.5, 0.75].forEach(r => { ctx.beginPath(); ctx.moveTo(0, h*r); ctx.lineTo(w, h*r); ctx.stroke(); });
  ctx.globalAlpha = 1;
  // line
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 8;
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = (i/(data.length-1)) * (w-2*pad) + pad;
    const y = h - ((v - min)/(max-min || 1)) * (h-2*pad) - pad;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#38bdf8';
  ctx.stroke();
}

let demoTimer = null; let ws = null;

function startDemo(){
  clearInterval(demoTimer);
  demoTimer = setInterval(()=>{
    for(const k of Object.keys(coins)){
      coins[k].prev = coins[k].price;
      const scale = k==='BTC' ? 120 : k==='ETH' ? 20 : 5;
      coins[k].price = randomWalk(coins[k].price, scale);
    }
    data.push(coins.BTC.price); data.shift();
    renderTicker(); draw();
  }, 1000);
  setDot('#s-ws','ok');
  setDot('#s-redis','ok');
  setDot('#s-stripe','ok');
  setDot('#s-openai','ok');
}

function connectWS(){
  if(ws){ try{ ws.close(); }catch{} ws=null; }
  try{
    ws = new WebSocket(CONFIG.WS_URL);
    ws.addEventListener('open', ()=>{ setDot('#s-ws','ok'); showToast('WebSocket connected'); });
    ws.addEventListener('message', ev => {
      try{
        const msg = JSON.parse(ev.data); // expected: { symbol, price }
        const { symbol, price } = msg;
        if(coins[symbol]){
          coins[symbol].prev = coins[symbol].price;
          coins[symbol].price = price;
          if(symbol==='BTC'){ data.push(price); data.shift(); }
          renderTicker(); draw();
        }
      }catch(e){ /* ignore */ }
    });
    ws.addEventListener('close', ()=>{ setDot('#s-ws','warn'); showToast('WebSocket disconnected — retrying…','warn'); setTimeout(connectWS, 2000); });
    ws.addEventListener('error', ()=>{ setDot('#s-ws','err'); });
  }catch(e){ setDot('#s-ws','err'); showToast('Failed to open WebSocket','error'); }
}

async function healthCheck(){
  if(CONFIG.DEMO){
    setDot('#s-redis','ok'); setDot('#s-stripe','ok'); setDot('#s-openai','ok'); return;
  }
  try{
    const res = await fetch(CONFIG.API_BASE_URL + '/health', { headers:{'Accept':'application/json'} });
    const j = await res.json();
    setDot('#s-redis', j.redis==='ok'? 'ok' : 'err');
    setDot('#s-stripe', j.stripe==='ok'? 'ok' : 'err');
    setDot('#s-openai', j.openai==='ok'? 'ok' : 'err');
  }catch(e){ setDot('#s-redis','warn'); setDot('#s-stripe','warn'); setDot('#s-openai','warn'); }
}

// --- Exponential Backoff Demo (429 Quota Exceeded) ---
async function simulateApiCall(){
  // Simulate a 50% chance of 429 when DEMO is on.
  const hit429 = Math.random() < 0.5;
  await new Promise(r => setTimeout(r, 350));
  if(hit429){
    const err = new Error('429: quota exceeded'); err.status = 429; throw err;
  }
  return { ok:true };
}

async function withBackoff(task, { maxAttempts=5, baseMs=600 } = {}){
  for(let attempt=1; attempt<=maxAttempts; attempt++){
    try{ return await task(); }
    catch(e){
      if(e.status === 429 && attempt < maxAttempts){
        const delay = Math.round(baseMs * Math.pow(2, attempt-1));
        showToast(`API quota exceeded — retry ${attempt}/${maxAttempts-1} in <strong>${Math.ceil(delay/1000)}s</strong>…`, 'warn', delay+800);
        await new Promise(r => setTimeout(r, delay));
      } else {
        showToast('Request failed: ' + (e.message||'Unknown error'), 'error');
        throw e;
      }
    }
  }
}

$('#simulateQuota')?.addEventListener('click', async () => {
  try{
    await withBackoff(simulateApiCall, { maxAttempts:5, baseMs:700 });
    showToast('Request succeeded after backoff','info');
  }catch{}
});

// Smooth scroll for in-page anchors
$$('a[href^="#"]').forEach(a => a.addEventListener('click', (e)=>{
  const id = a.getAttribute('href');
  if(id.length>1){ e.preventDefault(); document.querySelector(id).scrollIntoView({behavior:'smooth', block:'start'}); }
}));

function init(){
  clearInterval(demoTimer);
  if(CONFIG.DEMO){ startDemo(); }
  else { connectWS(); }
  healthCheck(); renderTicker(); draw();
}

// Kick things off
init();
