(function () {
  // ====== Basic load checks (friendly messages) ======
  if (!window.NSA_CONFIG) {
    document.body.innerHTML =
      "<pre style='color:#fff'>Missing /dashboard/config.js\n\nCreate dashboard/config.js and set NSA_CONFIG.SUPABASE_URL + NSA_CONFIG.SUPABASE_ANON_KEY.</pre>";
    return;
  }
  if (!window.supabase) {
    document.body.innerHTML =
      "<pre style='color:#fff'>Supabase JS failed to load.\n\nIf unpkg is blocked, try another CDN or check network settings.</pre>";
    return;
  }

  const SUPABASE_URL = window.NSA_CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.NSA_CONFIG.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    document.body.innerHTML =
      "<pre style='color:#fff'>Missing Supabase config.\n\nEdit /dashboard/config.js and set SUPABASE_URL + SUPABASE_ANON_KEY.</pre>";
    return;
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ====== DOM elements ======
  const authDiv = document.getElementById("auth");
  const appDiv = document.getElementById("app");

  const who = document.getElementById("who");
  const count = document.getElementById("count");
  const rows = document.getElementById("rows");
  const authMsg = document.getElementById("authMsg");

  const emailInput = document.getElementById("email");
  const sendLinkBtn = document.getElementById("sendLink");
  const logoutBtn = document.getElementById("logout");

  function showAuth(message = "") {
    authDiv.classList.remove("hidden");
    appDiv.classList.add("hidden");
    authMsg.textContent = message;
  }

  function showApp() {
    authDiv.classList.add("hidden");
    appDiv.classList.remove("hidden");
    authMsg.textContent = "";
  }

  function safeText(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }

  function money(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "$0.00";
    return `$${n.toFixed(2)}`;
  }

  // ====== Render ======
  async function render() {
    // 1) Session check (avoids "Auth session missing!" noise)
    const { data: { session }, error: sessErr } = await supabase.auth.getSession();

    if (sessErr) {
      // This is a real error
      showAuth(sessErr.message);
      return;
    }

    if (!session) {
      showAuth(""); // Not logged in yet — no error needed
      return;
    }

    // 2) Now safely load user + data
    showApp();

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      // session exists but user fetch failed — show message but keep app visible
      authMsg.textContent = userErr.message;
    }
    who.textContent = user?.email ? user.email : "(unknown user)";

    // 3) Fetch reservations (RLS should restrict per user later)
    const { data, error } = await supabase
      .from("reservations")
      .select("created_at, guest_name, arrival_date, nights, room_type, total_due, pets")
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      count.textContent = "Error loading reservations: " + error.message;
      rows.innerHTML = `<tr><td colspan="7">${safeText(error.message)}</td></tr>`;
      return;
    }

    count.textContent = `${data.length} loaded`;

    rows.innerHTML = data.map(r => `
      <tr>
        <td>${r.created_at ? new Date(r.created_at).toLocaleString() : ""}</td>
        <td>${safeText(r.guest_name)}</td>
        <td>${safeText(r.arrival_date)}</td>
        <td>${safeText(r.nights)}</td>
        <td>${safeText(r.room_type)}</td>
        <td>${money(r.total_due)}</td>
        <td>${safeText(r.pets)}</td>
      </tr>
    `).join("");
  }

  // ====== Auth actions ======
  async function sendMagicLink() {
    const email = (emailInput?.value || "").trim();
    if (!email) {
      authMsg.textContent = "Enter your email first.";
      return;
    }

    authMsg.textContent = "Sending magic link...";

    // IMPORTANT: ensure Supabase Auth URL Configuration includes this redirect URL
    const redirectTo = window.location.origin + "/dashboard/";

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });

    authMsg.textContent = error
      ? `Error: ${error.message}`
      : "Magic link sent. Check your email (and spam).";
  }

  async function logout() {
    await supabase.auth.signOut();
    // Clear UI quickly
    showAuth("");
  }

  // ====== Wire up events ======
  if (sendLinkBtn) sendLinkBtn.addEventListener("click", sendMagicLink);
  if (logoutBtn) logoutBtn.addEventListener("click", logout);

  // Re-render on auth changes
  supabase.auth.onAuthStateChange(() => {
    render();
  });

  // Initial render
  render();
})();
