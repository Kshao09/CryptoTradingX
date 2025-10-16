const { layout } = require('./layout');

function registrationTemplate({ firstName = 'Trader', code }) {
  const title = 'Verify your email';
  const codeBlock = `
    <div style="font-size:28px;font-weight:800;letter-spacing:6px;color:#fff;background:#0f172a;border:1px solid rgba(148,163,184,.25);border-radius:12px;padding:12px 16px;display:inline-block;">
      ${String(code || '------')}
    </div>`;

  const bodyHtml = `
    <h2 style="margin:0 0 10px 0;color:#fff;">Welcome, ${escapeHtml(firstName)} 👋</h2>
    <p style="margin:0 0 14px 0;color:#cbd5e1;">Use the verification code below to complete your sign up:</p>
    ${codeBlock}
    <p style="margin:14px 0 0 0;color:#cbd5e1;">This code expires in 10 minutes.</p>
  `;

  const html = layout({ title, bodyHtml });
  const text = [
    'Verify your email for CryptoTradingX',
    `Code: ${code}`,
    'This code expires in 10 minutes.'
  ].join('\n');

  return { subject: 'Your CryptoTradingX verification code', html, text };
}

function escapeHtml(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

module.exports = { registrationTemplate };
