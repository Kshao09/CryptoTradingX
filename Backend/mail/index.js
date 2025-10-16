// mail/index.js — central mail API, returns structured results
const {
  getTransporter,
  ensureVerified,
  isConfigured,
  FROM_ADDRESS,
} = require('./transporter');

const { registrationTemplate } = require('./templates/registration');
const { buyTemplate }         = require('./templates/buy');
const { sellTemplate }        = require('./templates/sell');
const { exchangeTemplate }    = require('./templates/exchange');

const MAIL_DEBUG = String(process.env.MAIL_DEBUG || '0') === '1';

async function safeSend({ to, subject, html, text }) {
  if (!isConfigured()) {
    console.warn('[mail] send skipped (SMTP not configured)');
    return { sent: false, messageId: null, reason: 'not_configured' };
  }
  const tx = getTransporter();
  await ensureVerified(); // try to verify, proceed regardless
  try {
    const info = await tx.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
    if (MAIL_DEBUG) console.log('[mail] sent:', subject, '->', to, 'id=', info?.messageId);
    return { sent: true, messageId: info?.messageId || null };
  } catch (err) {
    console.error('[mail] send failed:', err?.message || err);
    return { sent: false, messageId: null, error: err?.message || String(err) };
  }
}

async function sendRegistrationEmail(to, { firstName, code }) {
  const tpl = registrationTemplate({ firstName, code });
  return safeSend({ to, ...tpl });
}
async function sendBuyEmail(to, params) {
  const tpl = buyTemplate(params);
  return safeSend({ to, ...tpl });
}
async function sendSellEmail(to, params) {
  const tpl = sellTemplate(params);
  return safeSend({ to, ...tpl });
}
async function sendExchangeEmail(to, params) {
  const tpl = exchangeTemplate(params);
  return safeSend({ to, ...tpl });
}

module.exports = {
  sendRegistrationEmail,
  sendBuyEmail,
  sendSellEmail,
  sendExchangeEmail,
};
