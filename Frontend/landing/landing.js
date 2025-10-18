/* ---------- Tiny DOM helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- Config (safe defaults if config.js missing) ---------- */
const CONFIG = Object.assign(
  { API_BASE_URL: "", WS_URL: "", DEMO: true },
  window.CONFIG || {}
);
const baseUrl = (CONFIG.API_BASE_URL || "").replace(/\/+$/, "");

/* ---------- Toast + status helpers ---------- */
function showToast(msg, type = 'info', timeout = 4200){
  const wrap = $('#toasts'); if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.borderColor = type==='error' ? 'var(--err)' : type==='warn' ? 'var(--warn)' : 'var(--border)';
  t.innerHTML = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-4px)'; }, timeout - 300);
  setTimeout(() => wrap.removeChild(t), timeout);
}
function setDot(id, state){
  const el = $(id); if (!el) return;
  el.className = 'dot ' + (state==='ok' ? 'ok' : state==='warn' ? 'warn' : 'err');
}

/* ---------- Header UI ---------- */
$('#year') && ($('#year').textContent = new Date().getFullYear());
$('#cta-primary')?.addEventListener('click', (e) => {
  e.preventDefault();
  const token = (()=>{ try { return localStorage.getItem('token'); } catch { return ''; }})();
  location.href = token ? '/markets/market.html' : '/auth/auth.html';
});

/* ---------- CoinGecko-powered ticker + sparkline ---------- */
// Map to CoinGecko IDs (same mapping your Markets page uses)
const CG_IDS = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' };
const CG_LIST = Object.values(CG_IDS);

// Shared coin state for the three badges
const coins = {
  BTC: { price: null, prev: null, change24h: null },
  ETH: { price: null, prev: null, change24h: null },
  SOL: { price: null, prev: null, change24h: null },
};

// BTC sparkline
const chart = $('#chart');
const ctx = chart.getContext('2d');
let chartPrices = [];

function drawChartFromSeries(series){
  if (!Array.isArray(series) || !series.length) { ctx.clearRect(0,0,chart.width,chart.height); return; }
  const w = chart.width, h = chart.height, pad = 8;
  const min = Math.min(...series), max = Math.max(...series);
  ctx.clearRect(0,0,w,h);
  ctx.globalAlpha = 0.15; ctx.strokeStyle = '#94a3b8';
  [0.25,0.5,0.75].forEach(r => { ctx.beginPath(); ctx.moveTo(0,h*r); ctx.lineTo(w,h*r); ctx.stroke(); });
  ctx.globalAlpha = 1;
  ctx.beginPath();
  series.forEach((v,i)=>{
    const x = (i/(series.length-1))*(w-2*pad)+pad;
    const y = h - ((v-min)/(max-min||1))*(h-2*pad) - pad;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2.2; ctx.strokeStyle = '#38bdf8'; ctx.stroke();
}

/* Replace the old renderTicker with this orbit version */
/* ==== circular belt renderer (replaces your old renderTicker) ==== */
/* ==== Horizontal belt ticker ==== */
let beltRAF = null;
let beltOffset = 0;                 // current x offset (px)
let beltWidth = 0;                  // width of one track (px)
const BELT_SPEED_PX_S = 70;         // tweak scroll speed
let _beltTrack = null, _beltClone = null;

function buildChip(sym, info){
  const price = info.price, prev = info.prev ?? info.price, change = info.change24h;
  const deltaPct = (typeof change === 'number')
    ? change
    : (price && prev ? ((price - prev)/prev)*100 : 0);
  return `
    <div class="coin">
      <div class="left">
        <span class="badge">${sym}</span>
        <strong>${price==null ? '--' : `$${price.toLocaleString(undefined,{maximumFractionDigits:2})}`}</strong>
      </div>
      <div class="delta ${deltaPct>=0 ? 'up' : 'down'}">
        ${deltaPct>=0?'+':''}${(deltaPct||0).toFixed(2)}%
      </div>
    </div>
  `;
}

function measureBelt(){
  // after content is set and in the DOM
  beltWidth = _beltTrack ? _beltTrack.scrollWidth : 0;
}

function applyBeltTransforms(){
  if (!_beltTrack || !_beltClone) return;
  _beltTrack.style.transform = `translateX(${beltOffset}px)`;
  _beltClone.style.transform = `translateX(${beltOffset + beltWidth}px)`;
}

function startBelt(){
  cancelAnimationFrame(beltRAF);
  let last = performance.now();
  function tick(now){
    const dt = (now - last) / 1000; last = now;
    beltOffset -= BELT_SPEED_PX_S * dt;
    if (-beltOffset >= beltWidth && beltWidth > 0) {
      beltOffset += beltWidth; // wrap seamlessly
    }
    applyBeltTransforms();
    beltRAF = requestAnimationFrame(tick);
  }
  beltRAF = requestAnimationFrame(tick);
}

function renderTicker(){
  _beltTrack = _beltTrack || document.getElementById('beltTrack');
  _beltClone = _beltClone || document.getElementById('beltTrackClone');
  if (!_beltTrack || !_beltClone) return;

  const ids = Object.keys(coins);   // e.g., ["BTC","ETH","SOL"]
  const html = ids.map(sym => buildChip(sym, coins[sym])).join('');
  const currentOffset = beltOffset; // preserve motion across renders

  _beltTrack.innerHTML = html;
  _beltClone.innerHTML = html;

  // measure after DOM paints to get correct width
  requestAnimationFrame(() => {
    measureBelt();
    beltOffset = currentOffset; // resume from previous position
    applyBeltTransforms();
  });

  // keep the separate BTC badge near the chart updated
  if (coins.BTC?.price != null) {
    const b = document.getElementById('btcNow');
    if (b) b.textContent = `$${coins.BTC.price.toLocaleString(undefined,{maximumFractionDigits:2})}`;
  }
}

// keep belt width correct on resize
window.addEventListener('resize', () => {
  requestAnimationFrame(() => { measureBelt(); applyBeltTransforms(); });
});


// Fetch snapshot for BTC/ETH/SOL
async function fetchCGSnapshot(){
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(CG_LIST.join(','))}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('CG snapshot failed');
  const rows = await resp.json();
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  for (const [sym, id] of Object.entries(CG_IDS)) {
    const row = byId[id]; if (!row) continue;
    const prev = coins[sym].price ?? row.current_price;
    coins[sym].prev = prev;
    coins[sym].price = row.current_price ?? prev;
    coins[sym].change24h = row.price_change_percentage_24h_in_currency ?? null;
  }
}

// Fetch BTC series for sparkline (1 day)
async function fetchBTCSeries(days=1){
  const url = `https://api.coingecko.com/api/v3/coins/${CG_IDS.BTC}/market_chart?vs_currency=usd&days=${days}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('CG chart failed');
  const j = await resp.json();
  chartPrices = (j.prices || []).map(p => p[1]);
}

/* timers for CG */
let cgPriceTimer = null, cgChartTimer = null;
async function startCoinGecko(){
  clearInterval(cgPriceTimer); clearInterval(cgChartTimer);
  try {
    await Promise.all([fetchCGSnapshot(), fetchBTCSeries(1)]);
    renderTicker(); drawChartFromSeries(chartPrices);
    $('#chartHint').textContent = 'CoinGecko feed';
    setDot('#s-ws','warn'); // we’re not using WS in demo mode
  } catch (e) {
    console.warn(e); $('#chartHint').textContent = 'CoinGecko feed (degraded)';
  }
  cgPriceTimer = setInterval(async () => {
    try { await fetchCGSnapshot(); renderTicker(); } catch{}
  }, 30_000);
  cgChartTimer = setInterval(async () => {
    try { await fetchBTCSeries(1); drawChartFromSeries(chartPrices); } catch{}
  }, 120_000);
}

/* ---------- WebSocket live path (used when DEMO=false) ---------- */
let ws = null;
function connectWS(){
  if(ws){ try{ ws.close(); }catch{} ws=null; }
  try{
    ws = new WebSocket(CONFIG.WS_URL);
    ws.addEventListener('open', ()=>{ setDot('#s-ws','ok'); showToast('WebSocket connected'); $('#chartHint').textContent = 'Live server feed'; });
    ws.addEventListener('message', ev => {
      try{
        const msg = JSON.parse(ev.data); // { symbol, price }
        const { symbol, price } = msg;
        if(coins[symbol]){
          coins[symbol].prev = coins[symbol].price ?? price;
          coins[symbol].price = price;
          if(symbol==='BTC' && typeof price === 'number'){
            chartPrices.push(price); if (chartPrices.length>240) chartPrices.shift(); drawChartFromSeries(chartPrices);
          }
          renderTicker();
        }
      }catch(e){}
    });
    ws.addEventListener('close', ()=>{ setDot('#s-ws','warn'); showToast('WebSocket disconnected — retrying…','warn'); setTimeout(connectWS, 2000); });
    ws.addEventListener('error', ()=>{ setDot('#s-ws','err'); });
  }catch(e){ setDot('#s-ws','err'); showToast('Failed to open WebSocket','error'); }
}

/* ---------- Health check ---------- */
async function healthCheck(){
  if (CONFIG.DEMO) {
    setDot('#s-redis','ok'); setDot('#s-stripe','ok'); setDot('#s-openai','ok');
    return;
  }
  if (!baseUrl) { setDot('#s-redis','warn'); setDot('#s-stripe','warn'); setDot('#s-openai','warn'); return; }
  try{
    const res = await fetch(`${baseUrl}/health`, { headers:{'Accept':'application/json'} });
    const j = await res.json();
    setDot('#s-redis',  j.redis  === 'ok' ? 'ok' : 'err');
    setDot('#s-stripe', j.stripe === 'ok' ? 'ok' : 'err');
    setDot('#s-openai', j.openai === 'ok' ? 'ok' : 'err');
  }catch(e){
    setDot('#s-redis','warn'); setDot('#s-stripe','warn'); setDot('#s-openai','warn');
  }
}

/* ---------- Backoff demo + clipboard (unchanged) ---------- */
async function simulateApiCall(){
  const hit429 = Math.random() < 0.5;
  await new Promise(r => setTimeout(r, 350));
  if(hit429){ const err = new Error('429: quota exceeded'); err.status = 429; throw err; }
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
  try{ await withBackoff(simulateApiCall, { maxAttempts:5, baseMs:700 }); showToast('Request succeeded after backoff','info'); }catch{}
});
$('#copyCurl')?.addEventListener('click', () => {
  if (!baseUrl) { showToast('No API base configured','warn'); return; }
  const curl = `curl -s ${baseUrl}/health | jq`;
  navigator.clipboard.writeText(curl).then(()=> showToast('cURL copied to clipboard')).catch(()=> showToast('Copy failed','error'));
});

/* ---------- FAQ: real Q/A + feedback ---------- */

// Real FAQs. Edit freely.
const FAQS = [
  {
    id: "is-exchange",
    q: "Is CryptoTradingX an exchange or a client?",
    a: "CryptoTradingX is a client that connects to supported exchanges and market data providers. In Demo Mode we show prices from CoinGecko; when you go live, your backend WebSocket provides real-time quotes. We don’t hold customer funds."
  },
  {
    id: "realtime",
    q: "How do I get live prices instead of demo?",
    a: "Set <code>CONFIG.DEMO = false</code> in <code>config.js</code> and provide a valid <code>CONFIG.WS_URL</code>. The landing page will switch from CoinGecko to your WebSocket feed automatically."
  },
  {
    id: "orders",
    q: "Are orders real in Demo Mode?",
    a: "Demo Mode simulates order placement via the sample <code>/api/orders</code> endpoints. When integrated with a broker/exchange in live mode, those same routes forward to your execution layer."
  },
  {
    id: "pricing",
    q: "What does it cost?",
    a: "Starter is free. Pro is $29/month via Stripe and includes priority API pool and higher limits. Cancel anytime from your billing portal."
  },
  {
    id: "security",
    q: "How is my data secured?",
    a: "Use HTTPS in production, JWT for sessions, and store secrets server-side. We recommend enabling rate limits and CSRF protection on auth endpoints."
  },
  {
    id: "quota",
    q: "How do you prevent “API quota exceeded” errors?",
    a: "We cache hot endpoints (e.g., quotes) on the backend and use exponential backoff with jitter on 429s. Try the <em>Simulate “Quota Exceeded”</em> button in the hero to see the retry UX."
  },
  {
    id: "support",
    q: "How do I get support?",
    a: "Open a ticket from the app, email support@yourdomain.com, or reach out via the Get Started page."
  }
];

// Render the FAQ list
function renderFAQ(){
  const list = document.getElementById('faqList');
  if (!list) return;
  list.innerHTML = '';

  FAQS.forEach(item => {
    const details = document.createElement('details');
    details.className = 'faq-item';
    details.setAttribute('role','listitem');

    const voted = localStorage.getItem(`faqVote:${item.id}`); // 'up' | 'down' | null
    details.innerHTML = `
      <summary>${item.q}</summary>
      <div class="answer">${item.a}</div>
      <div class="feedback" aria-label="Was this helpful?">
        <span class="label">Was this helpful?</span>
        <button class="thumb up" data-id="${item.id}" ${voted?'disabled':''} title="Yes">👍</button>
        <button class="thumb down" data-id="${item.id}" ${voted?'disabled':''} title="No">👎</button>
        <span class="msg" id="fb-${item.id}">${voted ? 'Thanks for the feedback!' : ''}</span>
      </div>
    `;
    list.appendChild(details);
  });
}

// Handle feedback (local + optional POST)
async function handleFaqFeedback(id, helpful){
  const key = `faqVote:${id}`;
  if (localStorage.getItem(key)) { showToast('Thanks! You already left feedback.'); return; }
  try { localStorage.setItem(key, helpful ? 'up' : 'down'); } catch {}
  const msgEl = document.getElementById(`fb-${id}`); if (msgEl) msgEl.textContent = 'Thanks for the feedback!';
  document.querySelectorAll(`button[data-id="${id}"]`).forEach(b => b.disabled = true);

  // Optional: send to your backend if available
  try {
    if (baseUrl) {
      await fetch(`${baseUrl}/api/faq/feedback`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          id,
          helpful: !!helpful,
          ts: Date.now(),
          ua: navigator.userAgent
        })
      });
    }
  } catch { /* ignore network errors; UX already updated */ }
}

// Delegate click events for thumbs
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.thumb');
  if (!btn) return;
  const id = btn.dataset.id;
  const isUp = btn.classList.contains('up');
  handleFaqFeedback(id, isUp);
});

// Inject FAQPage structured data (SEO)
(function injectFaqSchema(){
  try {
    const data = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": FAQS.map(f => ({
        "@type": "Question",
        "name": f.q,
        "acceptedAnswer": { "@type": "Answer", "text": f.a.replace(/<[^>]+>/g,'') }
      }))
    };
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  } catch {}
})();

// Call from your existing init()
const _oldInit = typeof init === 'function' ? init : null;
window.init = function(){
  renderFAQ();
  if (_oldInit) _oldInit();
};

/* ---------- Demo toggle + init ---------- */
const demoToggle = $('#demoToggle');
const demoState  = $('#demoState');

function init(){
  clearInterval(cgPriceTimer); clearInterval(cgChartTimer);
  if (CONFIG.DEMO) { startCoinGecko(); }   // DEMO = CoinGecko
  else { connectWS(); }                    // Live = your WS
  healthCheck();
  renderTicker();
  startBelt();
  if (chartPrices?.length) drawChartFromSeries(chartPrices);
}
demoToggle?.addEventListener('click', () => {
  CONFIG.DEMO = !CONFIG.DEMO;
  demoState.textContent = CONFIG.DEMO ? 'ON' : 'OFF';
  init();
});
init();
