// sync.js — optional GitHub cloud sync via the Contents API.
// The token lives only in localStorage on this machine and is never committed.
// Exposes global `Sync`.

const Sync = (function () {
  const CFG_KEY = "sqltracker:sync:v1"; // { token, owner, repo, path, branch }

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }
  function clearToken() {
    const cfg = loadConfig();
    delete cfg.token;
    saveConfig(cfg);
  }

  function headers(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  // UTF-8 safe base64 encode/decode.
  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
  }

  function apiUrl(cfg) {
    const branch = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : "";
    return {
      base: `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path).replace(/%2F/g, "/")}`,
      ref: branch,
    };
  }

  function validate(cfg) {
    const missing = ["token", "owner", "repo", "path"].filter((k) => !cfg[k]);
    if (missing.length) throw new Error("Missing: " + missing.join(", "));
  }

  // Fetch current file (for its sha + content). Returns null if 404.
  async function getFile(cfg) {
    const { base, ref } = apiUrl(cfg);
    const res = await fetch(base + ref, { headers: headers(cfg.token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errMsg(res));
    return res.json();
  }

  async function errMsg(res) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch (e) {}
    return `GitHub API ${res.status}${detail ? ": " + detail : ""}`;
  }

  // Push local progress to the repo (create or update the file).
  async function push(cfg) {
    validate(cfg);
    const existing = await getFile(cfg);
    const payload = JSON.stringify(Store.exportAll(), null, 2);
    const body = {
      message: `Update SQL tracker progress (${new Date().toISOString()})`,
      content: b64encode(payload),
    };
    if (cfg.branch) body.branch = cfg.branch;
    if (existing && existing.sha) body.sha = existing.sha;

    const { base } = apiUrl(cfg);
    const res = await fetch(base, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers(cfg.token)),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errMsg(res));
    return "Pushed progress to GitHub.";
  }

  // Pull remote progress and merge into local storage (remote wins per id).
  async function pull(cfg) {
    validate(cfg);
    const existing = await getFile(cfg);
    if (!existing) throw new Error("Remote file not found yet — push first.");
    const json = JSON.parse(b64decode(existing.content));
    Store.merge(json);
    return "Pulled and merged remote progress.";
  }

  return { loadConfig, saveConfig, clearToken, push, pull };
})();
