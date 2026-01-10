// public/dashboard/app.js — v10 (rebased on working v9)
// Fixes: Activity Feed stuck "Loading…", Ops dots, chart rendering guards + resize safety
(() => {
  // ============================================================
  // Settings
  // ============================================================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

  // Canonical dashboard URL (fixes /dashboard vs /dashboard/ vs index.html + www)
  const CANONICAL_ORIGIN = "https://www.nightshifthotels.com";
  const CANONICAL_PATH = "/dashboard/";
  const CANONICAL_URL = `${CANONICAL_ORIGIN}${CANONICAL_PATH}`;

  // Persist sessions so refresh works
  const ALWAYS_REQUIRE_LOGIN = false;
  const PERSIST_SESSION = true;

  // Dedupe
  const HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS = true;
  const DEDUPE_DUPLICATE_BOOKINGS = true;

  // Fetch behavior
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

  // Treat YYYY-MM-DD as local date (prevents -1 day issues)
  const parseISOish = (v) => {
    if (!v) return null;
    const s = String(v).trim();

    // DD-MM-YYYY
    const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
      return isNaN(d.getTime()) ? null : d;
    }

    // YYYY-MM-DD
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      const [, yyyy, mm, dd] = ymd;
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

  const canonicalYMDFromAnyDateStr = (s) => {
    const d = parseISOish(s);
    return d ? toYMD(d) : "";
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

  function setAuthError(msg) {
    const el = $("authError");
    if (!el) return;
    if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
    el.style.display = "block";
    el.textContent = msg;
  }

  function clearSupabaseAuthStorage() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) localStorage.removeItem(k);
      }
    } catch {}
  }

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
    try { return JSON.parse(String(v)); } catch { return null; }
  }

  function toNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[^0-9.\-]/g, "").trim();
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // ============================================================
  // Canonical URL enforcement
  // ============================================================
  function enforceCanonicalUrl() {
    try {
      if (window.location.origin !== CANONICAL_ORIGIN) {
        window.location.replace(`${CANONICAL_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`);
        return true;
      }
      const p = window.location.pathname;
      if (p === "/dashboard" || p === "/dashboard/index.html") {
        window.location.replace(CANONICAL_URL);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Dedupe helpers
  // ============================================================
  function normKey(v) { return safeStr(v).trim().toLowerCase(); }

  function canonicalGuestName(v) {
    let s = safeStr(v).trim();
    if (s.includes(":")) s = s.split(":")[0].trim();
    s = s.replace(/\s*[-•|]\s*(king|queen|double|single|suite|non[-\s]?smoking|smoking|room|reservation|booking).*/i, "").trim();
    s = s.replace(/\s+/g, " ");
    return s;
  }

  function extractISODateFromText(text) {
    const s = safeStr(text);
    const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const m = s.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(20\d{2})\b/i);
    if (m) {
      const monthMap = {
        jan: "01", january: "01", feb: "02", february: "02",
        mar: "03", march: "03", apr: "04", april: "04",
        may: "05", jun: "06", june: "06", jul: "07", july: "07",
        aug: "08", august: "08", sep: "09", sept: "09", september: "09",
        oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12",
      };
      const mon = monthMap[m[1].toLowerCase()] || "";
      const day = String(Number(m[2])).padStart(2, "0");
      const year = m[3];
      if (mon) return `${year}-${mon}-${day}`;
    }
    return "";
  }

  function extractNameFromSummary(summary) {
    const s = safeStr(summary).trim();
    if (!s) return "";
    const m = s.match(/\bfor\s+([^,•.\n]{2,80})/i);
    if (!m) return "";
    const raw = safeStr(m[1]).trim();
    const nameOnly = raw.split(":")[0].trim();
    if (nameOnly.length < 2 || /^\d+$/.test(nameOnly)) return "";
    return nameOnly;
  }

  function isBookingLikeCall(summary) {
    const s = safeStr(summary).toLowerCase();
    return (
      s.includes("reservation confirmed") ||
      s.includes("confirmed reservation") ||
      s.includes("reservation for") ||
      s.includes("booking confirmed") ||
      s.includes("reservation_confirmed")
    );
  }

  function dedupeBookingLikeCalls(rows) {
    const bookingKeySet = new Set();
    for (const r of rows) {
      if (r.kind !== "booking") continue;
      const g = normKey(canonicalGuestName(r.guest));
      const a = normKey(canonicalYMDFromAnyDateStr(r.arrival));
      if (g && a) bookingKeySet.add(`${g}__${a}`);
    }

    return rows.filter(r => {
      if (r.kind !== "call") return true;
      if (!isBookingLikeCall(r.summary)) return true;

      const callBooking = (r.booking && typeof r.booking === "object") ? r.booking : null;

      const guestFromCall = normKey(canonicalGuestName(
        callBooking?.guest_name || r.guest || extractNameFromSummary(r.summary)
      ));

      const arrivalFromCall = normKey(canonicalYMDFromAnyDateStr(
        callBooking?.arrival_date || r.arrival || extractISODateFromText(r.summary)
      ));

      if (!guestFromCall || !arrivalFromCall) return true;
      return !bookingKeySet.has(`${guestFromCall}__${arrivalFromCall}`);
    });
  }

  function dedupeDuplicateBookings(rows) {
    const seen = new Set();
    const out = [];

    const sorted = [...rows].sort((a, b) => {
      const ta = a.when ? a.when.getTime() : -Infinity;
      const tb = b.when ? b.when.getTime() : -Infinity;
      return tb - ta;
    });

    for (const r of sorted) {
      if (r.kind !== "booking") { out.push(r); continue; }

      const g = normKey(canonicalGuestName(r.guest));
      const a = normKey(canonicalYMDFromAnyDateStr(r.arrival));
      const n = Number.isFinite(r.nights) ? String(r.nights) : "";
      const t = Number.isFinite(r.totalDue) ? String(r.totalDue) : "";

      const key = `${g}__${a}__${n}__${t}`;
      if (g && a && seen.has(key)) continue;

      if (g && a) seen.add(key);
      out.push(r);
    }
    return out;
  }

  // ============================================================
  // Theme
  // ============================================================
  function initTheme() {
    const saved = localStorage.getItem("ns_theme");
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);

    $("btnTheme")?.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = (cur === "dark") ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("ns_theme", next);
      toast(`Theme: ${next}`);
      renderAll();
    });
  }

  // ============================================================
  // Supabase
  // ============================================================
  function getSupabaseClient() {
    const cfg = window.NSA_CONFIG || {};
    const url = cfg.SUPABASE_URL;
    const key = cfg.SUPABASE_ANON_KEY;

    if (!url || !key || !window.supabase) {
      throw new Error("Missing Supabase config (config.js) or supabase-js not loaded.");
    }

    return window.supabase.createClient(url, key, {
      auth: {
        persistSession: PERSIST_SESSION,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    });
  }

  // ============================================================
  // Tables
  // ============================================================
  const TABLES = { reservations: "reservations", callLogs: "call_logs" };
  const TS_CANDIDATES = ["created_at", "inserted_at", "timestamp", "ts", "time", "createdAt"];

  // ============================================================
  // State
  // ============================================================
  let supabaseClient = null;
  let allRows = [];
  let filteredRows = [];
  let lastRange = null;

  // ============================================================
  // Auth UI
  // ============================================================
  function showOverlay(show) {
    const o = $("authOverlay");
    if (!o) return;
    o.style.display = show ? "flex" : "none";
    o.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function setSessionUI(session) {
    const email = session?.user?.email || "";
    const authBadge = $("authBadge");
    if (authBadge) authBadge.textContent = email ? "Unlocked" : "Locked";

    const btnAuth = $("btnAuth");
    if (btnAuth) btnAuth.textContent = email ? "Account" : "Login";

    const logoutBtn = $("btnLogout");
    if (logoutBtn) logoutBtn.style.display = email ? "inline-flex" : "none";

    const authStatus = $("authStatus");
    if (authStatus) authStatus.textContent = email ? `Signed in as ${email}` : "Not signed in";
  }

  async function hardSignOut() {
    try { await supabaseClient.auth.signOut(); } catch {}
    clearSupabaseAuthStorage();
  }

  async function enforceFounderIfSet(session) {
    if (!session?.user?.email) return { ok: false, reason: "No email on session." };
    if (session.user.email !== FOUNDER_EMAIL) {
      return { ok: false, reason: `Access denied for ${session.user.email}.` };
    }
    return { ok: true };
  }

  async function ensureAuthGate() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) console.warn("getSession error:", error);

    setSessionUI(session);

    if (!session) {
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");
      return { ok: false, session: null };
    }

    const founderCheck = await enforceFounderIfSet(session);
    if (!founderCheck.ok) {
      showOverlay(true);
      clearDataUI(founderCheck.reason + " Please use an authorized email.");
      await hardSignOut();
      return { ok: false, session: null };
    }

    showOverlay(false);
    return { ok: true, session };
  }

  function initAuthHandlers() {
    $("btnAuth")?.addEventListener("click", () => showOverlay(true));
    $("btnCloseAuth")?.addEventListener("click", () => showOverlay(false));

    $("btnSendLink")?.addEventListener("click", sendMagicLink);
    $("btnResendLink")?.addEventListener("click", sendMagicLink);

    $("btnLogout")?.addEventListener("click", async () => {
      toast("Signing out…");
      await hardSignOut();
      setSessionUI(null);
      showOverlay(true);
      clearDataUI("Signed out. Please sign in to view dashboard data.");
      setTimeout(() => window.location.reload(), 250);
    });

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      setSessionUI(session);

      if (!session) {
        showOverlay(true);
        clearDataUI("Please sign in to load dashboard data.");
        return;
      }

      const founderCheck = await enforceFounderIfSet(session);
      if (!founderCheck.ok) {
        showOverlay(true);
        clearDataUI(founderCheck.reason + " Please use an authorized email.");
        await hardSignOut();
        return;
      }

      showOverlay(false);
      await loadAndRender();
    });
  }

  async function sendMagicLink() {
    setAuthError("");
    const email = safeStr($("authEmail")?.value).trim();
    if (!email || !email.includes("@")) return setAuthError("Enter a valid email address.");

    const redirectTo = CANONICAL_URL;

    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });

    if (error) {
      console.error("Magic link error:", error);
      return setAuthError(error.message || "Failed to send magic link.");
    }

    toast("Magic link sent. Check your email.");
    setAuthError("");
  }

  // ============================================================
  // Controls
  // ============================================================
  function initControls() {
    const rangeSelect = $("rangeSelect");
    const customRange = $("customRange");
    const startDate = $("startDate");
    const endDate = $("endDate");
    const searchInput = $("searchInput");

    function syncCustomVisibility() {
      if (!customRange || !rangeSelect) return;
      customRange.style.display = (rangeSelect.value === "custom") ? "flex" : "none";
    }

    rangeSelect?.addEventListener("change", async () => {
      syncCustomVisibility();
      await loadAndRender();
    });

    startDate?.addEventListener("change", loadAndRender);
    endDate?.addEventListener("change", loadAndRender);

    searchInput?.addEventListener("input", () => {
      applyFilters();
      renderAll();
    });

    $("btnRefresh")?.addEventListener("click", loadAndRender);
    $("btnExport")?.addEventListener("click", () => {
      if (!filteredRows.length) return toast("Nothing to export.");
      exportCSV(filteredRows);
    });

    syncCustomVisibility();

    if (startDate && endDate) {
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      startDate.value = toYMD(start);
      endDate.value = toYMD(today);
    }
  }

  function getSelectedRange() {
    const mode = $("rangeSelect")?.value || "7";
    const now = new Date();

    if (mode === "today") return { label: "Today", start: startOfDay(now), end: endOfDay(now) };

    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
      return { label: `Last ${days} days`, start: s, end: endOfDay(now) };
    }

    const sVal = $("startDate")?.value;
    const eVal = $("endDate")?.value;
    const s = sVal ? startOfDay(new Date(`${sVal}T00:00:00`)) : null;
    const e = eVal ? endOfDay(new Date(`${eVal}T00:00:00`)) : null;

    if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) {
      const s2 = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
      return { label: "Last 7 days", start: s2, end: endOfDay(now) };
    }

    return { label: `${sVal} → ${eVal}`, start: s, end: e };
  }

  // ============================================================
  // Fetch
  // ============================================================
  async function fetchTableInRange(tableName, range, limit) {
    if (ENABLE_RANGE_FILTER) {
      const startISO = range.start.toISOString();
      const endISO = range.end.toISOString();

      for (const tsField of TS_CANDIDATES) {
        const { data, error } = await supabaseClient
          .from(tableName)
          .select("*")
          .gte(tsField, startISO)
          .lte(tsField, endISO)
          .order(tsField, { ascending: false })
          .limit(limit);

        if (!error && Array.isArray(data) && data.length > 0) {
          return { data: data || [], tsField, mode: `range:${tsField}` };
        }
        if (error) continue;
      }
    }

    for (const tsField of TS_CANDIDATES) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .order(tsField, { ascending: false })
        .limit(Math.min(limit, 3000));

      if (!error) return { data: data || [], tsField, mode: `order:${tsField}` };
    }

    const { data, error } = await supabaseClient.from(tableName).select("*").limit(50);
    if (error) throw error;
    return { data: data || [], tsField: "", mode: "raw" };
  }

  async function probeAccess() {
    const res = [];
    for (const t of [TABLES.reservations, TABLES.callLogs]) {
      const { data, error } = await supabaseClient.from(t).select("*").limit(1);
      res.push({ table: t, ok: !error, rows: (data || []).length, error: error?.message || "" });
    }
    return res;
  }

  // ============================================================
  // Normalize
  // ============================================================
  function normalizeReservationRow(r, tsField) {
    const when = parseISOish(r?.[tsField]) || parseISOish(r?.created_at) || parseISOish(r?.inserted_at) || null;
    const bookingObj = (r?.booking && typeof r.booking === "object") ? r.booking : null;

    const event = safeStr(r?.event || bookingObj?.event || "booking");
    const guest = safeStr(r?.guest_name || bookingObj?.guest_name || r?.name || r?.caller_name || "");

    const arrivalRaw = safeStr(r?.arrival_date || bookingObj?.arrival_date || "");
    const arrival = canonicalYMDFromAnyDateStr(arrivalRaw) || arrivalRaw;

    const nights = toNum(r?.nights ?? bookingObj?.nights);
    const totalDue = toNum(r?.total_due ?? bookingObj?.total_due);
    const sentiment = safeStr(r?.sentiment || bookingObj?.sentiment || r?.call_sentiment || "");

    const summary =
      safeStr(r?.summary) ||
      safeStr(bookingObj?.summary) ||
      `Reservation${guest ? ` for ${guest}` : ""}${arrival ? ` • Arrive ${arrival}` : ""}`;

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

  function normalizeCallLogRow(r, tsField) {
    const when = parseISOish(r?.[tsField]) || parseISOish(r?.created_at) || parseISOish(r?.inserted_at) || null;

    const event = safeStr(r?.event || r?.type || "call");
    const callId = safeStr(r?.call_id || r?.call_sid || r?.sid || r?.id || "");

    const rawPhone =
      r?.from ??
      r?.caller ??
      r?.phone ??
      r?.caller_phone ??
      r?.from_number ??
      r?.caller_number ??
      "";

    const duration = toNum(r?.duration_seconds ?? r?.duration ?? NaN);
    const sentiment = safeStr(r?.sentiment || r?.call_sentiment || "");

    const summary =
      safeStr(r?.summary) ||
      safeStr(r?.notes) ||
      safeStr(r?.transcript_summary) ||
      `${event}${callId ? ` • ${callId}` : ""}${rawPhone ? ` • ${safeStr(rawPhone)}` : ""}${Number.isFinite(duration) ? ` • ${Math.round(duration)}s` : ""}`;

    const bookingObj = safeJsonParse(r?.booking);

    const guestFromBooking = safeStr(bookingObj?.guest_name).trim();
    const arrivalFromBooking = safeStr(bookingObj?.arrival_date).trim();

    const explicitName = safeStr(r?.guest_name || r?.caller_name || r?.name || "").trim();
    const extractedName = extractNameFromSummary(summary);

    const guestDisplay =
      guestFromBooking ||
      explicitName ||
      extractedName ||
      safeStr(rawPhone).trim() ||
      callId;

    const arrivalFromText = extractISODateFromText(summary);
    const arrivalDisplay = arrivalFromBooking || arrivalFromText || "";
    const arrivalCanonical = canonicalYMDFromAnyDateStr(arrivalDisplay) || arrivalDisplay;

    return {
      kind: "call",
      when,
      whenRaw: r?.[tsField] || r?.created_at || r?.inserted_at || "",
      event,
      guest: guestDisplay,
      arrival: arrivalCanonical,
      nights: null,
      totalDue: null,
      sentiment,
      summary,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      booking: bookingObj,
      raw: r,
    };
  }

  // ============================================================
  // Filtering / KPIs / Ops / Feed
  // ============================================================
  function applyFilters() {
    const range = lastRange || getSelectedRange();
    const q = (safeStr($("searchInput")?.value)).toLowerCase().trim();

    filteredRows = allRows.filter(row => {
      const t = row.when instanceof Date && !isNaN(row.when.getTime()) ? row.when.getTime() : null;
      if (t !== null) {
        if (t < range.start.getTime() || t > range.end.getTime()) return false;
      }
      if (!q) return true;

      const hay = [
        row.kind, row.event, row.guest, row.arrival, row.sentiment, row.summary, safeStr(row.whenRaw),
      ].join(" ").toLowerCase();

      let rawStr = "";
      try { rawStr = JSON.stringify(row.raw).toLowerCase(); } catch {}
      return hay.includes(q) || rawStr.includes(q);
    });
  }

  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const totalCalls = calls.length;
    const totalBookings = bookings.length;
    const conv = totalCalls > 0 ? (totalBookings / totalCalls) : NaN;

    const durations = calls.map(c => c.durationSeconds).filter(n => Number.isFinite(n));
    const avgDur = durations.length ? (durations.reduce((a,b)=>a+b,0) / durations.length) : NaN;

    const revenue = bookings.map(b => b.totalDue).filter(n => Number.isFinite(n)).reduce((a,b)=>a+b,0);

    const negativeCount = rows.filter(r => safeStr(r.sentiment).toLowerCase().includes("neg")).length;
    const longCalls = calls.filter(c => Number.isFinite(c.durationSeconds) && c.durationSeconds >= 240).length;

    return { totalCalls, totalBookings, conv, avgDur, revenue, negativeCount, longCalls };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid");
    if (!el) return;
    el.innerHTML = "";

    const tiles = [
      { name: "Total calls", value: fmtInt(k.totalCalls), sub: "call logs in range" },
      { name: "Bookings", value: fmtInt(k.totalBookings), sub: "reservations in range" },
      { name: "Conversion", value: fmtPct(k.conv), sub: "bookings ÷ calls" },
      { name: "Revenue", value: fmtMoney(k.revenue), sub: "sum total_due" },
      { name: "Avg call", value: Number.isFinite(k.avgDur) ? `${Math.round(k.avgDur)}s` : "—", sub: "duration_seconds" },
    ];

    for (const t of tiles) {
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `
        <p class="name">${escHtml(t.name)}</p>
        <p class="value">${escHtml(t.value)}</p>
        <p class="sub">${escHtml(t.sub)}</p>
      `;
      el.appendChild(div);
    }
  }

  // Traffic-light dot using CSS vars already in your index.html
  function dotCssVar(varName) {
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:var(${varName});margin-right:8px;transform:translateY(-1px);"></span>`;
  }

  function renderOpsSignals(k) {
    const box = $("opsInsights");
    if (!box) return;

    const negVar = (k.negativeCount > 0) ? "--bad" : "--good";
    const longVar = (k.longCalls > 0) ? "--warn" : "--good";

    box.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="font-weight:700; font-size:13px;">Watchlist</div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center; min-width:0;">
            ${dotCssVar(negVar)}
            <span style="color:var(--muted); font-size:13px; white-space:nowrap;">Negative sentiment</span>
          </div>
          <div style="font-weight:700; font-size:13px;">${fmtInt(k.negativeCount)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center; min-width:0;">
            ${dotCssVar(longVar)}
            <span style="color:var(--muted); font-size:13px; white-space:nowrap;">Long calls (4m+)</span>
          </div>
          <div style="font-weight:700; font-size:13px;">${fmtInt(k.longCalls)}</div>
        </div>

        <div style="height:1px; background: rgba(255,255,255,0.08);"></div>

        <div style="font-weight:700; font-size:13px;">Snapshot</div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dotCssVar("--accent")}<span style="color:var(--muted); font-size:13px;">Calls</span></div>
          <div style="font-weight:700; font-size:13px;">${fmtInt(k.totalCalls)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dotCssVar("--accent")}<span style="color:var(--muted); font-size:13px;">Bookings</span></div>
          <div style="font-weight:700; font-size:13px;">${fmtInt(k.totalBookings)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dotCssVar("--accent")}<span style="color:var(--muted); font-size:13px;">Conversion</span></div>
          <div style="font-weight:700; font-size:13px;">${fmtPct(k.conv)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dotCssVar("--accent")}<span style="color:var(--muted); font-size:13px;">Revenue</span></div>
          <div style="font-weight:700; font-size:13px;">${fmtMoney(k.revenue)}</div>
        </div>
      </div>
    `;
  }

  // ---------------- Charts (guarded: will NOT break app if missing in HTML)
  function groupCountsByDay(rows, kind) {
    const map = new Map();
    for (const r of rows) {
      if (r.kind !== kind) continue;
      const d = r.when instanceof Date && !isNaN(r.when.getTime()) ? toYMD(r.when) : "";
      if (!d) continue;
      map.set(d, (map.get(d) || 0) + 1);
    }
    // return sorted arrays
    const keys = Array.from(map.keys()).sort();
    return { labels: keys, values: keys.map(k => map.get(k) || 0) };
  }

  function renderLineChart(canvasId, labels, values) {
    const c = $(canvasId);
    if (!c || !c.getContext) return; // no canvas in HTML -> skip

    // ensure visible sizing
    const parent = c.parentElement;
    const w = Math.max(260, (parent?.clientWidth || 0) - 8);
    const h = Math.max(140, c.height || 140);

    // only resize when needed (prevents blur)
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;

    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);

    if (!labels.length) {
      // draw a subtle empty state line
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(12, h / 2);
      ctx.lineTo(w - 12, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    const maxV = Math.max(1, ...values);
    const pad = 18;
    const usableW = w - pad * 2;
    const usableH = h - pad * 2;
    const step = labels.length > 1 ? usableW / (labels.length - 1) : usableW;

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(110,168,255,0.95)"; // accent-ish
    ctx.beginPath();

    labels.forEach((_, i) => {
      const x = pad + i * step;
      const y = pad + (usableH - (values[i] / maxV) * usableH);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // points
    ctx.fillStyle = "rgba(110,168,255,0.95)";
    labels.forEach((_, i) => {
      const x = pad + i * step;
      const y = pad + (usableH - (values[i] / maxV) * usableH);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderCharts(rows) {
    // only compute if you added canvases in HTML
    const calls = groupCountsByDay(rows, "call");
    const bookings = groupCountsByDay(rows, "booking");

    renderLineChart("chartCalls", calls.labels, calls.values);
    renderLineChart("chartBookings", bookings.labels, bookings.values);
  }

  // ---------------- Feed (v10 fix: never leave stateBox stuck)
  function renderFeed(rows) {
    const state = $("stateBox");
    const wrap = $("tableWrap");
    const tbody = $("feedTbody");

    // Guard if HTML changed
    if (!state || !wrap || !tbody) return;

    $("badgeCount").textContent = fmtInt(rows.length);
    $("feedMeta").textContent = `${fmtInt(rows.length)} items`;

    if (!rows.length) {
      wrap.style.display = "none";
      state.style.display = "block";
      state.textContent = "No activity in this date range.";
      return;
    }

    // ✅ v10: ALWAYS hide loading and show table when we have rows
    state.style.display = "none";
    wrap.style.display = "block";
    tbody.innerHTML = "";

    const sorted = [...rows].sort((a,b) => {
      const ta = a.when ? a.when.getTime() : -Infinity;
      const tb = b.when ? b.when.getTime() : -Infinity;
      return tb - ta;
    });

    for (const r of sorted.slice(0, 500)) {
      const tr = document.createElement("tr");

      const whenTxt = r.when ? r.when.toLocaleString() : safeStr(r.whenRaw) || "—";
      const arrivalTxt = r.arrival ? safeStr(r.arrival) : "—";
      const nightsTxt = Number.isFinite(r.nights) ? String(r.nights) : "—";
      const totalTxt = Number.isFinite(r.totalDue) ? fmtMoney(r.totalDue) : "—";
      const typeTxt = r.kind === "booking" ? "booking" : "call";
      const sentimentTxt = safeStr(r.sentiment) || "—";
      const guestTxt = safeStr(r.guest) || "—";
      const summaryTxt = safeStr(r.summary) || "—";

      tr.innerHTML = `
        <td><span class="muted">${escHtml(whenTxt)}</span></td>
        <td>${escHtml(typeTxt)}</td>
        <td title="${escHtml(guestTxt)}">${escHtml(guestTxt)}</td>
        <td title="${escHtml(arrivalTxt)}">${escHtml(arrivalTxt)}</td>
        <td>${escHtml(nightsTxt)}</td>
        <td>${escHtml(totalTxt)}</td>
        <td title="${escHtml(sentimentTxt)}">${escHtml(sentimentTxt)}</td>
        <td class="col-summary"><div class="summaryClamp" title="${escHtml(summaryTxt)}">${escHtml(summaryTxt)}</div></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function exportCSV(rows) {
    const cols = ["kind","time","event","guest_or_caller","arrival_date","nights","total_due","sentiment","summary"];
    const lines = [cols.join(",")];

    for (const r of rows) {
      const time = r.when ? r.when.toISOString() : safeStr(r.whenRaw);
      const vals = [
        r.kind, time, safeStr(r.event), safeStr(r.guest), safeStr(r.arrival),
        Number.isFinite(r.nights) ? r.nights : "",
        Number.isFinite(r.totalDue) ? r.totalDue : "",
        safeStr(r.sentiment), safeStr(r.summary),
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`);
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

  function renderAll() {
    applyFilters();
    $("badgeWindow").textContent = lastRange?.label || "—";

    const k = computeKPIs(filteredRows);
    renderKPIs(k);
    renderOpsSignals(k);
    renderCharts(filteredRows);
    renderFeed(filteredRows);

    const lu = $("lastUpdated");
    if (lu) lu.textContent = `Updated ${new Date().toLocaleString()}`;
  }

  function clearDataUI(msg) {
    allRows = [];
    filteredRows = [];

    if ($("badgeCount")) $("badgeCount").textContent = "—";
    if ($("kpiGrid")) $("kpiGrid").innerHTML = "";
    if ($("opsInsights")) $("opsInsights").innerHTML = "—";

    if ($("tableWrap")) $("tableWrap").style.display = "none";

    const sb = $("stateBox");
    if (sb) {
      sb.style.display = "block";
      sb.textContent = msg || "—";
    }
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    const gate = await ensureAuthGate();
    if (!gate.ok) return;

    const state = $("stateBox");
    const wrap = $("tableWrap");
    if (wrap) wrap.style.display = "none";
    if (state) { state.style.display = "block"; state.textContent = "Loading…"; }

    try {
      lastRange = getSelectedRange();
      if ($("badgeWindow")) $("badgeWindow").textContent = lastRange.label;

      const [resv, calls] = await Promise.all([
        fetchTableInRange(TABLES.reservations, lastRange, 3000),
        fetchTableInRange(TABLES.callLogs, lastRange, 3000),
      ]);

      const normalized = [];
      for (const r of (resv.data || [])) normalized.push(normalizeReservationRow(r, resv.tsField));
      for (const c of (calls.data || [])) normalized.push(normalizeCallLogRow(c, calls.tsField));

      let merged = normalized.map(r => {
        if (!r.when) r.when = parseISOish(r.whenRaw);
        return r;
      });

      if (HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS) merged = dedupeBookingLikeCalls(merged);
      if (DEDUPE_DUPLICATE_BOOKINGS) merged = dedupeDuplicateBookings(merged);

      allRows = merged;

      if (!allRows.length && state) {
        const probes = await probeAccess();
        const probeText = probes.map(p =>
          `• ${p.table}: ${p.ok ? `OK (rows visible: ${p.rows})` : `BLOCKED — ${p.error || "RLS"}`}`
        ).join("\n");

        state.textContent =
          "Signed in, but no rows returned.\n\n" +
          "Probe:\n" + probeText + "\n";
      }

      renderAll();
      toast("Dashboard refreshed.");
    } catch (err) {
      console.error(err);
      if (state) state.textContent = `Error: ${err?.message || err}`;
      toast("Load failed. Check console + Supabase settings.");
    }
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    initTheme();
    initControls();

    try {
      supabaseClient = getSupabaseClient();
    } catch (e) {
      clearDataUI(`Config error: ${e.message}`);
      showOverlay(true);
      return;
    }

    initAuthHandlers();

    if (ALWAYS_REQUIRE_LOGIN) {
      clearSupabaseAuthStorage();
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");
      await supabaseClient.auth.getSession();
      return;
    }

    const gate = await ensureAuthGate();
    if (gate.ok) await loadAndRender();

    // Helps when tab is backgrounded then focused again
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadAndRender();
    });
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) loadAndRender();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
