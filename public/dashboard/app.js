// public/dashboard/app.js  — v9.3 (ADD: property switcher + property_id filtering)
// NOTE: Auth, fetching, KPIs, charts, export, search, logout remain intact.
// Adds: property dropdown populated from data + filter applied across KPIs/charts/feed/export.

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

  const HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS = true; // (kept; not yet used here)
  const DEDUPE_DUPLICATE_BOOKINGS = true;                   // (kept; not yet used here)

  // Theme
  const THEME_STORAGE_KEY = "nsa_theme"; // "light" | "dark" | "system"

  // ✅ Property filter (uuid)
  const PROPERTY_STORAGE_KEY = "nsa_property"; // "__all__" or uuid string

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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  function escHtml(str) {
    return safeStr(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeJsonParse(v) {
    if (!v) return null;
    if (typeof v === "object") return v;
    try { return JSON.parse(v); } catch { return null; }
  }

  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[^0-9.\-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function toast(msg) {
    const el = $("toast"); if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ============================================================
  // ✅ Property switcher helpers
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
    const v = sel?.value || getStoredProperty();
    return v || "__all__";
  }

  function shortUuid(u) {
    const s = safeStr(u);
    if (!s || s === "__all__") return "All properties";
    // show: first 8 chars (safe, looks like Booking extranet internal ids)
    return s.length > 8 ? `${s.slice(0, 8)}…` : s;
  }

  function setPropertyBadgeUI() {
    // optional: if you want to reflect selection somewhere else later
    // right now, keep it minimal and non-breaking
  }

  function populatePropertySelect(rows) {
    const sel = $("propertySelect");
    if (!sel) return;

    const current = getStoredProperty();

    // Gather uuids (from normalized rows)
    const set = new Set();
    for (const r of rows) {
      const pid = r?.property_id;
      if (pid && pid !== "__all__") set.add(String(pid));
    }

    const ids = Array.from(set).sort();

    // Keep existing selection if possible
    const prev = sel.value || current || "__all__";

    // Rebuild options
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

    // Restore selection (fallback to __all__)
    sel.value = ids.includes(prev) ? prev : (prev === "__all__" ? "__all__" : "__all__");
    storeProperty(sel.value);
  }

  function initPropertyControl() {
    const sel = $("propertySelect");
    if (!sel) return;

    // hydrate from storage early (options will be populated after data loads)
    sel.value = getStoredProperty() || "__all__";

    sel.addEventListener("change", () => {
      storeProperty(sel.value || "__all__");
      // No re-fetch needed; just re-filter + re-render
      renderAll();
      toast(sel.value === "__all__" ? "Showing all properties." : `Filtered: ${shortUuid(sel.value)}`);
    });
  }

  // ============================================================
  // Theme (dark/light/system) — restored safely
  // ============================================================
  function systemPrefersDark() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || "system";
    } catch {
      return "system";
    }
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
    updateThemeButtonUI(theme, resolved);
  }

  function updateThemeButtonUI(theme, resolved) {
    const btn = $("btnTheme") || $("themeToggle") || $("btnToggleTheme");
    if (!btn) return;

    const label = resolved === "dark" ? "Dark" : "Light";
    const hint = theme === "system" ? " (System)" : "";
    if (!btn.dataset.preserveText) {
      btn.textContent = `${label}${hint}`;
    }
    btn.setAttribute("aria-pressed", resolved === "dark" ? "true" : "false");
    btn.title = "Toggle theme";
  }

  function cycleTheme(current) {
    const resolved = resolveTheme(current);
    return resolved === "dark" ? "light" : "dark";
  }

  function initTheme() {
    const initial = getStoredTheme();
    applyTheme(initial);

    const btn = $("btnTheme") || $("themeToggle") || $("btnToggleTheme");
    if (btn) {
      btn.onclick = () => {
        const now = getStoredTheme();
        const next = cycleTheme(now);
        storeTheme(next);
        applyTheme(next);
      };
    }

    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        const t = getStoredTheme();
        if (t === "system") applyTheme("system");
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else mq.addListener(onChange);
    } catch {}
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
  // Auth UI (UNCHANGED)
  // ============================================================
  function showOverlay(show) {
    const o = $("authOverlay"); if (!o) return;
    o.style.display = show ? "flex" : "none";
  }

  function setSessionUI(session) {
    const email = session?.user?.email || "";
    $("authBadge").textContent = email ? "Unlocked" : "Locked";
    $("btnAuth").textContent = email ? "Account" : "Login";
    $("btnLogout").style.display = email ? "inline-flex" : "none";
    $("authStatus").textContent = email ? `Signed in as ${email}` : "Not signed in";
  }

  async function hardSignOut() {
    try { await supabaseClient.auth.signOut(); } catch {}
    clearSupabaseAuthStorage();
  }

  async function ensureAuthGate() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    setSessionUI(session);

    if (!session) {
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");
      return false;
    }

    if (session.user.email !== FOUNDER_EMAIL) {
      showOverlay(true);
      clearDataUI("Unauthorized email.");
      await hardSignOut();
      return false;
    }

    showOverlay(false);
    return true;
  }

  function initAuthHandlers() {
    $("btnAuth").onclick = () => showOverlay(true);
    $("btnCloseAuth").onclick = () => showOverlay(false);
    $("btnSendLink").onclick = sendMagicLink;
    $("btnResendLink").onclick = sendMagicLink;

    $("btnLogout").onclick = async () => {
      toast("Signing out…");
      await hardSignOut();
      location.href = "/";
    };

    supabaseClient.auth.onAuthStateChange(async (_, session) => {
      setSessionUI(session);
      if (session) loadAndRender();
    });
  }

  async function sendMagicLink() {
    const emailEl = $("authEmail");
    const btnSend = $("btnSendLink");
    const btnResend = $("btnResendLink");

    const email = (emailEl?.value || "").trim();
    if (!email.includes("@")) {
      toast("Enter a valid email.");
      return;
    }

    const prevSendText = btnSend?.textContent || "Send magic link";
    const prevResendText = btnResend?.textContent || "Resend";
    if (btnSend) { btnSend.disabled = true; btnSend.textContent = "Sending…"; }
    if (btnResend) { btnResend.disabled = true; btnResend.textContent = "Sending…"; }

    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: CANONICAL_URL }
      });

      if (error) {
        alert(error.message);
        return;
      }

      const target = `/dashboard/check-email.html?email=${encodeURIComponent(email)}`;
      location.href = target;
    } finally {
      if (btnSend) { btnSend.disabled = false; btnSend.textContent = prevSendText; }
      if (btnResend) { btnResend.disabled = false; btnResend.textContent = prevResendText; }
    }
  }

  // ============================================================
  // Controls
  // ============================================================
  function initControls() {
    $("rangeSelect").onchange = () => loadAndRender();
    $("startDate").onchange = () => loadAndRender();
    $("endDate").onchange = () => loadAndRender();
    $("btnRefresh").onclick = () => loadAndRender();
    $("btnExport").onclick = () => exportCSV(filteredRows);

    $("searchInput").oninput = () => { applyFilters(); renderAll(); };

    // ✅ NEW
    initPropertyControl();
  }

  function getSelectedRange() {
    const mode = $("rangeSelect").value;
    const now = new Date();

    if (mode === "today") return { label: "Today", start: startOfDay(now), end: endOfDay(now) };
    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = new Date(now); s.setDate(now.getDate() - (days - 1));
      return { label: `Last ${days} days`, start: startOfDay(s), end: endOfDay(now) };
    }

    const sVal = $("startDate").value;
    const eVal = $("endDate").value;
    if (sVal && eVal) {
      return {
        label: `${sVal} → ${eVal}`,
        start: startOfDay(new Date(sVal)),
        end: endOfDay(new Date(eVal))
      };
    }

    const s = new Date(now); s.setDate(now.getDate() - 6);
    return { label: "Last 7 days", start: startOfDay(s), end: endOfDay(now) };
  }

  // ============================================================
  // Fetch + Normalize
  // ============================================================
  async function fetchTable(table) {
    const { data, error } = await supabaseClient
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) throw error;
    return data || [];
  }

  function normalizeReservation(r) {
    return {
      kind: "booking",
      when: parseISOish(r.created_at),
      guest: safeStr(r.guest_name),
      arrival: safeStr(r.arrival_date),
      nights: toNum(r.nights),
      totalDue: toNum(r.total_due),
      sentiment: "",
      summary: `Reservation for ${r.guest_name} • Arrive ${r.arrival_date}`,
      // ✅ NEW: bring property_id up to top-level (uuid)
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  function normalizeCall(r) {
    const booking = safeJsonParse(r.booking);
    return {
      kind: "call",
      when: parseISOish(r.created_at),
      guest: booking?.guest_name || "",
      arrival: booking?.arrival_date || "",
      nights: null,
      totalDue: null,
      sentiment: safeStr(r.sentiment),
      duration: toNum(r.duration_seconds),
      summary: safeStr(r.summary),
      // ✅ NEW: bring property_id up to top-level (uuid)
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  // ============================================================
  // State
  // ============================================================
  let allRows = [];
  let filteredRows = [];
  let lastRange = null;

  // ============================================================
  // Filters (✅ now includes property filter)
  // ============================================================
  function applyFilters() {
    const range = lastRange;
    const q = $("searchInput").value.toLowerCase().trim();
    const selectedProperty = getSelectedProperty(); // "__all__" or uuid

    filteredRows = allRows.filter(r => {
      // property filter
      if (selectedProperty !== "__all__") {
        if (safeStr(r.property_id) !== safeStr(selectedProperty)) return false;
      }

      // time filter
      if (r.when) {
        if (r.when < range.start || r.when > range.end) return false;
      }

      // search filter
      if (!q) return true;
      const hay = JSON.stringify(r).toLowerCase();
      return hay.includes(q);
    });
  }

  // ============================================================
  // KPIs + Ops
  // ============================================================
  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const totalCalls = calls.length;
    const totalBookings = bookings.length;
    const conv = totalCalls ? totalBookings / totalCalls : NaN;

    const durations = calls.map(c => c.duration).filter(Number.isFinite);
    const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : NaN;

    const revenue = bookings.map(b => b.totalDue).filter(Number.isFinite).reduce((a, b) => a + b, 0);

    const negative = calls.filter(c => c.sentiment.toLowerCase().includes("neg")).length;
    const longCalls = calls.filter(c => c.duration >= 240).length;

    return { totalCalls, totalBookings, conv, avgDur, revenue, negative, longCalls };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid"); el.innerHTML = "";
    const tiles = [
      ["Total calls", fmtInt(k.totalCalls)],
      ["Bookings", fmtInt(k.totalBookings)],
      ["Conversion", fmtPct(k.conv)],
      ["Revenue", fmtMoney(k.revenue)],
      ["Avg call", Number.isFinite(k.avgDur) ? `${Math.round(k.avgDur)}s` : "—"]
    ];
    for (const [t, v] of tiles) {
      const d = document.createElement("div");
      d.className = "kpi";
      d.innerHTML = `<p class="name">${t}</p><p class="value">${v}</p>`;
      el.appendChild(d);
    }
  }

  function renderOps(k) {
    $("opsInsights").innerHTML = `
      Neg sentiment: ${fmtInt(k.negative)}<br>
      Long calls (4m+): ${fmtInt(k.longCalls)}<br>
      Conversion: ${fmtPct(k.conv)}<br>
      Revenue: ${fmtMoney(k.revenue)}
    `;
  }

  // ============================================================
  // Charts
  // ============================================================
  function groupByDay(rows, kind) {
    const map = {};
    for (const r of rows) {
      if (r.kind !== kind || !r.when) continue;
      const d = toYMD(r.when);
      map[d] = (map[d] || 0) + 1;
    }
    return map;
  }

  function renderChart(canvasId, data) {
    const c = $(canvasId); if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);

    const keys = Object.keys(data).sort();
    if (!keys.length) return;

    const vals = keys.map(k => data[k]);
    const max = Math.max(...vals);

    const w = c.width, h = c.height;
    const pad = 20;
    const step = (w - pad * 2) / (keys.length - 1 || 1);

    ctx.strokeStyle = "#6ea8ff";
    ctx.beginPath();

    keys.forEach((k, i) => {
      const x = pad + i * step;
      const y = h - pad - (vals[i] / max) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });

    ctx.stroke();
  }

  // ============================================================
  // Activity Feed
  // ============================================================
  function renderFeed(rows) {
    $("badgeCount").textContent = fmtInt(rows.length);
    $("feedMeta").textContent = `${rows.length} items`;

    const tbody = $("feedTbody");
    if (tbody) {
      tbody.innerHTML = "";

      for (const r of rows.slice(0, 500)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.when ? r.when.toLocaleString() : "—"}</td>
          <td>${escHtml(r.kind || "—")}</td>
          <td>${escHtml(r.guest || "—")}</td>
          <td>${escHtml(r.arrival || "—")}</td>
          <td>${Number.isFinite(r.nights) ? r.nights : "—"}</td>
          <td>${Number.isFinite(r.totalDue) ? fmtMoney(r.totalDue) : "—"}</td>
          <td>${escHtml(r.sentiment || "—")}</td>
          <td class="col-summary"><div class="summaryClamp">${escHtml(r.summary || "—")}</div></td>
        `;
        tbody.appendChild(tr);
      }
      return;
    }
  }

  function exportCSV(rows) {
    if (!rows.length) { toast("Nothing to export."); return; }

    // ✅ include property_id in export
    const cols = ["property_id","kind","time","guest","arrival","nights","total","sentiment","summary"];
    const lines = [cols.join(",")];

    for (const r of rows) {
      const vals = [
        r.property_id || "",
        r.kind,
        r.when ? r.when.toISOString() : "",
        r.guest, r.arrival,
        r.nights, r.totalDue,
        r.sentiment, r.summary
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`);
      lines.push(vals.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `nightshift_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast("CSV exported.");
  }

  // ============================================================
  // Render All
  // ============================================================
  function renderAll() {
    applyFilters();
    const k = computeKPIs(filteredRows);
    renderKPIs(k);
    renderOps(k);

    renderChart("chartCalls", groupByDay(filteredRows, "call"));
    renderChart("chartBookings", groupByDay(filteredRows, "booking"));

    renderFeed(filteredRows);
    $("lastUpdated").textContent = `Updated ${new Date().toLocaleString()}`;
  }

  function clearDataUI(msg) {
    $("stateBox").textContent = msg || "—";
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    if (!(await ensureAuthGate())) return;

    try {
      lastRange = getSelectedRange();
      $("badgeWindow").textContent = lastRange.label;

      const [resv, calls] = await Promise.all([
        fetchTable("reservations"),
        fetchTable("call_logs")
      ]);

      allRows = [
        ...resv.map(normalizeReservation),
        ...calls.map(normalizeCall)
      ];

      // ✅ NEW: populate property dropdown from fetched data
      populatePropertySelect(allRows);

      renderAll();
      toast("Dashboard refreshed.");
    } catch (e) {
      console.error(e);
      clearDataUI("Load error.");
    }
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    try { supabaseClient = getSupabaseClient(); }
    catch (e) { clearDataUI(e.message); return; }

    initTheme();
    initAuthHandlers();
    initControls();

    if (ALWAYS_REQUIRE_LOGIN) {
      clearSupabaseAuthStorage();
      showOverlay(true);
      return;
    }

    if (await ensureAuthGate()) loadAndRender();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadAndRender();
    });

    window.addEventListener("pageshow", (e) => {
      if (e.persisted) loadAndRender();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
