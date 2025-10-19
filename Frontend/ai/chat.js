// AI Chat Bubble — uses window.authed() and your AI endpoint.
// Works on any page once included.

// tiny helpers
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const $  = (s, r=document) => r.querySelector(s);

(function attachAIChat(){
  // Avoid double attach
  if (window.__CTX_CHAT_ATTACHED__) return; window.__CTX_CHAT_ATTACHED__ = true;

  // ---- DOM ----
  const btn = document.createElement('button');
  btn.className = 'ctx-chat-btn';
  btn.title = 'Ask about your account/portfolio';
  btn.innerHTML = '💬';

  const wrap = document.createElement('div');
  wrap.className = 'ctx-chat';
  wrap.innerHTML = `
    <div class="hd">
      <div class="t"><span class="ctx-dot ok" id="ctxAiDot"></span>Account & Portfolio Assistant</div>
      <button class="x" aria-label="Close" title="Close">×</button>
    </div>

    <div class="chips">
      <span class="chip" data-q="Summarize my portfolio exposure and concentration.">Portfolio summary</span>
      <span class="chip" data-q="What are three risks I should watch for this week?">3 risks this week</span>
      <span class="chip" data-q="Given my holdings, what are two simple risk controls I can apply?">Risk controls</span>
      <span class="chip" data-q="Do I have any outsized positions I should rebalance?">Rebalance check</span>
    </div>

    <div class="ctx-hint">Education only, not financial advice.</div>
    <div class="msgs" id="ctxMsgs"></div>

    <div class="ft">
      <textarea id="ctxInput" placeholder="Ask about your account or portfolio…"></textarea>
      <button id="ctxSend">Send</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(wrap);

  const msgs = $('#ctxMsgs', wrap);
  const input = $('#ctxInput', wrap);
  const sendBtn = $('#ctxSend', wrap);
  const dot = $('#ctxAiDot', wrap);

  // ---- open/close ----
  btn.addEventListener('click', () => {
    wrap.classList.toggle('open');
    if (wrap.classList.contains('open')) {
      input.focus();
      ensureContextWarm();  // prefetch context on first open
    }
  });
  $('.x', wrap).addEventListener('click', () => wrap.classList.remove('open'));

  // quick chips
  wrap.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    input.value = chip.dataset.q;
    input.focus();
  });

  // send flow
  sendBtn.addEventListener('click', onSend);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  });

  // ---- context building ----
  let ctxReady = false;
  let cachedPositions = null;
  let cachedCashUsd = 0;

  async function ensureContextWarm(){
    if (ctxReady) return;
    try {
      const token = (localStorage && localStorage.getItem('token')) || '';
      if (!token) {
        setState('warn');
        pushBot("You're not signed in. Sign in to chat about your account.", true);
        return;
      }
      setState('ok');
      const { positions, cashUsd } = await buildPositionsFromAccount();
      cachedPositions = positions;
      cachedCashUsd = cashUsd;
      ctxReady = true;
    } catch (e) {
      setState('err');
      pushBot('Could not load your portfolio context. Try again after reloading.', true);
    }
  }

  function setState(state){ dot.className = 'ctx-dot ' + state; }

  async function buildPositionsFromAccount(){
    // 1) balances/portfolio
    let portfolio = [];
    try { portfolio = await window.authed('/api/portfolio'); } catch {}
    // fallback: balances
    if (!Array.isArray(portfolio) || !portfolio.length) {
      try {
        const b = await window.authed('/api/balances');
        const rows = Object.entries(b.balances||{}).map(([asset, balance]) => ({ asset, balance }));
        portfolio = rows;
      } catch {}
    }

    // 2) compute average BUY price per base using trades + orders (client side join)
    let orders = [], trades = [];
    try { orders = await window.authed('/api/orders'); } catch {}
    try { trades = await window.authed('/api/transactions'); } catch {}

    const sideByOrder = new Map(orders.map(o => [o.id, String(o.side||'').toUpperCase()]));
    const buyAgg = {}; // base -> { cost, qty }
    (trades||[]).forEach(t => {
      const side = sideByOrder.get(t.order_id);
      const base = String(t.symbol||'').split('-')[0] || '';
      if (!base || side !== 'BUY') return;
      if (!buyAgg[base]) buyAgg[base] = { cost:0, qty:0 };
      buyAgg[base].cost += Number(t.price||0) * Number(t.qty||0);
      buyAgg[base].qty  += Number(t.qty||0);
    });

    // 3) positions[] -> (symbol, qty, avgPrice)
    const positions = [];
    for (const row of (portfolio||[])) {
      const base = (row.asset || row.symbol || '').toUpperCase();
      const qty  = Number(row.balance || row.qty || 0);
      if (!base || !qty) continue;

      let avg = (buyAgg[base] && buyAgg[base].qty > 0) ? (buyAgg[base].cost / buyAgg[base].qty) : null;

      // fallback to a last price if avg unknown
      if (avg == null) {
        try {
          const p = await window.authed(`/api/prices/${base}`);
          avg = Number(p.usd || 0) || null;
        } catch {}
      }
      positions.push({ symbol: `${base}-USD`, qty, avgPrice: avg || 0 });
    }

    // Cash (if you store USD as a wallet row, surface it; else 0)
    let cashUsd = 0;
    try {
      const b = await window.authed('/api/balances');
      if (b?.balances?.USD) cashUsd = Number(b.balances.USD);
    } catch {}

    return { positions, cashUsd };
  }

  // ---- chat I/O ----
  function pushMe(text){ if (!text) return;
    const div = document.createElement('div'); div.className = 'm me'; div.textContent = text; msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
  }
  function pushBot(text, isSystem=false){
    const div = document.createElement('div'); div.className = 'm bot'; div.innerHTML = text.replace(/\n/g,'<br/>'); msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
    if(isSystem) div.style.opacity = .9;
  }

  async function onSend(){
    const q = input.value.trim();
    if (!q) return;
    pushMe(q); input.value = ''; sendBtn.disabled = true;

    await ensureContextWarm();
    if (!cachedPositions || !cachedPositions.length) {
      pushBot("I couldn't find any holdings. Place a trade first, then try again.");
      sendBtn.disabled = false; return;
    }

    try {
      // The backend expects { positions[], cashUsd, riskTolerance } and will
      // return either { summary, tips[] } (rule-based) or { text } (OpenAI).
      // We also include the user's question so it appears in the prompt JSON.
      const body = {
        positions: cachedPositions,
        cashUsd: cachedCashUsd || 0,
        riskTolerance: 'medium',
        question: q
      };

      // existing AI endpoint (already defined on your server) → /api/ai/insights
      const r = await window.authed('/api/ai/insights', {
        method:'POST',
        body: JSON.stringify(body)
      });

      if (r?.text) {
        pushBot(r.text);
      } else if (r?.summary || r?.tips) {
        let out = '';
        if (r.warning === 'ai_fallback') {
          out += '<em style="color:#9fb3da">AI model at capacity — showing quick summary.</em><br><br>';
        }
        if (r.summary) out += `<strong>Summary</strong><br>${r.summary}<br><br>`;
        if (Array.isArray(r.tips) && r.tips.length) out += '<strong>Tips</strong><br>• ' + r.tips.join('<br>• ');
        pushBot(out || 'No insights available right now.');
      } else {
        pushBot('Hmm, I did not get a usable reply.');
      }
    } catch (e) {
      const m = (e && e.message) ? e.message : 'Request failed';
      pushBot('Error: ' + m);
    } finally {
      sendBtn.disabled = false;
    }
  }
})();
