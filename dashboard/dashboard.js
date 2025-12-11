// ------------------ IMPORT SUPABASE ------------------
import { supabase } from "./supabase-client.js";

// ------------------ AUTH CHECK ------------------
function requireAuth() {
  if (!document.cookie.includes("ns-auth=")) {
    window.location.href = "/dashboard/login.html";
  }
}
requireAuth();

// ------------------ LOGOUT BUTTON ------------------
document.getElementById("logoutBtn").addEventListener("click", () => {
  document.cookie = "ns-auth=; Max-Age=0; path=/;";
  window.location.href = "/dashboard/login.html";
});

// ------------------ LOAD DASHBOARD DATA ------------------
async function loadDashboard() {
  // ------------------ CALL SUMMARY ------------------
  const { data: callData, error: callErr } = await supabase
    .from("daily_calls_view")
    .select("*")
    .order("date", { ascending: false })
    .limit(7);

  const callBox = document.getElementById("call-summary");

  if (callErr) {
    callBox.innerHTML = "Error loading call summaries.";
    console.error(callErr);
  } else if (!callData || callData.length === 0) {
    callBox.innerHTML = "No call data yet.";
  } else {
    callBox.innerHTML = callData
      .map(
        (c) => `
        <div class="dash-item">
          <strong>${c.date}</strong> — ${c.total_calls} calls
        </div>
      `
      )
      .join("");
  }

  // ------------------ RESERVATIONS ------------------
  const { data: reservations, error: resErr } = await supabase
    .from("reservations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  const resBox = document.getElementById("reservations-list");

  if (resErr) {
    resBox.innerHTML = "Error loading reservations.";
    console.error(resErr);
  } else if (!reservations || reservations.length === 0) {
    resBox.innerHTML = "No reservations yet.";
  } else {
    resBox.innerHTML = reservations
      .map(
        (r) => `
        <div class="reservation-card">
          <strong>${r.guest_name}</strong><br>
          Room: ${r.room_type}<br>
          Arrival: ${r.arrival_date}<br>
          Total: $${r.total_due}
        </div>
      `
      )
      .join("");
  }
}

loadDashboard();
