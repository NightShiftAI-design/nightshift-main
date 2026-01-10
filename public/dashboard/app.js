// public/dashboard/app.js
(() => {
  // ============================================================
  // IMPORTANT SETTINGS
  // ============================================================
  // If true: even if a session is saved, we sign out on page load.
  // This forces the dashboard to ALWAYS prompt for login.
  const FORCE_REAUTH_EACH_VISIT = true;

  // Founder email (used for friendly messaging; RLS is enforced in Supabase SQL)
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

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

  function clearSupabaseAuthStorage() {
    // Supabase tokens are stored like: sb-<projectref>-auth-token
    try {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) localStorage.removeItem(k);
      }
    } catch {}
  }

  const parseISOish = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
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

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

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

    const url =
      cfg.SUPABASE_URL ||
      window.SUPABASE_URL ||
      window.supabaseUrl ||
      window.NIGHTSHIFT_SUPABASE_URL;

    const key =
      cfg.SUPABASE_ANON_KEY ||
      window.SUPABASE_ANON_KEY ||
      window.supabaseAnonKey ||
      window.NIGHTSHIFT_SUPABASE_ANON_KEY;

    if (!url || !key || !window.supabase) {
      throw new Error(
        "Missing Supabase config. Ensure dashboard/config.js sets window.NSA_CONFIG.SUPABASE_URL and SUPABASE_ANON_KEY, and supabase-js is loaded."
      );
    }

    // NOTE: persistSession false ensures refresh does NOT silently keep session.
    return window.supabase.createClient(url, key, {
      auth: {
        persistSession: false,       // << forces login on refresh if you reload
        autoRefreshToken: false,
        detectSessionInUrl: true,    // << magic link token in URL gets parsed
      }
    });
  }

  // ============================================================
  // Tables / State
  // ============================================================
  const TABLES = {
    reservations: "reservations",
    callEvents: "call_events",
  };

  const TS_CANDIDATES = ["created_at", "inserted_at", "timestamp", "ts"];

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
    $("authBadge").textContent = email ? "Unlocked" : "Locked";
    $("btnAuth").textContent = email ? "Account" : "Login";

    const logoutBtn = $("btnLogout");
    if (logoutBtn) logoutBtn.style.display = email ? "inline-flex" : "none";

    const authStatus = $("authStatus");
    if (authStatus) authStatus.textContent = email ? `Signed in as ${email}` : "Not signed in";
  }

  async function hardSignOutAndReload() {
    try {
      // Supabase v2 supports scope. If not, it will ignore.
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch (e) {
      console.warn("signOut threw:", e);
    }
    clearSupabaseAuthStorage();
    // Also clear any UI state
    setSessionUI(null);
    clearDataUI("Please sign in to load dashboard data.");
    showOverlay(true);
    setTimeout(() => window.location.reload(), 200);
  }

  async function ensureAuthGate() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) console.warn("getSession error:", error);

    setSessionUI(session);

    if (!session) {
      showOverlay(true);
      $("stateBox").textContent = "Please sign in to load dashboard data.";
      return false;
    }

    showOverlay(false);
    return true;
  }

  function initAuthHandlers() {
    $("btnAuth")?.addEventListener("click", () => showOverlay(true));
    $("btnCloseAuth")?.addEventListener("click", () => showOverlay(false));
    $("btnSendLink")?.addEventListener("click", sendMagicLink);
    $("btnResendLink")?.addEventListener("click", sendMagicLink);

    $("btnLogout")?.addEventListener("click", async () => {
      toast("Signing out…");
      await hardSignOutAndReload();
    });

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      setSessionUI(session);
      if (session) {
        showOverlay(false);
        await loadAndRender();
      } else {
        showOverlay(true);
        clearDataUI("Please sign in to load dashboard data.");
      }
    });
  }

  async function sendMagicLink() {
    setAuthError("");
    const email = safeStr($("authEmail")?.value).trim();
    if (!email || !email.includes("@")) return setAuthError("Enter a valid email address.");

    // Force redirect specifically to dashboard
    const redirectTo = `${window.location.origin}/dashboard/`;

    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });

    if (error) {
      console.error("Magic link error:", error);
      setAuthError(error.message || "Failed to send magic link.");
      return;
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
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();

    // Try filter on candidate timestamp columns
    for (const tsField of TS_CANDIDATES) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .gte(tsField, startISO)
        .lte(tsField, endISO)
        .order(tsField, { ascending: false })
        .limit(limit);

      if (!error) return { data: data || [], tsField };
    }

    // Fallback: order only
    for (const tsField of TS_CANDIDATES) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .order(tsField, { ascending: false })
        .limit(Math.min(limit, 200));

      if (!error) return { data: data || [], tsField };
    }

    // Final fallback: raw limit
    const { data, error } = await supabaseClient.from(tableName).select("*").limit(50);
    if (error) throw error;
    return { data: data || [], tsField: "" };
  }

  async function probeAccess() {
    const out = [];
    for (const t of [TABLES.reservations, TABLES.callEvents]) {
      const { data, error } = await supabaseClient.from(t).select("*").limit(1);
      out.push({
        table: t,
        ok: !error,
        rows: (data || []).length,
        error: error?.message || ""
      });
    }
    return out;
  }

  // ============================================================
  // Normalize
  // ============================================================
  function normalizeReservationRow(r, tsField) {
    const when = parseISOish(r?.[tsField]) || parseISOish(r?.created_at) || parseISOish(r?.inserted_at) || null;
    const bookingObj = r?.booking && typeof r.booking === "object" ? r.booking : null;

    const event = safeStr(r?.event || bookingObj?.event || "booking");
    const guest = safeStr(r?.guest_name || bookingObj?.guest_name || r?.name || r?.caller_name || "");
    const arrival = safeStr(r?.arrival_date || bookingObj?.arrival_date || "");
    const nights = Number(r?.nights ?? bookingObj?.nights);
    const totalDue = Number(r?.total_due ?? bookingObj?.total_due);
    const sentiment = safeStr(r?.sentiment || bookingObj?.sentiment || r?.call_sentiment || "");

    const summary =
      safeStr(r?.summary) ||
      safeStr(bookingObj?.summary) ||
      `Reservation${guest ? ` for ${guest}` : ""}${arrival ? ` • Arrive ${arrival}` : ""}`;

    return {
      kind: "booking",
      when,
      whenRaw: r?.[tsField] || r?.created_at || r?.inserted_at || "",
      event, guest, arrival,
      nights: Number.isFinite(nights) ? nights : null,
      totalDue: Number.isFinite(totalDue) ? totalDue : null,
      sentiment, summary,
      raw: r,
    };
  }

  function normalizeCallEventRow(e, tsField) {
    const when = parseISOish(e?.[tsField]) || parseISOish(e?.created_at) || parseISOish(e?.inserted_at) || null;

    const event = safeStr(e?.event || e?.type || e?.name || "call_event");
    const callId = safeStr(e?.call_id || e?.call_sid || e?.id || "");
    const phone = safeStr(e?.from || e?.caller || e?.phone || e?.caller_phone || "");
    const sentiment = safeStr(e?.sentiment || e?.call_sentiment || "");
    const duration = Number(e?.duration_seconds ?? e?.duration ?? NaN);

    const summary =
      safeStr(e?.summary) ||
      safeStr(e?.notes) ||
      safeStr(e?.transcript_summary) ||
      `${event}${callId ? ` • ${callId}` : ""}${phone ? ` • ${phone}` : ""}${Number.isFinite(duration) ? ` • ${Math.round(duration)}s` : ""}`;

    return {
      kind: "call",
      when,
      whenRaw: e?.[tsField] || e?.created_at || e?.inserted_at || "",
      event,
      guest: phone || callId,
      arrival: "",
      nights: null,
      totalDue: null,
      sentiment,
      summary,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      raw: e,
    };
  }

  // ============================================================
  // Filtering / KPIs / Render
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

    return { totalCalls, totalBookings, conv, avgDur, revenue };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid");
    if (!el) return;
    el.innerHTML = "";

    const tiles = [
      { name: "Total calls", value: fmtInt(k.totalCalls), sub: "call events in range" },
      { name: "Bookings", value: fmtInt(k.totalBookings), sub: "reservations captured" },
      { name: "Conversion", value: fmtPct(k.conv), sub: "bookings ÷ calls" },
      { name: "Booking revenue", value: fmtMoney(k.revenue), sub: "sum total_due (if present)" },
      { name: "Avg call duration", value: Number.isFinite(k.avgDur) ? `${Math.round(k.avgDur)}s` : "—", sub: "duration_seconds (if present)" },
    ];

    for (const t of tiles) {
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<p class="name">${t.name}</p><p class="value">${t.value}</p><p class="sub">${t.sub}</p>`;
      el.appendChild(div);
    }
  }

  function renderFeed(rows) {
    $("badgeCount").textContent = fmtInt(rows.length);
    $("feedMeta").textContent = `${fmtInt(rows.length)} items`;

    const state = $("stateBox");
    const wrap = $("tableWrap");
    const tbody = $("feedTbody");

    if (!rows.length) {
      wrap.style.display = "none";
      state.style.display = "block";
      state.textContent = "No data returned (empty tables OR RLS blocked).";
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

      tr.innerHTML = `
        <td><span class="muted">${whenTxt}</span></td>
        <td>${typeTxt}</td>
        <td>${safeStr(r.guest) || "<span class='muted'>—</span>"}</td>
        <td>${arrivalTxt}</td>
        <td>${nightsTxt}</td>
        <td>${totalTxt}</td>
        <td>${safeStr(r.sentiment) || "—"}</td>
        <td>${safeStr(r.summary) || "<span class='muted'>—</span>"}</td>
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
    renderFeed(filteredRows);
    $("lastUpdated").textContent = `Updated ${new Date().toLocaleString()}`;
  }

  function clearDataUI(msg) {
    allRows = [];
    filteredRows = [];
    $("badgeCount").textContent = "—";
    $("kpiGrid").innerHTML = "";
    $("tableWrap").style.display = "none";
    $("stateBox").style.display = "block";
    $("stateBox").textContent = msg || "—";
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    const ok = await ensureAuthGate();
    if (!ok) return;

    const state = $("stateBox");
    const wrap = $("tableWrap");
    wrap.style.display = "none";
    state.style.display = "block";
    state.textContent = "Loading…";

    try {
      lastRange = getSelectedRange();
      $("badgeWindow").textContent = lastRange.label;

      const [resv, calls] = await Promise.all([
        fetchTableInRange(TABLES.reservations, lastRange, 2000),
        fetchTableInRange(TABLES.callEvents, lastRange, 3000),
      ]);

      const normalized = [];
      for (const r of (resv.data || [])) normalized.push(normalizeReservationRow(r, resv.tsField));
      for (const e of (calls.data || [])) normalized.push(normalizeCallEventRow(e, calls.tsField));

      allRows = normalized.map(r => {
        if (!r.when) r.when = parseISOish(r.whenRaw);
        return r;
      });

      if (!allRows.length) {
        // tell you whether RLS is blocking
        const probes = await probeAccess();
        const lines = probes.map(p =>
          `• ${p.table}: ${p.ok ? "OK" : "BLOCKED"}${p.error ? ` — ${p.error}` : ""}`
        ).join("\n");

        state.textContent =
          `Signed in, but no rows returned.\n\n` +
          `Most common cause: RLS is blocking SELECT.\n\n` +
          `Probe:\n${lines}\n\n` +
          `If tables are not empty in Supabase editor, you must add SELECT policies.`;
      }

      renderAll();
      toast("Dashboard refreshed.");
    } catch (err) {
      console.error(err);
      state.textContent = `Error: ${err?.message || err}`;
      toast("Load failed. Check console + Supabase settings.");
    }
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
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

    // Always show login overlay first (so /dashboard isn't "open")
    showOverlay(true);
    clearDataUI("Please sign in to load dashboard data.");

    // If you want NO silent session carry-over, force sign out every visit:
    if (FORCE_REAUTH_EACH_VISIT) {
      await hardSignOutAndReload();
      return; // hardSignOut reloads
    }

    // Otherwise: process magic-link session if present in URL
    await ensureAuthGate();
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await loadAndRender();

    // Friendly hint
    const { data: { session: s2 } } = await supabaseClient.auth.getSession();
    if (s2?.user?.email && s2.user.email !== FOUNDER_EMAIL) {
      toast("Signed in (non-founder). Access depends on Supabase RLS policies.");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
