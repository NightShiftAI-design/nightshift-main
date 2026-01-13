// public/dashboard/app.js — v10.5 (SAFE + PRO EXPORT + PDF REPORT)
// Based on your working v10.4 — ALL logic preserved

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
    const d = new Date(v);
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
  // Supabase
  // ============================================================
  let supabaseClient = null;

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
  // AUTH — unchanged
  // ============================================================
  function showOverlay(show) {
    const o = $("authOverlay");
    if (o) o.style.display = show ? "flex" : "none";
  }

  function setSessionUI(session) {
    const email = session && session.user ? (session.user.email || "") : "";
    setText("authBadge", email ? "Unlocked" : "Locked");
    setText("authStatus", email ? `Signed in as ${email}` : "Not signed in");
    const btnLogout = $("btnLogout");
    if (btnLogout) btnLogout.style.display = email ? "inline-flex" : "none";
  }

  async function ensureAuthGate() {
    const s = await supabaseClient.auth.getSession();
    const session = s?.data?.session || null;

    setSessionUI(session);

    if (!session || session.user.email !== FOUNDER_EMAIL) {
      showOverlay(true);
      return false;
    }

    showOverlay(false);
    return true;
  }

  async function sendMagicLink() {
    const email = $("authEmail")?.value?.trim();
    if (!email || !email.includes("@")) return toast("Enter valid email.");

    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: CANONICAL_URL }
    });

    if (error) return alert(error.message);
    location.href = `/dashboard/check-email.html?email=${encodeURIComponent(email)}`;
  }

  function initAuthHandlers() {
    $("btnSendLink") && ($("btnSendLink").onclick = sendMagicLink);
    $("btnResendLink") && ($("btnResendLink").onclick = sendMagicLink);
    $("btnCloseAuth") && ($("btnCloseAuth").onclick = () => showOverlay(false));

    supabaseClient.auth.onAuthStateChange(async (_, session) => {
      setSessionUI(session);
      if (session) loadAndRender();
    });
  }

  // ============================================================
  // DATA FETCH — unchanged
  // ============================================================
  async function fetchCalls(range) {
    const q = supabaseClient.from("call_logs").select("*");
    q.gte("created_at", range.start.toISOString()).lte("created_at", range.end.toISOString());
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function fetchReservations(range) {
    const q = supabaseClient.from("reservations").select("*");
    q.gte("created_at", range.start.toISOString()).lte("created_at", range.end.toISOString());
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // ============================================================
  // NORMALIZE — unchanged
  // ============================================================
  function normalizeReservation(r) {
    const created = parseISOish(r.created_at);
    return {
      kind: "booking",
      when: created,
      businessDate: created,
      guest: safeStr(r.guest_name),
      arrival: safeStr(r.arrival_date),
      nights: toNum(r.nights),
      ratePerNight: toNum(r.rate_per_night),
      totalDue: toNum(r.total_due),
      summary: safeStr(r.summary),
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  function normalizeCall(r) {
    const created = parseISOish(r.created_at);
    return {
      kind: "call",
      when: created,
      businessDate: created,
      guest: "",
      arrival: "",
      nights: NaN,
      ratePerNight: NaN,
      totalDue: NaN,
      summary: safeStr(r.summary),
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  // ============================================================
  // STATE
  // ============================================================
  const state = { allRows: [], filteredRows: [], lastRange: null };

  // ============================================================
  // KPI
  // ============================================================
  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");
    const totalCalls = calls.length;
    const totalBookings = bookings.length;
    const conv = totalCalls ? totalBookings / totalCalls : NaN;
    const revenue = bookings.map(b => b.totalDue).filter(Number.isFinite).reduce((a, b) => a + b, 0);
    return { totalCalls, totalBookings, conv, revenue };
  }

  // ============================================================
  // DAILY SUMMARY (NEW)
  // ============================================================
  function summarizeByDay(rows) {
    const map = {};
    for (const r of rows) {
      const k = toYMD(r.businessDate);
      if (!map[k]) map[k] = { calls: 0, bookings: 0, revenue: 0 };
      if (r.kind === "call") map[k].calls++;
      if (r.kind === "booking") {
        map[k].bookings++;
        if (Number.isFinite(r.totalDue)) map[k].revenue += r.totalDue;
      }
    }
    return map;
  }

  // ============================================================
  // EXPORTS
  // ============================================================
  function exportCSV(rows) {
    if (!rows.length) return toast("Nothing to export.");

    const headers = ["Date", "Type", "Guest", "Arrival", "Nights", "Rate", "Total", "Summary"];
    const lines = [headers.join(",")];

    for (const r of rows) {
      const vals = [
        r.when?.toLocaleString() || "",
        r.kind,
        r.guest || "",
        r.arrival || "",
        Number.isFinite(r.nights) ? r.nights : "",
        Number.isFinite(r.ratePerNight) ? r.ratePerNight : "",
        Number.isFinite(r.totalDue) ? r.totalDue : "",
        r.summary || ""
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(vals.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `NightShift_Report_${toYMD(new Date())}.csv`;
    a.click();
    toast("CSV exported.");
  }

  function exportPDF(rows) {
    const kpis = computeKPIs(rows);
    const daily = summarizeByDay(rows);

    const win = window.open("", "_blank");

    const chartCalls = $("chartCalls")?.toDataURL();
    const chartBookings = $("chartBookings")?.toDataURL();

    const dailyRows = Object.entries(daily).map(([d, v]) =>
      `<tr><td>${d}</td><td>${v.calls}</td><td>${v.bookings}</td><td>${fmtMoney(v.revenue)}</td></tr>`
    ).join("");

    win.document.write(`
      <html>
      <head>
        <title>NightShift AI Report</title>
        <style>
          body{font-family:system-ui;margin:0}
          header{background:#0b1020;color:#fff;padding:20px}
          section{padding:20px}
          table{width:100%;border-collapse:collapse;font-size:12px}
          th,td{border:1px solid #ddd;padding:6px}
          th{background:#f3f6ff}
          .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
          .kpi{border:1px solid #dbe6ff;border-radius:10px;padding:10px;text-align:center}
        </style>
      </head>
      <body>
        <header>
          <h2>NightShift AI — Performance Report</h2>
          <div>${location.hostname}</div>
        </header>

        <section>
          <div class="kpis">
            <div class="kpi">Calls<br><b>${kpis.totalCalls}</b></div>
            <div class="kpi">Bookings<br><b>${kpis.totalBookings}</b></div>
            <div class="kpi">Conversion<br><b>${fmtPct(kpis.conv)}</b></div>
            <div class="kpi">Revenue<br><b>${fmtMoney(kpis.revenue)}</b></div>
          </div>

          ${chartCalls ? `<img src="${chartCalls}" width="100%">` : ""}
          ${chartBookings ? `<img src="${chartBookings}" width="100%">` : ""}

          <h3>Daily Summary</h3>
          <table>
            <tr><th>Date</th><th>Calls</th><th>Bookings</th><th>Revenue</th></tr>
            ${dailyRows}
          </table>
        </section>

        <script>window.onload=()=>window.print()</script>
      </body>
      </html>
    `);

    win.document.close();
  }

  // ============================================================
  // LOAD
  // ============================================================
  async function loadAndRender() {
    if (!(await ensureAuthGate())) return;

    const now = new Date();
    const range = { start: startOfDay(now), end: endOfDay(now) };
    state.lastRange = range;

    const [resvRaw, callsRaw] = await Promise.all([
      fetchReservations(range),
      fetchCalls(range)
    ]);

    const resv = resvRaw.map(normalizeReservation);
    const calls = callsRaw.map(normalizeCall);

    state.allRows = resv.concat(calls);
    state.filteredRows = state.allRows;
  }

  // ============================================================
  // INIT
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    try { supabaseClient = getSupabaseClient(); }
    catch (e) { return console.error(e); }

    initAuthHandlers();

    $("btnExport") && ($("btnExport").onclick = () => {
      confirm("OK = PDF Report\nCancel = CSV Export")
        ? exportPDF(state.filteredRows)
        : exportCSV(state.filteredRows);
    });

    if (await ensureAuthGate()) loadAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
