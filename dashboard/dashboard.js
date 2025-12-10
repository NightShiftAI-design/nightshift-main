import { supabase } from "./supabase-client.js";

// ------------------ AUTH CHECK ------------------
if (!localStorage.getItem("ns-session")) {
    window.location.href = "/dashboard/login.html";
}

// ------------------ LOGOUT ------------------
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("ns-session");
    window.location.href = "/dashboard/login.html";
});

// ------------------ LOAD CALL SUMMARIES ------------------
async function loadCalls() {
    const container = document.getElementById("callSummaries");

    const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

    if (error) {
        console.error(error);
        container.innerHTML = "<p>Error loading call summaries.</p>";
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = "<p>No call logs available.</p>";
        return;
    }

    container.innerHTML = data
        .map(
            c => `
            <div class="dash-item">
                <strong>${c.caller_number}</strong><br>
                ${c.summary || "No summary"}<br>
                <small>${new Date(c.created_at).toLocaleString()}</small>
            </div>
        `
        )
        .join("");
}

// ------------------ LOAD RESERVATIONS ------------------
async function loadReservations() {
    const container = document.getElementById("reservations");

    const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

    if (error) {
        console.error(error);
        container.innerHTML = "<p>Error loading reservations.</p>";
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = "<p>No reservations yet.</p>";
        return;
    }

    container.innerHTML = data
        .map(
            r => `
            <div class="dash-item">
                <strong>${r.guest_name}</strong><br>
                Room: ${r.room_type}<br>
                Dates: ${r.arrival_date} → ${r.departure_date}<br>
                <small>${new Date(r.created_at).toLocaleString()}</small>
            </div>
        `
        )
        .join("");
}

// ------------------ RUN EVERYTHING ------------------
loadCalls();
loadReservations();
