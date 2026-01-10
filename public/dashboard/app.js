// public/dashboard/app.js — v8 (KPIs + Ops + Charts)
(() => {
  // ============================================================
  // Settings
  // ============================================================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

  const CANONICAL_ORIGIN = "https://www.nightshifthotels.com";
  const CANONICAL_PATH = "/dashboard/";
  const CANONICAL_URL = `${CANONICAL_ORIGIN}${CANONICAL_PATH}`;

  const ALWAYS_REQUIRE_LOGIN = false;
  const PERSIST_SESSION = true;

  const HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS = true;
  const DEDUPE_DUPLICATE_BOOKINGS = true;
  const ENABLE_RANGE_FILTER = true;

  // ============================================================
  // Helpers
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const safeStr = (v) => (v === null || v === undefined) ? "" : String(v);

  const fmtInt = (n) => Number.isFinite(n) ? n.toLocaleString() : "—";
  const fmtMoney = (n) => Number.isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : "—";
  const fmtPct = (n) => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";

  const parseISOish = (v) => {
    if (!v) return null;
    const s = String(v).trim();

    const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    }

    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      const [, yyyy, mm, dd] = ymd;
      return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  const toYMD = (d) => {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);

  const toast = (msg) => {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  };

  // ============================================================
  // Canonical URL
  // ============================================================
  function enforceCanonicalUrl() {
    try {
      if (location.origin !== CANONICAL_ORIGIN) {
        location.replace(CANONICAL_ORIGIN + location.pathname + location.search + location.hash);
        return true;
      }
      if (location.pathname === "/dashboard" || location.pathname === "/dashboard/index.html") {
        location.replace(CANONICAL_URL);
        return true;
      }
      return false;
    } catch { return false; }
  }

  // ============================================================
  // Supabase
  // ============================================================
  function getSupabaseClient() {
    const cfg = window.NSA_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase)
      throw new Error("Supabase config missing");

    return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: PERSIST_SESSION, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  // ============================================================
  // State
  // ============================================================
  let supabaseClient = null;
  let allRows = [];
  let filteredRows = [];
  let lastRange = null;
  let chartCalls = null;
  let chartBookings = null;

  // ============================================================
  // Date Range
  // ============================================================
  function getSelectedRange() {
    const mode = $("rangeSelect")?.value || "7";
    const now = new Date();

    if (mode === "today") return { label:"Today", start:startOfDay(now), end:endOfDay(now) };

    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days-1)));
      return { label:`Last ${days} days`, start:s, end:endOfDay(now) };
    }

    const sVal = $("startDate")?.value;
    const eVal = $("endDate")?.value;
    if (!sVal || !eVal) return getSelectedRange();

    return {
      label: `${sVal} → ${eVal}`,
      start: startOfDay(new Date(`${sVal}T00:00:00`)),
      end: endOfDay(new Date(`${eVal}T00:00:00`))
    };
  }

  // ============================================================
  // Filters
  // ============================================================
  function applyFilters() {
    const range = lastRange;
    const q = safeStr($("searchInput")?.value).toLowerCase();

    filteredRows = allRows.filter(r => {
      if (r.when) {
        if (r.when < range.start || r.when > range.end) return false;
      }
      if (!q) return true;

      const hay = JSON.stringify(r).toLowerCase();
      return hay.includes(q);
    });
  }

  // ============================================================
  // KPIs
  // ============================================================
  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const revenue = bookings.reduce((s,b)=>s+(Number(b.totalDue)||0),0);

    return {
      totalCalls: calls.length,
      totalBookings: bookings.length,
      conv: calls.length ? bookings.length / calls.length : NaN,
      revenue
    };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid");
    el.innerHTML = "";

    const tiles = [
      { n:"Calls", v:fmtInt(k.totalCalls) },
      { n:"Bookings", v:fmtInt(k.totalBookings) },
      { n:"Conversion", v:fmtPct(k.conv) },
      { n:"Revenue", v:fmtMoney(k.revenue) },
    ];

    for (const t of tiles) {
      const d = document.createElement("div");
      d.className = "kpi";
      d.innerHTML = `<p class="name">${t.n}</p><p class="value">${t.v}</p>`;
      el.appendChild(d);
    }
  }

  // ============================================================
  // Charts
  // ============================================================
  function buildDailySeries(rows, kind) {
    const map = {};
    for (const r of rows) {
      if (r.kind !== kind || !r.when) continue;
      const k = toYMD(r.when);
      map[k] = (map[k] || 0) + 1;
    }

    const labels = Object.keys(map).sort();
    return {
      labels,
      values: labels.map(l => map[l])
    };
  }

  function renderCharts() {
    if (!window.Chart) return;

    const calls = buildDailySeries(filteredRows, "call");
    const bookings = buildDailySeries(filteredRows, "booking");

    const ctx1 = $("chartCalls");
    const ctx2 = $("chartBookings");

    if (chartCalls) chartCalls.destroy();
    if (chartBookings) chartBookings.destroy();

    chartCalls = new Chart(ctx1, {
      type: "line",
      data: { labels: calls.labels, datasets:[{ label:"Calls", data:calls.values, tension:.3 }] },
      options:{ responsive:true, plugins:{ legend:{display:false} } }
    });

    chartBookings = new Chart(ctx2, {
      type: "bar",
      data: { labels: bookings.labels, datasets:[{ label:"Bookings", data:bookings.values }] },
      options:{ responsive:true, plugins:{ legend:{display:false} } }
    });
  }

  // ============================================================
  // Feed
  // ============================================================
  function renderFeed(rows) {
    const tb = $("feedTbody");
    tb.innerHTML = "";

    for (const r of rows.slice(0,500)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.when ? r.when.toLocaleString() : "—"}</td>
        <td>${r.kind}</td>
        <td>${safeStr(r.guest)}</td>
        <td>${safeStr(r.arrival)}</td>
        <td>${r.nights ?? "—"}</td>
        <td>${r.totalDue ? fmtMoney(r.totalDue) : "—"}</td>
        <td>${safeStr(r.sentiment)}</td>
        <td>${safeStr(r.summary)}</td>
      `;
      tb.appendChild(tr);
    }

    $("feedMeta").textContent = `${rows.length} items`;
    $("badgeCount").textContent = rows.length;
  }

  // ============================================================
  // Render
  // ============================================================
  function renderAll() {
    applyFilters();
    renderKPIs(computeKPIs(filteredRows));
    renderCharts();
    renderFeed(filteredRows);
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    lastRange = getSelectedRange();

    const [r1, r2] = await Promise.all([
      supabaseClient.from("reservations").select("*").limit(3000),
      supabaseClient.from("call_logs").select("*").limit(3000),
    ]);

    const rows = [];

    for (const r of r1.data || []) {
      rows.push({ kind:"booking", when:parseISOish(r.created_at), ...r });
    }
    for (const c of r2.data || []) {
      rows.push({ kind:"call", when:parseISOish(c.created_at), ...c });
    }

    allRows = rows;
    renderAll();
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    try { supabaseClient = getSupabaseClient(); }
    catch(e){ alert(e.message); return; }

    $("rangeSelect")?.addEventListener("change", loadAndRender);
    $("btnRefresh")?.addEventListener("click", loadAndRender);
    $("searchInput")?.addEventListener("input", renderAll);

    await loadAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
