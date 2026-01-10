(function () {
  // Ensure config + supabase loaded
  if (!window.NSA_CONFIG) {
    document.body.innerHTML = "<pre style='color:#fff'>Missing /dashboard/config.js</pre>";
    return;
  }
  if (!window.supabase) {
    document.body.innerHTML = "<pre style='color:#fff'>Supabase JS failed to load (unpkg blocked?)</pre>";
    return;
  }

  const SUPABASE_URL = window.NSA_CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.NSA_CONFIG.SUPABASE_ANON_KEY;

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const authDiv = document.getElementById("auth");
  const appDiv = document.getElementById("app");
  const who = document.getElementById("who");
  const count = document.getElementById("count");
  const rows = document.getElementById("rows");
  const authMsg = document.getElementById("authMsg");

  async function render() {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (userErr) authMsg.textContent = userErr.message;

    if (!user) {
      authDiv.classList.remove("hidden");
      appDiv.classList.add("hidden");
      return;
    }

    authDiv.classList.add("hidden");
    appDiv.classList.remove("hidden");
    who.textContent = user.email;

    const { data, error } = await supabase
      .from("reservations")
      .select("created_at, guest_name, arrival_date, nights, room_type, total_due, pets")
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      count.textContent = "Error loading reservations: " + error.message;
      rows.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
      return;
    }

    count.textContent = `${data.length} loaded`;

    rows.innerHTML = data.map(r => `
      <tr>
        <td>${r.created_at ? new Date(r.created_at).toLocaleString() : ""}</td>
        <td>${r.guest_name ?? ""}</td>
        <td>${r.arrival_date ?? ""}</td>
        <td>${r.nights ?? ""}</td>
        <td>${r.room_type ?? ""}</td>
        <td>$${Number(r.total_due ?? 0).toFixed(2)}</td>
        <td>${r.pets ?? ""}</td>
      </tr>
    `).join("");
  }

  document.getElementById("sendLink").addEventListener("click", async () => {
    const email = document.getElementById("email").value.trim();
    authMsg.textContent = "";

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/dashboard/" }
    });

    authMsg.textContent = error ? error.message : "Magic link sent. Check your email.";
  });

  document.getElementById("logout").addEventListener("click", async () => {
    await supabase.auth.signOut();
    render();
  });

  supabase.auth.onAuthStateChange(() => render());
  render();
})();
