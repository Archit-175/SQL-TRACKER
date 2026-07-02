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

  // Effective record = defaults (from seed) overlaid with any saved fields (saved wins).
  function get(q) {
    const base = defaultRecord(q);
    const saved = data[q.id];
    return saved ? Object.assign(base, saved) : base;
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

  return { get, set, merge, exportAll, replaceAll, todayISO };
})();
