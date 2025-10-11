// auth.js — robust toggle + signup/login with name fields

const $ = (sel) => document.querySelector(sel);

// If already logged in, go to markets page
try {
  const tokenExisting = localStorage.getItem('token');
  if (tokenExisting) location.replace('../markets/market.html');
} catch {}

/* ---------- Mode toggle ---------- */
const panels = { signup: $('#signupPanel'), login: $('#loginPanel') };
const link = $('#modeLink');

const params = new URLSearchParams(location.search);
let mode = (params.get('mode') === 'login') ? 'login' : 'signup';

function setMode(next) {
  mode = next;
  const isLogin = mode === 'login';
  if (panels.signup) panels.signup.hidden = isLogin;
  if (panels.login)  panels.login.hidden  = !isLogin;
  if (link) link.textContent = isLogin ? 'New here? Create account →' : 'Already registered? Sign in →';
  hideAllErrors();
  $('#suMsg') && ($('#suMsg').textContent = '');
  $('#liMsg') && ($('#liMsg').textContent = '');
  (isLogin ? $('#liEmail') : $('#suFirst'))?.focus();
}
if (link) link.addEventListener('click', (e) => { e.preventDefault(); setMode(mode === 'login' ? 'signup' : 'login'); });
setMode(mode);

/* ---------- Helpers ---------- */
function postJSON(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); } // uses utils.js (:contentReference[oaicite:9]{index=9})

function showErr(sel, msg) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return;
  if (!msg) { el.textContent = ''; el.classList.remove('show'); return; }
  el.textContent = msg; el.classList.add('show');
}
function hideAllErrors() {
  document.querySelectorAll('.field-msg').forEach(n => { n.textContent = ''; n.classList.remove('show'); });
}

// Name validation: allow letters, spaces, hyphens, apostrophes (Unicode friendly)
function nameValid(value, { optional = false } = {}) {
  const s = (value || '').trim();
  if (!s) return optional; // ok if optional
  return /^[\p{L}][\p{L}\p{M}'\- ]{1,99}$/u.test(s); // 2–100 chars total
}

/* ============================================================
   SIGNUP validation + submit
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

function emailValidInput(inputEl) {
  const v = inputEl?.value?.trim() || '';
  return v && (inputEl.checkValidity ? inputEl.checkValidity() : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

function validateSignup({ forceShow = false } = {}) {
  const firstOk   = nameValid(suFirst?.value);
  const middleOk  = nameValid(suMiddle?.value, { optional: true });
  const lastOk    = nameValid(suLast?.value);
  const emailOk   = emailValidInput(suEmail);
  const passOk    = (suPass?.value || '').length >= 8 && /[0-9]/.test(suPass.value) && /[A-Za-z]/.test(suPass.value); // simple strength check
  const confirmOk = (suPass2?.value || '').length > 0 && suPass?.value === suPass2?.value;

  const showFirstErr   = (suTouched.first   || suSubmitted || forceShow) && !firstOk  && (suFirst?.value  || '').length > 0;
  const showMiddleErr  = (suTouched.middle  || suSubmitted || forceShow) && !middleOk && (suMiddle?.value || '').length > 0; // only if provided
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

$('#signupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  suSubmitted = true;
  if (!validateSignup({ forceShow: true })) return;

  if (suMsg) suMsg.textContent = 'Creating account...';
  try {
    const body = {
      firstName: (suFirst.value  || '').trim(),
      middleName: (suMiddle.value || '').trim() || null,
      lastName:  (suLast.value   || '').trim(),
      email:     (suEmail.value  || '').trim(),
      password:  suPass.value
    };
    await postJSON('/api/auth/register', body);
    if (suMsg) suMsg.textContent = 'Account created! Please sign in.';
    setMode('login');
    const liEmail = $('#liEmail'); const liPass = $('#liPass');
    if (liEmail) liEmail.value = body.email;
    if (liPass) liPass.focus();
  } catch (err) {
    if (suMsg) suMsg.textContent = err.message;
  }
});

/* ============================================================
   LOGIN validation + submit (unchanged)
============================================================ */
const liEmail = $('#liEmail');
const liPass  = $('#liPass');
const liMsg   = $('#liMsg');

let liTouched = { email: false, pass: false };
let liSubmitted = false;

function emailValidInput(inputEl) {
  const v = inputEl?.value?.trim() || '';
  return v && (inputEl.checkValidity ? inputEl.checkValidity() : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

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

  if (liMsg) liMsg.textContent = '';
  try {
    const data = await postJSON('/api/auth/login', { email: liEmail.value.trim(), password: liPass.value });
    localStorage.setItem('token', data.token);
    location.replace('../markets/market.html');
  } catch (err) {
    if (liMsg) liMsg.textContent = err.message;
  }
});
