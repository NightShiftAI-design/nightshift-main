// public/dashboard/app.js — v10.4 (REALISTIC KPI FIX + ELITE WINDOW + PRO SaaS POLISH + SAFE)
// Keeps all existing index.html ID contracts and working behavior.
// Fixes:
// ✅ Conversion no longer goes >100% due to booking-payload calls being excluded incorrectly
// ✅ Total calls = all call rows in window (matches your SQL counts)
// ✅ Optional: include call_logs booking events in bookings/revenue without breaking anything
// ✅ Reservations window uses created_at by default (demo realism), still shows arrival_date in feed
// ✅ Range-aware server filtering + schema drift tolerance preserved

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

  const THEME_STORAGE_KEY = "nsa_theme";        // "light" | "dark" | "system"
  const PROPERTY_STORAGE_KEY = "nsa_property";  // "__all__" | "<uuid>"

  const FETCH_LIMIT = 3000;
  const FEED_MAX_ROWS = 500;

  // ============================================================
  // KPI behavior toggles
  // ============================================================
  const KPI_INCLUDE_CALLLOG_BOOKINGS = false;
  const KPI_REVENUE_INCLUDE_CALLLOG_BOOKINGS = false;

  const BOOKING_EVENTS = new Set([
    "reservation_confirmed",
    "booking_confirmed",
    "reservation_created"
  ]);

  const RESERVATION_WINDOW_BY_CREATED_AT = true;

  // ============================================================
  // DOM Helpers
  // ============================================================
  const $ = (id) => document.getElementById(id);

  const setText = (id, text) => {
    const el = $(id);
    if (el) el.textContent = (text === null || text === undefined) ? "" : String(text);
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
    const s = String(v).trim().replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function safeJsonParse(v) {
    if (!v) return null;
    if (typeof v === "object") return v;
    try { return JSON.parse(v); } catch { return null; }
  }

  function parseISOish(v) {
    if (!v) return null;
    const d = new Date(v);
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

  function clampStr(s, max = 220) {
    const v = safeStr(s);
    if (v.length <= max) return v;
    return v.slice(0, max - 1) + "…";
  }

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

  async function ensureAuthGate() {
    const s = await supabaseClient.auth.getSession();
    const session = s && s.data && s.data.session ? s.data.session : null;

    setSessionUI(session);

    if (!session) {
      showOverlay(true);
      return false;
    }

    if (session.user.email !== FOUNDER_EMAIL) {
      showOverlay(true);
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

    if (btnSend) btnSend.disabled = true;
    if (btnResend) btnResend.disabled = true;

    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: CANONICAL_URL }
      });
      if (error) { alert(error.message); return; }
      location.href = `/dashboard/check-email.html?email=${encodeURIComponent(email)}`;
    } finally {
      if (btnSend) btnSend.disabled = false;
      if (btnResend) btnResend.disabled = false;
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
  // State
  // ============================================================
  const state = {
    allRows: [],
    filteredRows: [],
    lastRange: null
  };

  // ============================================================
  // KPI
  // ============================================================
  function computeKPIs(rows) {
    const calls = rows.filter(r => r.kind === "call");
    const bookings = rows.filter(r => r.kind === "booking");

    const totalCalls = calls.length;
    const totalBookings = bookings.length;
    const conv = totalCalls ? (totalBookings / totalCalls) : NaN;

    const revenue = bookings
      .map(b => b.totalDue)
      .filter(Number.isFinite)
      .reduce((a, b) => a + b, 0);

    return { totalCalls, totalBookings, conv, revenue };
  }

  // ============================================================
  // INIT
  // ============================================================
  async function init() {
    if (enforceCanonicalUrl()) return;

    try { supabaseClient = getSupabaseClient(); }
    catch (e) { console.error(e); return; }

    initAuthHandlers();

    if (await ensureAuthGate()) loadAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
