// public/dashboard/app.js
(() => {
  // ============================================================
  // Settings
  // ============================================================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

  // Keep you signed in (so refresh + switching tabs doesn't break auth)
  const PERSIST_SESSION = true;

  // If true, forces login overlay on every load (shared-computer mode).
  // Keep FALSE for normal founder usage.
  const ALWAYS_REQUIRE_LOGIN = false;

  // Dedupe: hide booking-like CALL entries if a matching BOOKING exists
  const HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS = true;

  // Dedupe: hide duplicate BOOKINGS that are clearly repeats
  const DEDUPE_DUPLICATE_BOOKINGS = true;

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

  // Treat YYYY-MM-DD as LOCAL midnight (prevents “-1 day” issues in EST)
  function parseISOish(v) {
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
  }

  function toYMD(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function canonicalYMDFromAnyDateStr(s) {
    const d = parseISOish(s);
    return d ? toYMD(d) : "";
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

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

  function clearSupabaseAuthStorage() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) localStorage.removeItem(k);
      }
    } catch {}
  }

  // ============================================================
  // Supabase
  // ============================================================
  function getSupabaseClient() {
    const cfg = window.NSA_CONFIG || {};
    const url = cfg.SUPABASE_URL;
    const key = cfg.SUPABASE_ANON_KEY;

    if (!url || !key || !window.supabase) {
      throw new Error("Missing Supabase config or supabase-js not loaded.");
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
  // Tables + timestamp candidates
  // ============================================================
  const TABLES = {
    reservations: "reservations",
    callLogs: "call_logs",
  };

  // Your rows show created_at exists on both
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
    const btnAuth = $("btnAuth");
    const btnLogout = $("btnLogout");
    const authStatus = $("authStatus");

    if (authBadge) authBadge.textContent = email ? "Unlocked" : "Locked";
    if (btnAuth) btnAuth.textContent = email ? "Account" : "Login";
    if (btnLogout) btnLogout.style.display = email ? "inline-flex" : "none";
    if (authStatus) authStatus.textContent = email ? `Signed in as ${email}` : "Not signed in";
  }

  async function hardSignOut() {
    try {
      // v2 supports scope; if it throws, ignore
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch {
      try { await supabaseClient.auth.signOut(); } catch {}
    }
    clearSupabaseAuthStorage();
  }

  async function enforceFounder(session) {
    const email = session?.user?.email || "";
    if (!email) return { ok: false, reason: "No email on session." };
    if (email !== FOUNDER_EMAIL) return { ok: false, reason: `Access denied for ${email}.` };
    return { ok: true };
  }

  async function ensureAuthGate() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    setSessionUI(session);

    if (!session) {
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");
      return { ok: false, session: null };
    }

    const ok = await enforceFounder(session);
    if (!ok.ok) {
      showOverlay(true);
      clearDataUI(ok.reason);
      await hardSignOut();
      return { ok: false, session: null };
    }

    showOverlay(false);
    return { ok: true, session };
  }

  async function sendMagicLink() {
    setAuthError("");
    const email = safeStr($("authEmail")?.value).trim();
    if (!email || !email.includes("@")) return setAuthError("Enter a valid email address.");

    // Redirect back to the exact page you’re on (prevents / vs /index.html issues)
    // Ensure it’s the folder root with trailing slash.
    const origin = window.location.origin;
    const redirectTo = `${origin}/dashboard/`;

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
      // Hard reload to reset everything cleanly
      setTimeout(() => window.location.reload(), 200);
    });

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      setSessionUI(session);

      if (!session) {
        showOverlay(true);
        clearDataUI("Please sign in to load dashboard data.");
        return;
      }

      const ok = await enforceFounder(session);
      if (!ok.ok) {
        showOverlay(true);
        clearDataUI(ok.reason);
        await hardSignOut();
        return;
      }

      showOverlay(false);
      await loadAndRender();
    });
  }

  // ============================================================
  // Controls
  // ============================================================
  function getSelectedRange() {
    const mode = $("rangeSelect")?.value || "7";
    const now = new Date();

    if (mode === "today") return { label: "Today", start: startOfDay(now), end: endOfDay(now) };

    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
      return { label: `Last ${days} days`, start: s, end: endOfDay(now) };
    }

    // Custom
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

  // ============================================================
  // Fetch
  // ============================================================
  async function fetchTable(tableName, range, limit) {
    // Use order() only (range filters often fail due to timestamp types/tz)
    for (const tsField of TS_CANDIDATES) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .order(tsField, { ascending: false })
        .limit(limit);

      if (!error) return { data: data || [], tsField };
    }

    const { data, error } = await supabaseClient.from(tableName).select("*").limit(Math.min(limit, 200));
    if (error) throw error;
    return { data: data || [], tsField: "" };
  }

  // ============================================================
  // Normalize rows
  // ============================================================
  function normalizeReservationRow(r, tsField) {
    const when = parseISOish(r?.[tsField]) || parseISOish(r?.created_at) || null;
    const guest = safeStr(r?.guest_name || r?.name || "");
    const arrivalRaw = safeStr(r?.arrival_date || "");
    const arrival = canonicalYMDFromAnyDateStr(arrivalRaw) || arrivalRaw;

    const nights = toNum(r?.nights);
    const totalDue = toNum(r?.total_due);
    const summary =
      safeStr(r?.summary) ||
      `Reservation${guest ? ` for ${guest}` : ""}${arrival ? ` • Arrive ${arrival}` : ""}`;

    return {
      kind: "booking",
      when,
      whenRaw: r?.[tsField] || r?.created_at || "",
      event: safeStr(r?.event || "booking"),
      guest,
      arrival,
      nights: Number.isFinite(nights) ? nights : null,
      totalDue: Number.isFinite(totalDue) ? totalDue : null,
      sentiment: "",
      summary,
      raw: r,
    };
  }

  function normalizeCallLogRow(r, tsField) {
    const when = parseISOish(r?.[tsField]) || parseISOish(r?.created_at) || null;
    const bookingObj = safeJsonParse(r?.booking);

    const guest =
      safeStr(bookingObj?.guest_name).trim() ||
      safeStr(r?.guest_name || "").trim() ||
      safeStr(extractNameFromSummary(r?.summary)).trim() ||
      "—";

    const arrival =
      canonicalYMDFromAnyDateStr(bookingObj?.arrival_date) ||
      canonicalYMDFromAnyDateStr(extractISODateFromText(r?.summary)) ||
      "";

    const sentiment = safeStr(r?.sentiment || "");
    const summary = safeStr(r?.summary || r?.notes || "");

    return {
      kind: "call",
      when,
      whenRaw: r?.[tsField] || r?.created_at || "",
      event: safeStr(r?.event || r?.type || "call"),
      guest,
      arrival,
      nights: null,
      totalDue: null,
      sentiment,
      summary,
      durationSeconds: toNum(r?.duration_seconds),
      booking: bookingObj,
      raw: r,
    };
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

  // ============================================================
  // Dedupe
  // ============================================================
  function normKey(v) {
    return safeStr(v).trim().toLowerCase();
  }

  function canonicalGuestName(v) {
    let s = safeStr(v).trim();
    if (s.includes(":")) s = s.split(":")[0].trim();
    s = s.replace(/\s+/g, " ");
    return s;
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

    // keep newest first
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

  function dot(colorVar) {
    // uses your existing CSS vars: --good / --warn / --bad / --accent
    return `<span style="display:inline-block;width:9px;height:9px;border-radius:999px;background:var(${colorVar});box-shadow:0 0 0 3px rgba(255,255,255,0.06);margin-right:10px;transform:translateY(1px);"></span>`;
  }

  function renderOpsSignals(k) {
    const box = $("opsInsights");
    if (!box) return;

    const negColor = (k.negativeCount > 0) ? "--bad" : "--good";
    const longColor = (k.longCalls > 0) ? "--warn" : "--good";

    box.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="font-weight:800; font-size:13px;">Watchlist</div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center; min-width:0;">
            ${dot(negColor)}
            <span style="color:var(--muted); font-size:13px;">Negative sentiment</span>
          </div>
          <div style="font-weight:800; font-size:13px;">${fmtInt(k.negativeCount)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center; min-width:0;">
            ${dot(longColor)}
            <span style="color:var(--muted); font-size:13px;">Long calls (4m+)</span>
          </div>
          <div style="font-weight:800; font-size:13px;">${fmtInt(k.longCalls)}</div>
        </div>

        <div style="height:1px; background: rgba(255,255,255,0.08); margin:6px 0;"></div>

        <div style="font-weight:800; font-size:13px;">Snapshot</div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dot("--accent")}<span style="color:var(--muted); font-size:13px;">Calls</span></div>
          <div style="font-weight:800; font-size:13px;">${fmtInt(k.totalCalls)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dot("--accent")}<span style="color:var(--muted); font-size:13px;">Bookings</span></div>
          <div style="font-weight:800; font-size:13px;">${fmtInt(k.totalBookings)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dot("--accent")}<span style="color:var(--muted); font-size:13px;">Conversion</span></div>
          <div style="font-weight:800; font-size:13px;">${fmtPct(k.conv)}</div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="display:flex; align-items:center;">${dot("--accent")}<span style="color:var(--muted); font-size:13px;">Revenue</span></div>
          <div style="font-weight:800; font-size:13px;">${fmtMoney(k.revenue)}</div>
        </div>
      </div>
    `;
  }

  function renderFeed(rows) {
    const state = $("stateBox");
    const wrap = $("tableWrap");
    const tbody = $("feedTbody");
    const badgeCount = $("badgeCount");
    const feedMeta = $("feedMeta");

    if (badgeCount) badgeCount.textContent = fmtInt(rows.length);
    if (feedMeta) feedMeta.textContent = `${fmtInt(rows.length)} items`;

    if (!wrap || !tbody || !state) return;

    if (!rows.length) {
      wrap.style.display = "none";
      state.style.display = "block";
      state.textContent = "No data in this range.";
      return;
    }

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

    const badgeWindow = $("badgeWindow");
    if (badgeWindow) badgeWindow.textContent = lastRange?.label || "—";

    const k = computeKPIs(filteredRows);
    renderKPIs(k);
    renderOpsSignals(k);
    renderFeed(filteredRows);

    const lu = $("lastUpdated");
    if (lu) lu.textContent = `Updated ${new Date().toLocaleString()}`;
  }

  function clearDataUI(msg) {
    allRows = [];
    filteredRows = [];

    const bc = $("badgeCount");
    if (bc) bc.textContent = "—";

    const kpi = $("kpiGrid");
    if (kpi) kpi.innerHTML = "";

    const ops = $("opsInsights");
    if (ops) ops.innerHTML = escHtml(msg || "—");

    const tw = $("tableWrap");
    if (tw) tw.style.display = "none";

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
      const badgeWindow = $("badgeWindow");
      if (badgeWindow) badgeWindow.textContent = lastRange.label;

      // Pull a healthy amount, then filter locally by date range
      const [resv, calls] = await Promise.all([
        fetchTable(TABLES.reservations, lastRange, 4000),
        fetchTable(TABLES.callLogs, lastRange, 5000),
      ]);

      const normalized = [];
      for (const r of (resv.data || [])) normalized.push(normalizeReservationRow(r, resv.tsField));
      for (const c of (calls.data || [])) normalized.push(normalizeCallLogRow(c, calls.tsField));

      // Ensure when exists for filtering
      let merged = normalized.map(r => {
        if (!r.when) r.when = parseISOish(r.whenRaw);
        return r;
      });

      if (HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS) merged = dedupeBookingLikeCalls(merged);
      if (DEDUPE_DUPLICATE_BOOKINGS) merged = dedupeDuplicateBookings(merged);

      allRows = merged;

      // Now local date-range filtering actually matters
      renderAll();
      toast("Dashboard refreshed.");
    } catch (err) {
      console.error(err);
      if (state) state.textContent = `Error: ${err?.message || err}`;
      toast("Load failed. Check console + Supabase.");
    }
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
  // Tab visibility resilience (so leaving tab doesn't “kill” your UI)
  // ============================================================
  function initVisibilityResilience() {
    document.addEventListener("visibilitychange", () => {
      // When you come back to the tab, re-check session + refresh data once.
      if (!document.hidden) {
        // Avoid hammering: small delay so browser fully resumes
        setTimeout(() => {
          loadAndRender().catch(() => {});
        }, 250);
      }
    });
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    initTheme();
    initControls();
    initVisibilityResilience();

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
  }

  document.addEventListener("DOMContentLoaded", init);
})();
