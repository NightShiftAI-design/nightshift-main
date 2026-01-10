// public/dashboard/app.js
(() => {
  // ============================================================
  // Settings (edit these if you want)
  // ============================================================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

  // Always show login overlay on load (prevents "URL bypass" on shared computers)
  const ALWAYS_REQUIRE_LOGIN = true;

  // Do not persist sessions (prevents silent auto-login after refresh)
  const PERSIST_SESSION = false;

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

  // Escape HTML so we never inject raw user content into innerHTML
  function escHtml(str) {
    return safeStr(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
      throw new Error(
        "Missing Supabase config. Ensure dashboard/config.js sets window.NSA_CONFIG.SUPABASE_URL and SUPABASE_ANON_KEY, and supabase-js is loaded."
      );
    }

    return window.supabase.createClient(url, key, {
      auth: {
        persistSession: PERSIST_SESSION,
        autoRefreshToken: false,
        detectSessionInUrl: true,
      }
    });
  }

  // ============================================================
  // Tables
  // ============================================================
  const TABLES = {
    reservations: "reservations",
    callLogs: "call_logs",
  };

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
    $("authBadge").textContent = email ? "Unlocked" : "Locked";
    $("btnAuth").textContent = email ? "Account" : "Login";

    const logoutBtn = $("btnLogout");
    if (logoutBtn) logoutBtn.style.display = email ? "inline-flex" : "none";

    const authStatus = $("authStatus");
    if (authStatus) authStatus.textContent = email ? `Signed in as ${email}` : "Not signed in";
  }

  async function hardSignOut() {
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn("signOut threw:", e);
    }
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
      $("stateBox").textContent = "Please sign in to load dashboard data.";
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

    // MUST be allowed in Supabase Auth -> Redirect URLs
    const redirectTo = `${window.location.origin}/dashboard/`;

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

      if (!error) return { data: data || [], tsField, mode: `range:${tsField}` };
    }

    for (const tsField of TS_CANDIDATES) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .order(tsField, { ascending: false })
        .limit(Math.min(limit, 500));

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
      res.push({
        table: t,
        ok: !error,
        rows: (data || []).length,
        error: error?.message || ""
      });
    }
    return res;
  }

  // ============================================================
  // Normalize to unified feed rows
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
    const phone = safeStr(r?.from || r?.caller || r?.phone || r?.caller_phone || "");
    const duration = Number(r?.duration_seconds ?? r?.duration ?? NaN);
    const sentiment = safeStr(r?.sentiment || r?.call_sentiment || "");

    const summary =
      safeStr(r?.summary) ||
      safeStr(r?.notes) ||
      safeStr(r?.transcript_summary) ||
      `${event}${callId ? ` • ${callId}` : ""}${phone ? ` • ${phone}` : ""}${Number.isFinite(duration) ? ` • ${Math.round(duration)}s` : ""}`;

    return {
      kind: "call",
      when,
      whenRaw: r?.[tsField] || r?.created_at || r?.inserted_at || "",
      event,
      guest: phone || callId,
      arrival: "",
      nights: null,
      totalDue: null,
      sentiment,
      summary,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      raw: r,
    };
  }

  // ============================================================
  // Filtering / KPIs / Ops Signals / Feed
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
      { name: "Booking revenue", value: fmtMoney(k.revenue), sub: "sum total_due" },
      { name: "Avg call duration", value: Number.isFinite(k.avgDur) ? `${Math.round(k.avgDur)}s` : "—", sub: "duration_seconds" },
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

  function renderOpsSignals(k) {
    const box = $("opsInsights");
    if (!box) return;

    box.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div>
          <b>Watchlist</b><br/>
          <span style="color: var(--muted); font-size: 13px;">
            Negative sentiment: <b>${fmtInt(k.negativeCount)}</b><br/>
            Long calls (4m+): <b>${fmtInt(k.longCalls)}</b>
          </span>
        </div>
        <div>
          <b>Snapshot</b><br/>
          <span style="color: var(--muted); font-size: 13px;">
            Calls: <b>${fmtInt(k.totalCalls)}</b> • Bookings: <b>${fmtInt(k.totalBookings)}</b><br/>
            Conversion: <b>${fmtPct(k.conv)}</b> • Revenue: <b>${fmtMoney(k.revenue)}</b>
          </span>
        </div>
      </div>
    `;
  }

  function renderFeed(rows) {
    const state = $("stateBox");
    const wrap = $("tableWrap");
    const tbody = $("feedTbody");

    $("badgeCount").textContent = fmtInt(rows.length);
    $("feedMeta").textContent = `${fmtInt(rows.length)} items`;

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
    if (ops) ops.innerHTML = "—";

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
    wrap.style.display = "none";
    state.style.display = "block";
    state.textContent = "Loading…";

    try {
      lastRange = getSelectedRange();
      $("badgeWindow").textContent = lastRange.label;

      const [resv, calls] = await Promise.all([
        fetchTableInRange(TABLES.reservations, lastRange, 2000),
        fetchTableInRange(TABLES.callLogs, lastRange, 3000),
      ]);

      const normalized = [];
      for (const r of (resv.data || [])) normalized.push(normalizeReservationRow(r, resv.tsField));
      for (const c of (calls.data || [])) normalized.push(normalizeCallLogRow(c, calls.tsField));

      allRows = normalized.map(r => {
        if (!r.when) r.when = parseISOish(r.whenRaw);
        return r;
      });

      if (!allRows.length) {
        const probes = await probeAccess();
        const probeText = probes.map(p =>
          `• ${p.table}: ${p.ok ? `OK (rows visible: ${p.rows})` : `BLOCKED — ${p.error || "RLS"}`}`
        ).join("\n");

        state.textContent =
          "Signed in, but no rows returned.\n\n" +
          "If you see rows in Supabase Table Editor but the dashboard shows none, RLS is blocking SELECT.\n\n" +
          "Probe:\n" + probeText + "\n";
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

    if (ALWAYS_REQUIRE_LOGIN) {
      // Clear tokens so a refresh on shared machines doesn't silently keep session
      clearSupabaseAuthStorage();
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");

      // If user arrived from magic link, Supabase will detect URL token and SIGNED_IN will fire.
      // We still call getSession once so UI can update quickly if already authenticated.
      await supabaseClient.auth.getSession();
      return;
    }

    const gate = await ensureAuthGate();
    if (gate.ok) await loadAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
