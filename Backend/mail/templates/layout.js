// Base HTML layout wrapper (simple, compatible)

function layout({ title, bodyHtml }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:#0b1320;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:linear-gradient(180deg,#121b2e,#0b1320);border:1px solid rgba(148,163,184,.18);border-radius:16px;padding:20px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:#7c3aed"></div>
        <h1 style="font-size:18px;margin:0;color:#fff;">CryptoTradingX</h1>
      </div>
      ${bodyHtml}
      <p style="margin-top:22px;font-size:12px;color:#94a3b8">
        This is an automated message from CryptoTradingX. If you did not initiate this action, please contact support.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { layout };
