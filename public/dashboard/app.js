// public/dashboard/app.js — v7 (Auth stable + Date filters + Tab resume fix)
(() => {
  // ============================================================
  // Settings
  // ============================================================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

  const CANONICAL_ORIGIN = "https://www.nightshifthotels.com";
  const CANONICAL_PATH = "/dashboard/";
  const CANONICAL_URL = `${CANONICAL_ORIGIN}${CANONICAL_PATH}`;

  const PERSIST_SESSION = true;

  // ============================================================
  // Helpers
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const safeStr = (v) => (v === null || v === undefined) ? "" : String(v);

  const toast = (msg) => {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
  const endOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);

  function clearSupabaseAuthStorage() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
      for (const k of Object.keys(sessionStorage)) if (k.startsWith("sb-")) sessionStorage.removeItem(k);
    } catch {}
  }

  // ============================================================
  // Canonical URL
  // ============================================================
  function enforceCanonicalUrl() {
    try {
      const p = window.location.pathname;

      if (window.location.origin !== CANONICAL_ORIGIN) {
        window.location.replace(`${CANONICAL_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`);
        return true;
      }

      if (p === "/dashboard" || p === "/dashboard/index.html") {
        window.location.replace(CANONICAL_URL);
        return true;
      }

      return false;
    } catch { return false; }
  }

  // ============================================================
  // Supabase
  // ============================================================
  function createClient() {
    const cfg = window.NSA_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      throw new Error("Missing Supabase config or SDK");
    }

    return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: PERSIST_SESSION,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    });
  }

  // ============================================================
  // State
  // ============================================================
  let supabaseClient = null;
  let authUnsub = null;
  let allRows = [];
  let filteredRows = [];
  let isLoading = false;

  // ============================================================
  // Auth UI
  // ============================================================
  function showOverlay(show) {
    $("authOverlay").style.display = show ? "flex" : "none";
  }

  function setSessionUI(session) {
    const email = session?.user?.email || "";
    $("authBadge").textContent = email ? "Unlocked" : "Locked";
    $("btnAuth").textContent = email ? "Account" : "Login";
    $("btnLogout").style.display = email ? "inline-flex" : "none";
    $("authStatus").textContent = email ? `Signed in as ${email}` : "Not signed in";
  }

  async function HARD_LOGOUT() {
    try { await supabaseClient.auth.signOut(); } catch {}
    try { authUnsub?.(); } catch {}
    clearSupabaseAuthStorage();
    toast("Signed out");
    setTimeout(() => window.location.replace(CANONICAL_URL), 150);
  }

  async function enforceFounder(session) {
    return session?.user?.email === FOUNDER_EMAIL;
  }

  async function attachAuthListener() {
    if (authUnsub) authUnsub();

    const { data } = supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      setSessionUI(session);

      if (!session) {
        showOverlay(true);
        clearDataUI("Please sign in to load dashboard data.");
        return;
      }

      if (!(await enforceFounder(session))) {
        clearDataUI("Unauthorized account.");
        await HARD_LOGOUT();
        return;
      }

      showOverlay(false);
      await loadAndRender();
    });

    authUnsub = data?.subscription?.unsubscribe;
  }

  async function ensureSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    setSessionUI(session);

    if (!session) {
      showOverlay(true);
      clearDataUI("Please sign in to load dashboard data.");
      return false;
    }

    if (!(await enforceFounder(session))) {
      clearDataUI("Unauthorized account.");
      await HARD_LOGOUT();
      return false;
    }

    showOverlay(false);
    return true;
  }

  async function sendMagicLink() {
    const email = safeStr($("authEmail").value).trim();
    if (!email || !email.includes("@")) return;

    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: CANONICAL_URL }
    });

    if (error) return toast(error.message || "Magic link failed");
    toast("Magic link sent");
  }

  // ============================================================
  // Date Range
  // ============================================================
  function getSelectedRange() {
    const mode = $("rangeSelect").value;
    const now = new Date();

    if (mode === "today") return { start: startOfDay(now), end: endOfDay(now) };

    if (mode === "7" || mode === "30") {
      const days = Number(mode);
      const s = new Date(now);
      s.setDate(s.getDate() - (days - 1));
      return { start: startOfDay(s), end: endOfDay(now) };
    }

    const sVal = $("startDate").value;
    const eVal = $("endDate").value;
    if (!sVal || !eVal) return null;

    return {
      start: startOfDay(new Date(`${sVal}T00:00:00`)),
      end: endOfDay(new Date(`${eVal}T00:00:00`)),
    };
  }

  function applyDateFilter() {
    const range = getSelectedRange();
    if (!range) {
      filteredRows = allRows;
      return;
    }

    filteredRows = allRows.filter(r => {
      if (!r.when) return false;
      const t = r.when.getTime();
      return t >= range.start.getTime() && t <= range.end.getTime();
    });
  }

  // ============================================================
  // Data
  // ============================================================
  const TABLES = { reservations: "reservations", callLogs: "call_logs" };
  const TS = ["created_at", "inserted_at", "timestamp", "time"];

  function parseDate(v) {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  async function fetchLatest(table) {
    for (const f of TS) {
      const { data, error } = await supabaseClient
        .from(table)
        .select("*")
        .order(f, { ascending: false })
        .limit(3000);
      if (!error) return { data, f };
    }
    return { data: [] };
  }

  function normalizeReservation(r, f) {
    return {
      kind: "booking",
      when: parseDate(r[f] || r.created_at),
      guest: safeStr(r.guest_name),
      arrival: safeStr(r.arrival_date),
      nights: r.nights,
      totalDue: Number(r.total_due),
      sentiment: "",
      summary: r.summary || `Reservation for ${r.guest_name}`,
      raw: r
    };
  }

  function normalizeCall(r, f) {
    let booking = null;
    try { booking = JSON.parse(r.booking); } catch {}

    return {
      kind: "call",
      when: parseDate(r[f] || r.created_at),
      guest: booking?.guest_name || r.caller_number || "",
      arrival: booking?.arrival_date || "",
      nights: null,
      totalDue: null,
      sentiment: r.sentiment || "",
      summary: r.summary || "",
      raw: r
    };
  }

  function dedupe(rows) {
    const seen = new Set();
    return rows.filter(r => {
      const k = `${r.kind}|${r.guest}|${r.arrival}|${r.totalDue || ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ============================================================
  // Render
  // ============================================================
  function renderFeed(rows) {
    const tbody = $("feedTbody");
    const wrap = $("tableWrap");
    const state = $("stateBox");

    $("badgeCount").textContent = rows.length;

    if (!rows.length) {
      wrap.style.display = "none";
      state.style.display = "block";
      state.textContent = "No data in selected range.";
      return;
    }

    state.style.display = "none";
    wrap.style.display = "block";
    tbody.innerHTML = "";

    for (const r of rows.slice(0, 500)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.when ? r.when.toLocaleString() : "—"}</td>
        <td>${r.kind}</td>
        <td>${r.guest || "—"}</td>
        <td>${r.arrival || "—"}</td>
        <td>${r.nights ?? "—"}</td>
        <td>${r.totalDue ? "$" + r.totalDue : "—"}</td>
        <td>${r.sentiment || "—"}</td>
        <td>${r.summary || "—"}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function clearDataUI(msg) {
    $("badgeCount").textContent = "—";
    $("tableWrap").style.display = "none";
    $("stateBox").style.display = "block";
    $("stateBox").textContent = msg || "—";
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    if (isLoading) return;
    isLoading = true;

    if (!(await ensureSession())) {
      isLoading = false;
      return;
    }

    $("stateBox").textContent = "Loading…";

    try {
      const [resv, calls] = await Promise.all([
        fetchLatest(TABLES.reservations),
        fetchLatest(TABLES.callLogs),
      ]);

      const rows = [];
      resv.data.forEach(r => rows.push(normalizeReservation(r, resv.f)));
      calls.data.forEach(r => rows.push(normalizeCall(r, calls.f)));

      allRows = dedupe(rows);

      applyDateFilter();
      renderFeed(filteredRows);

      toast("Updated");
    } catch (e) {
      console.error(e);
      clearDataUI("Load failed.");
    } finally {
      isLoading = false;
    }
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    clearSupabaseAuthStorage();

    try {
      supabaseClient = createClient();
    } catch {
      clearDataUI("Config error.");
      showOverlay(true);
      return;
    }

    await attachAuthListener();

    $("btnAuth").onclick = () => showOverlay(true);
    $("btnCloseAuth").onclick = () => showOverlay(false);
    $("btnSendLink").onclick = sendMagicLink;
    $("btnResendLink").onclick = sendMagicLink;
    $("btnLogout").onclick = HARD_LOGOUT;

    $("rangeSelect").onchange = loadAndRender;
    $("startDate").onchange = loadAndRender;
    $("endDate").onchange = loadAndRender;
    $("btnRefresh").onclick = loadAndRender;

    // ✅ FIX: resume when tab becomes active
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadAndRender();
    });

    // ✅ FIX: resume when restored from back/forward cache
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) loadAndRender();
    });

    await ensureSession();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
