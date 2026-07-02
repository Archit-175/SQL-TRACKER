// sync.js — cross-device cloud sync via a single private GitHub Gist (Puzzle Tracker model).
//
// Key idea: the gist is NEVER entered by hand. On connect we list the account's gists and find the
// one containing `sql-tracker-progress.json` (creating it once if absent). Because the same GitHub
// token/account is used on every device, this resolves to the SAME gist everywhere — that's the
// shared sync. The token itself is encrypted with the edit PIN and committed inside `progress.js`,
// so on any device you just unlock with the PIN and it auto-connects. Exposes global `Cloud`.

const Cloud = (function () {
  // SHA-256 of the edit PIN (never store the PIN itself). Regenerate with: await Cloud.sha256Hex("newPin")
  const PIN_HASH = "4401dfbd4b7faaf470f94888cca5b473f0590e10c3799088be66cef7da7238f5"; // "6612"
  const PIN_KDF_ITERS = 250000;
  const CLOUD_KEY = "sqltracker:cloud:v1"; // { token, gistId, lastSync }
  const GIST_FILE = "sql-tracker-progress.json";

  let cloudCfg = null;
  let currentPin = null;        // held in memory after unlock, never persisted
  let pendingCloudBlob = null;  // encrypted token staged for the next Save snapshot
  let pushTimer = null;
  let uiState = "off";          // off | syncing | ok | error
  let cb = { onStatus: function () {}, onData: function () {}, toast: function () {} };

  // ---------- crypto helpers ----------
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const _b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const _unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveAesKey(pin, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PIN_KDF_ITERS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptToken(token, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(pin, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
    return { v: 1, salt: _b64(salt), iv: _b64(iv), ct: _b64(ct) };
  }
  async function decryptToken(blob, pin) {
    const key = await deriveAesKey(pin, _unb64(blob.salt));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _unb64(blob.iv) }, key, _unb64(blob.ct));
    return new TextDecoder().decode(pt);
  }
  function verifyPin(pin) { return sha256Hex(pin).then((h) => h === PIN_HASH); }
  function setPin(pin) { currentPin = pin; }

  // ---------- config persistence ----------
  function loadCloudCfg() { try { const r = localStorage.getItem(CLOUD_KEY); if (r) cloudCfg = JSON.parse(r); } catch (e) {} }
  function saveCloudCfg() { try { cloudCfg ? localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudCfg)) : localStorage.removeItem(CLOUD_KEY); } catch (e) {} }

  function isConnected() { return !!(cloudCfg && cloudCfg.gistId); }
  function setUI(state) { uiState = state; cb.onStatus(state, cloudCfg && cloudCfg.lastSync); }

  // ---------- GitHub API ----------
  async function ghFetch(method, path, body) {
    const res = await fetch("https://api.github.com" + path, {
      method,
      headers: {
        Authorization: "token " + cloudCfg.token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error("GitHub " + res.status + " " + res.statusText);
    return res.json();
  }

  // Same token (same account) => same gist on every device. No manual id.
  async function resolveGist() {
    const gists = await ghFetch("GET", "/gists?per_page=100");
    const matches = gists.filter((g) => g.files && g.files[GIST_FILE]);
    if (matches.length) {
      matches.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // oldest wins => converge
      cloudCfg.gistId = matches[0].id;
      return;
    }
    const created = await ghFetch("POST", "/gists", {
      description: "SQL Tracker — synced progress", public: false,
      files: { [GIST_FILE]: { content: JSON.stringify(Store.buildSnapshot(), null, 2) } },
    });
    cloudCfg.gistId = created.id;
  }

  async function pushNow() {
    if (!isConnected()) return;
    await ghFetch("PATCH", "/gists/" + cloudCfg.gistId, {
      files: { [GIST_FILE]: { content: JSON.stringify(Store.buildSnapshot(), null, 2) } },
    });
    cloudCfg.lastSync = new Date().toISOString();
    saveCloudCfg();
    setUI("ok");
  }
  function schedulePush() {
    if (!isConnected()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushNow().catch(() => setUI("error")), 2500);
  }

  async function syncNow() {
    if (!isConnected()) return;
    setUI("syncing");
    try {
      const gist = await ghFetch("GET", "/gists/" + cloudCfg.gistId);
      const file = gist.files && gist.files[GIST_FILE];
      let raw = file && file.content;
      if (file && file.truncated && file.raw_url) raw = await (await fetch(file.raw_url)).text();
      if (raw) { if (Store.mergeRemote(JSON.parse(raw))) cb.onData(); }
      await pushNow();
      cb.toast("Cloud synced");
    } catch (e) {
      console.warn(e); setUI("error"); cb.toast("Cloud sync failed — check token or network");
    }
  }

  // Manual connect: paste token, no id.
  async function connectWithToken(token) {
    token = (token || "").trim();
    if (!token) { cb.toast("Paste your GitHub token (gist scope) first"); return; }
    setUI("syncing");
    cloudCfg = { token, gistId: null, lastSync: null };
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: "token " + token, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error("Invalid token (status " + res.status + ")");
      await resolveGist();
      saveCloudCfg();
      setUI("ok");
      await syncNow();
      await enableCrossBrowser(token); // stage PIN-encrypted token for progress.js
    } catch (e) {
      console.warn(e); cloudCfg = null; setUI("off"); cb.toast("Connect failed — " + e.message);
    }
  }

  // Encrypt the token with the PIN and stage it for the next Save snapshot.
  async function enableCrossBrowser(token) {
    let pin = currentPin;
    if (!pin) {
      const entry = prompt("Enter your edit PIN to enable PIN-unlock sync on all devices\n(Cancel = this device only):");
      if (entry == null) return;
      pin = entry.trim();
      if ((await sha256Hex(pin)) !== PIN_HASH) { cb.toast("Wrong PIN — sync stays on this device only"); return; }
      currentPin = pin;
    }
    try {
      pendingCloudBlob = await encryptToken(token, pin);
      cb.onStatus(uiState, cloudCfg && cloudCfg.lastSync); // refresh UI (Save snapshot now relevant)
      cb.toast("Sync ready — click “Save snapshot” and commit progress.js to enable PIN-unlock everywhere");
    } catch (e) { console.warn(e); }
  }

  // On a fresh device: unlock with PIN -> decrypt the committed token -> auto-connect to the same gist.
  async function autoConnect(pin) {
    if (isConnected()) return;
    const blob = window.PUBLISHED_PROGRESS && window.PUBLISHED_PROGRESS.cloud;
    if (!blob) return;
    setUI("syncing");
    try {
      const token = await decryptToken(blob, pin);
      cloudCfg = { token, gistId: null, lastSync: null };
      await resolveGist();
      saveCloudCfg();
      setUI("ok");
      await syncNow();
      cb.toast("Cloud sync connected via PIN");
    } catch (e) { console.warn(e); cloudCfg = null; setUI("off"); }
  }

  function disconnect() {
    clearTimeout(pushTimer);
    cloudCfg = null;
    saveCloudCfg();
    setUI("off");
    cb.toast("Disconnected from cloud sync");
  }

  // progress.js text for download — carries the encrypted token forward so other devices auto-connect.
  function buildProgressJs() {
    const snap = Store.buildSnapshot();
    snap.cloud = pendingCloudBlob || (window.PUBLISHED_PROGRESS && window.PUBLISHED_PROGRESS.cloud) || null;
    return "window.PUBLISHED_PROGRESS = " + JSON.stringify(snap, null, 2) + ";\n";
  }

  function init(callbacks) {
    cb = Object.assign(cb, callbacks || {});
    loadCloudCfg();
    if (isConnected()) {
      setUI("ok");
      setTimeout(() => syncNow().catch(() => setUI("error")), 800);
    } else {
      setUI("off");
    }
  }

  return {
    sha256Hex, verifyPin, setPin, init,
    connectWithToken, autoConnect, disconnect, syncNow, schedulePush,
    isConnected, buildProgressJs,
    hasPublishedToken: () => !!(window.PUBLISHED_PROGRESS && window.PUBLISHED_PROGRESS.cloud),
    hasPendingBlob: () => !!pendingCloudBlob,
    state: () => uiState,
    lastSync: () => cloudCfg && cloudCfg.lastSync,
  };
})();
