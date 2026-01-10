/* NightShift AI Dashboard (no frameworks)
   - Theme toggle (saved)
   - Date filters (today / 7 / 30 / custom)
   - KPIs + ops insights
   - Search
   - CSV export
   - Simple charts (canvas)
   - Defensive schema reading (won’t crash if columns differ)
*/

(() => {
  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);

  const fmtInt = (n) => Number.isFinite(n) ? n.toLocaleString() : "—";
  const fmtMoney = (n) => Number.isFinite(n) ? n.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—";
  const fmtPct = (n) => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";

  const safeStr = (v) => (v === null || v === undefined) ? "" : String(v);

  const parseISOish = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    // If it's already ISO, Date can parse; if it's like "27-06-2026" try DD-MM-YYYY:
    const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  const toYMD = (d) => {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const toast = (msg) => {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  };

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem("ns_theme");
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
    $("btnTheme")?.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = (cur === "dark") ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("ns_theme", next);
      toast(`Theme: ${next}`);
      // redraw charts for better contrast
      renderAll();
    });
  }

  // ---------- Supabase ----------
  function getSupabaseClient() {
    // Expect config.js to define:
    // window.SUPABASE_URL, window.SUPABASE_ANON_KEY
    const url = window.SUPABASE_URL || window.supabaseUrl || window.NIGHTSHIFT_SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY || window.supabaseAnonKey || window.NIGHTSHIFT_SUPABASE_ANON_KEY;

    if (!url || !key || !window.supabase) {
      throw new Error("Missing Supabase config. Ensure dashboard/config.js sets SUPABASE_URL and SUPABASE_ANON_KEY.");
    }
    return window.supabase.createClient(url, key);
  }

  // ---------- Data model ----------
  // We’ll try to read from:
  // - reservations (booking events)
  // - call_events (call_started / call_ended / etc.)
  //
  // If your actual tables differ, adjust TABLES below.
  const TABLES = {
    reservations: "reservations",
    callEvents: "call_events",
  };

  // Internal state
  let supabaseClient = null;
  let allRows = [];      // normalized rows for feed
  let filteredRows = []; // after date+search
  let lastRange = null;

  // ---------- Controls ----------
  function initControls() {
    const rangeSelect = $("rangeSelect");
    const customRange = $("customRange");
    const startDate = $("startDate");
    const endDate = $("endDate");
    const searchInput = $("searchInput");

    function syncCustomVisibility() {
      customRange.style.display = (rangeSelect.value === "custom") ? "flex" : "none";
    }

    rangeSelect.addEventListener("change", () => {
      syncCustomVisibility();
      loadAndRender();
    });

    startDate.addEventListener("change", loadAndRender);
    endDate.addEventListener("change", loadAndRender);

    searchInput.addEventListener("input", () => {
      applyFilters();
      renderAll();
    });

    $("btnRefresh")?.addEventListener("click", loadAndRender);

    $("btnExport")?.addEventListener("click", () => {
      if (!filteredRows.length) return toast("Nothing to export.");
      exportCSV(filteredRows);
    });

    syncCustomVisibility();

    // Default custom date inputs to last 7 days if user switches to custom
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    startDate.value = toYMD(start);
    endDate.value = toYMD(today);
  }

  // ---------- Range ----------
  function getSelectedRange() {
    const mode = $("rangeSelect").value;
    const now = new Date();

    if (mode === "today") {
      const s = startOfDay(now);
      const e = endOfDay(now);
      return { label: "Today", start: s, end: e };
    }

    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
      const e = endOfDay(now);
      return { label: `Last ${days} days`, start: s, end: e };
    }

    // custom
    const sVal = $("startDate").value;
    const eVal = $("endDate").value;

    const s = sVal ? startOfDay(new Date(`${sVal}T00:00:00`)) : null;
    const e = eVal ? endOfDay(new Date(`${eVal}T00:00:00`)) : null;

    if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) {
      // fallback to last 7 days
      const fallback = getSelectedRangeFallback();
      return fallback;
    }

    const label = `${sVal} → ${eVal}`;
    return { label, start: s, end: e };
  }

  function getSelectedRangeFallback() {
    const now = new Date();
    const s = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    const e = endOfDay(now);
    return { label: "Last 7 days", start: s, end: e };
  }

  // ---------- Fetch ----------
  async function fetchReservations(range) {
    // Try to fetch enough rows; if you have huge volume, add pagination later.
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();

    // We’ll try common timestamp fields: created_at OR inserted_at
    // If your table uses something else, adjust below.
    const tries = ["created_at", "inserted_at", "timestamp", "ts"];

    for (const tsField of tries) {
      const q = supabaseClient
        .from(TABLES.reservations)
        .select("*")
        .gte(tsField, startISO)
        .lte(tsField, endISO)
        .order(tsField, { ascending: false })
        .limit(2000);

      const { data, error } = await q;
      if (!error) return { data: data || [], tsField };
      // ignore "column not found" type issues and try next field
    }
    // Last resort: just select recent without filters
    const { data } = await supabaseClient
      .from(TABLES.reservations)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    return { data: data || [], tsField: "created_at" };
  }

  async function fetchCallEvents(range) {
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();
    const tries = ["created_at", "inserted_at", "timestamp", "ts"];

    for (const tsField of tries) {
      const q = supabaseClient
        .from(TABLES.callEvents)
        .select("*")
        .gte(tsField, startISO)
        .lte(tsField, endISO)
        .order(tsField, { ascending: false })
        .limit(3000);

      const { data, error } = await q;
      if (!error) return { data: data || [], tsField };
    }

    const { data } = await supabaseClient
      .from(TABLES.callEvents)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(800);
    return { data: data || [], tsField: "created_at" };
  }

  // ---------- Normalize ----------
  function normalizeReservationRow(r, tsField) {
    const when = parseISOish(r?.[tsField]) || parseISOish(r?.created_at) || parseISOish(r?.inserted_at) || null;

    // Common booking fields (your schema may use nested booking object)
    const bookingObj = r?.booking && typeof r.booking === "object" ? r.booking : null;

    const event = safeStr(r?.event || bookingObj?.event || "booking");
    const guest = safeStr(r?.guest_name || bookingObj?.guest_name || r?.name || r?.caller_name || "");
    const arrival = safeStr(r?.arrival_date || bookingObj?.arrival_date || "");
    const nights = Number(r?.nights ?? bookingObj?.nights);
    const totalDue = Number(r?.total_due ?? bookingObj?.total_due);
    const roomType = safeStr(r?.room_type || bookingObj?.room_type || "");
    const sentiment = safeStr(r?.sentiment || bookingObj?.sentiment || r?.call_sentiment || "");

    const summary =
      safeStr(r?.summary) ||
      safeStr(bookingObj?.summary) ||
      `Reservation${guest ? ` for ${guest}` : ""}${arrival ? ` • Arrive ${arrival}` : ""}${roomType ? ` • ${roomType}` : ""}`;

    return {
      kind: "booking",
      when,
      whenRaw: r?.[tsField] || r?.created_at || r?.inserted_at || "",
      event,
      guest,
      arrival,
      nights: Number.isFinite(nights) ? nights : null,
      totalDue: Number.isFinite(totalDue) ? totalDue : null,
      sentiment,
      summary,
      raw: r,
    };
  }

  function normalizeCallEventRow(e, tsField) {
    const when = parseISOish(e?.[tsField]) || parseISOish(e?.created_at) || parseISOish(e?.inserted_at) || null;

    const event = safeStr(e?.event || e?.type || e?.name || "call_event");
    const callId = safeStr(e?.call_id || e?.call_sid || e?.id || "");
    const phone = safeStr(e?.from || e?.caller || e?.phone || e?.caller_phone || "");
    const sentiment = safeStr(e?.sentiment || e?.call_sentiment || "");
    const duration = Number(e?.duration_seconds ?? e?.duration ?? NaN);

    const summary =
      safeStr(e?.summary) ||
      safeStr(e?.notes) ||
      safeStr(e?.transcript_summary) ||
      `${event}${callId ? ` • ${callId}` : ""}${phone ? ` • ${phone}` : ""}${Number.isFinite(duration) ? ` • ${Math.round(duration)}s` : ""}`;

    return {
      kind: "call",
      when,
      whenRaw: e?.[tsField] || e?.created_at || e?.inserted_at || "",
      event,
      guest: phone || callId,
      arrival: "",
      nights: null,
      totalDue: null,
      sentiment,
      summary,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      raw: e,
    };
  }

  // ---------- Filtering ----------
  function applyFilters() {
    const range = lastRange || getSelectedRange();
    const q = (safeStr($("searchInput")?.value)).toLowerCase().trim();

    filteredRows = allRows.filter(row => {
      // date filter
      const t = row.when instanceof Date && !isNaN(row.when.getTime()) ? row.when.getTime() : null;
      if (t !== null) {
        if (t < range.start.getTime() || t > range.end.getTime()) return false;
      }

      // search filter
      if (!q) return true;
      const hay = [
        row.kind,
        row.event,
        row.guest,
        row.arrival,
        row.sentiment,
        row.summary,
        safeStr(row.whenRaw),
      ].join(" ").toLowerCase();

      // also search raw JSON lightly
      const rawStr = (() => {
        try { return JSON.stringify(row.raw).toLowerCase(); } catch { return ""; }
      })();

      return hay.includes(q) || rawStr.includes(q);
    });
  }

  // ---------- KPIs / Insights ----------
  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const totalCalls = calls.length;
    const totalBookings = bookings.length;

    const conv = totalCalls > 0 ? (totalBookings / totalCalls) : NaN;

    const durations = calls.map(c => c.durationSeconds).filter(n => Number.isFinite(n));
    const avgDur = durations.length ? (durations.reduce((a,b)=>a+b,0) / durations.length) : NaN;

    const revenue = bookings.map(b => b.totalDue).filter(n => Number.isFinite(n)).reduce((a,b)=>a+b,0);

    const sentimentCounts = rows.reduce((acc, r) => {
      const s = safeStr(r.sentiment).toLowerCase();
      if (!s) return acc;
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    // upcoming arrivals (arrival_date may be string; best-effort parse)
    const today = startOfDay(new Date()).getTime();
    const nextArrivals = bookings
      .map(b => ({ b, d: parseISOish(b.arrival) }))
      .filter(x => x.d && !isNaN(x.d.getTime()))
      .filter(x => x.d.getTime() >= today)
      .sort((a,b)=>a.d-b.d)
      .slice(0, 5);

    return {
      totalCalls,
      totalBookings,
      conv,
      avgDur,
      revenue,
      sentimentCounts,
      nextArrivals
    };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid");
    el.innerHTML = "";

    const tiles = [
      { name: "Total calls", value: fmtInt(k.totalCalls), sub: "all call events in range" },
      { name: "Bookings", value: fmtInt(k.totalBookings), sub: "reservations captured" },
      { name: "Conversion", value: fmtPct(k.conv), sub: "bookings ÷ calls" },
      { name: "Booking revenue", value: fmtMoney(k.revenue), sub: "sum of total_due (if present)" },
      { name: "Avg call duration", value: Number.isFinite(k.avgDur) ? `${Math.round(k.avgDur)}s` : "—", sub: "based on duration_seconds" },
      { name: "Positive sentiment", value: fmtInt(k.sentimentCounts["positive"] || 0), sub: "rows tagged positive" },
      { name: "Neutral sentiment", value: fmtInt(k.sentimentCounts["neutral"] || 0), sub: "rows tagged neutral" },
      { name: "Negative sentiment", value: fmtInt(k.sentimentCounts["negative"] || 0), sub: "rows tagged negative" },
    ];

    for (const t of tiles) {
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `
        <p class="name">${t.name}</p>
        <p class="value">${t.value}</p>
        <p class="sub">${t.sub}</p>
      `;
      el.appendChild(div);
    }
  }

  function renderOpsInsights(k, rows) {
    const box = $("opsInsights");
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    // quick flags
    const negative = rows.filter(r => safeStr(r.sentiment).toLowerCase() === "negative");
    const longCalls = calls
      .filter(c => Number.isFinite(c.durationSeconds) && c.durationSeconds >= 240)
      .slice(0, 6);

    const noSummary = rows.filter(r => !safeStr(r.summary).trim()).length;

    const nextArrivalsText = k.nextArrivals.length
      ? k.nextArrivals.map(x => {
          const g = x.b.guest || "Guest";
          const a = x.b.arrival || toYMD(x.d);
          const n = Number.isFinite(x.b.nights) ? `${x.b.nights} night(s)` : "";
          return `• ${g} — ${a} ${n ? `(${n})` : ""}`;
        }).join("<br/>")
      : `<span class="muted">No upcoming arrival dates detected in this range.</span>`;

    box.innerHTML = `
      <div class="insight">
        <b>Watchlist</b>
        <span>
          Negative sentiment: <b>${fmtInt(negative.length)}</b><br/>
          Long calls (4m+): <b>${fmtInt(longCalls.length)}</b><br/>
          Missing summaries: <b>${fmtInt(noSummary)}</b>
        </span>
      </div>

      <div class="insight">
        <b>Next arrivals (best-effort)</b>
        <span>${nextArrivalsText}</span>
      </div>

      <div class="insight">
        <b>Operational snapshot</b>
        <span>
          Calls: <b>${fmtInt(k.totalCalls)}</b> • Bookings: <b>${fmtInt(k.totalBookings)}</b><br/>
          Conversion: <b>${fmtPct(k.conv)}</b> • Revenue: <b>${fmtMoney(k.revenue)}</b>
        </span>
      </div>
    `;
  }

  // ---------- Feed table ----------
  function sentimentTag(sentiment) {
    const s = safeStr(sentiment).toLowerCase();
    if (!s) return `<span class="tag">—</span>`;
    if (s.includes("pos")) return `<span class="tag good">positive</span>`;
    if (s.includes("neg")) return `<span class="tag bad">negative</span>`;
    if (s.includes("neu")) return `<span class="tag warn">neutral</span>`;
    return `<span class="tag">${safeStr(sentiment)}</span>`;
  }

  function kindTag(kind) {
    if (kind === "booking") return `<span class="tag good">booking</span>`;
    return `<span class="tag">call</span>`;
  }

  function renderFeed(rows) {
    const state = $("stateBox");
    const wrap = $("tableWrap");
    const tbody = $("feedTbody");

    $("badgeCount").textContent = fmtInt(rows.length);
    $("feedMeta").textContent = `${fmtInt(rows.length)} items`;

    if (!rows.length) {
      wrap.style.display = "none";
      state.style.display = "block";
      state.textContent = "No data found for this date range / search.";
      return;
    }

    state.style.display = "none";
    wrap.style.display = "block";

    // Sort newest first
    const sorted = [...rows].sort((a, b) => {
      const ta = a.when ? a.when.getTime() : -Infinity;
      const tb = b.when ? b.when.getTime() : -Infinity;
      return tb - ta;
    });

    tbody.innerHTML = "";

    for (const r of sorted.slice(0, 500)) {
      const tr = document.createElement("tr");

      const whenTxt = r.when ? r.when.toLocaleString() : safeStr(r.whenRaw) || "—";
      const arrivalTxt = r.arrival ? safeStr(r.arrival) : "—";
      const nightsTxt = Number.isFinite(r.nights) ? String(r.nights) : "—";
      const totalTxt = Number.isFinite(r.totalDue) ? fmtMoney(r.totalDue) : "—";

      tr.innerHTML = `
        <td><span class="muted">${whenTxt}</span></td>
        <td>${kindTag(r.kind)}</td>
        <td>${safeStr(r.guest) || "<span class='muted'>—</span>"}</td>
        <td>${arrivalTxt}</td>
        <td>${nightsTxt}</td>
        <td>${totalTxt}</td>
        <td>${sentimentTag(r.sentiment)}</td>
        <td>${safeStr(r.summary) || "<span class='muted'>—</span>"}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // ---------- Charts (simple line) ----------
  function groupByDay(rows, kindFilter) {
    const map = new Map(); // ymd -> count
    for (const r of rows) {
      if (kindFilter && r.kind !== kindFilter) continue;
      const d = r.when || parseISOish(r.whenRaw);
      if (!d || isNaN(d.getTime())) continue;
      const key = toYMD(d);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  function buildDayAxis(range) {
    const days = [];
    const cur = new Date(range.start);
    while (cur.getTime() <= range.end.getTime()) {
      days.push(toYMD(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  function drawLineChart(canvasId, labels, values, colorVarName) {
    const canvas = $(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // computed style for color
    const cs = getComputedStyle(document.documentElement);
    const stroke = cs.getPropertyValue(colorVarName).trim() || "#6ea8ff";
    const grid = cs.getPropertyValue("--border").trim() || "rgba(255,255,255,0.12)";
    const text = cs.getPropertyValue("--muted").trim() || "rgba(255,255,255,0.6)";

    const W = canvas.width;
    const H = canvas.height;
    const pad = 34;

    const maxVal = Math.max(1, ...values);
    const minVal = 0;

    // gridlines
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad + ((H - pad * 2) * i) / gridLines;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();

      // y labels
      const v = Math.round(maxVal - ((maxVal - minVal) * i) / gridLines);
      ctx.fillStyle = text;
      ctx.font = "12px system-ui";
      ctx.fillText(String(v), 8, y + 4);
    }

    // line
    const xStep = (W - pad * 2) / Math.max(1, labels.length - 1);
    const yScale = (H - pad * 2) / (maxVal - minVal);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;

    ctx.beginPath();
    labels.forEach((lbl, i) => {
      const x = pad + xStep * i;
      const y = pad + (maxVal - values[i]) * yScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // points
    ctx.fillStyle = stroke;
    labels.forEach((lbl, i) => {
      const x = pad + xStep * i;
      const y = pad + (maxVal - values[i]) * yScale;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // x labels (sparse)
    ctx.fillStyle = text;
    ctx.font = "12px system-ui";
    const step = Math.ceil(labels.length / 6);
    labels.forEach((lbl, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      const x = pad + xStep * i;
      const short = lbl.slice(5); // MM-DD
      ctx.fillText(short, x - 16, H - 10);
    });
  }

  function renderCharts(rows) {
    const range = lastRange || getSelectedRange();
    const axis = buildDayAxis(range);

    const callsMap = groupByDay(rows, "call");
    const bookingsMap = groupByDay(rows, "booking");

    const callsSeries = axis.map(d => callsMap.get(d) || 0);
    const bookingsSeries = axis.map(d => bookingsMap.get(d) || 0);

    // trend labels
    const callsTotal = callsSeries.reduce((a,b)=>a+b,0);
    const bookingsTotal = bookingsSeries.reduce((a,b)=>a+b,0);

    $("callsTrendLabel").textContent = `${fmtInt(callsTotal)} total`;
    $("bookingsTrendLabel").textContent = `${fmtInt(bookingsTotal)} total`;

    drawLineChart("callsChart", axis, callsSeries, "--accent");
    // bookings in green
    // temporarily override by reading --good
    const canvas = $("bookingsChart");
    if (canvas) {
      const cs = getComputedStyle(document.documentElement);
      const good = cs.getPropertyValue("--good").trim() || "#42d392";
      // hack: set a css variable for stroke, draw using it
      document.documentElement.style.setProperty("--_tmp_booking_color", good);
      drawLineChart("bookingsChart", axis, bookingsSeries, "--_tmp_booking_color");
      document.documentElement.style.removeProperty("--_tmp_booking_color");
    }
  }

  // ---------- CSV export ----------
  function exportCSV(rows) {
    const cols = [
      "kind",
      "time",
      "event",
      "guest_or_caller",
      "arrival_date",
      "nights",
      "total_due",
      "sentiment",
      "summary",
    ];

    const lines = [cols.join(",")];

    for (const r of rows) {
      const time = r.when ? r.when.toISOString() : safeStr(r.whenRaw);
      const vals = [
        r.kind,
        time,
        safeStr(r.event),
        safeStr(r.guest),
        safeStr(r.arrival),
        Number.isFinite(r.nights) ? r.nights : "",
        Number.isFinite(r.totalDue) ? r.totalDue : "",
        safeStr(r.sentiment),
        safeStr(r.summary),
      ].map(v => {
        const s = String(v ?? "");
        // CSV escape
        const escaped = s.replace(/"/g, '""');
        return `"${escaped}"`;
      });

      lines.push(vals.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `nightshift_dashboard_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    toast("CSV exported.");
  }

  // ---------- Render all ----------
  function renderAll() {
    applyFilters();

    // badges
    $("badgeWindow").textContent = lastRange?.label || "—";

    // KPIs
    const k = computeKPIs(filteredRows);
    renderKPIs(k);
    renderOpsInsights(k, filteredRows);

    // Feed
    renderFeed(filteredRows);

    // Charts
    renderCharts(filteredRows);

    // updated
    $("lastUpdated").textContent = `Updated ${new Date().toLocaleString()}`;
  }

  // ---------- Load ----------
  async function loadAndRender() {
    const state = $("stateBox");
    const wrap = $("tableWrap");
    wrap.style.display = "none";
    state.style.display = "block";
    state.textContent = "Loading…";

    try {
      lastRange = getSelectedRange();
      $("badgeWindow").textContent = lastRange.label;

      const [resv, calls] = await Promise.all([
        fetchReservations(lastRange),
        fetchCallEvents(lastRange),
      ]);

      // Normalize
      const normalized = [];

      for (const r of (resv.data || [])) normalized.push(normalizeReservationRow(r, resv.tsField));
      for (const e of (calls.data || [])) normalized.push(normalizeCallEventRow(e, calls.tsField));

      // Ensure "when" exists when possible
      allRows = normalized.map(r => {
        if (!r.when) r.when = parseISOish(r.whenRaw);
        return r;
      });

      // Update sidebar badge
      $("badgeCount").textContent = fmtInt(allRows.length);

      // Show
      state.textContent = "Rendering…";
      renderAll();
      toast("Dashboard refreshed.");
    } catch (err) {
      console.error(err);
      state.textContent = `Error: ${err?.message || err}`;
      toast("Load failed. Check console + config.js.");
    }
  }

  // ---------- Init ----------
  async function init() {
    initTheme();
    initControls();

    try {
      supabaseClient = getSupabaseClient();
    } catch (e) {
      $("stateBox").textContent = `Config error: ${e.message}`;
      return;
    }

    await loadAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
