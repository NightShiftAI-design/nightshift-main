// public/dashboard/app.js — v10.0 (FULL REWRITE, SAFE + BOOKING-LIKE UI)
// Goals:
// - Keep every existing ID contract used by index.html (kpiGrid, feedTbody, feedEmpty, feedTableWrap, stateBox, toast, authOverlay, etc.)
// - Auth handlers ALWAYS attach (magic link, overlay controls, logout)
// - Canonical URL enforcement preserved
// - Theme + property switcher preserved
// - Robust date parsing + range handling (today / 7 / 30 / custom)
// - Dedupe visual duplicates
// - KPIs as bubbles (works with your CSS)
// - Feed renders with tr.dataset.event for filter script
// - Charts render if canvases exist
// - Updates “lastUpdated”/mirrors if present

(() => {
  // ============================================================
  // Settings
  // ============================================================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

  const CANONICAL_ORIGIN = "https://www.nightshifthotels.com";
  const CANONICAL_PATH = "/dashboard/";
  const CANONICAL_URL = `${CANONICAL_ORIGIN}${CANONICAL_PATH}`;

  // If true: user must click "Login" and sign in every time
  const ALWAYS_REQUIRE_LOGIN = false;

  // If true: Supabase will persist session in localStorage
  const PERSIST_SESSION = true;

  // Storage keys
  const THEME_STORAGE_KEY = "nsa_theme";        // "light" | "dark" | "system"
  const PROPERTY_STORAGE_KEY = "nsa_property";  // "__all__" | "<uuid>"

  // Data limits
  const FETCH_LIMIT = 3000;
  const FEED_MAX_ROWS = 500;

  // ============================================================
  // DOM Helpers
  // ============================================================
  const $ = (id) => document.getElementById(id);

  const setText = (id, text) => {
    const el = $(id);
    if (el) el.textContent = (text === null || text === undefined) ? "" : String(text);
  };

  const showEl = (id, show) => {
    const el = $(id);
    if (el) el.style.display = show ? "" : "none";
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
    const s = String(v).replace(/[^0-9.\-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function safeJsonParse(v) {
    if (!v) return null;
    if (typeof v === "object") return v;
    try { return JSON.parse(v); } catch { return null; }
  }

  // Accepts:
  // - dd-mm-yyyy
  // - yyyy-mm-dd
  // - timestamps / ISO-ish
  function parseISOish(v) {
    if (!v) return null;
    const s = String(v).trim();

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

    // "2026-01-09 09:28:03.721+00:00" or +00
    if (/^\d{4}-\d{2}-\d{2}\s/.test(s) && (s.includes("+00") || s.includes("+00:00"))) {
      const iso = s
        .replace(" ", "T")
        .replace("+00:00", "Z")
        .replace("+00", "Z");
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
  // Crash visibility (surface errors in stateBox)
  // ============================================================
  window.addEventListener("error", (e) => {
    try {
      if ($("stateBox")) $("stateBox").textContent = `JS error: ${e.message || e.error || "Unknown error"}`;
    } catch {}
  });

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
    } catch {
      return false;
    }
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
    if (btn) {
      const label = resolved === "dark" ? "Dark" : "Light";
      const hint = theme === "system" ? " (System)" : "";
      btn.textContent = `${label}${hint}`;
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
    if (!s || s === "__all__") return "All properties";
    return s.length > 8 ? `${s.slice(0, 8)}…` : s;
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
      auth: {
        persistSession: PERSIST_SESSION,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  // ============================================================
  // Auth UI
  // ============================================================
  function showOverlay(show) {
    const o = $("authOverlay");
    if (!o) return;
    o.style.display = show ? "flex" : "none";
  }

  function setSessionUI(session) {
    const email = session && session.user ? (session.user.email || "") : "";

    setText("authBadge", email ? "Unlocked" : "Locked");
    setText("authStatus", email ? `Signed in as ${email}` : "Not signed in");

    const btnAuth = $("btnAuth");
    if (btnAuth) btnAuth.textContent = email ? "Account" : "Login";

    const btnLogout = $("btnLogout");
    if (btnLogout) btnLogout.style.display = email ? "inline-flex" : "none";
  }

  async function hardSignOut() {
    try { await supabaseClient.auth.signOut(); } catch {}
    clearSupabaseAuthStorage();
  }

  function clearDataUI(msg) {
    setText("stateBox", msg || "—");
    // leave feedEmpty visible, feedTableWrap hidden
    setFeedVisibility(false);
    setText("badgeCount", "0");
    setText("feedMeta", "0 items");
  }

  async function ensureAuthGate() {
    const s = await supabaseClient.auth.getSession();
    const session = s && s.data && s.data.session ? s.data.session : null;

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

    const email = (emailEl && emailEl.value ? emailEl.value : "").trim();
    if (!email.includes("@")) { toast("Enter a valid email."); return; }

    const prevSendText = btnSend ? btnSend.textContent : "Send magic link";
    const prevResendText = btnResend ? btnResend.textContent : "Resend";

    if (btnSend) { btnSend.disabled = true; btnSend.textContent = "Sending…"; }
    if (btnResend) { btnResend.disabled = true; btnResend.textContent = "Sending…"; }

    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: CANONICAL_URL }
      });

      if (error) { alert(error.message); return; }

      // redirect to your check-email page
      location.href = `/dashboard/check-email.html?email=${encodeURIComponent(email)}`;
    } finally {
      if (btnSend) { btnSend.disabled = false; btnSend.textContent = prevSendText; }
      if (btnResend) { btnResend.disabled = false; btnResend.textContent = prevResendText; }
    }
  }

  function initAuthHandlers() {
    const btnAuth = $("btnAuth");
    const btnClose = $("btnCloseAuth");
    const btnSend = $("btnSendLink");
    const btnResend = $("btnResendLink");
    const btnLogout = $("btnLogout");

    if (btnAuth) btnAuth.onclick = () => showOverlay(true);
    if (btnClose) btnClose.onclick = () => showOverlay(false);
    if (btnSend) btnSend.onclick = sendMagicLink;
    if (btnResend) btnResend.onclick = sendMagicLink;

    if (btnLogout) {
      btnLogout.onclick = async () => {
        toast("Signing out…");
        await hardSignOut();
        location.href = "/";
      };
    }

    // keep UI synced
    supabaseClient.auth.onAuthStateChange(async (_, session) => {
      setSessionUI(session);
      if (session) loadAndRender();
    });
  }

  // ============================================================
  // Range / Controls
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

    // custom
    enableCustomDates(true);
    const sVal = $("startDate") ? $("startDate").value : "";
    const eVal = $("endDate") ? $("endDate").value : "";

    if (sVal && eVal) {
      const sd = startOfDay(new Date(sVal));
      const ed = endOfDay(new Date(eVal));
      return { label: `${sVal} → ${eVal}`, start: sd, end: ed, mode: "custom" };
    }

    // fallback
    const s = new Date(now);
    s.setDate(now.getDate() - 6);
    return { label: "Last 7 days", start: startOfDay(s), end: endOfDay(now), mode: "7" };
  }

  function initControls() {
    const rangeSelect = $("rangeSelect");
    const startDate = $("startDate");
    const endDate = $("endDate");

    if (rangeSelect) rangeSelect.onchange = () => loadAndRender();
    if (startDate) startDate.onchange = () => loadAndRender();
    if (endDate) endDate.onchange = () => loadAndRender();

    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.onclick = () => loadAndRender();

    const btnExport = $("btnExport");
    if (btnExport) btnExport.onclick = () => exportCSV(state.filteredRows);

    const searchInput = $("searchInput");
    if (searchInput) {
      searchInput.oninput = () => {
        applyFilters();
        renderAll();
      };
    }

    initPropertyControl();
  }

  // ============================================================
  // Fetch + Normalize
  // ============================================================
  async function fetchTable(table) {
    const { data, error } = await supabaseClient
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);

    if (error) throw error;
    return data || [];
  }

  function normalizeReservation(r) {
    const arrival = safeStr(r.arrival_date);
    const arrivalDate = parseISOish(arrival);
    const nights = toNum(r.nights);

    return {
      kind: "booking",
      when: parseISOish(r.created_at),
      businessDate: arrivalDate,
      guest: safeStr(r.guest_name),
      arrival,
      nights,
      totalDue: toNum(r.total_due),
      sentiment: "",
      duration: NaN,
      summary: safeStr(r.summary) || `Reservation for ${safeStr(r.guest_name)} • Arrive ${arrival}`,
      property_id: safeStr(r.property_id),
      raw: r
    };
  }

  function normalizeCall(r) {
    const booking = safeJsonParse(r.booking);
    return {
      kind: "call",
      when: parseISOish(r.created_at),
      businessDate: parseISOish(r.created_at),
      guest: safeStr((booking && booking.guest_name) || r.guest_name || ""),
      arrival: safeStr(booking && booking.arrival_date),
      nights: toNum(booking && booking.nights),
      totalDue: toNum(booking && booking.total_due),
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
  const state = {
    allRows: [],
    filteredRows: [],
    lastRange: null
  };

  // ============================================================
  // Dedupe (visual duplicates)
  // ============================================================
  function dedupeRows(rows) {
    const seen = new Set();
    const out = [];

    for (const r of rows) {
      const raw = r.raw || {};
      const booking = safeJsonParse(raw.booking);

      const fp = [
        r.kind,
        safeStr(r.property_id),
        booking?.event || "",
        booking?.guest_name || r.guest || "",
        booking?.arrival_date || r.arrival || "",
        booking?.room_type || "",
        booking?.total_due || "",
        r.when ? r.when.toISOString().slice(0, 19) : ""
      ].join("|");

      if (seen.has(fp)) continue;
      seen.add(fp);
      out.push(r);
    }

    return out;
  }

  // ============================================================
  // Filters
  // ============================================================
  function applyFilters() {
    const range = state.lastRange || getSelectedRange();
    const selectedProperty = getSelectedProperty();

    const q = (safeStr($("searchInput") && $("searchInput").value)).toLowerCase().trim();

    state.filteredRows = state.allRows.filter(r => {
      if (selectedProperty !== "__all__" && safeStr(r.property_id) !== safeStr(selectedProperty)) {
        return false;
      }

      const d = r.businessDate || r.when;
      if (d) {
        if (d < range.start || d > range.end) return false;
      }

      if (!q) return true;
      const hay = JSON.stringify(r).toLowerCase();
      return hay.includes(q);
    });

    // remove dupes after filtering (so property/range/search behaves correctly)
    state.filteredRows = dedupeRows(state.filteredRows);
  }

  // ============================================================
  // KPIs (Bubbles)
  // ============================================================
  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const totalCalls = calls.length;
    const totalBookings = bookings.length;
    const conv = totalCalls ? totalBookings / totalCalls : NaN;

    const durations = calls.map(c => c.duration).filter(Number.isFinite);
    const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : NaN;

    const revenue = bookings
      .map(b => b.totalDue)
      .filter(Number.isFinite)
      .reduce((a, b) => a + b, 0);

    return { totalCalls, totalBookings, conv, avgDur, revenue };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid");
    if (!el) return;

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
  // Charts (only if canvases exist)
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
    const c = $(canvasId);
    if (!c) return;

    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);

    const keys = Object.keys(data).sort();
    if (!keys.length) return;

    const vals = keys.map(k => data[k]);
    const max = Math.max.apply(null, vals) || 1;

    const w = c.width;
    const h = c.height;
    const pad = 20;
    const step = (w - pad * 2) / (keys.length - 1 || 1);

    ctx.strokeStyle = "#6ea8ff";
    ctx.lineWidth = 2;
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
  // Feed visibility (match index.html IDs)
  // ============================================================
  function setFeedVisibility(hasRows) {
    const empty = $("feedEmpty");
    const wrap = $("feedTableWrap");
    if (empty) empty.style.display = hasRows ? "none" : "";
    if (wrap) wrap.style.display = hasRows ? "" : "none";
  }

  function classifyEvent(r) {
    const sum = (r.summary || "").toLowerCase();
    if (sum.includes("escalat") || sum.includes("urgent") || sum.includes("911")) return "escalation";
    return r.kind === "booking" ? "booking" : "call";
  }

  function renderFeed(rows) {
    setText("badgeCount", fmtInt(rows.length));
    setText("feedMeta", `${rows.length} items`);

    const tbody = $("feedTbody");
    if (!tbody) { setFeedVisibility(false); return; }

    tbody.innerHTML = "";

    const sorted = rows.slice().sort((a, b) => {
      const ad = (a.kind === "booking" ? (a.businessDate || a.when) : (a.when || a.businessDate));
      const bd = (b.kind === "booking" ? (b.businessDate || b.when) : (b.when || b.businessDate));
      return (bd && bd.getTime ? bd.getTime() : 0) - (ad && ad.getTime ? ad.getTime() : 0);
    });

    for (const r of sorted.slice(0, FEED_MAX_ROWS)) {
      const ev = classifyEvent(r);

      const tr = document.createElement("tr");
      tr.dataset.event = ev; // ✅ used by index.html filter script

      // NOTE: Your current index.html table columns are:
      // Time | Type | Guest/Caller | Arrival | N | Rate | Total | Sentiment | Summary
      // But your current normalized objects don't include rate_per_night yet.
      // So we render Rate as "—" for now to keep alignment.
      const rateCell = "—";

      tr.innerHTML = `
        <td>${r.when ? escHtml(r.when.toLocaleString()) : "—"}</td>
        <td>${escHtml(ev)}</td>
        <td>${escHtml(r.guest || "—")}</td>
        <td>${escHtml(r.arrival || "—")}</td>
        <td>${Number.isFinite(r.nights) ? escHtml(r.nights) : "—"}</td>
        <td>${escHtml(rateCell)}</td>
        <td>${Number.isFinite(r.totalDue) ? escHtml(fmtMoney(r.totalDue)) : "—"}</td>
        <td>${escHtml(r.sentiment || "—")}</td>
        <td>${escHtml(r.summary || "—")}</td>
      `;
      tbody.appendChild(tr);
    }

    setFeedVisibility(tbody.children.length > 0);
  }

  // ============================================================
  // Export
  // ============================================================
  function exportCSV(rows) {
    if (!rows.length) { toast("Nothing to export."); return; }

    const cols = ["property_id", "kind", "time", "business_date", "guest", "arrival", "nights", "rate", "total", "sentiment", "summary"];
    const lines = [cols.join(",")];

    for (const r of rows) {
      const vals = [
        r.property_id || "",
        r.kind,
        r.when ? r.when.toISOString() : "",
        r.businessDate ? r.businessDate.toISOString() : "",
        r.guest || "",
        r.arrival || "",
        Number.isFinite(r.nights) ? r.nights : "",
        "", // rate placeholder (when you add rate_per_night later, plug it here)
        Number.isFinite(r.totalDue) ? r.totalDue : "",
        r.sentiment || "",
        r.summary || ""
      ].map(v => `"${String(v === null || v === undefined ? "" : v).replace(/"/g, '""')}"`);

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
  // Render All
  // ============================================================
  function updateWindowBadges() {
    const label = state.lastRange ? state.lastRange.label : "—";
    setText("badgeWindow", label);

    // Optional (present in your new index.html)
    setText("badgeWindowInline", `Window: ${label}`);
    setText("badgeWindowMirror", label);
  }

  function updateLastUpdated() {
    const t = new Date().toLocaleString();
    setText("lastUpdated", `Updated ${t}`);
  }

  function renderAll() {
    applyFilters();

    const kpis = computeKPIs(state.filteredRows);
    renderKPIs(kpis);

    renderChart("chartCalls", groupByDay(state.filteredRows, "call"));
    renderChart("chartBookings", groupByDay(state.filteredRows, "booking"));

    renderFeed(state.filteredRows);

    updateWindowBadges();
    updateLastUpdated();
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    if (!(await ensureAuthGate())) return;

    try {
      state.lastRange = getSelectedRange();
      updateWindowBadges();

      const [resv, calls] = await Promise.all([
        fetchTable("reservations"),
        fetchTable("call_logs")
      ]);

      state.allRows = []
        .concat((resv || []).map(normalizeReservation))
        .concat((calls || []).map(normalizeCall));

      populatePropertySelect(state.allRows);

      // Clear old message on successful load
      setText("stateBox", "");

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

    // supabase client
    try { supabaseClient = getSupabaseClient(); }
    catch (e) { clearDataUI(e.message); return; }

    initTheme();
    initAuthHandlers();     // ✅ attach handlers before any early returns
    initControls();

    if (ALWAYS_REQUIRE_LOGIN) {
      clearSupabaseAuthStorage();
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");
      return;
    }

    // auto-load if already logged in
    if (await ensureAuthGate()) loadAndRender();

    // refresh when tab becomes visible again
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadAndRender();
    });

    // refresh when BFCache restores the page
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) loadAndRender();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
