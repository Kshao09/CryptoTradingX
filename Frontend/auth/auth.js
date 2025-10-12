// auth.js — signup/login + email verification merge

const $ = (sel) => document.querySelector(sel);

// If already logged in, go straight to portal
try {
  const tokenExisting = localStorage.getItem('token');
  // if (tokenExisting) location.replace('../portfolio/portfolio.html');
} catch {}

/* ---------- Panels & mode toggle ---------- */
const panels = {
  signup: $('#signupPanel'),
  login: $('#loginPanel'),
  verify: $('#verifyPanel'),
};
const link = $('#modeLink'); // signup/login switch link (hidden during verify)

const params = new URLSearchParams(location.search);
let mode = (params.get('mode') === 'login') ? 'login' : 'signup';

function setMode(next) {
  mode = next;
  const isLogin = next === 'login';
  const isSignup = next === 'signup';
  const isVerify = next === 'verify';

  if (panels.signup) panels.signup.hidden = !isSignup;
  if (panels.login)  panels.login.hidden  = !isLogin;
  if (panels.verify) panels.verify.hidden = !isVerify;

  // hide switch link during verify
  if (link) {
    link.hidden = isVerify;
    link.textContent = isLogin ? 'New here? Create account →' : 'Already registered? Sign in →';
  }

  hideAllErrors();
  $('#suMsg') && ($('#suMsg').textContent = '');
  $('#liMsg') && ($('#liMsg').textContent = '');
  $('#vMsg')  && ($('#vMsg').textContent  = '');

  if (isLogin)   $('#liEmail')?.focus();
  if (isSignup)  $('#suFirst')?.focus();
  if (isVerify)  $('#vCode')?.focus();
}

if (link) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    setMode(mode === 'login' ? 'signup' : 'login');
  });
}
setMode(mode);

/* ---------- Helpers ---------- */
// Uses utils.js `api(path, init)` so it applies base URL and headers
function postJSON(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

function showErr(sel, msg) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return;
  if (!msg) { el.textContent = ''; el.classList.remove('show'); return; }
  el.textContent = msg; el.classList.add('show');
}
function hideAllErrors() {
  document.querySelectorAll('.field-msg').forEach(n => { n.textContent = ''; n.classList.remove('show'); });
}

// Name validation: letters, spaces, hyphens, apostrophes (Unicode ok)
function nameValid(value, { optional = false } = {}) {
  const s = (value || '').trim();
  if (!s) return optional; // ok if optional
  return /^[\p{L}][\p{L}\p{M}'\- ]{1,99}$/u.test(s); // 2–100 chars total
}
function emailValidInput(inputEl) {
  const v = inputEl?.value?.trim() || '';
  return v && (inputEl.checkValidity ? inputEl.checkValidity() : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

/* ============================================================
   SIGNUP validation + submit  (now triggers email verification)
============================================================ */
const suFirst  = $('#suFirst');
const suMiddle = $('#suMiddle');
const suLast   = $('#suLast');
const suEmail  = $('#suEmail');
const suPass   = $('#suPass');
const suPass2  = $('#suPass2');
const suBtn    = $('#suBtn');
const suMsg    = $('#suMsg');

let suTouched = { first:false, middle:false, last:false, email:false, pass:false, confirm:false };
let suSubmitted = false;

function validateSignup({ forceShow = false } = {}) {
  const firstOk   = nameValid(suFirst?.value);
  const middleOk  = nameValid(suMiddle?.value, { optional: true });
  const lastOk    = nameValid(suLast?.value);
  const emailOk   = emailValidInput(suEmail);
  const passOk    = (suPass?.value || '').length >= 8 && /[0-9]/.test(suPass.value) && /[A-Za-z]/.test(suPass.value);
  const confirmOk = (suPass2?.value || '').length > 0 && suPass?.value === suPass2?.value;

  const showFirstErr   = (suTouched.first   || suSubmitted || forceShow) && !firstOk  && (suFirst?.value  || '').length > 0;
  const showMiddleErr  = (suTouched.middle  || suSubmitted || forceShow) && !middleOk && (suMiddle?.value || '').length > 0;
  const showLastErr    = (suTouched.last    || suSubmitted || forceShow) && !lastOk   && (suLast?.value   || '').length > 0;
  const showEmailErr   = (suTouched.email   || suSubmitted || forceShow) && !emailOk  && (suEmail?.value  || '').length > 0;
  const showPassErr    = (suTouched.pass    || suSubmitted || forceShow) && !passOk   && (suPass?.value   || '').length > 0;
  const showConfirmErr = (suTouched.confirm || suSubmitted || forceShow) && !confirmOk && (suPass2?.value || '').length > 0;

  showErr('#suFirstErr',   showFirstErr   ? 'First name should be letters/spaces only (2–100 chars).' : '');
  showErr('#suMiddleErr',  showMiddleErr  ? 'Middle name has invalid characters.' : '');
  showErr('#suLastErr',    showLastErr    ? 'Last name should be letters/spaces only (2–100 chars).' : '');
  showErr('#suEmailErr',   showEmailErr   ? 'Enter a valid email.' : '');
  showErr('#suPassErr',    showPassErr    ? 'Min 8 chars, include letters & a number.' : '');
  showErr('#suConfirmErr', showConfirmErr ? 'Passwords do not match.' : '');

  if (suBtn) suBtn.disabled = !(firstOk && lastOk && emailOk && passOk && confirmOk && middleOk);
  return firstOk && lastOk && emailOk && passOk && confirmOk && middleOk;
}

// mark touched on blur; revalidate on input
suFirst ?.addEventListener('blur',  () => { suTouched.first   = true; validateSignup(); });
suMiddle?.addEventListener('blur',  () => { suTouched.middle  = true; validateSignup(); });
suLast  ?.addEventListener('blur',  () => { suTouched.last    = true; validateSignup(); });
suEmail ?.addEventListener('blur',  () => { suTouched.email   = true; validateSignup(); });
suPass  ?.addEventListener('blur',  () => { suTouched.pass    = true; validateSignup(); });
suPass2 ?.addEventListener('blur',  () => { suTouched.confirm = true; validateSignup(); });
['input'].forEach(evt => {
  suFirst ?.addEventListener(evt, () => validateSignup());
  suMiddle?.addEventListener(evt, () => validateSignup());
  suLast  ?.addEventListener(evt, () => validateSignup());
  suEmail ?.addEventListener(evt, () => validateSignup());
  suPass  ?.addEventListener(evt, () => validateSignup());
  suPass2 ?.addEventListener(evt, () => validateSignup());
});
validateSignup();

const vEmail = $('#vEmail');
const vCode  = $('#vCode');
const vMsg   = $('#vMsg');

$('#signupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  suSubmitted = true;
  if (!validateSignup({ forceShow: true })) return;

  if (suMsg) suMsg.textContent = 'Creating account...';
  try {
    const firstName  = (suFirst.value  || '').trim();
    const middleName = (suMiddle.value || '').trim() || null;
    const lastName   = (suLast.value   || '').trim();
    const email      = (suEmail.value  || '').trim();
    const password   = suPass.value;

    // Send BOTH camelCase and snake_case to be compatible with your server versions
    const body = {
      firstName, middleName, lastName, email, password,
      first_name: firstName, middle_name: middleName, last_name: lastName
    };

    const resp = await postJSON('/api/auth/register', body);

    if (resp && resp.message === 'verification_sent') {
      suMsg.textContent = '';
      $('#vEmail').textContent = email;
      $('#verifyForm').dataset.email = email;
      setMode('verify');
      $('#vMsg').textContent = 'Verification code sent. Check your inbox.';
      $('#vCode')?.focus();
      return;
    }

    // Anything else is an error
    throw new Error(resp?.message || 'Register failed');
  } catch (err) {
    if (suMsg) suMsg.textContent = err.message || 'Register failed';
  }
});

/* ============================================================
   VERIFY code (new) — success => token => portal
============================================================ */
$('#verifyForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('#vCodeErr', '');
  if (!vCode?.value || !/^\d{6}$/.test(vCode.value.trim())) {
    showErr('#vCodeErr', 'Enter the 6-digit code.');
    return;
  }
  try {
    const email = $('#verifyForm').dataset.email;
    const code = vCode.value.trim();
    const data = await postJSON('/api/auth/verify', { email, code });
    if (!data?.token) throw new Error('Verify failed');
    localStorage.setItem('token', data.token);
    location.replace('../portfolio/portfolio.html');
  } catch (err) {
    vMsg.textContent = err.message || 'Verification failed';
  }
});

// Resend code
$('#resendBtn')?.addEventListener('click', async () => {
  vMsg.textContent = '';
  const email = $('#verifyForm').dataset.email;
  try {
    const data = await postJSON('/api/auth/resend-code', { email });
    if (data?.message === 'verification_sent') {
      vMsg.textContent = 'New code sent.';
    } else {
      vMsg.textContent = 'Check your inbox for the code.';
    }
  } catch (err) {
    vMsg.textContent = err.message || 'Could not resend code';
  }
});

/* ============================================================
   LOGIN validation + submit (handles unverified -> verify)
============================================================ */
const liEmail = $('#liEmail');
const liPass  = $('#liPass');
const liMsg   = $('#liMsg');

let liTouched = { email: false, pass: false };
let liSubmitted = false;

function validateLogin({ forceShow = false } = {}) {
  const emailOk = emailValidInput(liEmail);
  const passOk  = (liPass?.value || '').length > 0;

  const showEmailErr = (liTouched.email || liSubmitted || forceShow) && !emailOk && (liEmail?.value || '').length > 0;
  const showPassErr  = (liTouched.pass  || liSubmitted || forceShow) && !passOk  && (liPass?.value  || '').length > 0;

  showErr('#liEmailErr', showEmailErr ? 'Enter a valid email.' : '');
  showErr('#liPassErr',  showPassErr  ? 'Password is required.' : '');

  return emailOk && passOk;
}

liEmail?.addEventListener('blur', () => { liTouched.email = true; validateLogin(); });
liPass ?.addEventListener('blur', () => { liTouched.pass  = true; validateLogin(); });
['input'].forEach(evt => {
  liEmail?.addEventListener(evt, () => validateLogin());
  liPass ?.addEventListener(evt, () => validateLogin());
});

$('#loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  liSubmitted = true;
  if (!validateLogin({ forceShow: true })) return;

  liMsg.textContent = '';
  try {
    const email = liEmail.value.trim();
    const password = liPass.value;
    const data = await postJSON('/api/auth/login', { email, password });

    // Success: token present
    if (data?.token) {
      localStorage.setItem('token', data.token);
      location.replace('../portfolio/portfolio.html');
      return;
    }
    throw new Error('Login failed');
  } catch (err) {
    // If backend blocks unverified accounts with 403 + email_not_verified
    const msg = err.message || '';
    if (/email_not_verified/i.test(msg)) {
      if (vEmail) vEmail.textContent = liEmail.value.trim();
      $('#verifyForm').dataset.email = liEmail.value.trim();
      setMode('verify');
      vMsg.textContent = 'Email not verified. Enter the code we sent.';
      vCode?.focus();
      return;
    }
    liMsg.textContent = msg;
  }
});

// Keep code field numeric-only UX nicety
vCode?.addEventListener('input', () => {
  vCode.value = vCode.value.replace(/\D+/g, '').slice(0, 6);
});
