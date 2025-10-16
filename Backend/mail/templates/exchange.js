const { layout } = require('./layout');
const { fmtUsd, fmtQty, nowIso } = require('../utils');

function exchangeTemplate({
  firstName = 'Trader',
  from, to,
  amountFrom, amountTo,
  priceFrom, priceTo,
  feeUsd = 0,
  sellOrderId, buyOrderId
}) {
  const title = `Your ${from} → ${to} exchange`;
  const bodyHtml = `
    <h2 style="margin:0 0 10px 0;color:#fff;">Exchange complete 🔁</h2>
    <p style="margin:0 0 12px 0;color:#cbd5e1;">Hi ${escapeHtml(firstName)}, your swap has been executed.</p>
    <table style="width:100%;border-collapse:collapse;color:#e5e7eb">
      ${row('From', `${fmtQty(amountFrom)} ${from}`)}
      ${row('To (received)', `${fmtQty(amountTo)} ${to}`)}
      ${row('From Price', fmtUsd(priceFrom))}
      ${row('To Price', fmtUsd(priceTo))}
      ${row('Fee (0.10%)', fmtUsd(feeUsd))}
      ${sellOrderId ? row('Sell Order ID', String(sellOrderId)) : ''}
      ${buyOrderId ? row('Buy Order ID', String(buyOrderId)) : ''}
      ${row('Timestamp', nowIso())}
    </table>`;

  const html = layout({ title, bodyHtml });
  const text = [
    'Exchange complete',
    `From: ${amountFrom} ${from}`,
    `To (received): ${amountTo} ${to}`,
    `From Price: ${fmtUsd(priceFrom)}`,
    `To Price: ${fmtUsd(priceTo)}`,
    `Fee: ${fmtUsd(feeUsd)}`,
    sellOrderId ? `Sell Order ID: ${sellOrderId}` : '',
    buyOrderId ? `Buy Order ID: ${buyOrderId}` : '',
    `Timestamp: ${nowIso()}`,
  ].filter(Boolean).join('\n');

  return { subject: `Your ${from} → ${to} exchange`, html, text };
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#94a3b8">${label}</td>
    <td style="padding:8px 0;text-align:right;color:#e5e7eb">${value}</td>
  </tr>`;
}
function escapeHtml(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

module.exports = { exchangeTemplate };
