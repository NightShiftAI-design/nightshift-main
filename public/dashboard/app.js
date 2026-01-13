// public/dashboard/app.js — v10.5 (BRANDED EXPORT + PROPERTY + DATE WINDOW + ELITE POLISH + SAFE)

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

  const KPI_INCLUDE_CALLLOG_BOOKINGS = false;
  const KPI_REVENUE_INCLUDE_CALLLOG_BOOKINGS = false;

  const BOOKING_EVENTS = new Set([
    "reservation_confirmed",
    "booking_confirmed",
    "reservation_created"
  ]);

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

    if (/^\d{4}-\d{2}-\d{2}\s/.test(s) && (s.includes("+00") || s.includes("+00:00"))) {
      const iso = s.replace(" ", "T").replace("+00:00", "Z").replace("+00", "Z");
      const d = new Date(iso);
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
    const v = sel ? sel.value : getStoredProperty();
    return v || "__all__";
  }

  function shortUuid(u) {
    const s = safeStr(u);
    if (!s || s === "__all__") return "Portfolio Summary";
    return s.length > 10 ? `${s.slice(0, 10)}…` : s;
  }

  function populatePropertySelect(rows) {
    const sel = $("propertySelect");
    if (!sel) return;

    const saved = getStoredProperty();
    const idsSet = new Set();

    for (const r of rows) {
      const pid = r && r.property_id;
      if (pid && pid !== "__all__") idsSet.add(String(pid));
    }

    const ids = Array.from(idsSet).sort();
    const prev = sel.value || saved || "__all__";

    sel.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "__all__";
    optAll.textContent = "Portfolio Summary";
    sel.appendChild(optAll);

    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = shortUuid(id);
      sel.appendChild(opt);
    }

    sel.value = ids.includes(prev) ? prev : "__all__";
    storeProperty(sel.value);
  }

  function initPropertyControl() {
    const sel = $("propertySelect");
    if (!sel) return;
    sel.value = getStoredProperty() || "__all__";
    sel.addEventListener("change", () => {
      storeProperty(sel.value || "__all__");
      renderAll();
      toast(sel.value === "__all__" ? "Showing portfolio." : `Property: ${shortUuid(sel.value)}`);
    });
  }

  // ============================================================
  // Supabase
  // ============================================================
  let supabaseClient = null;

  function clearSupabaseAuthStorage() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) localStorage.removeItem(k);
      }
    } catch {}
  }

  function getSupabaseClient() {
    const cfg = window.NSA_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      throw new Error("Missing Supabase config.");
    }
    return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: PERSIST_SESSION, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  // ============================================================
  // Range
  // ============================================================
  function enableCustomDates(enable) {
    const s = $("startDate");
    const e = $("endDate");
    if (s) s.disabled = !enable;
    if (e) e.disabled = !enable;
  }

  function getSelectedRange() {
    const mode = $("rangeSelect") ? $("rangeSelect").value : "7";
    const now = new Date();

    if (mode === "today") {
      enableCustomDates(false);
      return { label: "Today", start: startOfDay(now), end: endOfDay(now), mode };
    }

    if (mode === "7" || mode === "30") {
      enableCustomDates(false);
      const days = Number(mode);
      const s = new Date(now);
      s.setDate(now.getDate() - (days - 1));
      return { label: `Last ${days} days`, start: startOfDay(s), end: endOfDay(now), mode };
    }

    enableCustomDates(true);
    const sVal = $("startDate")?.value;
    const eVal = $("endDate")?.value;

    if (sVal && eVal) {
      const sd = startOfDay(new Date(sVal));
      const ed = endOfDay(new Date(eVal));
      return { label: `${sVal} → ${eVal}`, start: sd, end: ed, mode: "custom" };
    }

    const s = new Date(now);
    s.setDate(now.getDate() - 6);
    return { label: "Last 7 days", start: startOfDay(s), end: endOfDay(now), mode: "7" };
  }

  // ============================================================
  // Export
  // ============================================================
  function exportCSV(rows) {
    if (!rows.length) { toast("Nothing to export."); return; }

    const headers = [
      "Property ID","Type","Time","Arrival","Guest","Nights",
      "Rate per Night (USD)","Total Revenue (USD)","Sentiment","Summary"
    ];

    const lines = [headers.join(",")];

    for (const r of rows) {
      const vals = [
        r.property_id || "",
        r.kind === "booking" ? "Booking" : "Call",
        r.when ? r.when.toLocaleString() : "",
        r.arrival || "",
        r.guest || "",
        Number.isFinite(r.nights) ? r.nights : "",
        Number.isFinite(r.ratePerNight) ? r.ratePerNight.toFixed(2) : "",
        Number.isFinite(r.totalDue) ? r.totalDue.toFixed(2) : "",
        r.sentiment || "",
        r.summary || ""
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);

      lines.push(vals.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `NightShiftAI_Report_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();

    URL.revokeObjectURL(url);
    toast("CSV exported.");
  }

  function exportBrandedReport(rows, kpis) {
    const win = window.open("", "_blank");
    const range = state.lastRange;
    const prop = shortUuid(getSelectedProperty());

    const styles = `
      body{font-family:Inter,system-ui,Arial;margin:0;background:#fff;color:#0b1020}
      .hdr{background:#0b1020;color:#fff;padding:24px}
      .hdrGrid{display:flex;justify-content:space-between;gap:20px}
      .brand{font-weight:700;font-size:20px}
      .meta{font-size:12px;opacity:.85}
      .wrap{padding:28px}
      .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin:20px 0}
      .kpi{border:1px solid #dbe6ff;border-radius:12px;padding:12px;text-align:center}
      .kpi b{display:block;font-size:20px;margin-top:6px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #e1e6f0;padding:8px}
      th{background:#f3f6ff;text-align:left}
      .foot{margin-top:30px;font-size:11px;color:#666}
    `;

    const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.when ? r.when.toLocaleString() : ""}</td>
        <td>${r.kind === "booking" ? "Booking" : "Call"}</td>
        <td>${r.guest || ""}</td>
        <td>${r.arrival || ""}</td>
        <td>${Number.isFinite(r.nights) ? r.nights : ""}</td>
        <td>${Number.isFinite(r.ratePerNight) ? fmtMoney(r.ratePerNight) : ""}</td>
        <td>${Number.isFinite(r.totalDue) ? fmtMoney(r.totalDue) : ""}</td>
        <td>${r.summary || ""}</td>
      </tr>
    `).join("");

    win.document.write(`
      <html>
      <head><title>NightShift AI — Performance Report</title><style>${styles}</style></head>
      <body>
        <div class="hdr">
          <div class="hdrGrid">
            <div>
              <div class="brand">NightShift AI — Virtual Front Desk Analytics</div>
              <div class="meta">Property: ${escHtml(prop)}</div>
              <div class="meta">Window: ${escHtml(range.label)} (${toYMD(range.start)} – ${toYMD(range.end)})</div>
            </div>
            <div class="meta" style="text-align:right">
              Generated: ${new Date().toLocaleString()}<br/>
              founder@nightshifthotels.com<br/>
              https://www.nightshifthotels.com
            </div>
          </div>
        </div>

        <div class="wrap">
          <div class="kpis">
            <div class="kpi">Calls<b>${fmtInt(kpis.totalCalls)}</b></div>
            <div class="kpi">Bookings<b>${fmtInt(kpis.totalBookings)}</b></div>
            <div class="kpi">Conversion<b>${fmtPct(kpis.conv)}</b></div>
            <div class="kpi">Revenue<b>${fmtMoney(kpis.revenue)}</b></div>
            <div class="kpi">Avg Call<b>${Number.isFinite(kpis.avgDur) ? Math.round(kpis.avgDur) + "s" : "—"}</b></div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Time</th><th>Type</th><th>Guest</th><th>Arrival</th>
                <th>Nights</th><th>Rate</th><th>Total</th><th>Summary</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div class="foot">
            Confidential — Generated by NightShift AI
          </div>
        </div>

        <script>window.onload=()=>window.print()</script>
      </body>
      </html>
    `);

    win.document.close();
  }

  // ============================================================
  // KPIs + Render
  // ============================================================
  const state = { allRows: [], filteredRows: [], lastRange: null };

  function applyFilters() {
    const range = state.lastRange || getSelectedRange();
    const selectedProperty = getSelectedProperty();
    const q = (safeStr($("searchInput")?.value)).toLowerCase().trim();

    state.filteredRows = state.allRows.filter(r => {
      if (selectedProperty !== "__all__" && safeStr(r.property_id) !== safeStr(selectedProperty)) return false;
      const d = r.businessDate || r.when;
      if (d && (d < range.start || d > range.end)) return false;
      if (!q) return true;
      return [r.kind,r.property_id,r.guest,r.arrival,r.summary].map(x=>safeStr(x).toLowerCase()).join("|").includes(q);
    });
  }

  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const totalCalls = calls.length;
    const totalBookings = bookings.length;
    const conv = totalCalls ? (totalBookings / totalCalls) : NaN;

    const durations = calls.map(c => c.duration).filter(Number.isFinite);
    const avgDur = durations.length ? durations.reduce((a,b)=>a+b,0)/durations.length : NaN;

    const revenue = bookings.map(b=>b.totalDue).filter(Number.isFinite).reduce((a,b)=>a+b,0);

    return { totalCalls, totalBookings, conv, avgDur, revenue };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid"); if (!el) return;
    el.innerHTML = "";

    const tiles = [
      { label: "Total calls", value: fmtInt(k.totalCalls), icon: "fa-phone-volume" },
      { label: "Bookings", value: fmtInt(k.totalBookings), icon: "fa-calendar-check" },
      { label: "Conversion", value: fmtPct(k.conv), icon: "fa-arrow-trend-up" },
      { label: "Revenue", value: fmtMoney(k.revenue), icon: "fa-dollar-sign" },
      { label: "Avg call", value: Number.isFinite(k.avgDur) ? `${Math.round(k.avgDur)}s` : "—", icon: "fa-clock" }
    ];

    for (const t of tiles) {
      const d = document.createElement("div");
      d.className = "kpi";
      d.innerHTML = `
        <div class="kpiTop">
          <div class="kpiIcon"><i class="fa-solid ${t.icon}"></i></div>
          <p class="name">${escHtml(t.label)}</p>
        </div>
        <p class="value">${escHtml(t.value)}</p>
      `;
      el.appendChild(d);
    }
  }

  // ============================================================
  // Init Controls
  // ============================================================
  function initControls() {
    $("rangeSelect") && ($("rangeSelect").onchange = () => loadAndRender());
    $("startDate") && ($("startDate").onchange = () => loadAndRender());
    $("endDate") && ($("endDate").onchange = () => loadAndRender());
    $("btnRefresh") && ($("btnRefresh").onclick = () => loadAndRender());

    const btnExport = $("btnExport");
    if (btnExport) {
      btnExport.onclick = () => {
        const kpis = computeKPIs(state.filteredRows);
        const ok = confirm("OK = Branded PDF report\nCancel = CSV export");
        ok ? exportBrandedReport(state.filteredRows, kpis) : exportCSV(state.filteredRows);
      };
    }

    $("searchInput") && ($("searchInput").oninput = () => { applyFilters(); renderAll(); });
    initPropertyControl();
  }

  // ============================================================
  // Render All
  // ============================================================
  function renderAll() {
    applyFilters();
    const kpis = computeKPIs(state.filteredRows);
    renderKPIs(kpis);
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;
    initTheme();
    initControls();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
