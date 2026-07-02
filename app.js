// app.js — application state, list view, grouping, search/filters, PIN lock, QOTD, wiring.

(function () {
  "use strict";

  // ============ Config ============
  // The edit PIN is stored as a SHA-256 hash in sync.js (Cloud.PIN_HASH), never in plaintext.
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

  // ============ Practice: Daily 5 + Random ============
  function unsolvedList() {
    return QUESTIONS.filter((q) => recordFor(q).status !== "Solved");
  }

  // Deterministic PRNG (mulberry32) from a numeric seed.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Up to n unsolved questions in a stable, date-seeded order. As you solve one it drops and the
  // next unsolved question (in the same fixed daily order) takes its place.
  function dailyQuestions(n) {
    const order = QUESTIONS.slice();
    const rnd = mulberry32(hashStr(Store.todayISO()));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order.filter((q) => recordFor(q).status !== "Solved").slice(0, n);
  }

  function practiceRowHTML(q) {
    return `<div class="prow" data-jump="${q.id}" role="button" tabindex="0">
      <span class="row-id">#${q.id}</span>
      <span class="prow-title">${esc(q.title)}</span>
      <span class="badge badge-${q.difficulty}">${q.difficulty}</span>
      <span class="chip">${esc(q.topic)}</span>
      <a class="prow-link" href="${esc(q.url)}" target="_blank" rel="noopener" title="Open on LeetCode" aria-label="Open on LeetCode">↗</a>
    </div>`;
  }

  function renderPractice() {
    const el = $("#practice");
    el.hidden = false;
    const five = dailyQuestions(5);
    if (!five.length) {
      el.innerHTML = `<div class="practice-head"><div class="practice-title">Daily practice</div>
        <button class="practice-random" id="practiceRandom" type="button" disabled>🎲 Random</button></div>
        <div class="practice-empty">Everything is solved — take a victory lap! 🎉</div>`;
      return;
    }
    el.innerHTML = `
      <div class="practice-head">
        <div>
          <div class="practice-title">Daily 5 <span class="practice-date">· ${esc(Store.todayISO())}</span></div>
          <div class="practice-sub">Your practice set for today — solve one and a new one appears.</div>
        </div>
        <button class="practice-random" id="practiceRandom" type="button">🎲 Random</button>
      </div>
      <div class="practice-list">${five.map(practiceRowHTML).join("")}</div>`;
  }

  // Pick a random unsolved question and jump to it in the list.
  function randomPractice() {
    const pool = unsolvedList();
    if (!pool.length) { toast("Everything is solved! 🎉", "ok"); return; }
    const q = pool[Math.floor(Math.random() * pool.length)];
    jumpToQuestion(q.id);
    toast(`🎲 #${q.id} · ${q.title}`);
  }

  // Reveal a question in the list: switch to list view, clear filters, expand its group,
  // open its detail, scroll to it, and flash it.
  function jumpToQuestion(id) {
    id = Number(id);
    if (state.view !== "list") activateView("list");
    state.search = state.filterDifficulty = state.filterTopic = state.filterStatus = "";
    $("#search").value = ""; $("#filterDifficulty").value = ""; $("#filterTopic").value = "";
    $("#filterStatus").value = "";
    const q = findQ(id);
    if (!q) return;
    state.collapsed.delete(groupKeyOf(q));
    state.openRows.add(id);
    renderList();
    const rowEl = listEl.querySelector(`.row[data-id="${id}"]`);
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      rowEl.classList.add("flash");
      setTimeout(() => rowEl.classList.remove("flash"), 1600);
    }
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
    renderPractice();
  }

  // ============ Analytics ============
  function renderAnalytics() {
    Analytics.render(analyticsEl);
  }

  // ============ Views ============
  function activateView(name) {
    state.view = name;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
    $("#view-list").classList.toggle("is-active", name === "list");
    $("#view-analytics").classList.toggle("is-active", name === "analytics");
    render();
  }

  // ============ Full render ============
  function render() {
    renderProgress();
    renderPractice();
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
      activateView(tab.dataset.view);
    });

    // Practice panel: random button + jump-to-question rows
    $("#practice").addEventListener("click", (e) => {
      if (e.target.closest("#practiceRandom")) { randomPractice(); return; }
      if (e.target.closest(".prow-link")) return; // let the LeetCode link work normally
      const jump = e.target.closest("[data-jump]");
      if (jump) jumpToQuestion(jump.getAttribute("data-jump"));
    });
    $("#practice").addEventListener("keydown", (e) => {
      const jump = e.target.closest("[data-jump]");
      if (jump && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); jumpToQuestion(jump.getAttribute("data-jump")); }
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
        Cloud.schedulePush();
      }
    });

    // Notes / solution editing (persist on input; debounced-ish via input)
    listEl.addEventListener("input", (e) => {
      const notes = e.target.closest("[data-notes]");
      const sol = e.target.closest("[data-solution]");
      if (notes) { Store.set(findQ(notes.dataset.notes), { notes: notes.value }); Cloud.schedulePush(); }
      else if (sol) { Store.set(findQ(sol.dataset.solution), { solution: sol.value }); Cloud.schedulePush(); }
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
    $("#pinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = $("#pinInput").value;
      const ok = await Cloud.verifyPin(val);
      if (ok) {
        state.unlocked = true;
        sessionStorage.setItem("sqltracker:unlocked", "1");
        closePin();
        updateLockUI();
        renderList();
        toast("Editing unlocked", "ok");
        // Remember the PIN in memory and auto-connect cloud sync if a token is published.
        Cloud.setPin(val);
        Cloud.autoConnect(val);
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
    $("#syncConnect").addEventListener("click", async () => {
      const token = $("#ghToken").value;
      $("#ghToken").value = "";
      setSyncStatus("Connecting…", "busy");
      await Cloud.connectWithToken(token);
    });
    $("#syncSyncNow").addEventListener("click", () => { setSyncStatus("Syncing…", "busy"); Cloud.syncNow(); });
    $("#syncDisconnect").addEventListener("click", () => Cloud.disconnect());
    $("#syncSnapshot").addEventListener("click", downloadSnapshot);

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
  const CLOUD_LABEL = { off: "Not connected", syncing: "Syncing…", ok: "Synced", error: "Sync error" };

  function openSync() {
    setSyncStatus("", "");
    setCloudUI(Cloud.state(), Cloud.lastSync());
    $("#syncBackdrop").hidden = false;
  }
  function closeSync() { $("#syncBackdrop").hidden = true; }
  function setSyncStatus(html, kind) {
    const el = $("#syncStatus");
    el.innerHTML = html;
    el.className = "sync-status" + (kind ? " " + kind : "");
  }

  // Reflect cloud state in the header button + modal (badge, which controls show).
  function setCloudUI(cloudState, lastSync) {
    const s = cloudState || "off";
    const connected = Cloud.isConnected();

    // Header cloud button
    const btn = $("#syncBtn");
    btn.classList.remove("ok", "syncing", "error");
    if (s !== "off") btn.classList.add(s);
    btn.title = "Cloud sync — " + (CLOUD_LABEL[s] || "Not connected");

    // Badge
    const badge = $("#syncBadge");
    badge.textContent = CLOUD_LABEL[s] || "Not connected";
    badge.className = "sync-badge" + (s !== "off" ? " " + s : "");
    $("#syncWhen").textContent = lastSync ? "last: " + new Date(lastSync).toLocaleString() : "";

    // Controls: token+Connect when disconnected; Sync now + Disconnect when connected.
    $("#tokenField").hidden = connected;
    $("#syncConnect").hidden = connected;
    $("#syncSyncNow").hidden = !connected;
    $("#syncDisconnect").hidden = !connected;
    // Save snapshot only makes sense in edit mode (unlocked).
    $("#syncSnapshot").hidden = !state.unlocked;
  }

  // Download an updated progress.js for the owner to commit.
  function downloadSnapshot() {
    const text = Cloud.buildProgressJs();
    const blob = new Blob([text], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "progress.js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const note = Cloud.hasPendingBlob()
      ? "Downloaded progress.js (includes encrypted token). Commit it to enable PIN-unlock on all devices."
      : "Downloaded progress.js. Commit it to publish your progress.";
    setSyncStatus(esc(note), "ok");
    toast("Saved progress.js", "ok");
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
    // Cloud sync: reflect status in UI, re-render when a pull changes local data.
    Cloud.init({
      onStatus: (s, last) => setCloudUI(s, last),
      onData: () => render(),
      toast: (m) => toast(m),
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
