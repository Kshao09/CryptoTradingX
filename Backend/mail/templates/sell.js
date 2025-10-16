const { layout } = require('./layout');
const { fmtUsd, fmtQty, nowIso } = require('../utils');

function sellTemplate({ firstName = 'Trader', symbol, qty, price, proceedsUsd, feeUsd = 0, orderId }) {
  const title = `Your ${symbol} sale`;
  const gross = Number(qty) * Number(price);
  const net = proceedsUsd ?? (gross - Number(feeUsd || 0));
  const bodyHtml = `
    <h2 style="margin:0 0 10px 0;color:#fff;">Sale filled ✅</h2>
    <p style="margin:0 0 12px 0;color:#cbd5e1;">Hi ${escapeHtml(firstName)}, your order has been executed.</p>
    <table style="width:100%;border-collapse:collapse;color:#e5e7eb">
      ${row('Asset', symbol)}
      ${row('Filled Qty', fmtQty(qty))}
      ${row('Fill Price', fmtUsd(price))}
      ${row('Gross', fmtUsd(gross))}
      ${row('Fee (0.10%)', fmtUsd(feeUsd))}
      ${row('Net Proceeds', fmtUsd(net))}
      ${orderId ? row('Order ID', String(orderId)) : ''}
      ${row('Timestamp', nowIso())}
    </table>`;

  const html = layout({ title, bodyHtml });
  const text = [
    'Sale filled',
    `Asset: ${symbol}`,
    `Filled Qty: ${qty}`,
    `Fill Price: ${fmtUsd(price)}`,
    `Gross: ${fmtUsd(gross)}`,
    `Fee: ${fmtUsd(feeUsd)}`,
    `Net Proceeds: ${fmtUsd(net)}`,
    orderId ? `Order ID: ${orderId}` : '',
    `Timestamp: ${nowIso()}`,
  ].filter(Boolean).join('\n');

  return { subject: `Your ${symbol} sale`, html, text };
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#94a3b8">${label}</td>
    <td style="padding:8px 0;text-align:right;color:#e5e7eb">${value}</td>
  </tr>`;
}
function escapeHtml(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

module.exports = { sellTemplate };
