// mail/transporter.js — robust transporter with lazy verify + readiness helpers
const nodemailer = require('nodemailer');

const SMTP_HOST   = process.env.SMTP_HOST;
const SMTP_PORT   = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER   = process.env.SMTP_USER;
const SMTP_PASS   = process.env.SMTP_PASS;
const SMTP_FROM   = process.env.SMTP_FROM || SMTP_USER || 'no-reply@cryptotradingx.app';

const MAIL_DEBUG  = String(process.env.MAIL_DEBUG || '0') === '1';

let transporter = null;
let verified = false;

function isConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function buildTransport() {
  if (!isConfigured()) {
    console.warn('[mail] SMTP not configured; emails disabled.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  // Try an early verify, but don't block sends on this.
  transporter.verify().then(() => {
    verified = true;
    if (MAIL_DEBUG) console.log('[mail] transporter verified');
  }).catch(err => {
    console.warn('[mail] verify failed (will still attempt sends):', err.message);
  });

  return transporter;
}

function getTransporter() {
  return transporter || buildTransport();
}

async function ensureVerified() {
  const t = getTransporter();
  if (!t) return false;
  if (verified) return true;
  try {
    await t.verify();
    verified = true;
    if (MAIL_DEBUG) console.log('[mail] verified on-demand');
  } catch (e) {
    // Still okay to attempt send even if verify fails.
    if (MAIL_DEBUG) console.warn('[mail] on-demand verify failed:', e.message);
  }
  return verified;
}

module.exports = {
  getTransporter,
  ensureVerified,
  isConfigured,
  isReady: () => verified,
  FROM_ADDRESS: SMTP_FROM,
};
