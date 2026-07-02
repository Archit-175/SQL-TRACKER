// sync.js — optional cloud sync via a private GitHub Gist.
// The token lives only in localStorage on this machine and is never committed.
// A token with just the `gist` scope is enough. Exposes global `Sync`.

const Sync = (function () {
  const CFG_KEY = "sqltracker:sync:v2"; // { token, gistId, filename }

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

  async function errMsg(res) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch (e) {}
    return `GitHub API ${res.status}${detail ? ": " + detail : ""}`;
  }

  function filenameOf(cfg) {
    return (cfg.filename && cfg.filename.trim()) || "progress.json";
  }

  // Push local progress to a Gist. Creates a new secret gist if no gistId is set,
  // otherwise updates the existing one. Returns { message, gistId, gistUrl }.
  async function push(cfg) {
    if (!cfg.token) throw new Error("Token required");
    const filename = filenameOf(cfg);
    const payload = JSON.stringify(Store.exportAll(), null, 2);
    const files = {};
    files[filename] = { content: payload };

    let res, data;
    if (cfg.gistId) {
      res = await fetch(`https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`, {
        method: "PATCH",
        headers: Object.assign({ "Content-Type": "application/json" }, headers(cfg.token)),
        body: JSON.stringify({ files }),
      });
      if (!res.ok) throw new Error(await errMsg(res));
      data = await res.json();
      return { message: "Updated gist.", gistId: data.id, gistUrl: data.html_url };
    }

    res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers(cfg.token)),
      body: JSON.stringify({
        description: "SQL Practice Tracker progress",
        public: false,
        files,
      }),
    });
    if (!res.ok) throw new Error(await errMsg(res));
    data = await res.json();
    return { message: "Created new secret gist.", gistId: data.id, gistUrl: data.html_url };
  }

  // Pull remote progress from the Gist and merge into local storage (remote wins per id).
  async function pull(cfg) {
    if (!cfg.token) throw new Error("Token required");
    if (!cfg.gistId) throw new Error("No Gist ID yet — push first to create one.");
    const filename = filenameOf(cfg);

    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`, {
      headers: headers(cfg.token),
    });
    if (!res.ok) throw new Error(await errMsg(res));
    const data = await res.json();

    const files = data.files || {};
    const file = files[filename] || files[Object.keys(files)[0]];
    if (!file) throw new Error("Gist has no files.");

    // Large gists (>1MB) come back truncated; fetch the raw content in that case.
    let content = file.content;
    if (file.truncated && file.raw_url) {
      const raw = await fetch(file.raw_url);
      if (!raw.ok) throw new Error(await errMsg(raw));
      content = await raw.text();
    }

    Store.merge(JSON.parse(content));
    return { message: "Pulled and merged remote progress.", gistUrl: data.html_url };
  }

  return { loadConfig, saveConfig, clearToken, push, pull };
})();
