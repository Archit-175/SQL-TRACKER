// analytics.js — computes stats and renders hand-drawn inline-SVG charts.
// Exposes global `Analytics.render(container)`.

const Analytics = (function () {
  const DIFFS = ["Easy", "Medium", "Hard"];
  const DIFF_COLOR = { Easy: "var(--easy)", Medium: "var(--medium)", Hard: "var(--hard)" };
  const TOPICS = ["Basics", "Joins", "Aggregation", "Subqueries", "Window", "String", "Date", "Pivot"];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // Gather records for every question.
  function records() {
    return QUESTIONS.map((q) => ({ q, r: Store.get(q) }));
  }

  function computeStats(recs) {
    const total = recs.length;
    const solved = recs.filter((x) => x.r.status === "Solved");
    const dates = solved.map((x) => x.r.dateSolved).filter(Boolean).sort();
    return {
      total,
      solvedCount: solved.length,
      completion: total ? Math.round((solved.length / total) * 100) : 0,
      streak: currentStreak(dates),
      solved,
      dates,
    };
  }

  // Consecutive days (ending today or yesterday) with at least one solve.
  function currentStreak(sortedDates) {
    if (!sortedDates.length) return 0;
    const days = new Set(sortedDates);
    const today = new Date(Store.todayISO() + "T00:00:00");
    const iso = (d) => {
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    };
    // Allow the streak to be "current" if the latest solve was today or yesterday.
    let cursor = new Date(today);
    if (!days.has(iso(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(iso(cursor))) return 0;
    }
    let streak = 0;
    while (days.has(iso(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // ---------- Line chart: cumulative solved over time ----------
  function lineChart(dates) {
    const W = 640, H = 240, PAD_L = 38, PAD_R = 12, PAD_T = 14, PAD_B = 28;
    if (!dates.length) return emptyChart("No solved dates yet — mark a problem Solved to start the timeline.");

    // Build cumulative series keyed by unique day.
    const counts = {};
    dates.forEach((d) => { counts[d] = (counts[d] || 0) + 1; });
    const days = Object.keys(counts).sort();
    const series = [];
    let cum = 0;
    days.forEach((d) => { cum += counts[d]; series.push({ d, v: cum }); });

    const t0 = new Date(days[0] + "T00:00:00").getTime();
    const t1 = new Date(days[days.length - 1] + "T00:00:00").getTime();
    const maxV = series[series.length - 1].v;
    const spanT = Math.max(1, t1 - t0);

    const x = (d) => PAD_L + ((new Date(d + "T00:00:00").getTime() - t0) / spanT) * (W - PAD_L - PAD_R);
    const y = (v) => H - PAD_B - (v / maxV) * (H - PAD_T - PAD_B);

    const pts = series.map((p) => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`);
    const linePath = "M" + pts.join(" L");
    const areaPath = `M${x(series[0].d).toFixed(1)},${(H - PAD_B).toFixed(1)} L` +
      pts.join(" L") + ` L${x(series[series.length - 1].d).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

    // Y gridlines
    const ticks = niceTicks(maxV, 4);
    let grid = "";
    ticks.forEach((tv) => {
      const yy = y(tv).toFixed(1);
      grid += `<line x1="${PAD_L}" y1="${yy}" x2="${W - PAD_R}" y2="${yy}" stroke="var(--border)" stroke-width="1"/>`;
      grid += `<text x="${PAD_L - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle" fill="var(--text-faint)" font-size="11" font-family="var(--font-mono)">${tv}</text>`;
    });

    // X labels: first & last date
    const xlab = (d, anchor) =>
      `<text x="${x(d).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}" fill="var(--text-faint)" font-size="11" font-family="var(--font-mono)">${shortDate(d)}</text>`;

    const dots = series.map((p) =>
      `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" fill="var(--accent)"><title>${p.d}: ${p.v} solved</title></circle>`
    ).join("");

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Solved over time">
      <defs><linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path d="${areaPath}" fill="url(#areaGrad)"/>
      <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xlab(days[0], "start")}
      ${days.length > 1 ? xlab(days[days.length - 1], "end") : ""}
    </svg>`;
  }

  // ---------- Bar chart (horizontal) ----------
  function barChart(rows) {
    // rows: [{ label, solved, total, color }]
    const W = 640, rowH = 34, PAD_L = 96, PAD_R = 44, PAD_T = 6;
    const H = PAD_T * 2 + rows.length * rowH;
    const maxV = Math.max(1, ...rows.map((r) => r.total));
    const barW = W - PAD_L - PAD_R;

    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Breakdown">`;
    rows.forEach((r, i) => {
      const cy = PAD_T + i * rowH + rowH / 2;
      const by = cy - 9;
      const fullW = (r.total / maxV) * barW;
      const solvedW = (r.solved / maxV) * barW;
      out += `<text x="${PAD_L - 10}" y="${cy}" text-anchor="end" dominant-baseline="middle" fill="var(--text-dim)" font-size="13">${esc(r.label)}</text>`;
      out += `<rect x="${PAD_L}" y="${by}" width="${fullW.toFixed(1)}" height="18" rx="5" fill="var(--bg)" stroke="var(--border)"/>`;
      out += `<rect x="${PAD_L}" y="${by}" width="${solvedW.toFixed(1)}" height="18" rx="5" fill="${r.color}"><title>${r.label}: ${r.solved}/${r.total}</title></rect>`;
      out += `<text x="${PAD_L + fullW + 8}" y="${cy}" dominant-baseline="middle" fill="var(--text-dim)" font-size="12" font-family="var(--font-mono)">${r.solved}/${r.total}</text>`;
    });
    out += `</svg>`;
    return out;
  }

  function emptyChart(msg) {
    return `<div class="empty" style="padding:30px">${esc(msg)}</div>`;
  }

  // ---------- Contribution heatmap (GitHub-style) ----------
  function isoOf(d) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Map of YYYY-MM-DD -> number of problems solved that day.
  function dateCounts(dates) {
    const m = {};
    dates.forEach((d) => { m[d] = (m[d] || 0) + 1; });
    return m;
  }

  function heatColor(n) {
    if (!n) return "var(--bg-2)";
    if (n === 1) return "rgba(38,217,127,0.30)";
    if (n === 2) return "rgba(38,217,127,0.50)";
    if (n <= 4) return "rgba(38,217,127,0.75)";
    return "var(--accent)";
  }

  function heatmap(dates) {
    const WEEKS = 27; // ~6 months, keeps cells readable
    const CELL = 14, GAP = 4, LEFT = 30, TOP = 20;
    const counts = dateCounts(dates);

    const today = new Date(Store.todayISO() + "T00:00:00");
    // Anchor the last column to the current week (its Saturday), so today is always shown.
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay())); // Saturday of this week
    const start = new Date(end);
    start.setDate(start.getDate() - (WEEKS * 7 - 1)); // Sunday, WEEKS columns back

    const W = LEFT + WEEKS * (CELL + GAP) + 6;
    const H = TOP + 7 * (CELL + GAP) + 4;

    let cells = "", monthLabels = "", lastMonth = -1, lastLabelCol = -2;
    const cursor = new Date(start);
    let total = 0;

    for (let col = 0; col < WEEKS; col++) {
      for (let row = 0; row < 7; row++) {
        const iso = isoOf(cursor);
        const inRange = cursor <= today;
        const n = inRange ? (counts[iso] || 0) : 0;
        if (inRange) {
          const x = LEFT + col * (CELL + GAP);
          const y = TOP + row * (CELL + GAP);
          const label = n ? `${n} solved on ${iso}` : `No problems on ${iso}`;
          cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" ` +
            `fill="${heatColor(n)}" stroke="var(--border)" stroke-width="1"><title>${label}</title></rect>`;
          total += n;
          // Month label at the top of the first week of a new month (min 3 columns apart).
          if (row === 0 && cursor.getMonth() !== lastMonth && col - lastLabelCol >= 3) {
            lastMonth = cursor.getMonth();
            lastLabelCol = col;
            monthLabels += `<text x="${x}" y="${TOP - 7}" fill="var(--text-faint)" font-size="11" font-family="var(--font-mono)">${MONTHS[lastMonth]}</text>`;
          } else if (row === 0) {
            lastMonth = cursor.getMonth();
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // Weekday labels (Mon/Wed/Fri).
    const dayLabels = [[1, "Mon"], [3, "Wed"], [5, "Fri"]].map(([row, txt]) => {
      const y = TOP + row * (CELL + GAP) + CELL - 3;
      return `<text x="${LEFT - 6}" y="${y}" text-anchor="end" fill="var(--text-faint)" font-size="10" font-family="var(--font-mono)">${txt}</text>`;
    }).join("");

    // Legend.
    const legendX = W - 5 * (CELL + 3) - 34;
    let legend = `<text x="${legendX - 6}" y="${H - 4}" text-anchor="end" fill="var(--text-faint)" font-size="10">Less</text>`;
    [0, 1, 2, 3, 5].forEach((n, i) => {
      legend += `<rect x="${legendX + i * (CELL + 3)}" y="${H - 15}" width="${CELL}" height="${CELL}" rx="3" fill="${heatColor(n)}" stroke="var(--border)" stroke-width="1"/>`;
    });
    legend += `<text x="${legendX + 5 * (CELL + 3) + 4}" y="${H - 4}" fill="var(--text-faint)" font-size="10">More</text>`;

    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Solved contribution heatmap">
      ${monthLabels}${dayLabels}${cells}${legend}</svg>`;
    return { svg, total };
  }

  // ---------- helpers ----------
  function niceTicks(max, count) {
    const step = Math.max(1, Math.ceil(max / count));
    const ticks = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] !== max) ticks.push(max);
    return ticks;
  }
  function shortDate(iso) {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y.slice(2)}`;
  }

  function render(container) {
    const recs = records();
    const s = computeStats(recs);

    const diffRows = DIFFS.map((d) => {
      const inDiff = recs.filter((x) => x.q.difficulty === d);
      return {
        label: d,
        solved: inDiff.filter((x) => x.r.status === "Solved").length,
        total: inDiff.length,
        color: DIFF_COLOR[d],
      };
    });

    const topicRows = TOPICS.map((t) => {
      const inTopic = recs.filter((x) => x.q.topic === t);
      return {
        label: t,
        solved: inTopic.filter((x) => x.r.status === "Solved").length,
        total: inTopic.length,
        color: "var(--accent)",
      };
    }).filter((r) => r.total > 0);

    const heat = heatmap(s.dates);

    container.innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="stat-num">${s.solvedCount}</div><div class="stat-label">Total solved</div></div>
        <div class="stat"><div class="stat-num">${s.completion}%</div><div class="stat-label">Completion</div></div>
        <div class="stat"><div class="stat-num">${s.streak}</div><div class="stat-label">Day streak</div></div>
      </div>
      <div class="chart-card">
        <h3>Activity heatmap <span style="color:var(--text-faint);font-weight:400;font-size:13px">· ${heat.total} in the last 6 months</span></h3>
        ${heat.svg}
      </div>
      <div class="chart-card">
        <h3>Solved over time</h3>
        ${lineChart(s.dates)}
      </div>
      <div class="chart-card">
        <h3>By difficulty</h3>
        ${barChart(diffRows)}
      </div>
      <div class="chart-card">
        <h3>By topic</h3>
        ${barChart(topicRows)}
      </div>
    `;
  }

  return { render };
})();
