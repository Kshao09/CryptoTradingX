// If already logged in, go to markets page
const tokenExisting = localStorage.getItem('token');
if (tokenExisting) location.replace('../markets/market.html');

/* ---------- Mode toggle ---------- */
const panels = { signup: $('#signupPanel'), login: $('#loginPanel') };
const link = $('#modeLink');

const params = new URLSearchParams(location.search);
let mode = (params.get('mode') === 'login') ? 'login' : 'signup';

function setMode(next) {
  mode = next;
  const isLogin = mode === 'login';
  panels.signup.hidden = isLogin;
  panels.login.hidden  = !isLogin;
  link.textContent = isLogin ? 'New here? Create account →' : 'Already registered? Sign in →';
  // Clear transient messages/errors when switching
  hideAllErrors();
  $('#suMsg').textContent = '';
  $('#liMsg').textContent = '';
  (isLogin ? $('#liEmail') : $('#suEmail'))?.focus();
}
link.addEventListener('click', (e) => { e.preventDefault(); setMode(mode === 'login' ? 'signup' : 'login'); });
setMode(mode);

/* ---------- Helpers ---------- */
function postJSON(path, body) {
  return fetch(`${CTX.API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || 'Request failed');
    return data;
  });
}

function showErr(id, msg) {
  const el = $(id);
  if (!el) return;
  if (!msg) { el.textContent = ''; el.classList.remove('show'); return; }
  el.textContent = msg;
  el.classList.add('show');
}
function hideAllErrors() {
  document.querySelectorAll('.field-msg').forEach((n) => { n.textContent = ''; n.classList.remove('show'); });
}

/* ============================================================
   SIGNUP: show errors ONLY after user makes a mistake (touched)
   or on submit attempt. Hide them when fixed or untouched.
============================================================ */
const suEmail = $('#suEmail');
const suPass  = $('#suPass');
const suPass2 = $('#suPass2');
const suBtn   = $('#suBtn');
const suMsg   = $('#suMsg');

let suTouched = { email: false, pass: false, confirm: false };
let suSubmitted = false;

function emailValid(v) {
  // Use built-in validation if available; fallback to simple pattern
  return v && (suEmail.checkValidity ? suEmail.checkValidity() : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}
function validateSignup({ forceShow = false } = {}) {
  const email = suEmail.value.trim();
  const p1 = suPass.value;
  const p2 = suPass2.value;

  const emailOk = emailValid(email);
  const passOk = p1.length >= 8;
  const confirmOk = p2.length > 0 && p1 === p2;

  const showEmailErr   = (suTouched.email || suSubmitted || forceShow) && !emailOk && email.length > 0;
  const showPassErr    = (suTouched.pass  || suSubmitted || forceShow) && !passOk  && p1.length   > 0;
  const showConfirmErr = (suTouched.confirm || suSubmitted || forceShow) && !confirmOk && p2.length > 0;

  // Only show if actually a mistake; if empty or fixed -> hide
  showErr('#suEmailErr',   showEmailErr   ? 'Enter a valid email.' : '');
  showErr('#suPassErr',    showPassErr    ? 'Password must be at least 8 characters.' : '');
  showErr('#suConfirmErr', showConfirmErr ? 'Passwords do not match.' : '');

  // Enable button only when all valid
  suBtn.disabled = !(emailOk && passOk && confirmOk);
  return emailOk && passOk && confirmOk;
}

// blur marks as "touched"; input revalidates and hides when fixed/empty
suEmail.addEventListener('blur',  () => { suTouched.email   = true; validateSignup(); });
suPass.addEventListener('blur',   () => { suTouched.pass    = true; validateSignup(); });
suPass2.addEventListener('blur',  () => { suTouched.confirm = true; validateSignup(); });

['input'].forEach(evt => {
  suEmail.addEventListener(evt, () => validateSignup());
  suPass.addEventListener(evt,  () => validateSignup());
  suPass2.addEventListener(evt, () => validateSignup());
});
validateSignup();

$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  suSubmitted = true;
  if (!validateSignup({ forceShow: true })) return;

  suMsg.textContent = 'Creating account...';
  try {
    await postJSON('/api/auth/register', { email: suEmail.value.trim(), password: suPass.value });
    suMsg.textContent = 'Account created! Please sign in.';
    setMode('login');
    $('#liEmail').value = suEmail.value.trim();
    $('#liPass').focus();
  } catch (err) {
    suMsg.textContent = err.message;
  }
});

/* ============================================================
   LOGIN: show errors only when a mistake happens (touched/submit)
============================================================ */
const liEmail = $('#liEmail');
const liPass  = $('#liPass');
const liMsg   = $('#liMsg');

let liTouched = { email: false, pass: false };
let liSubmitted = false;

function validateLogin({ forceShow = false } = {}) {
  const email = liEmail.value.trim();
  const pass  = liPass.value;

  const emailOk = emailValid(email);
  const passOk  = pass.length > 0;

  const showEmailErr = (liTouched.email || liSubmitted || forceShow) && !emailOk && email.length > 0;
  const showPassErr  = (liTouched.pass  || liSubmitted || forceShow) && !passOk  && pass.length  > 0;

  showErr('#liEmailErr', showEmailErr ? 'Enter a valid email.' : '');
  showErr('#liPassErr',  showPassErr  ? 'Password is required.' : '');

  return emailOk && passOk;
}

liEmail.addEventListener('blur', () => { liTouched.email = true; validateLogin(); });
liPass.addEventListener('blur',  () => { liTouched.pass  = true; validateLogin(); });
['input'].forEach(evt => {
  liEmail.addEventListener(evt, () => validateLogin());
  liPass.addEventListener(evt,  () => validateLogin());
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  liSubmitted = true;
  if (!validateLogin({ forceShow: true })) return;

  liMsg.textContent = 'Signing in...';
  try {
    const data = await postJSON('/api/auth/login', { email: liEmail.value.trim(), password: liPass.value });
  localStorage.setItem('token', data.token);
  location.replace('../markets/market.html');
  } catch (err) {
    liMsg.textContent = err.message;
  }
});
