// public/dashboard/app.js — v10.3 (ELITE DATA WINDOW FIX + PRO SaaS POLISH + SAFE)
// public/dashboard/app.js — v10.4 (REALISTIC KPI FIX + ELITE WINDOW + PRO SaaS POLISH + SAFE)
// Keeps all existing index.html ID contracts and working behavior.
// Key upgrades:
// ✅ Reservations now show in 7/30-day windows by default (filters by created_at; still displays arrival_date)
// ✅ Cleaner KPI logic (calls exclude booking-events; configurable)
// ✅ Safer Supabase fetch (range-aware server filtering when possible; falls back cleanly)
// ✅ Stronger date parsing + money parsing + schema drift tolerance
// ✅ More professional state messaging + error surfacing without breaking UI
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
  // ✅ KPI behavior toggles
  // KPI behavior toggles
// ============================================================
  // If true, “Bookings” includes call_logs booking events like reservation_confirmed.
  // If false, “Bookings” uses reservations table only.
  // Bookings count from reservations table only (recommended)
const KPI_INCLUDE_CALLLOG_BOOKINGS = false;

  // If true, revenue also includes call_logs totals for booking events.
  // Default false to avoid double counting (recommended for demo cleanliness).
  // Revenue from reservations table only (recommended; avoids double count)
const KPI_REVENUE_INCLUDE_CALLLOG_BOOKINGS = false;

  // Which events in call_logs.booking.event count as a “booking”
  // call_logs.booking.event values that represent booking events
const BOOKING_EVENTS = new Set([
"reservation_confirmed",
"booking_confirmed",
"reservation_created"
]);

// ============================================================
  // ✅ Date-window behavior (THIS fixes “bookings not showing”)
  // Date-window behavior
// ============================================================
  // If true, reservations are filtered by created_at for date windows.
  // If false, reservations are filtered by arrival_date (stay date).
  // For Elite demo realism, keep this TRUE.
  // TRUE = reservations are windowed by created_at (best for dashboard demo)
  // FALSE = reservations are windowed by arrival_date (stay date)
const RESERVATION_WINDOW_BY_CREATED_AT = true;

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
    // Allow currency strings like "$74.06", "74.06", "74,06"
const s = String(v).trim().replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
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
if (!s) return null;

    // dd-mm-yyyy
const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
if (ddmmyyyy) {
const [, dd, mm, yyyy] = ddmmyyyy;
const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
return Number.isFinite(d.getTime()) ? d : null;
}

    // yyyy-mm-dd
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
  // Crash visibility (surface errors in stateBox)
  // Crash visibility
// ============================================================
window.addEventListener("error", (e) => {
try {
if ($("stateBox")) $("stateBox").textContent = `JS error: ${e.message || e.error || "Unknown error"}`;
} catch {}
});

window.addEventListener("unhandledrejection", (e) => {
try {
const msg = (e && e.reason && e.reason.message) ? e.reason.message : String(e.reason || "Promise error");
if ($("stateBox")) $("stateBox").textContent = `Load error: ${msg}`;
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

function setFeedVisibility(hasRows) {
const empty = $("feedEmpty");
const wrap = $("feedTableWrap");
if (empty) empty.style.display = hasRows ? "none" : "";
if (wrap) wrap.style.display = hasRows ? "" : "none";
}

function clearDataUI(msg) {
setText("stateBox", msg || "—");
setFeedVisibility(false);
setText("badgeCount", "0");
setText("feedMeta", "0 items");
const tbody = $("feedTbody");
if (tbody) tbody.innerHTML = "";
const kpi = $("kpiGrid");
if (kpi) kpi.innerHTML = "";
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

enableCustomDates(true);
const sVal = $("startDate") ? $("startDate").value : "";
const eVal = $("endDate") ? $("endDate").value : "";

if (sVal && eVal) {
const sd = startOfDay(new Date(sVal));
const ed = endOfDay(new Date(eVal));
return { label: `${sVal} → ${eVal}`, start: sd, end: ed, mode: "custom" };
}

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
  // Fetch + Normalize (range-aware, schema-safe)
  // Fetch (range-aware)
// ============================================================
function isoForSupabase(d) {
    // Supabase accepts ISO timestamps
return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

async function fetchCalls(range) {
    // call_logs should always be filterable by created_at
const q = supabaseClient
.from("call_logs")
.select("*")
.order("created_at", { ascending: false })
.limit(FETCH_LIMIT);

    // Range server-filter to avoid pulling entire history
if (range && range.start && range.end) {
q.gte("created_at", isoForSupabase(range.start)).lte("created_at", isoForSupabase(range.end));
}

const { data, error } = await q;
if (error) throw error;
return data || [];
}

  function canServerFilterReservationsByArrival(sampleVal) {
    // Only safe if arrival_date looks like yyyy-mm-dd
    const s = safeStr(sampleVal).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

async function fetchReservations(range) {
    // Prefer server filtering by created_at if we're windowing by created_at
    // Otherwise, try arrival_date only if it's yyyy-mm-dd; else fallback to client filtering.
const q = supabaseClient
.from("reservations")
.select("*")
.order("created_at", { ascending: false })
.limit(FETCH_LIMIT);

if (range && range.start && range.end) {
if (RESERVATION_WINDOW_BY_CREATED_AT) {
q.gte("created_at", isoForSupabase(range.start)).lte("created_at", isoForSupabase(range.end));
}
      // If not windowing by created_at, we will client-filter by arrival_date because it may be dd-mm-yyyy.
      // We'll keep the query broad (still limited) for safety.
}

const { data, error } = await q;
if (error) throw error;
return data || [];
}

  // ✅ derive a trustworthy nightly rate from various shapes
  // ============================================================
  // Normalize
  // ============================================================
function computeRatePerNight({ rate, nightly_rate, rate_per_night, total_due, nights, adr, avg_rate }) {
const direct =
toNum(rate_per_night) ||
toNum(nightly_rate) ||
toNum(rate) ||
toNum(adr) ||
toNum(avg_rate);

if (Number.isFinite(direct) && direct > 0) return direct;

const t = toNum(total_due);
const n = toNum(nights);
if (Number.isFinite(t) && Number.isFinite(n) && n > 0) return t / n;

return NaN;
}

function normalizeReservation(r) {
const arrival = safeStr(r.arrival_date);
const arrivalDate = parseISOish(arrival);
const created = parseISOish(r.created_at);

const nights = toNum(r.nights);

const ratePerNight = computeRatePerNight({
rate_per_night: r.rate_per_night,
nightly_rate: r.nightly_rate,
rate: r.rate,
adr: r.adr,
avg_rate: r.avg_rate,
total_due: r.total_due,
nights: r.nights
});

    // ✅ KEY FIX:
    // "Last 7/30 days" usually means bookings created recently, not future arrival date.
const windowDate = RESERVATION_WINDOW_BY_CREATED_AT ? created : arrivalDate;

const guest = safeStr(r.guest_name);
const summary =
safeStr(r.summary) ||
(guest || arrival
? `Reservation for ${guest || "Guest"} • Arrive ${arrival || "—"}`
: "Reservation created");

return {
kind: "booking",
when: created || arrivalDate,
businessDate: windowDate || created || arrivalDate,
guest,
arrival,
nights,
ratePerNight,
totalDue: toNum(r.total_due),
sentiment: "",
duration: NaN,
summary,
property_id: safeStr(r.property_id),
raw: r
};
}

function normalizeCall(r) {
const booking = safeJsonParse(r.booking) || {};

    const guest =
      safeStr(booking.guest_name || booking.guest || r.guest_name || "");

    const guest = safeStr(booking.guest_name || booking.guest || r.guest_name || "");
const arrival = safeStr(booking.arrival_date || booking.arrival || "");

const nights = toNum(booking.nights);
const totalDue = toNum(booking.total_due || booking.total || booking.total_due_usd);

const ratePerNight = computeRatePerNight({
rate_per_night:
booking.rate_per_night ??
booking.ratePerNight ??
booking.rate_per_night_usd ??
booking.rate_nightly,
nightly_rate: booking.nightly_rate,
rate: booking.rate,
adr: booking.adr,
avg_rate: booking.avg_rate,
total_due: booking.total_due,
nights: booking.nights
});

const when = parseISOish(r.created_at);

return {
kind: "call",
when,
businessDate: when,
guest,
arrival,
nights,
ratePerNight,
totalDue,
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
  // Dedupe
// ============================================================
function dedupeRows(rows) {
const seen = new Set();
const out = [];

for (const r of rows) {
const raw = r.raw || {};
const booking = safeJsonParse(raw.booking) || {};

const fp = [
r.kind,
safeStr(r.property_id),
safeStr(booking.event || ""),
safeStr(booking.guest_name || r.guest || ""),
safeStr(booking.arrival_date || r.arrival || ""),
safeStr(booking.room_type || ""),
safeStr(booking.total_due || r.totalDue || ""),
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

      // Date window filtering
const d = r.businessDate || r.when;
if (d) {
if (d < range.start || d > range.end) return false;
}

if (!q) return true;

      // More professional search: only search key fields + summary (faster than JSON stringify)
const hay = [
r.kind,
r.property_id,
r.guest,
r.arrival,
r.sentiment,
r.summary
].map(x => safeStr(x).toLowerCase()).join(" | ");

return hay.includes(q);
});

state.filteredRows = dedupeRows(state.filteredRows);
}

// ============================================================
  // ✅ KPI helpers
  // KPI helpers
// ============================================================
function isCallLogBookingEvent(r) {
if (!r || r.kind !== "call") return false;
const b = safeJsonParse(r.raw && r.raw.booking) || {};
const ev = safeStr(b.event).trim();
return BOOKING_EVENTS.has(ev);
}

// ============================================================
  // KPIs (Bubbles)
  // KPIs
// ============================================================
function computeKPIs(rows) {
const calls = rows.filter(r => r.kind === "call");
const bookingsTable = rows.filter(r => r.kind === "booking");

const bookingEventsFromCalls = KPI_INCLUDE_CALLLOG_BOOKINGS
? calls.filter(isCallLogBookingEvent)
: [];

    // ✅ Calls metric should exclude booking-confirmation rows (more realistic conversion)
    const totalCalls = calls.filter(c => !isCallLogBookingEvent(c)).length;
    // ✅ FIX: Total calls should reflect ALL calls in the window (matches SQL, prevents >100% inflation)
    const totalCalls = calls.length;

const totalBookings = bookingsTable.length + bookingEventsFromCalls.length;
const conv = totalCalls ? (totalBookings / totalCalls) : NaN;

const durations = calls.map(c => c.duration).filter(Number.isFinite);
const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : NaN;

    // Revenue: safest by default is reservations table only (avoids double counting)
    // Revenue default: reservations only
let revenue = bookingsTable
.map(b => b.totalDue)
.filter(Number.isFinite)
.reduce((a, b) => a + b, 0);

if (KPI_REVENUE_INCLUDE_CALLLOG_BOOKINGS && bookingEventsFromCalls.length) {
const callRevenue = bookingEventsFromCalls
.map(r => r.totalDue)
.filter(Number.isFinite)
.reduce((a, b) => a + b, 0);
revenue += callRevenue;
}

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
  // Charts (if canvases exist)
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
// Feed
// ============================================================
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
      const ad = (a.kind === "booking" ? (a.when || a.businessDate) : (a.when || a.businessDate));
      const bd = (b.kind === "booking" ? (b.when || b.businessDate) : (b.when || b.businessDate));
      const ad = (a.when || a.businessDate);
      const bd = (b.when || b.businessDate);
return (bd && bd.getTime ? bd.getTime() : 0) - (ad && ad.getTime ? ad.getTime() : 0);
});

for (const r of sorted.slice(0, FEED_MAX_ROWS)) {
const ev = classifyEvent(r);
const tr = document.createElement("tr");
      tr.dataset.event = ev; // ✅ required by your filter script
      tr.dataset.event = ev;

const rateCell = Number.isFinite(r.ratePerNight) ? fmtMoney(r.ratePerNight) : "—";
const totalCell = Number.isFinite(r.totalDue) ? fmtMoney(r.totalDue) : "—";
const nightsCell = Number.isFinite(r.nights) ? String(r.nights) : "—";

tr.innerHTML = `
       <td>${r.when ? escHtml(r.when.toLocaleString()) : "—"}</td>
       <td>${escHtml(ev)}</td>
       <td>${escHtml(r.guest || "—")}</td>
       <td>${escHtml(r.arrival || "—")}</td>
       <td>${escHtml(nightsCell)}</td>
       <td>${escHtml(rateCell)}</td>
       <td>${escHtml(totalCell)}</td>
       <td>${escHtml(r.sentiment || "—")}</td>
       <td>${escHtml(clampStr(r.summary || "—", 260))}</td>
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
Number.isFinite(r.ratePerNight) ? r.ratePerNight : "",
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
  // UI badges + “last updated”
  // UI badges + last updated
// ============================================================
function updateWindowBadges() {
const label = state.lastRange ? state.lastRange.label : "—";
setText("badgeWindow", label);
setText("badgeWindowInline", `Window: ${label}`);
setText("badgeWindowMirror", label);
}

function updateLastUpdated() {
const t = new Date().toLocaleString();
setText("lastUpdated", `Updated ${t}`);
}

// ============================================================
// Render All
// ============================================================
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
function setLoadingState(isLoading) {
    // Professional SaaS feel: status line changes without breaking layout
const sb = $("stateBox");
if (!sb) return;
sb.textContent = isLoading ? "Loading data…" : "";
}

async function loadAndRender() {
if (!(await ensureAuthGate())) return;

try {
state.lastRange = getSelectedRange();
updateWindowBadges();

setLoadingState(true);

const [resvRaw, callsRaw] = await Promise.all([
fetchReservations(state.lastRange),
fetchCalls(state.lastRange)
]);

      // Normalize
const resv = (resvRaw || []).map(normalizeReservation);
const calls = (callsRaw || []).map(normalizeCall);

      // If reservations are not server-filtered by arrival_date (custom format), ensure client filter still applies.
      // (applyFilters() will filter by businessDate automatically)
state.allRows = resv.concat(calls);

populatePropertySelect(state.allRows);

setLoadingState(false);
setText("stateBox", "");

renderAll();
toast("Dashboard refreshed.");
} catch (e) {
console.error(e);
setLoadingState(false);
clearDataUI(`Load error: ${e && e.message ? e.message : "Unknown error"}`);
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
clearDataUI("Please sign in to load dashboard data.");
return;
}

if (await ensureAuthGate()) loadAndRender();

    // Refresh when returning to tab
document.addEventListener("visibilitychange", () => {
if (document.visibilityState === "visible") loadAndRender();
});

    // Refresh when bfcache restores page
window.addEventListener("pageshow", (e) => {
if (e.persisted) loadAndRender();
});
}

document.addEventListener("DOMContentLoaded", init);
})();
