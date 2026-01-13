// public/dashboard/app.js — v10.5 (BRANDED EXPORT + PDF CHARTS + DAILY SUMMARY)
// Keeps all existing behavior from v10.4 and adds professional export features.

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

  const THEME_STORAGE_KEY = "nsa_theme";
  const PROPERTY_STORAGE_KEY = "nsa_property";

  const FETCH_LIMIT = 3000;
  const FEED_MAX_ROWS = 500;

  // ============================================================
  // KPI behavior toggles
  // ============================================================
  const KPI_INCLUDE_CALLLOG_BOOKINGS = false;
  const KPI_REVENUE_INCLUDE_CALLLOG_BOOKINGS = false;

  const BOOKING_EVENTS = new Set([
    "reservation_confirmed",
    "booking_confirmed",
    "reservation_created"
  ]);

  // ============================================================
  // Date-window behavior
  // ============================================================
  const RESERVATION_WINDOW_BY_CREATED_AT = true;

  // ============================================================
  // DOM Helpers
  // ============================================================
  const $ = (id) => document.getElementById(id);

  const setText = (id, text) => {
    const el = $(id);
    if (el) el.textContent = (text === null || text === undefined) ? "" : String(text);
  };

  // ============================================================
  // Formatting + parsing
  // ============================================================
  const safeStr = (v) => (v === null || v === undefined) ? "" : String(v);

  const fmtInt = (n) => Number.isFinite(n) ? n.toLocaleString() : "—";
  const fmtMoney = (n) => Number.isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : "—";
  const fmtPct = (n) => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";

  function escHtml(str) {
    return safeStr(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim().replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function safeJsonParse(v) {
    if (!v) return null;
    if (typeof v === "object") return v;
    try { return JSON.parse(v); } catch { return null; }
  }

  function parseISOish(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;

    const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      const d = new Date(`${s}T00:00:00`);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  function clampStr(s, max = 220) {
    const v = safeStr(s);
    if (v.length <= max) return v;
    return v.slice(0, max - 1) + "…";
  }

  // ============================================================
  // Toast
  // ============================================================
  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = String(msg || "");
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

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
    } catch {}
    return false;
  }

  // ============================================================
  // Theme
  // ============================================================
  function systemPrefersDark() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch { return false; }
  }

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_STORAGE_KEY) || "system"; }
    catch { return "system"; }
  }

  function storeTheme(v) {
    try { localStorage.setItem(THEME_STORAGE_KEY, v); } catch {}
  }

  function resolveTheme(theme) {
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    return systemPrefersDark() ? "dark" : "light";
  }

  function applyTheme(theme) {
    const resolved = resolveTheme(theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    const btn = $("btnTheme");
    if (btn) btn.textContent = resolved === "dark" ? "Dark" : "Light";
  }

  function initTheme() {
    applyTheme(getStoredTheme());
    const btn = $("btnTheme");
    if (btn) {
      btn.onclick = () => {
        const now = getStoredTheme();
        const next = resolveTheme(now) === "dark" ? "light" : "dark";
        storeTheme(next);
        applyTheme(next);
      };
    }
  }

  // ============================================================
  // Property switcher
  // ============================================================
  function getStoredProperty() {
    try { return localStorage.getItem(PROPERTY_STORAGE_KEY) || "__all__"; }
    catch { return "__all__"; }
  }

  function storeProperty(v) {
    try { localStorage.setItem(PROPERTY_STORAGE_KEY, v); } catch {}
  }

  function getSelectedProperty() {
    const sel = $("propertySelect");
    return sel ? sel.value : "__all__";
  }

  function shortUuid(u) {
    const s = safeStr(u);
    if (!s || s === "__all__") return "All properties";
    return s.length > 8 ? `${s.slice(0, 8)}…` : s;
  }

  function populatePropertySelect(rows) {
    const sel = $("propertySelect");
    if (!sel) return;

    const idsSet = new Set();
    for (const r of rows) if (r.property_id) idsSet.add(String(r.property_id));

    const ids = Array.from(idsSet).sort();
    const prev = getStoredProperty();

    sel.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "__all__";
    optAll.textContent = "All properties";
    sel.appendChild(optAll);

    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = shortUuid(id);
      sel.appendChild(opt);
    }

    sel.value = ids.includes(prev) ? prev : "__all__";
  }

  function initPropertyControl() {
    const sel = $("propertySelect");
    if (!sel) return;
    sel.value = getStoredProperty();
    sel.onchange = () => {
      storeProperty(sel.value);
      renderAll();
    };
  }

  // ============================================================
  // Supabase
  // ============================================================
  let supabaseClient = null;

  function getSupabaseClient() {
    const cfg = window.NSA_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      throw new Error("Missing Supabase config.");
    }
    return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  // ============================================================
  // Auth UI
  // ============================================================
  function showOverlay(show) {
    const o = $("authOverlay");
    if (o) o.style.display = show ? "flex" : "none";
  }

  async function ensureAuthGate() {
    const { data } = await supabaseClient.auth.getSession();
    const session = data.session;

    if (!session) {
      showOverlay(true);
      return false;
    }

    if (session.user.email !== FOUNDER_EMAIL) {
      showOverlay(true);
      await supabaseClient.auth.signOut();
      return false;
    }

    showOverlay(false);
    return true;
  }

  // ============================================================
  // Range / Controls
  // ============================================================
  function enableCustomDates(enable) {
    const s = $("startDate"), e = $("endDate");
    if (s) s.disabled = !enable;
    if (e) e.disabled = !enable;
  }

  function getSelectedRange() {
    const mode = $("rangeSelect")?.value || "7";
    const now = new Date();

    if (mode === "today") {
      enableCustomDates(false);
      return { label: "Today", start: startOfDay(now), end: endOfDay(now) };
    }

    if (mode === "7" || mode === "30") {
      enableCustomDates(false);
      const days = Number(mode);
      const s = new Date(now); s.setDate(now.getDate() - (days - 1));
      return { label: `Last ${days} days`, start: startOfDay(s), end: endOfDay(now) };
    }

    enableCustomDates(true);
    const sd = new Date($("startDate").value);
    const ed = new Date($("endDate").value);
    return { label: `${toYMD(sd)} → ${toYMD(ed)}`, start: startOfDay(sd), end: endOfDay(ed) };
  }

  function initControls() {
    $("rangeSelect")?.addEventListener("change", loadAndRender);
    $("startDate")?.addEventListener("change", loadAndRender);
    $("endDate")?.addEventListener("change", loadAndRender);
    $("btnRefresh")?.addEventListener("click", loadAndRender);

    const btnExport = $("btnExport");
    if (btnExport) {
      btnExport.onclick = () => {
        const kpis = computeKPIs(state.filteredRows);
        const ok = confirm("OK = Branded PDF report\nCancel = CSV export");
        ok ? exportBrandedReport(state.filteredRows, kpis) : exportCSV(state.filteredRows);
      };
    }

    initPropertyControl();
  }

  // ============================================================
  // Fetch
  // ============================================================
  function isoForSupabase(d) { return d.toISOString(); }

  async function fetchCalls(range) {
    let q = supabaseClient.from("call_logs").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
    q = q.gte("created_at", isoForSupabase(range.start)).lte("created_at", isoForSupabase(range.end));
    const { data, error } = await q; if (error) throw error; return data || [];
  }

  async function fetchReservations(range) {
    let q = supabaseClient.from("reservations").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
    q = q.gte("created_at", isoForSupabase(range.start)).lte("created_at", isoForSupabase(range.end));
    const { data, error } = await q; if (error) throw error; return data || [];
  }

  // ============================================================
  // Normalize
  // ============================================================
  function normalizeReservation(r) {
    const when = parseISOish(r.created_at);
    return {
      kind: "booking",
      when,
      businessDate: when,
      guest: safeStr(r.guest_name),
      arrival: safeStr(r.arrival_date),
      nights: toNum(r.nights),
      ratePerNight: toNum(r.rate_per_night),
      totalDue: toNum(r.total_due),
      sentiment: "",
      duration: NaN,
      summary: safeStr(r.summary),
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  function normalizeCall(r) {
    const when = parseISOish(r.created_at);
    return {
      kind: "call",
      when,
      businessDate: when,
      guest: "",
      arrival: "",
      nights: NaN,
      ratePerNight: NaN,
      totalDue: NaN,
      sentiment: safeStr(r.sentiment),
      duration: toNum(r.duration_seconds),
      summary: safeStr(r.summary),
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  // ============================================================
  // State
  // ============================================================
  const state = { allRows: [], filteredRows: [], lastRange: null };

  // ============================================================
  // Filters
  // ============================================================
  function applyFilters() {
    const range = state.lastRange;
    const prop = getSelectedProperty();
    state.filteredRows = state.allRows.filter(r => {
      if (prop !== "__all__" && r.property_id !== prop) return false;
      if (r.when < range.start || r.when > range.end) return false;
      return true;
    });
  }

  // ============================================================
  // KPIs
  // ============================================================
  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const totalCalls = calls.length;
    const totalBookings = bookings.length;
    const conv = totalCalls ? totalBookings / totalCalls : NaN;

    const durations = calls.map(c => c.duration).filter(Number.isFinite);
    const avgDur = durations.length ? durations.reduce((a,b)=>a+b,0)/durations.length : NaN;

    const revenue = bookings.map(b => b.totalDue).filter(Number.isFinite).reduce((a,b)=>a+b,0);

    return { totalCalls, totalBookings, conv, avgDur, revenue };
  }

  // ============================================================
  // Charts
  // ============================================================
  function groupByDay(rows, kind) {
    const map = {};
    for (const r of rows) {
      if (r.kind !== kind) continue;
      const key = toYMD(r.when);
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }

  function renderChart(canvasId, data) {
    const c = $(canvasId); if (!c) return;
    const ctx = c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height);

    const keys = Object.keys(data).sort(); if (!keys.length) return;
    const vals = keys.map(k=>data[k]); const max = Math.max(...vals,1);

    const pad=20, w=c.width, h=c.height, step=(w-pad*2)/(keys.length-1||1);
    ctx.strokeStyle="#6ea8ff"; ctx.lineWidth=2; ctx.beginPath();
    keys.forEach((k,i)=>{
      const x=pad+i*step, y=h-pad-(vals[i]/max)*(h-pad*2);
      i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    });
    ctx.stroke();
  }

  // ============================================================
  // Export CSV
  // ============================================================
  function exportCSV(rows) {
    if (!rows.length) { toast("Nothing to export."); return; }

    const headers = [
      "Property ID","Type","Time","Guest","Arrival","Nights",
      "Rate / Night (USD)","Total Revenue (USD)","Sentiment","Summary"
    ];

    const lines=[headers.join(",")];

    for(const r of rows){
      const vals=[
        r.property_id||"",
        r.kind==="booking"?"Booking":"Call",
        r.when?r.when.toLocaleString():"",
        r.guest||"",
        r.arrival||"",
        Number.isFinite(r.nights)?r.nights:"",
        Number.isFinite(r.ratePerNight)?r.ratePerNight.toFixed(2):"",
        Number.isFinite(r.totalDue)?r.totalDue.toFixed(2):"",
        r.sentiment||"",
        r.summary||""
      ].map(v=>`"${String(v).replace(/"/g,'""')}"`);
      lines.push(vals.join(","));
    }

    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`NightShiftAI_Report_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // Export Branded PDF (with charts + daily summary)
  // ============================================================
  function exportBrandedReport(rows, kpis) {
    const range = state.lastRange;
    const prop = getSelectedProperty()==="__all__"?"Portfolio Summary":getSelectedProperty();

    const callsByDay = groupByDay(rows,"call");
    const bookingsByDay = groupByDay(rows,"booking");

    function chartImg(data){
      const c=document.createElement("canvas"); c.width=600; c.height=200;
      renderChartOn(c,data);
      return c.toDataURL("image/png");
    }

    function renderChartOn(c,data){
      const ctx=c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height);
      const keys=Object.keys(data).sort(); if(!keys.length) return;
      const vals=keys.map(k=>data[k]); const max=Math.max(...vals,1);
      const pad=20,w=c.width,h=c.height,step=(w-pad*2)/(keys.length-1||1);
      ctx.strokeStyle="#6ea8ff"; ctx.lineWidth=2; ctx.beginPath();
      keys.forEach((k,i)=>{
        const x=pad+i*step,y=h-pad-(vals[i]/max)*(h-pad*2);
        i?ctx.lineTo(x,y):ctx.moveTo(x,y);
      });
      ctx.stroke();
    }

    const callsImg=chartImg(callsByDay);
    const bookImg=chartImg(bookingsByDay);

    const dailyRows=Object.keys(callsByDay).sort().map(d=>{
      const c=callsByDay[d]||0,b=bookingsByDay[d]||0;
      const conv=c?((b/c)*100).toFixed(1)+"%":"—";
      return `<tr><td>${d}</td><td>${c}</td><td>${b}</td><td>${conv}</td></tr>`;
    }).join("");

    const win=window.open("","_blank");

    win.document.write(`
    <html><head><title>NightShift AI Report</title>
    <style>
      body{font-family:Inter,Arial;margin:0;color:#0b1020}
      .hdr{background:#0b1020;color:#fff;padding:24px}
      .wrap{padding:28px}
      .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin:20px 0}
      .kpi{border:1px solid #dbe6ff;border-radius:12px;padding:12px;text-align:center}
      .kpi b{display:block;font-size:20px;margin-top:6px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #e1e6f0;padding:8px}
      th{background:#f3f6ff}
    </style></head>
    <body>
      <div class="hdr">
        <b>NightShift AI — Virtual Front Desk Analytics</b><br/>
        Property: ${prop}<br/>
        Window: ${range.label}<br/>
        founder@nightshifthotels.com — nightshifthotels.com
      </div>

      <div class="wrap">
        <div class="kpis">
          <div class="kpi">Calls<b>${fmtInt(kpis.totalCalls)}</b></div>
          <div class="kpi">Bookings<b>${fmtInt(kpis.totalBookings)}</b></div>
          <div class="kpi">Conversion<b>${fmtPct(kpis.conv)}</b></div>
          <div class="kpi">Revenue<b>${fmtMoney(kpis.revenue)}</b></div>
          <div class="kpi">Avg Call<b>${Number.isFinite(kpis.avgDur)?Math.round(kpis.avgDur)+"s":"—"}</b></div>
        </div>

        <h3>Daily Summary</h3>
        <table>
          <thead><tr><th>Date</th><th>Calls</th><th>Bookings</th><th>Conversion</th></tr></thead>
          <tbody>${dailyRows}</tbody>
        </table>

        <h3>Call Volume</h3><img src="${callsImg}"/>
        <h3>Bookings</h3><img src="${bookImg}"/>
      </div>

      <script>window.onload=()=>window.print()</script>
    </body></html>
    `);

    win.document.close();
  }

  // ============================================================
  // Render
  // ============================================================
  function renderAll() {
    applyFilters();
    const kpis = computeKPIs(state.filteredRows);

    renderChart("chartCalls", groupByDay(state.filteredRows, "call"));
    renderChart("chartBookings", groupByDay(state.filteredRows, "booking"));
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    if (!(await ensureAuthGate())) return;

    state.lastRange = getSelectedRange();

    const [resvRaw, callsRaw] = await Promise.all([
      fetchReservations(state.lastRange),
      fetchCalls(state.lastRange)
    ]);

    const resv = resvRaw.map(normalizeReservation);
    const calls = callsRaw.map(normalizeCall);

    state.allRows = resv.concat(calls);
    populatePropertySelect(state.allRows);
    renderAll();
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    try { supabaseClient = getSupabaseClient(); }
    catch (e) { console.error(e); return; }

    initTheme();
    initControls();

    if (await ensureAuthGate()) loadAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
