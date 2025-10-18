/* utils.js — small helpers used across pages */

(function () {
  const CFG = (window.CONFIG || {});

  function getToken() {
    try { return localStorage.getItem("token") || ""; } catch { return ""; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem("token", t);
      else localStorage.removeItem("token");
    } catch {}
  }

  async function api(path, opts = {}) {
    const url = (CFG.API_BASE || "") + path;
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (!res.ok) {
      // Try to extract a clear error
      let msg = res.statusText;
      try {
        const data = await res.json();
        msg = data.message || data.error || msg;
      } catch {
        try { msg = await res.text(); } catch {}
      }
      throw new Error(msg || `HTTP ${res.status}`);
    }
    // No content
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
        // Back to login if auth fails
        try { localStorage.removeItem("token"); } catch {}
        // Adjust this path to your auth page if different
        window.location.replace("../landing/landing.html");
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
