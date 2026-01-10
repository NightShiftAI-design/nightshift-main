// public/dashboard/app.js
(() => {
  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);

  const fmtInt = (n) => Number.isFinite(n) ? n.toLocaleString() : "—";
  const fmtMoney = (n) => Number.isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : "—";
  const fmtPct = (n) => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
  const safeStr = (v) => (v === null || v === undefined) ? "" : String(v);

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
    // Supabase v2 stores auth tokens in localStorage keys like: sb-<projectref>-auth-token
    try {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) localStorage.removeItem(k);
      }
    } catch {}
  }

  // ---------- Theme ----------
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

  // ---------- Supabase ----------
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

    return window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    });
  }

  // ---------- Tables ----------
  const TABLES = {
    reservations: "reservations",
    callEvents: "call_events",
  };

  // Timestamp candidates we will try (because schemas differ)
  const TS_CANDIDATES = ["created_at", "inserted_at", "timestamp", "ts"];

  // ---------- State ----------
  let supabaseClient = null;
  let allRows = [];
  let filteredRows = [];
  let lastRange = null;

  // ---------- Auth UI ----------
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

  async function ensureAuthGate() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) console.warn("getSession error:", error);

    setSessionUI(session);

    if (!session) {
      showOverlay(true);
      if ($("stateBox")) $("stateBox").textContent = "Please sign in to load dashboard data.";
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
      try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.warn("signOut error:", error);
      } catch (e) {
        console.warn("signOut threw:", e);
      }

      // Hard clear in case token is stuck
      clearSupabaseAuthStorage();

      toast("Signed out.");
      setSessionUI(null);
      showOverlay(true);
      clearDataUI("Signed out. Please login to view data.");

      // Force a clean state
      setTimeout(() => window.location.reload(), 300);
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

    if (!email || !email.includes("@")) {
      return setAuthError("Enter a valid email address.");
    }

    // MUST be allowed in Supabase Auth -> URL Configuration -> Redirect URLs
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

  // ---------- Controls ----------
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
      const fallback = (() => {
        const now2 = new Date();
        const s2 = startOfDay(new Date(now2.getFullYear(), now2.getMonth(), now2.getDate() - 6));
        return { label: "Last 7 days", start: s2, end: endOfDay(now2) };
      })();
      return fallback;
    }
    return { label: `${sVal} → ${eVal}`, start: s, end: e };
  }

  // ---------- Fetch ----------
  async function fetchTableInRange(tableName, range, limit, tsCandidates) {
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();

    // Try filtering by various timestamp fields
    for (const tsField of tsCandidates) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .gte(tsField, startISO)
        .lte(tsField, endISO)
        .order(tsField, { ascending: false })
        .limit(limit);

      if (!error) return { data: data || [], tsField, mode: `range:${tsField}` };
    }

    // Fallback: try ordering by candidates (no filtering)
    for (const tsField of tsCandidates) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("*")
        .order(tsField, { ascending: false })
        .limit(Math.min(limit, 500));

      if (!error) return { data: data || [], tsField, mode: `order:${tsField}` };
    }

    // Final fallback: just limit(200) raw
    const { data, error } = await supabaseClient
      .from(tableName)
      .select("*")
      .limit(200);

    if (error) return { data: [], tsField: "", mode: "raw", error };
    return { data: data || [], tsField: "", mode: "raw" };
  }

  async function fetchReservations(range) {
    return fetchTableInRange(TABLES.reservations, range, 2000, TS_CANDIDATES);
  }

  async function fetchCallEvents(range) {
    return fetchTableInRange(TABLES.callEvents, range, 3000, TS_CANDIDATES);
  }

  async function probeWhyEmpty() {
    // Small probes that help us distinguish: (1) RLS vs (2) wrong table/columns
    const probes = [];

    for (const t of [TABLES.reservations, TABLES.callEvents]) {
      const { data, error } = await supabaseClient.from(t).select("*").limit(1);
      probes.push({
        table: t,
        ok: !error,
        rowReturned: !!(data && data.length),
        error: error?.message || ""
      });
    }

    return probes;
  }

  // ---------- Normalize ----------
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

  // ---------- Filtering / KPIs / Feed ----------
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

    const sentimentCounts = rows.reduce((acc, r) => {
      const s = safeStr(r.sentiment).toLowerCase();
      if (!s) return acc;
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    return { totalCalls, totalBookings, conv, avgDur, revenue, sentimentCounts };
  }

  function renderKPIs(k) {
    const el = $("kpiGrid");
    if (!el) return;
    el.innerHTML = "";

    const tiles = [
      { name: "Total calls", value: fmtInt(k.totalCalls), sub: "all call events in range" },
      { name: "Bookings", value: fmtInt(k.totalBookings), sub: "reservations captured" },
      { name: "Conversion", value: fmtPct(k.conv), sub: "bookings ÷ calls" },
      { name: "Booking revenue", value: fmtMoney(k.revenue), sub: "sum of total_due (if present)" },
      { name: "Avg call duration", value: Number.isFinite(k.avgDur) ? `${Math.round(k.avgDur)}s` : "—", sub: "based on duration_seconds" },
      { name: "Positive sentiment", value: fmtInt(k.sentimentCounts["positive"] || 0), sub: "rows tagged positive" },
      { name: "Neutral sentiment", value: fmtInt(k.sentimentCounts["neutral"] || 0), sub: "rows tagged neutral" },
      { name: "Negative sentiment", value: fmtInt(k.sentimentCounts["negative"] || 0), sub: "rows tagged negative" },
    ];

    for (const t of tiles) {
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<p class="name">${t.name}</p><p class="value">${t.value}</p><p class="sub">${t.sub}</p>`;
      el.appendChild(div);
    }
  }

  function renderOpsInsights(_k, _rows) {
    const box = $("opsInsights");
    if (!box) return;
    box.innerHTML = `<div class="state">Signals will populate when data loads.</div>`;
  }

  function renderFeed(rows) {
    const state = $("stateBox");
    const wrap = $("tableWrap");
    const tbody = $("feedTbody");

    $("badgeCount").textContent = fmtInt(rows.length);
    $("feedMeta").textContent = `${fmtInt(rows.length)} items`;

    if (!rows.length) {
      if (wrap) wrap.style.display = "none";
      if (state) {
        state.style.display = "block";
        state.textContent = "No data returned for this range (or access blocked).";
      }
      return;
    }

    if (state) state.style.display = "none";
    if (wrap) wrap.style.display = "block";
    if (!tbody) return;

    const sorted = [...rows].sort((a, b) => {
      const ta = a.when ? a.when.getTime() : -Infinity;
      const tb = b.when ? b.when.getTime() : -Infinity;
      return tb - ta;
    });

    tbody.innerHTML = "";

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
        r.kind,
        time,
        safeStr(r.event),
        safeStr(r.guest),
        safeStr(r.arrival),
        Number.isFinite(r.nights) ? r.nights : "",
        Number.isFinite(r.totalDue) ? r.totalDue : "",
        safeStr(r.sentiment),
        safeStr(r.summary),
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
    renderOpsInsights(k, filteredRows);
    renderFeed(filteredRows);

    $("lastUpdated").textContent = `Updated ${new Date().toLocaleString()}`;
  }

  function clearDataUI(msg) {
    allRows = [];
    filteredRows = [];
    $("badgeCount").textContent = "—";
    $("kpiGrid").innerHTML = "";
    $("opsInsights").innerHTML = "";
    $("tableWrap").style.display = "none";
    $("stateBox").style.display = "block";
    $("stateBox").textContent = msg || "—";
  }

  // ---------- Load ----------
  async function loadAndRender() {
    const ok = await ensureAuthGate();
    if (!ok) return;

    const state = $("stateBox");
    const wrap = $("tableWrap");

    if (wrap) wrap.style.display = "none";
    if (state) {
      state.style.display = "block";
      state.textContent = "Loading…";
    }

    try {
      lastRange = getSelectedRange();
      $("badgeWindow").textContent = lastRange.label;

      const [resv, calls] = await Promise.all([
        fetchReservations(lastRange),
        fetchCallEvents(lastRange),
      ]);

      const normalized = [];
      for (const r of (resv.data || [])) normalized.push(normalizeReservationRow(r, resv.tsField));
      for (const e of (calls.data || [])) normalized.push(normalizeCallEventRow(e, calls.tsField));

      allRows = normalized.map(r => {
        if (!r.when) r.when = parseISOish(r.whenRaw);
        return r;
      });

      if (!allRows.length) {
        const probes = await probeWhyEmpty();
        const probeText = probes.map(p =>
          `• ${p.table}: ${p.ok ? "OK" : "ERROR"} ${p.rowReturned ? "(row exists)" : "(no row returned)"}${p.error ? ` — ${p.error}` : ""}`
        ).join("\n");

        if (state) {
          state.textContent =
            "Signed in, but no rows were returned.\n\n" +
            "This is almost always RLS blocking SELECT, or the table is empty.\n\n" +
            "Probe:\n" + probeText + "\n\n" +
            "If probe shows OK but no rows: table is empty.\n" +
            "If probe shows ERROR or OK/no rows while you KNOW there is data: RLS is blocking reads.";
        }
      }

      renderAll();
      toast("Dashboard refreshed.");
    } catch (err) {
      console.error(err);
      if (state) state.textContent = `Error: ${err?.message || err}`;
      toast("Load failed. Check console + Supabase settings.");
    }
  }

  // ---------- Init ----------
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

    await ensureAuthGate();

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await loadAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
