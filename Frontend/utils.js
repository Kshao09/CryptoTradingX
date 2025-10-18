/* utils.js — small helpers used across pages */
(function () {
  const CFG = (window.CONFIG || {});

  function getToken() {
    try { return localStorage.getItem("token") || ""; } catch { return ""; }
  }

  function setToken(t) {
    try { t ? localStorage.setItem("token", t) : localStorage.removeItem("token"); } catch {}
  }

  async function api(path, opts = {}) {
    const url = (CFG.API_BASE || "") + path;
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const data = await res.json();
        msg = data.message || data.error || msg;
      } catch {
        try { msg = await res.text(); } catch {}
      }
      throw new Error(msg || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function authed(path, opts = {}) {
    const token = getToken();
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {},
      token ? { Authorization: `Bearer ${token}` } : {}
    );
    try {
      return await api(path, Object.assign({}, opts, { headers }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (/unauthorized|no token|invalid token|401/i.test(msg)) {
        try { localStorage.removeItem("token"); } catch {}
        // Use an absolute path so it works from any subfolder:
        window.location.replace("/landing/landing.html");
      }
      throw e;
    }
  }

  // expose helpers
  window.getToken = getToken;
  window.setToken = setToken;
  window.api = api;
  window.authed = authed;
})();
