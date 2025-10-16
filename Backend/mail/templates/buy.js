const { layout } = require('./layout');
const { fmtUsd, fmtQty, nowIso } = require('../utils');

function buyTemplate({ firstName = 'Trader', symbol, qty, price, amountUsd, orderId, paymentIntentId }) {
  const title = `Your ${symbol} purchase`;
  const total = amountUsd ?? (Number(qty) * Number(price));
  const bodyHtml = `
    <h2 style="margin:0 0 10px 0;color:#fff;">Purchase confirmed ✅</h2>
    <p style="margin:0 0 12px 0;color:#cbd5e1;">Thanks, ${escapeHtml(firstName)}. We've credited your account.</p>
    <table style="width:100%;border-collapse:collapse;color:#e5e7eb">
      ${row('Asset', symbol)}
      ${row('Filled Qty', fmtQty(qty))}
      ${row('Fill Price', fmtUsd(price))}
      ${row('Total', fmtUsd(total))}
      ${orderId ? row('Order ID', String(orderId)) : ''}
      ${paymentIntentId ? row('Payment Intent', String(paymentIntentId)) : ''}
      ${row('Timestamp', nowIso())}
    </table>`;

  const html = layout({ title, bodyHtml });
  const text = [
    'Purchase confirmed',
    `Asset: ${symbol}`,
    `Filled Qty: ${qty}`,
    `Fill Price: ${fmtUsd(price)}`,
    `Total: ${fmtUsd(total)}`,
    orderId ? `Order ID: ${orderId}` : '',
    paymentIntentId ? `Payment Intent: ${paymentIntentId}` : '',
    `Timestamp: ${nowIso()}`,
  ].filter(Boolean).join('\n');

  return { subject: `Your ${symbol} purchase`, html, text };
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#94a3b8">${label}</td>
    <td style="padding:8px 0;text-align:right;color:#e5e7eb">${value}</td>
  </tr>`;
}
function escapeHtml(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

module.exports = { buyTemplate };
