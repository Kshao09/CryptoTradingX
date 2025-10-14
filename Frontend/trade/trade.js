/* Stripe purchase flow (Card Element), using payment_method_types=['card'] */
(async function () {
  // Populate coin select from cached markets (fallback to BTC/ETH)
  const purchaseCoinSel = document.getElementById("purchaseCoin");
  const cached = JSON.parse(localStorage.getItem("lastMarkets") || "[]");
  const list = (cached.length ? cached : [
    { symbol: "BTC-USD", name: "Bitcoin" },
    { symbol: "ETH-USD", name: "Ethereum" }
  ]);
  if (purchaseCoinSel) {
    purchaseCoinSel.innerHTML = "";
    list.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.symbol;
      opt.textContent = m.name ? `${m.symbol} — ${m.name}` : m.symbol;
      purchaseCoinSel.appendChild(opt);
    });
  }

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    try { localStorage.removeItem("token"); } catch {}
    location.replace("../auth/auth.html");
  });

  // Stripe
  const stripePubKey =
    (window.CONFIG && window.CONFIG.STRIPE_PUBLISHABLE_KEY) || window.STRIPE_PUBLISHABLE_KEY;
  const purchaseForm = document.getElementById("purchaseForm");
  const payBtn = document.getElementById("payBtn");
  const purchaseMsg = document.getElementById("purchaseMsg");

  if (!purchaseForm) return;

  if (!stripePubKey || !window.Stripe) {
    purchaseMsg.textContent =
      "Stripe is not configured. Add STRIPE_PUBLISHABLE_KEY in config.js and include Stripe.js.";
    purchaseMsg.classList.add("error");
    return;
  }

  const stripe = Stripe(stripePubKey);
  const elements = stripe.elements();

  const card = elements.create('card', {
    hidePostalCode: true,
    style: {
      base: {
        color: '#111827',                              // dark text
        iconColor: '#111827',
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial',
        fontSize: '16px',
        '::placeholder': { color: '#9ca3af' },         // mid-gray placeholder
        ':-webkit-autofill': { color: '#111827' }
      },
      invalid: {
        color: '#b91c1c',
        iconColor: '#b91c1c'
      }
    }
  });

  card.mount('#card-element');


  card.on("change", (evt) => {
    const el = document.getElementById("card-errors");
    el.textContent = evt.error ? evt.error.message : "";
  });

  purchaseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    purchaseMsg.textContent = "";
    purchaseMsg.className = "msg";

    const coin = document.getElementById("purchaseCoin").value;
    const amountUsd = Math.floor(parseFloat(document.getElementById("amountUsd").value || "0"));
    const name = document.getElementById("buyerName").value.trim();
    const email = document.getElementById("buyerEmail").value.trim();

    if (!coin) { purchaseMsg.textContent = "Please select a coin."; purchaseMsg.className = "msg error"; return; }
    if (!amountUsd || amountUsd < 1) { purchaseMsg.textContent = "Enter a valid USD amount (min $1)."; purchaseMsg.className = "msg error"; return; }
    if (!name) { purchaseMsg.textContent = "Enter the cardholder name."; purchaseMsg.className = "msg error"; return; }
    if (!email) { purchaseMsg.textContent = "Enter a valid email."; purchaseMsg.className = "msg error"; return; }

    payBtn.disabled = true;
    payBtn.textContent = "Processing…";

    try {
      // 1) Create PaymentIntent on backend
      const intent = await authed("/api/payments/create-intent", {
        method: "POST",
        body: JSON.stringify({ amountUsd, coin, receiptEmail: email })
      });

      if (!intent || !intent.clientSecret) {
        throw new Error("Failed to create payment. Try again.");
      }

      // 2) Confirm card payment
      const { error, paymentIntent } = await stripe.confirmCardPayment(intent.clientSecret, {
        payment_method: {
          card,
          billing_details: { name, email }
        }
      });

      if (error) throw new Error(error.message || "Your card was declined.");

      if (paymentIntent && paymentIntent.status === "succeeded") {
        purchaseMsg.textContent = "Payment successful! Your coins will be credited shortly.";
        purchaseMsg.className = "msg success";

        // Optional: server-side fulfillment confirmation
        try {
          await authed("/api/payments/fulfill", {
            method: "POST",
            body: JSON.stringify({ paymentIntentId: paymentIntent.id })
          });
        } catch (_) {}

        purchaseForm.reset();
        card.clear();
      } else {
        purchaseMsg.textContent = "Payment processing… you will see an update once completed.";
        purchaseMsg.className = "msg";
      }
    } catch (err) {
      purchaseMsg.textContent = (err && err.message) ? err.message : String(err);
      purchaseMsg.className = "msg error";
    } finally {
      payBtn.disabled = false;
      payBtn.textContent = "Pay with card";
    }
  });
})();
