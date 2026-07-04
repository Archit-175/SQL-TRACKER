// storage.js — localStorage persistence, keyed by question id.
// Exposes a global `Store` object. Saved data survives when new questions are added to
// QUESTIONS (unknown ids are preserved; missing ids fall back to defaults derived from seed).

const Store = (function () {
  const KEY = "sqltracker:progress:v1";

  // In-memory map: { [id]: { status, notes, solution, dateSolved } }
  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("Store: failed to parse saved data, starting fresh.", e);
      return {};
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Store: failed to save.", e);
    }
  }

  // ---- Daily 5 speed-timer sessions, keyed by date: { [date]: { startedAt, finishedAt } } ----
  const TIMERS_KEY = "sqltracker:timers:v1";
  let timers = loadTimers();
  function loadTimers() {
    try { return JSON.parse(localStorage.getItem(TIMERS_KEY) || "{}"); } catch (e) { return {}; }
  }
  function persistTimers() {
    try { localStorage.setItem(TIMERS_KEY, JSON.stringify(timers)); } catch (e) {}
  }
  // Effective timers (local; synced sessions are merged in via mergeRemote/gist).
  function getTimers() {
    return Object.assign({}, timers);
  }
  function getTimer(date) {
    return getTimers()[date] || null;
  }
  function setTimer(date, session) {
    if (session) timers[date] = session; else delete timers[date];
    persistTimers();
  }
  // Merge remote timer sessions: prefer a finished session, else the one that started earliest.
  function mergeTimers(remote) {
    if (!remote || typeof remote !== "object") return false;
    let changed = false;
    Object.keys(remote).forEach((date) => {
      const r = remote[date];
      if (!r || !r.startedAt) return;
      const l = timers[date];
      let take = false;
      if (!l) take = true;
      else if (!l.finishedAt && r.finishedAt) take = true;
      else if (!!l.finishedAt === !!r.finishedAt && r.startedAt < l.startedAt) take = true;
      if (take) { timers[date] = r; changed = true; }
    });
    if (changed) persistTimers();
    return changed;
  }

  // ---- Frozen Daily 5 selection, keyed by date: { [date]: [ids] } (synced so all devices match) ----
  const DAILYSETS_KEY = "sqltracker:dailysets:v1";
  let dailySets = loadDailySets();
  function loadDailySets() {
    try { return JSON.parse(localStorage.getItem(DAILYSETS_KEY) || "{}"); } catch (e) { return {}; }
  }
  function persistDailySets() {
    try { localStorage.setItem(DAILYSETS_KEY, JSON.stringify(dailySets)); } catch (e) {}
  }
  function getDailySet(date) {
    const v = dailySets[date];
    return Array.isArray(v) && v.length ? v.slice() : null;
  }
  function setDailySet(date, ids) {
    if (Array.isArray(ids) && ids.length) dailySets[date] = ids.slice(); else delete dailySets[date];
    persistDailySets();
  }
  // Merge remote daily-set picks (remote wins per date, so devices converge on one shared set).
  function mergeDailySets(remote) {
    if (!remote || typeof remote !== "object") return false;
    let changed = false;
    Object.keys(remote).forEach((date) => {
      const r = remote[date];
      if (!Array.isArray(r) || !r.length) return;
      if (JSON.stringify(dailySets[date]) !== JSON.stringify(r)) { dailySets[date] = r.slice(); changed = true; }
    });
    if (changed) persistDailySets();
    return changed;
  }

  // Default record for a question: `done:true` seeds "Solved" and its known solve date (if any).
  function defaultRecord(q) {
    const seededDate = (typeof SOLVED_DATES !== "undefined" && SOLVED_DATES[q.id]) || null;
    return {
      status: q.done ? "Solved" : "Todo",
      notes: "",
      solution: "",
      dateSolved: q.done ? seededDate : null,
    };
  }

  // Effective record = seed defaults < published snapshot < local working copy (saved wins).
  function get(q) {
    const base = defaultRecord(q);

    // Layer the committed published snapshot (shared baseline across devices).
    const pub = (typeof window !== "undefined" && window.PUBLISHED_PROGRESS) || null;
    if (pub) {
      if (pub.status && pub.status[q.id]) base.status = pub.status[q.id];
      if (pub.notes && pub.notes[q.id] != null) base.notes = pub.notes[q.id];
      if (pub.solution && pub.solution[q.id] != null) base.solution = pub.solution[q.id];
      if (pub.solvedAt && pub.solvedAt[q.id]) base.dateSolved = pub.solvedAt[q.id];
    }

    const saved = data[q.id];
    return saved ? Object.assign(base, saved) : base;
  }

  const byId = (id) => QUESTIONS.find((x) => String(x.id) === String(id));
  const ensure = (id) => (data[id] = data[id] || {});

  // Build a compact snapshot of effective progress, keyed by id (for gist + progress.js).
  function buildSnapshot() {
    const status = {}, notes = {}, solution = {}, solvedAt = {};
    QUESTIONS.forEach((q) => {
      const r = get(q);
      if (r.status && r.status !== "Todo") status[q.id] = r.status;
      if (r.notes) notes[q.id] = r.notes;
      if (r.solution) solution[q.id] = r.solution;
      if (r.dateSolved) solvedAt[q.id] = r.dateSolved;
    });
    return { app: "sql-tracker", status, notes, solution, solvedAt, timers: getTimers(), dailySets: Object.assign({}, dailySets) };
  }

  // Union-merge remote snapshot into local; never clobber a stronger/non-empty local value.
  function mergeRemote(remote) {
    if (!remote || typeof remote !== "object") return false;
    let changed = false;
    Object.keys(remote.status || {}).forEach((id) => {
      const q = byId(id); if (!q) return;
      const cur = get(q);
      if (remote.status[id] && cur.status !== "Solved" && remote.status[id] !== cur.status) {
        ensure(id).status = remote.status[id];
        if (remote.solvedAt && remote.solvedAt[id] && !cur.dateSolved) ensure(id).dateSolved = remote.solvedAt[id];
        changed = true;
      }
    });
    Object.keys(remote.notes || {}).forEach((id) => {
      const q = byId(id); if (!q) return;
      if (remote.notes[id] && !get(q).notes) { ensure(id).notes = remote.notes[id]; changed = true; }
    });
    Object.keys(remote.solution || {}).forEach((id) => {
      const q = byId(id); if (!q) return;
      if (remote.solution[id] && !get(q).solution) { ensure(id).solution = remote.solution[id]; changed = true; }
    });
    if (changed) persist();
    const timersChanged = mergeTimers(remote.timers);
    const setsChanged = mergeDailySets(remote.dailySets);
    return changed || timersChanged || setsChanged;
  }

  function todayISO() {
    // Local date as YYYY-MM-DD.
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  // Update a field; auto-manages dateSolved on first transition to "Solved".
  function set(q, patch) {
    const cur = get(q);
    const next = Object.assign({}, cur, patch);

    if (patch.status === "Solved" && !next.dateSolved) {
      next.dateSolved = todayISO();
    }

    data[q.id] = next;
    persist();
    return next;
  }

  // Merge an incoming map (e.g. from cloud sync) into local data. Incoming wins per id.
  function merge(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    Object.keys(incoming).forEach((id) => {
      data[id] = Object.assign({}, data[id], incoming[id]);
    });
    persist();
  }

  function exportAll() {
    return JSON.parse(JSON.stringify(data));
  }

  function replaceAll(next) {
    data = next && typeof next === "object" ? next : {};
    persist();
  }

  return { get, set, merge, exportAll, replaceAll, todayISO, buildSnapshot, mergeRemote, getTimers, getTimer, setTimer, getDailySet, setDailySet };
})();
