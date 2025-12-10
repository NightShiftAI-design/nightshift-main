import { supabase } from "./supabase-client.js";

// ------------------ AUTH CHECK ------------------
function requireAuth() {
  const session = localStorage.getItem("ns-session");
  if (!session) {
    window.location.href = "/dashboard/login.html";
  }
}
requireAuth();

// ------------------ LOGOUT ------------------
document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem("ns-session");
  window.location.href = "/dashboard/login.html";
});

// ------------------ LOAD DATA ------------------
async function loadDashboard() {

  // ---- CALL SUMMARY VIEW ----
  const { data: calls, error: callError } = await supabase
    .from("daily_calls_view")
    .select("*")
    .order("date", { ascending: false })
    .limit(7);

  if (callError) {
    document.getElementById("call-summary").innerHTML =
      "Error loading call summary.";
    console.error(callError);
  } else {
    document.getElementById("call-summary").innerHTML =
      calls.length > 0
        ? calls
            .map(c => `<p><strong>${c.date}</strong>: ${c.total_calls} calls</p>`)
            .join("")
        : "No data available.";
  }

  // ---- RESERVATIONS TABLE ----
  const { data: reservations, error: resError } = await supabase
    .from("reservations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (resError) {
    document.getElementById("reservations-list").innerHTML =
      "Error loading reservations.";
    console.error(resError);
  } else {
    document.getElementById("reservations-list").innerHTML =
      reservations.length > 0
        ? reservations
            .map(
              r => `
          <div class="reservation-card">
            <strong>${r.guest_name}</strong><br>
            ${r.room_type} — ${r.arrival_date}<br>
            Total: $${r.total_due}
          </div>
        `
            )
            .join("")
        : "No reservations yet.";
  }
}

loadDashboard();
