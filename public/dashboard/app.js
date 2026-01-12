// public/dashboard/app.js — v9.6
// FIX: bookings filtered by arrival_date (not created_at)
// ADD: real Arrivals/Departures/Stay-overs counts + "View all reservations" toggle
// NOTE: Auth overlay unchanged. Fetching/KPIs/charts/export/search/logout kept intact.

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

  // Theme
  const THEME_STORAGE_KEY = "nsa_theme"; // "light" | "dark" | "system"
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

  // ✅ Fix JS date parsing for Supabase "YYYY-MM-DD HH:MM:SS+00"
  function parseISOish(v) {
    if (!v) return null;
    const s = String(v).trim();

    // dd-mm-yyyy
    const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    }

    // yyyy-mm-dd
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(`${s}T00:00:00`);

    // ✅ Supabase timestamp with space -> convert to ISO
    // "2026-01-11 21:30:30.809526+00" -> "2026-01-11T21:30:30.809526Z"
    if (/^\d{4}-\d{2}-\d{2}\s/.test(s) && (s.includes("+00") || s.includes("+00:00"))) {
      const iso = s
        .replace(" ", "T")
        .replace("+00:00", "Z")
        .replace("+00", "Z");
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

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

    const current = getStoredProperty();
    const set = new Set();
    for (const r of rows) {
      const pid = r?.property_id;
      if (pid && pid !== "__all__") set.add(String(pid));
    }
    const ids = Array.from(set).sort();
    const prev = sel.value || current || "__all__";

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
    try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }
    catch { return false; }
  }
  function getStoredTheme() {
    try { return localStorage.getItem(THEME_STORAGE_KEY) || "system"; }
    catch { return "system"; }
  }
  function storeTheme(v) { try { localStorage.setItem(THEME_STORAGE_KEY, v); } catch {} }
  function resolveTheme(theme) {
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    return systemPrefersDark() ? "dark" : "light";
  }
  function applyTheme(theme) {
    const resolved = resolveTheme(theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    const btn = $("btnTheme");
    if (btn) {
      const label = resolved === "dark" ? "Dark" : "Light";
      const hint = theme === "system" ? " (System)" : "";
      btn.textContent = `${label}${hint}`;
      btn.setAttribute("aria-pressed", resolved === "dark" ? "true" : "false");
    }
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
    if ($("authBadge")) $("authBadge").textContent = email ? "Unlocked" : "Locked";
    if ($("btnAuth")) $("btnAuth").textContent = email ? "Account" : "Login";
    if ($("btnLogout")) $("btnLogout").style.display = email ? "inline-flex" : "none";
    if ($("authStatus")) $("authStatus").textContent = email ? `Signed in as ${email}` : "Not signed in";
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
    if ($("btnAuth")) $("btnAuth").onclick = () => showOverlay(true);
    if ($("btnCloseAuth")) $("btnCloseAuth").onclick = () => showOverlay(false);
    if ($("btnSendLink")) $("btnSendLink").onclick = sendMagicLink;
    if ($("btnResendLink")) $("btnResendLink").onclick = sendMagicLink;

    if ($("btnLogout")) $("btnLogout").onclick = async () => {
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
    if (!email.includes("@")) { toast("Enter a valid email."); return; }

    const prevSendText = btnSend?.textContent || "Send magic link";
    const prevResendText = btnResend?.textContent || "Resend";
    if (btnSend) { btnSend.disabled = true; btnSend.textContent = "Sending…"; }
    if (btnResend) { btnResend.disabled = true; btnResend.textContent = "Sending…"; }

    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: CANONICAL_URL }
      });

      if (error) { alert(error.message); return; }

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
    if ($("rangeSelect")) $("rangeSelect").onchange = () => loadAndRender();
    if ($("startDate")) $("startDate").onchange = () => loadAndRender();
    if ($("endDate")) $("endDate").onchange = () => loadAndRender();
    if ($("btnRefresh")) $("btnRefresh").onclick = () => loadAndRender();
    if ($("btnExport")) $("btnExport").onclick = () => exportCSV(filteredRows);

    if ($("searchInput")) $("searchInput").oninput = () => { applyFilters(); renderAll(); };

    initPropertyControl();
    initReservationsUI(); // ✅ NEW
  }

  function getSelectedRange() {
    const mode = $("rangeSelect")?.value || "7";
    const now = new Date();

    if (mode === "today") return { label: "Today", start: startOfDay(now), end: endOfDay(now), mode };
    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = new Date(now); s.setDate(now.getDate() - (days - 1));
      return { label: `Last ${days} days`, start: startOfDay(s), end: endOfDay(now), mode };
    }

    const sVal = $("startDate")?.value;
    const eVal = $("endDate")?.value;
    if (sVal && eVal) {
      return { label: `${sVal} → ${eVal}`, start: startOfDay(new Date(sVal)), end: endOfDay(new Date(eVal)), mode:"custom" };
    }

    const s = new Date(now); s.setDate(now.getDate() - 6);
    return { label: "Last 7 days", start: startOfDay(s), end: endOfDay(now), mode:"7" };
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

  // ✅ Booking "business date" = arrival_date (what matters for arrivals/departures)
  function normalizeReservation(r) {
    const arrival = safeStr(r.arrival_date);
    const arrivalDate = parseISOish(arrival); // from yyyy-mm-dd
    const nights = toNum(r.nights);

    return {
      kind: "booking",
      when: parseISOish(r.created_at),         // created time (for table display)
      businessDate: arrivalDate,              // ✅ arrival-based filtering/segments
      guest: safeStr(r.guest_name),
      arrival: arrival,
      nights,
      totalDue: toNum(r.total_due),
      sentiment: "",
      summary: `Reservation for ${safeStr(r.guest_name)} • Arrive ${arrival}`,
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  function normalizeCall(r) {
    const booking = safeJsonParse(r.booking);
    return {
      kind: "call",
      when: parseISOish(r.created_at),
      businessDate: parseISOish(r.created_at), // calls filter by created_at
      guest: booking?.guest_name || "",
      arrival: booking?.arrival_date || "",
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
  // Filters (now bookings filter by arrival_date)
  // ============================================================
  function applyFilters() {
    const range = lastRange;
    const q = ($("searchInput")?.value || "").toLowerCase().trim();
    const selectedProperty = getSelectedProperty();

    filteredRows = allRows.filter(r => {
      // property
      if (selectedProperty !== "__all__") {
        if (safeStr(r.property_id) !== safeStr(selectedProperty)) return false;
      }

      // date
      const d = r.businessDate || r.when;
      if (d) {
        if (d < range.start || d > range.end) return false;
      }

      // search
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

    const negative = calls.filter(c => (c.sentiment || "").toLowerCase().includes("neg")).length;
    const longCalls = calls.filter(c => c.duration >= 240).length;

    return { totalCalls, totalBookings, conv, avgDur, revenue, negative, longCalls };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid"); if (!el) return;
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
      d.innerHTML = `<p class="name">${t}</p><p class="value">${v}</p>`;
      el.appendChild(d);
    }
  }

  function renderOps(k) {
    const el = $("opsInsights"); if (!el) return;
    el.innerHTML = `
      Neg sentiment: ${fmtInt(k.negative)}<br>
      Long calls (4m+): ${fmtInt(k.longCalls)}<br>
      Conversion: ${fmtPct(k.conv)}<br>
      Revenue: ${fmtMoney(k.revenue)}
    `;
  }

  // ============================================================
  // Charts (unchanged)
  // ============================================================
  function groupByDay(rows, kind) {
    const map = {};
    for (const r of rows) {
      if (r.kind !== kind) continue;
      const d = (r.businessDate || r.when);
      if (!d) continue;
      const key = toYMD(d);
      map[key] = (map[key] || 0) + 1;
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
  // Feed table (latest reservations / activity)
  // ============================================================
  function renderFeed(rows) {
    if ($("badgeCount")) $("badgeCount").textContent = fmtInt(rows.length);
    if ($("feedMeta")) $("feedMeta").textContent = `${rows.length} items`;

    const tbody = $("feedTbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    // ✅ Show bookings first by ARRIVAL date (so “all reservations” is meaningful)
    const sorted = [...rows].sort((a, b) => {
      const ad = (a.kind === "booking" ? (a.businessDate || a.when) : (a.when || a.businessDate));
      const bd = (b.kind === "booking" ? (b.businessDate || b.when) : (b.when || b.businessDate));
      return (bd?.getTime?.() || 0) - (ad?.getTime?.() || 0);
    });

    for (const r of sorted.slice(0, 500)) {
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
  }

  function exportCSV(rows) {
    if (!rows.length) { toast("Nothing to export."); return; }
    const cols = ["property_id","kind","time","business_date","guest","arrival","nights","total","sentiment","summary"];
    const lines = [cols.join(",")];

    for (const r of rows) {
      const vals = [
        r.property_id || "",
        r.kind,
        r.when ? r.when.toISOString() : "",
        r.businessDate ? r.businessDate.toISOString() : "",
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
  // ✅ Reservations segments (Arrivals / Departures / Stay-overs)
  // ============================================================
  let segmentMode = "arrivals"; // arrivals | departures | stayovers | requests
  let showAllBookings = false;

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function getCheckoutDate(arrivalDate, nights) {
    if (!arrivalDate || !Number.isFinite(nights)) return null;
    // checkout = arrival + nights (hotel convention)
    return addDays(arrivalDate, Math.max(0, Math.round(nights)));
  }

  function sameYMD(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function computeSegments(bookings, targetDay) {
    const dayStart = startOfDay(targetDay);
    const dayEnd = endOfDay(targetDay);

    let arrivals = 0, departures = 0, stayovers = 0;

    for (const b of bookings) {
      const arr = b.businessDate; // arrival_date parsed
      const nights = b.nights;
      const chk = getCheckoutDate(arr, nights);

      if (arr && sameYMD(arr, dayStart)) arrivals++;

      if (chk && sameYMD(chk, dayStart)) departures++;

      if (arr && chk) {
        // stayover if: arrived before today AND checkout after today
        if (arr < dayStart && chk > dayEnd) stayovers++;
      }
    }

    return { arrivals, departures, stayovers };
  }

  function setCount(id, n) {
    const el = $(id);
    if (!el) return;
    el.textContent = String(n);
    el.classList.toggle("zero", !n);
  }

  function setActiveTab(id) {
    const ids = ["tabArrivals","tabDepartures","tabStayovers","tabRequests"];
    ids.forEach(x => $(x)?.classList.remove("active"));
    $(id)?.classList.add("active");
  }

  function initReservationsUI() {
    const a = $("tabArrivals");
    const d = $("tabDepartures");
    const s = $("tabStayovers");
    const r = $("tabRequests");

    a?.addEventListener("click", () => { segmentMode = "arrivals"; setActiveTab("tabArrivals"); renderReservationsPanel(); });
    d?.addEventListener("click", () => { segmentMode = "departures"; setActiveTab("tabDepartures"); renderReservationsPanel(); });
    s?.addEventListener("click", () => { segmentMode = "stayovers"; setActiveTab("tabStayovers"); renderReservationsPanel(); });
    r?.addEventListener("click", () => { segmentMode = "requests"; setActiveTab("tabRequests"); renderReservationsPanel(); });

    // Hook "View all reservations"
    const btnViewAll = document.querySelector('[aria-label="View all reservations"]');
    btnViewAll?.addEventListener("click", () => {
      showAllBookings = !showAllBookings;
      toast(showAllBookings ? "Showing all reservations (arrival-based)." : "Showing latest activity.");
      renderAll();
    });
  }

  function renderReservationsPanel() {
    const todayLabel = $("todayLabel");
    const empty = $("reservationsEmpty");

    // pick “target day” from range selector:
    // - Today: actual today
    // - Other ranges: use range.end (most recent day)
    const target = (lastRange?.mode === "today") ? new Date() : (lastRange?.end || new Date());
    const targetDay = startOfDay(target);

    if (todayLabel) {
      todayLabel.textContent = targetDay.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric", year:"numeric" });
    }

    const bookings = filteredRows.filter(r => r.kind === "booking");
    const seg = computeSegments(bookings, targetDay);

    setCount("countArrivals", seg.arrivals);
    setCount("countDepartures", seg.departures);
    setCount("countStayovers", seg.stayovers);

    // requests is not implemented yet (needs messages table), keep 0
    setCount("countRequests", 0);

    const any = (seg.arrivals + seg.departures + seg.stayovers) > 0;
    if (empty) empty.style.display = any ? "none" : "";
  }

  // ============================================================
  // Render All
  // ============================================================
  function renderAll() {
    applyFilters();

    // If user clicked "View all reservations": show only bookings (arrival-based)
    const rowsForTable = showAllBookings
      ? filteredRows.filter(r => r.kind === "booking")
      : filteredRows;

    const k = computeKPIs(filteredRows);
    renderKPIs(k);
    renderOps(k);

    renderChart("chartCalls", groupByDay(filteredRows, "call"));
    renderChart("chartBookings", groupByDay(filteredRows, "booking"));

    renderFeed(rowsForTable);
    renderReservationsPanel();

    if ($("lastUpdated")) $("lastUpdated").textContent = `Updated ${new Date().toLocaleString()}`;
  }

  function clearDataUI(msg) {
    if ($("stateBox")) $("stateBox").textContent = msg || "—";
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    if (!(await ensureAuthGate())) return;

    try {
      lastRange = getSelectedRange();
      if ($("badgeWindow")) $("badgeWindow").textContent = lastRange.label;

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
