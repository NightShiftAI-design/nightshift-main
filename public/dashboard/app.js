// public/dashboard/app.js — v5 HARD AUTH RESET BUILD
(() => {
  // ============================================================
  // Settings
  // ============================================================
  const FOUNDER_EMAIL = "founder@nightshifthotels.com";

  const CANONICAL_ORIGIN = "https://www.nightshifthotels.com";
  const CANONICAL_PATH = "/dashboard/";
  const CANONICAL_URL = `${CANONICAL_ORIGIN}${CANONICAL_PATH}`;

  const PERSIST_SESSION = true;

  const HIDE_BOOKING_LIKE_CALLS_WHEN_BOOKING_EXISTS = true;
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

  function clearSupabaseAuthStorage() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-")) localStorage.removeItem(k);
      }
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith("sb-")) sessionStorage.removeItem(k);
      }
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
    } catch {
      return false;
    }
  }

  // ============================================================
  // Supabase
  // ============================================================
  function createFreshClient() {
    const cfg = window.NSA_CONFIG || {};
    const url = cfg.SUPABASE_URL;
    const key = cfg.SUPABASE_ANON_KEY;

    if (!url || !key || !window.supabase) {
      throw new Error("Missing Supabase config or SDK.");
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
  // State
  // ============================================================
  let supabaseClient = null;
  let authListenerUnsub = null;

  // ============================================================
  // Auth UI
  // ============================================================
  function showOverlay(show) {
    const o = $("authOverlay");
    if (!o) return;
    o.style.display = show ? "flex" : "none";
  }

  function setSessionUI(session) {
    const email = session?.user?.email || "";
    $("authBadge").textContent = email ? "Unlocked" : "Locked";
    $("btnAuth").textContent = email ? "Account" : "Login";
    $("btnLogout").style.display = email ? "inline-flex" : "none";
    $("authStatus").textContent = email ? `Signed in as ${email}` : "Not signed in";
  }

  async function HARD_LOGOUT_AND_RESET() {
    try { await supabaseClient?.auth?.signOut(); } catch {}
    try { authListenerUnsub?.(); } catch {}

    clearSupabaseAuthStorage();

    toast("Signed out.");
    setTimeout(() => window.location.replace(CANONICAL_URL), 150);
  }

  async function enforceFounder(session) {
    if (!session?.user?.email) return false;
    return session.user.email === FOUNDER_EMAIL;
  }

  // ============================================================
  // Auth Flow
  // ============================================================
  async function attachAuthListener() {
    if (authListenerUnsub) authListenerUnsub();

    const { data } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      setSessionUI(session);

      if (event === "SIGNED_OUT" || !session) {
        showOverlay(true);
        clearDataUI("Please sign in to load dashboard data.");
        return;
      }

      if (!(await enforceFounder(session))) {
        clearDataUI("Unauthorized account.");
        await HARD_LOGOUT_AND_RESET();
        return;
      }

      showOverlay(false);
      await loadAndRender();
    });

    authListenerUnsub = data?.subscription?.unsubscribe;
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
      await HARD_LOGOUT_AND_RESET();
      return false;
    }

    showOverlay(false);
    return true;
  }

  async function sendMagicLink() {
    const email = safeStr($("authEmail")?.value).trim();
    if (!email || !email.includes("@")) return;

    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: CANONICAL_URL }
    });

    if (error) {
      toast(error.message || "Magic link failed.");
      return;
    }

    toast("Magic link sent.");
  }

  // ============================================================
  // Data
  // ============================================================
  const TABLES = { reservations: "reservations", callLogs: "call_logs" };
  const TS = ["created_at", "inserted_at", "timestamp", "time"];

  let allRows = [];
  let filteredRows = [];
  let lastRange = null;

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
        .limit(2000);
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
    const booking = (() => { try { return JSON.parse(r.booking); } catch { return null; } })();
    return {
      kind: "call",
      when: parseDate(r[f] || r.created_at),
      guest: booking?.guest_name || r.caller_number || "",
      arrival: booking?.arrival_date || "",
      nights: null,
      totalDue: null,
      sentiment: r.sentiment || "",
      summary: r.summary || "",
      booking,
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
  // Render (minimal for debug stability)
  // ============================================================
  function renderFeed(rows) {
    const tbody = $("feedTbody");
    const wrap = $("tableWrap");
    const state = $("stateBox");

    $("badgeCount").textContent = rows.length;

    if (!rows.length) {
      wrap.style.display = "none";
      state.style.display = "block";
      state.textContent = "No data.";
      return;
    }

    state.style.display = "none";
    wrap.style.display = "block";
    tbody.innerHTML = "";

    for (const r of rows.slice(0, 300)) {
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
    allRows = [];
    filteredRows = [];
    $("badgeCount").textContent = "—";
    $("tableWrap").style.display = "none";
    $("stateBox").style.display = "block";
    $("stateBox").textContent = msg || "—";
  }

  // ============================================================
  // Load
  // ============================================================
  async function loadAndRender() {
    if (!(await ensureSession())) return;

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
      filteredRows = allRows;

      renderFeed(filteredRows);
      toast("Loaded.");
    } catch (e) {
      console.error(e);
      clearDataUI("Load failed.");
    }
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    clearSupabaseAuthStorage(); // 🔥 ensures stale sessions cannot survive

    try {
      supabaseClient = createFreshClient();
    } catch (e) {
      clearDataUI("Config error.");
      showOverlay(true);
      return;
    }

    await attachAuthListener();

    $("btnAuth").onclick = () => showOverlay(true);
    $("btnCloseAuth").onclick = () => showOverlay(false);
    $("btnSendLink").onclick = sendMagicLink;
    $("btnResendLink").onclick = sendMagicLink;
    $("btnLogout").onclick = HARD_LOGOUT_AND_RESET;

    await ensureSession();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
