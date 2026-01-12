// public/dashboard/app.js — v9.5
// FIX: Populate Arrivals/Departures/Stayovers from reservations (arrival_date + nights)
// Keeps: auth, fetching, KPIs, charts, export, search, logout, property switcher intact.

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

  const HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS = true; // kept
  const DEDUPE_DUPLICATE_BOOKINGS = true;                   // kept

  const THEME_STORAGE_KEY = "nsa_theme";      // "light" | "dark" | "system"
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
      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
      return isNaN(d.getTime()) ? null : d;
    }

    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      const [, yyyy, mm, dd] = ymd;
      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const addDays = (d, days) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  };

  const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

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

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function toast(msg) {
    const el = $("toast"); if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
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
    const v = sel?.value || getStoredProperty();
    return v || "__all__";
  }
  function shortUuid(u) {
    const s = safeStr(u);
    if (!s || s === "__all__") return "All properties";
    return s.length > 8 ? `${s.slice(0, 8)}…` : s;
  }

  function populatePropertySelect(rows) {
    const sel = $("propertySelect");
    if (!sel) return;

    const currentStored = getStoredProperty();
    const prev = sel.value || currentStored || "__all__";

    const set = new Set();
    for (const r of rows) {
      const pid = r?.property_id;
      if (pid && pid !== "__all__") set.add(String(pid));
    }
    const ids = Array.from(set).sort();

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

    sel.value = (prev === "__all__") ? "__all__" : (ids.includes(prev) ? prev : "__all__");
    storeProperty(sel.value);
  }

  function initPropertyControl() {
    const sel = $("propertySelect");
    if (!sel) return;

    sel.value = getStoredProperty() || "__all__";

    sel.addEventListener("change", () => {
      storeProperty(sel.value || "__all__");
      renderAll();
      toast(sel.value === "__all__" ? "Showing all properties." : `Filtered: ${shortUuid(sel.value)}`);
    });
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

  function updateThemeButtonUI(theme, resolved) {
    const btn = $("btnTheme") || $("themeToggle") || $("btnToggleTheme");
    if (!btn) return;
    const label = resolved === "dark" ? "Dark" : "Light";
    const hint = theme === "system" ? " (System)" : "";
    if (!btn.dataset.preserveText) btn.textContent = `${label}${hint}`;
  }

  function applyTheme(theme) {
    const resolved = resolveTheme(theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    updateThemeButtonUI(theme, resolved);
  }

  function initTheme() {
    const initial = getStoredTheme();
    applyTheme(initial);

    const btn = $("btnTheme") || $("themeToggle") || $("btnToggleTheme");
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
  // Auth UI
  // ============================================================
  function showOverlay(show) {
    const o = $("authOverlay"); if (!o) return;
    o.style.display = show ? "flex" : "none";
  }

  function setSessionUI(session) {
    const email = session?.user?.email || "";
    setText("authBadge", email ? "Unlocked" : "Locked");
    const btnAuth = $("btnAuth");
    if (btnAuth) btnAuth.textContent = email ? "Account" : "Login";
    const btnLogout = $("btnLogout");
    if (btnLogout) btnLogout.style.display = email ? "inline-flex" : "none";
    setText("authStatus", email ? `Signed in as ${email}` : "Not signed in");
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

      location.href = `/dashboard/check-email.html?email=${encodeURIComponent(email)}`;
    } finally {
      if (btnSend) { btnSend.disabled = false; btnSend.textContent = prevSendText; }
      if (btnResend) { btnResend.disabled = false; btnResend.textContent = prevResendText; }
    }
  }

  function initAuthHandlers() {
    $("btnAuth") && ($("btnAuth").onclick = () => showOverlay(true));
    $("btnCloseAuth") && ($("btnCloseAuth").onclick = () => showOverlay(false));
    $("btnSendLink") && ($("btnSendLink").onclick = sendMagicLink);
    $("btnResendLink") && ($("btnResendLink").onclick = sendMagicLink);

    $("btnLogout") && ($("btnLogout").onclick = async () => {
      toast("Signing out…");
      await hardSignOut();
      location.href = "/";
    });

    supabaseClient.auth.onAuthStateChange(async (_, session) => {
      setSessionUI(session);
      if (session) loadAndRender();
    });
  }

  // ============================================================
  // Controls
  // ============================================================
  function initControls() {
    $("rangeSelect") && ($("rangeSelect").onchange = () => loadAndRender());
    $("startDate") && ($("startDate").onchange = () => loadAndRender());
    $("endDate") && ($("endDate").onchange = () => loadAndRender());
    $("btnRefresh") && ($("btnRefresh").onclick = () => loadAndRender());
    $("btnExport") && ($("btnExport").onclick = () => exportCSV(filteredRows));

    $("searchInput") && ($("searchInput").oninput = () => { applyFilters(); renderAll(); });

    initPropertyControl();

    // Scroll “View all reservations” to the latest table card if present
    document.querySelectorAll('a[aria-label="View all reservations"]').forEach(a => {
      a.addEventListener("click", () => {
        const target = $("latestTableWrap") || $("feedTbody") || $("stateBox");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function getSelectedRange() {
    const mode = $("rangeSelect")?.value || "7";
    const now = new Date();

    if (mode === "today") return { label: "Today", start: startOfDay(now), end: endOfDay(now) };

    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = new Date(now);
      s.setDate(now.getDate() - (days - 1));
      return { label: `Last ${days} days`, start: startOfDay(s), end: endOfDay(now) };
    }

    const sVal = $("startDate")?.value || "";
    const eVal = $("endDate")?.value || "";
    if (mode === "custom" && sVal && eVal) {
      return { label: `${sVal} → ${eVal}`, start: startOfDay(new Date(sVal)), end: endOfDay(new Date(eVal)) };
    }

    const s = new Date(now);
    s.setDate(now.getDate() - 6);
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
    const arrivalDate = parseISOish(r.arrival_date);         // IMPORTANT
    const nights = toNum(r.nights);
    const checkoutDate = (arrivalDate && Number.isFinite(nights))
      ? addDays(arrivalDate, Math.max(0, Math.floor(nights)))
      : null;

    return {
      kind: "booking",
      when: parseISOish(r.created_at), // activity time
      guest: safeStr(r.guest_name),
      arrival: safeStr(r.arrival_date),
      arrivalDate,                    // for arrivals/departures/stayovers
      checkoutDate,                   // arrival + nights
      nights,
      totalDue: toNum(r.total_due),
      sentiment: "",
      summary: safeStr(r.summary) || `Reservation for ${safeStr(r.guest_name)} • Arrive ${safeStr(r.arrival_date)}`,
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  function normalizeCall(r) {
    const booking = safeJsonParse(r.booking);
    return {
      kind: "call",
      when: parseISOish(r.created_at),
      guest: safeStr(booking?.guest_name || ""),
      arrival: safeStr(booking?.arrival_date || ""),
      nights: null,
      totalDue: null,
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
  let allRows = [];
  let filteredRows = [];
  let lastRange = null;

  // ============================================================
  // Filters (activity feed / KPIs / charts)
  // ============================================================
  function applyFilters() {
    const range = lastRange || getSelectedRange();
    const q = ($("searchInput")?.value || "").toLowerCase().trim();
    const selectedProperty = getSelectedProperty();

    filteredRows = allRows.filter(r => {
      if (selectedProperty !== "__all__") {
        if (safeStr(r.property_id) !== safeStr(selectedProperty)) return false;
      }

      // Activity range filter:
      // Calls: created_at; Bookings: created_at (keep original behavior for KPIs/feed)
      if (r.when) {
        if (r.when < range.start || r.when > range.end) return false;
      }

      if (!q) return true;
      return JSON.stringify(r).toLowerCase().includes(q);
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

    const negative = calls.filter(c => safeStr(c.sentiment).toLowerCase().includes("neg")).length;
    const longCalls = calls.filter(c => Number.isFinite(c.duration) && c.duration >= 240).length;

    return { totalCalls, totalBookings, conv, avgDur, revenue, negative, longCalls };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid");
    if (!el) return;
    el.innerHTML = "";

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
      d.innerHTML = `<p class="name">${escHtml(t)}</p><p class="value">${escHtml(v)}</p>`;
      el.appendChild(d);
    }
  }

  function renderOps(k) {
    const el = $("opsInsights");
    if (!el) return;
    el.innerHTML = `
      Neg sentiment: ${escHtml(fmtInt(k.negative))}<br>
      Long calls (4m+): ${escHtml(fmtInt(k.longCalls))}<br>
      Conversion: ${escHtml(fmtPct(k.conv))}<br>
      Revenue: ${escHtml(fmtMoney(k.revenue))}
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
    const c = $(canvasId);
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);

    const keys = Object.keys(data).sort();
    if (!keys.length) return;

    const vals = keys.map(k => data[k]);
    const max = Math.max(...vals, 1);

    const w = c.width, h = c.height;
    const pad = 20;
    const step = (w - pad * 2) / (keys.length - 1 || 1);

    ctx.strokeStyle = "#6ea8ff";
    ctx.beginPath();
    keys.forEach((k, i) => {
      const x = pad + i * step;
      const y = h - pad - (vals[i] / max) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // ============================================================
  // Activity Feed (Latest reservations table)
  // ============================================================
  function renderFeed(rows) {
    setText("badgeCount", fmtInt(rows.length));
    setText("feedMeta", `${rows.length} items`);

    const tbody = $("feedTbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    for (const r of rows.slice(0, 500)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.when ? escHtml(r.when.toLocaleString()) : "—"}</td>
        <td>${escHtml(r.kind || "—")}</td>
        <td>${escHtml(r.guest || "—")}</td>
        <td>${escHtml(r.arrival || "—")}</td>
        <td>${Number.isFinite(r.nights) ? escHtml(String(r.nights)) : "—"}</td>
        <td>${Number.isFinite(r.totalDue) ? escHtml(fmtMoney(r.totalDue)) : "—"}</td>
        <td>${escHtml(r.sentiment || "—")}</td>
        <td class="col-summary"><div class="summaryClamp">${escHtml(r.summary || "—")}</div></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function exportCSV(rows) {
    if (!rows.length) { toast("Nothing to export."); return; }

    const cols = ["property_id","kind","time","guest","arrival","nights","total","sentiment","summary"];
    const lines = [cols.join(",")];

    for (const r of rows) {
      const vals = [
        r.property_id || "",
        r.kind || "",
        r.when ? r.when.toISOString() : "",
        r.guest || "",
        r.arrival || "",
        Number.isFinite(r.nights) ? r.nights : "",
        Number.isFinite(r.totalDue) ? r.totalDue : "",
        r.sentiment || "",
        r.summary || ""
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`);
      lines.push(vals.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nightshift_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV exported.");
  }

  // ============================================================
  // ✅ Reservations “Today” (Arrivals/Departures/Stayovers)
  // ============================================================
  function getSelectedDayForReservations() {
    // We treat the “Today” widget as the end-date of the selected range.
    // If range is custom, it shows the end date.
    // If range is today, it shows today.
    const range = lastRange || getSelectedRange();
    return startOfDay(range.end);
  }

  function bookingSegmentsForDay(bookings, dayStart) {
    const dayEnd = endOfDay(dayStart);

    const arrivals = [];
    const departures = [];
    const stayovers = [];

    for (const b of bookings) {
      if (!b.arrivalDate) continue;
      const arr = startOfDay(b.arrivalDate);
      const dep = b.checkoutDate ? startOfDay(b.checkoutDate) : null; // checkout day (not night)

      // Arrivals: arrival date == selected day
      if (arr.getTime() === dayStart.getTime()) arrivals.push(b);

      // Departures: checkout day == selected day
      if (dep && dep.getTime() === dayStart.getTime()) departures.push(b);

      // Stayovers: in-house during the night before checkout
      // A simple definition: arrived before day, and checkout after day
      if (dep && arr.getTime() < dayStart.getTime() && dep.getTime() > dayStart.getTime()) {
        stayovers.push(b);
      }
    }

    return { arrivals, departures, stayovers, dayStart, dayEnd };
  }

  function ensureReservationsListContainer() {
    // Creates a list container inside the big Reservations card without editing HTML.
    let host = $("reservationsListHost");
    if (host) return host;

    const empty = $("reservationsEmpty");
    if (!empty) return null;

    host = document.createElement("div");
    host.id = "reservationsListHost";
    host.style.marginTop = "12px";
    empty.insertAdjacentElement("afterend", host);
    return host;
  }

  function renderReservationsToday(allBookings) {
    const host = ensureReservationsListContainer();
    if (!host) return;

    const day = getSelectedDayForReservations();
    const seg = bookingSegmentsForDay(allBookings, day);

    // counts
    const setBadge = (id, n) => {
      const el = $(id);
      if (!el) return;
      el.textContent = String(n);
      el.classList.toggle("zero", !n);
    };

    setBadge("countArrivals", seg.arrivals.length);
    setBadge("countDepartures", seg.departures.length);
    setBadge("countStayovers", seg.stayovers.length);
    setBadge("countRequests", 0); // placeholder until you build requests data source

    // label
    const tl = $("todayLabel");
    if (tl) tl.textContent = day.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });

    const any = seg.arrivals.length + seg.departures.length + seg.stayovers.length > 0;
    const empty = $("reservationsEmpty");
    if (empty) empty.style.display = any ? "none" : "";

    // Determine active tab to display
    const isActive = (id) => $(id)?.classList.contains("active");
    const activeKind =
      isActive("tabDepartures") ? "departures" :
      isActive("tabStayovers") ? "stayovers" :
      isActive("tabRequests") ? "requests" :
      "arrivals";

    const list = (activeKind === "departures") ? seg.departures
      : (activeKind === "stayovers") ? seg.stayovers
      : (activeKind === "requests") ? []
      : seg.arrivals;

    if (!any) {
      host.innerHTML = "";
      return;
    }

    if (activeKind === "requests") {
      host.innerHTML = `
        <div class="emptyState">
          <div style="max-width:520px;">
            <div class="icon"><i class="fa-regular fa-bell"></i></div>
            <h4>Guest requests not connected yet</h4>
            <p>When you add a “requests/messages” table, we’ll populate this tab.</p>
          </div>
        </div>
      `;
      return;
    }

    // Compact table
    host.innerHTML = `
      <div class="tableWrap" style="min-width:0;">
        <table style="min-width:760px;">
          <thead>
            <tr>
              <th style="width:240px;">Guest</th>
              <th style="width:120px;">Arrival</th>
              <th style="width:120px;">Nights</th>
              <th style="width:140px;">Total</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(b => {
              const notes = safeStr(b.raw?.notes || b.raw?.summary || "");
              return `
                <tr>
                  <td>${escHtml(b.guest || "—")}</td>
                  <td>${escHtml(b.arrival || "—")}</td>
                  <td>${Number.isFinite(b.nights) ? escHtml(String(b.nights)) : "—"}</td>
                  <td>${Number.isFinite(b.totalDue) ? escHtml(fmtMoney(b.totalDue)) : "—"}</td>
                  <td class="col-summary"><div class="summaryClamp">${escHtml(notes || "—")}</div></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // ============================================================
  // Render All
  // ============================================================
  function renderAll() {
    applyFilters();

    // KPIs/charts/feed use filteredRows (activity time)
    const k = computeKPIs(filteredRows);
    renderKPIs(k);
    renderOps(k);
    renderChart("chartCalls", groupByDay(filteredRows, "call"));
    renderChart("chartBookings", groupByDay(filteredRows, "booking"));
    renderFeed(filteredRows);

    // ✅ Reservations Today view should come from ALL BOOKINGS (still property-filtered, but not "created_at filtered")
    const selectedProperty = getSelectedProperty();
    const allBookings = allRows
      .filter(r => r.kind === "booking")
      .filter(r => selectedProperty === "__all__" ? true : safeStr(r.property_id) === safeStr(selectedProperty));

    renderReservationsToday(allBookings);

    setText("lastUpdated", `Updated ${new Date().toLocaleString()}`);
    $("latestWindowBadgeReminder") && ($("latestWindowBadgeReminder").textContent = lastRange?.label || "—");
  }

  function clearDataUI(msg) {
    setText("stateBox", msg || "—");
  }

  // ============================================================
  // Load
  // ============================================================
  let _loading = false;

  async function loadAndRender() {
    if (_loading) return;
    _loading = true;

    try {
      if (!(await ensureAuthGate())) return;

      lastRange = getSelectedRange();
      setText("badgeWindow", lastRange.label);

      const [resv, calls] = await Promise.all([
        fetchTable("reservations"),
        fetchTable("call_logs")
      ]);

      allRows = [
        ...resv.map(normalizeReservation),
        ...calls.map(normalizeCall)
      ];

      populatePropertySelect(allRows);

      renderAll();
      toast("Dashboard refreshed.");
    } catch (e) {
      console.error(e);
      clearDataUI("Load error.");
    } finally {
      _loading = false;
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
