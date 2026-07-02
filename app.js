// app.js — application state, list view, grouping, search/filters, PIN lock, QOTD, wiring.

(function () {
  "use strict";

  // ============ Config ============
  const EDIT_PIN = "6612"; // change this to set your own PIN (see README).
  const DIFF_ORDER = { Easy: 0, Medium: 1, Hard: 2 };
  const DIFF_COLOR = { Easy: "var(--easy)", Medium: "var(--medium)", Hard: "var(--hard)" };
  const TOPIC_ORDER = ["Basics", "Joins", "Aggregation", "Subqueries", "Window", "String", "Date", "Pivot"];
  const STATUSES = ["Todo", "Attempted", "Solved"];

  // ============ State ============
  const state = {
    view: "list",
    groupBy: "difficulty",
    search: "",
    filterDifficulty: "",
    filterTopic: "",
    filterStatus: "",
    unlocked: sessionStorage.getItem("sqltracker:unlocked") === "1",
    openRows: new Set(),
    collapsed: new Set(),
  };

  // ============ DOM refs ============
  const $ = (sel) => document.querySelector(sel);
  const listEl = $("#list");
  const analyticsEl = $("#analytics");

  // ============ Utils ============
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toast(msg, kind) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (kind ? " " + kind : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ============ Data selection ============
  function recordFor(q) { return Store.get(q); }

  function matchesFilters(q) {
    const r = recordFor(q);
    if (state.filterDifficulty && q.difficulty !== state.filterDifficulty) return false;
    if (state.filterTopic && q.topic !== state.filterTopic) return false;
    if (state.filterStatus && r.status !== state.filterStatus) return false;
    if (state.search) {
      const s = state.search.toLowerCase();
      if (!String(q.id).includes(s) && !q.title.toLowerCase().includes(s)) return false;
    }
    return true;
  }

  function visibleQuestions() {
    return QUESTIONS.filter(matchesFilters);
  }

  // ============ Progress summary ============
  function renderProgress() {
    const solved = QUESTIONS.filter((q) => recordFor(q).status === "Solved").length;
    const total = QUESTIONS.length;
    const pct = total ? Math.round((solved / total) * 100) : 0;
    $("#progressTitle").textContent = `${solved} of ${total} solved`;
    $("#progressPct").textContent = pct + "%";
    $("#progressFill").style.width = pct + "%";
    $("#progressSub").textContent =
      pct === 100 ? "All done — legend. 🏆" : pct >= 50 ? "Over halfway there!" : "Keep going!";

    const counts = { Easy: [0, 0], Medium: [0, 0], Hard: [0, 0] };
    QUESTIONS.forEach((q) => {
      counts[q.difficulty][1]++;
      if (recordFor(q).status === "Solved") counts[q.difficulty][0]++;
    });
    $("#diffCounts").innerHTML = ["Easy", "Medium", "Hard"].map((d) =>
      `<span class="diff-count"><span class="dot" style="background:${DIFF_COLOR[d]}"></span>${d} <b>${counts[d][0]}/${counts[d][1]}</b></span>`
    ).join("");
  }

  // ============ Question of the day ============
  function renderQOTD() {
    const el = $("#qotd");
    const unsolved = QUESTIONS.filter((q) => recordFor(q).status !== "Solved");
    if (!unsolved.length) {
      el.hidden = false;
      el.innerHTML = `<div class="qotd-main"><div class="qotd-badge">Question of the day</div>
        <div class="qotd-title">Everything is solved — take a victory lap! 🎉</div></div>`;
      return;
    }
    // Deterministic index from today's date string.
    const seed = hashStr(Store.todayISO());
    const q = unsolved[seed % unsolved.length];
    el.hidden = false;
    el.innerHTML = `
      <div class="qotd-main">
        <div class="qotd-badge">Question of the day</div>
        <div class="qotd-title"><span class="qid">#${q.id}</span>${esc(q.title)}</div>
        <div class="qotd-meta">
          <span class="badge badge-${q.difficulty}">${q.difficulty}</span>
          <span class="chip">${esc(q.topic)}</span>
        </div>
      </div>
      <a class="qotd-cta" href="${esc(q.url)}" target="_blank" rel="noopener">Solve now →</a>`;
  }

  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  // ============ List / grouping ============
  function groupKeyOf(q) {
    return state.groupBy === "topic" ? q.topic : q.difficulty;
  }
  function orderedGroupKeys(keys) {
    const arr = Array.from(keys);
    if (state.groupBy === "difficulty") {
      arr.sort((a, b) => DIFF_ORDER[a] - DIFF_ORDER[b]);
    } else {
      arr.sort((a, b) => {
        const ia = TOPIC_ORDER.indexOf(a), ib = TOPIC_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    }
    return arr;
  }

  function renderList() {
    const visible = visibleQuestions();
    if (!visible.length) {
      listEl.innerHTML = `<div class="empty">No problems match your filters.</div>`;
      return;
    }

    // Bucket into groups.
    const groups = {};
    visible.forEach((q) => {
      const k = groupKeyOf(q);
      (groups[k] = groups[k] || []).push(q);
    });

    const keys = orderedGroupKeys(Object.keys(groups));
    let html = "";
    keys.forEach((key) => {
      const items = groups[key];
      const solved = items.filter((q) => recordFor(q).status === "Solved").length;
      const collapsed = state.collapsed.has(key);
      html += `<div class="group${collapsed ? " collapsed" : ""}" data-group="${esc(key)}">
        <button class="group-head" data-group-toggle="${esc(key)}">
          <span class="group-caret">▼</span>
          <span class="group-name">${esc(key)}</span>
          <span class="group-count"><b>${solved}</b> / ${items.length}</span>
        </button>
        <div class="group-body">${items.map(rowHTML).join("")}</div>
      </div>`;
    });
    listEl.innerHTML = html;
  }

  function rowHTML(q) {
    const r = recordFor(q);
    const open = state.openRows.has(q.id);
    const dis = state.unlocked ? "" : "disabled";
    const statusOpts = STATUSES.map((s) =>
      `<option value="${s}"${s === r.status ? " selected" : ""}>${s}</option>`).join("");

    return `<div class="row${open ? " open" : ""}" data-id="${q.id}">
      <div class="row-main">
        <button class="row-toggle" data-row-toggle="${q.id}" title="Details">▶</button>
        <span class="row-id">#${q.id}</span>
        <span class="row-title"><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.title)}</a></span>
        <span class="badge badge-${q.difficulty}">${q.difficulty}</span>
        <span class="chip">${esc(q.topic)}</span>
        <select class="status-select status-${r.status}" data-status="${q.id}" ${dis}>${statusOpts}</select>
      </div>
      <div class="row-detail">
        <div class="detail-field">
          <label>Notes</label>
          <textarea data-notes="${q.id}" rows="2" placeholder="Approach, gotchas, patterns…" ${dis}>${esc(r.notes)}</textarea>
        </div>
        <div class="detail-field">
          <label>My SQL solution</label>
          <textarea class="mono" data-solution="${q.id}" rows="6" placeholder="SELECT ..." spellcheck="false" ${dis}>${esc(r.solution)}</textarea>
        </div>
        <div class="detail-meta">${r.dateSolved ? `Solved on <span class="solved-date">${esc(r.dateSolved)}</span>` : "Not solved yet"}</div>
      </div>
    </div>`;
  }

  // Re-render only the summary bits that depend on progress (cheap; keeps open rows intact).
  function refreshSummaries() {
    renderProgress();
    renderQOTD();
  }

  // ============ Analytics ============
  function renderAnalytics() {
    Analytics.render(analyticsEl);
  }

  // ============ Full render ============
  function render() {
    renderProgress();
    renderQOTD();
    if (state.view === "list") renderList();
    else renderAnalytics();
    updateLockUI();
  }

  // ============ Editing / lock ============
  function updateLockUI() {
    const btn = $("#lockBtn");
    btn.classList.toggle("is-unlocked", state.unlocked);
    btn.querySelector(".lock-icon").textContent = state.unlocked ? "🔓" : "🔒";
    btn.querySelector(".lock-label").textContent = state.unlocked ? "Unlocked" : "Locked";
  }

  function findQ(id) { return QUESTIONS.find((q) => q.id === Number(id)); }

  function requireUnlocked() {
    if (!state.unlocked) { openPin(); return false; }
    return true;
  }

  // ============ Event wiring ============
  function wire() {
    // Tabs
    $("#tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      state.view = tab.dataset.view;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      $("#view-list").classList.toggle("is-active", state.view === "list");
      $("#view-analytics").classList.toggle("is-active", state.view === "analytics");
      render();
    });

    // Controls
    $("#groupBy").addEventListener("change", (e) => { state.groupBy = e.target.value; state.collapsed.clear(); renderList(); });
    $("#search").addEventListener("input", (e) => { state.search = e.target.value.trim(); renderList(); });
    $("#filterDifficulty").addEventListener("change", (e) => { state.filterDifficulty = e.target.value; renderList(); });
    $("#filterTopic").addEventListener("change", (e) => { state.filterTopic = e.target.value; renderList(); });
    $("#filterStatus").addEventListener("change", (e) => { state.filterStatus = e.target.value; renderList(); });
    $("#resetFilters").addEventListener("click", () => {
      state.search = state.filterDifficulty = state.filterTopic = state.filterStatus = "";
      $("#search").value = ""; $("#filterDifficulty").value = ""; $("#filterTopic").value = ""; $("#filterStatus").value = "";
      renderList();
    });

    // List interactions (event delegation)
    listEl.addEventListener("click", (e) => {
      const gt = e.target.closest("[data-group-toggle]");
      if (gt) {
        const key = gt.getAttribute("data-group-toggle");
        if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
        gt.closest(".group").classList.toggle("collapsed");
        return;
      }
      const rt = e.target.closest("[data-row-toggle]");
      if (rt) {
        const id = Number(rt.getAttribute("data-row-toggle"));
        const rowEl = rt.closest(".row");
        if (state.openRows.has(id)) state.openRows.delete(id); else state.openRows.add(id);
        rowEl.classList.toggle("open");
        return;
      }
    });

    // Status change
    listEl.addEventListener("change", (e) => {
      const st = e.target.closest("[data-status]");
      if (st) {
        if (!requireUnlocked()) { st.value = recordFor(findQ(st.dataset.status)).status; return; }
        const q = findQ(st.dataset.status);
        Store.set(q, { status: st.value });
        st.className = "status-select status-" + st.value;
        // Update this row's solved-date meta + summaries.
        const meta = st.closest(".row").querySelector(".detail-meta");
        const r = recordFor(q);
        meta.innerHTML = r.dateSolved ? `Solved on <span class="solved-date">${esc(r.dateSolved)}</span>` : "Not solved yet";
        // Update this group's count.
        updateGroupCount(st.closest(".group"));
        refreshSummaries();
      }
    });

    // Notes / solution editing (persist on input; debounced-ish via input)
    listEl.addEventListener("input", (e) => {
      const notes = e.target.closest("[data-notes]");
      const sol = e.target.closest("[data-solution]");
      if (notes) { Store.set(findQ(notes.dataset.notes), { notes: notes.value }); }
      else if (sol) { Store.set(findQ(sol.dataset.solution), { solution: sol.value }); }
    });
    // Guard: if locked, block typing by refocusing away (textareas are disabled anyway).

    // Lock button
    $("#lockBtn").addEventListener("click", () => {
      if (state.unlocked) {
        state.unlocked = false;
        sessionStorage.removeItem("sqltracker:unlocked");
        updateLockUI();
        renderList();
        toast("Editing locked");
      } else {
        openPin();
      }
    });

    // PIN modal
    $("#pinForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const val = $("#pinInput").value;
      if (val === EDIT_PIN) {
        state.unlocked = true;
        sessionStorage.setItem("sqltracker:unlocked", "1");
        closePin();
        updateLockUI();
        renderList();
        toast("Editing unlocked", "ok");
      } else {
        $("#pinError").hidden = false;
        $("#pinInput").select();
      }
    });
    $("#pinClose").addEventListener("click", closePin);
    $("#pinBackdrop").addEventListener("click", (e) => { if (e.target === $("#pinBackdrop")) closePin(); });

    // Sync modal
    $("#syncBtn").addEventListener("click", openSync);
    $("#syncClose").addEventListener("click", closeSync);
    $("#syncBackdrop").addEventListener("click", (e) => { if (e.target === $("#syncBackdrop")) closeSync(); });
    $("#ghPush").addEventListener("click", () => doSync("push"));
    $("#ghPull").addEventListener("click", () => doSync("pull"));
    $("#ghClear").addEventListener("click", () => {
      Sync.clearToken();
      $("#ghToken").value = "";
      setSyncStatus("Token cleared.", "ok");
    });

    // Global esc
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closePin(); closeSync(); }
    });
  }

  function updateGroupCount(groupEl) {
    if (!groupEl) return;
    const key = groupEl.getAttribute("data-group");
    const items = visibleQuestions().filter((q) => groupKeyOf(q) === key);
    const solved = items.filter((q) => recordFor(q).status === "Solved").length;
    const cnt = groupEl.querySelector(".group-count");
    if (cnt) cnt.innerHTML = `<b>${solved}</b> / ${items.length}`;
  }

  // ============ PIN modal helpers ============
  function openPin() {
    $("#pinError").hidden = true;
    $("#pinInput").value = "";
    $("#pinBackdrop").hidden = false;
    setTimeout(() => $("#pinInput").focus(), 30);
  }
  function closePin() { $("#pinBackdrop").hidden = true; }

  // ============ Sync modal helpers ============
  function openSync() {
    const cfg = Sync.loadConfig();
    $("#ghToken").value = cfg.token || "";
    $("#ghGistId").value = cfg.gistId || "";
    $("#ghFile").value = cfg.filename || "progress.json";
    setSyncStatus("", "");
    $("#syncBackdrop").hidden = false;
  }
  function closeSync() { $("#syncBackdrop").hidden = true; }
  function setSyncStatus(html, kind) {
    const el = $("#syncStatus");
    el.innerHTML = html;
    el.className = "sync-status" + (kind ? " " + kind : "");
  }
  function readSyncForm() {
    const cfg = {
      token: $("#ghToken").value.trim(),
      gistId: $("#ghGistId").value.trim(),
      filename: ($("#ghFile").value.trim() || "progress.json"),
    };
    Sync.saveConfig(cfg);
    return cfg;
  }
  async function doSync(kind) {
    const cfg = readSyncForm();
    setSyncStatus(kind === "push" ? "Pushing…" : "Pulling…", "busy");
    try {
      const res = kind === "push" ? await Sync.push(cfg) : await Sync.pull(cfg);
      // Persist a newly created gist id back into the form + config.
      if (res.gistId && res.gistId !== cfg.gistId) {
        cfg.gistId = res.gistId;
        Sync.saveConfig(cfg);
        $("#ghGistId").value = res.gistId;
      }
      const link = res.gistUrl ? ` <a href="${esc(res.gistUrl)}" target="_blank" rel="noopener">view gist ↗</a>` : "";
      setSyncStatus(esc(res.message) + link, "ok");
      if (kind === "pull") { render(); }
      toast(res.message, "ok");
    } catch (err) {
      setSyncStatus(esc(err.message || String(err)), "err");
      toast("Sync failed", "err");
    }
  }

  // ============ Init ============
  function populateTopicFilter() {
    const sel = $("#filterTopic");
    const topics = TOPIC_ORDER.filter((t) => QUESTIONS.some((q) => q.topic === t));
    topics.forEach((t) => {
      const o = document.createElement("option");
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
  }

  function init() {
    populateTopicFilter();
    wire();
    updateLockUI();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
