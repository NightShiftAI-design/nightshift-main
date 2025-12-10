// ------------------ CONFIG ------------------
const OWNER_KEY = "NightShift2025MasterKey"; 
// Change this to anything you want — keep it secret.

// ------------------ LOGIN LOGIC ------------------
document.getElementById("login-btn").addEventListener("click", () => {
  const input = document.getElementById("access-key").value.trim();
  const errorBox = document.getElementById("login-error");

  if (input === OWNER_KEY) {
    localStorage.setItem("ns-session", "active");
    window.location.href = "/dashboard/index.html";
  } else {
    errorBox.textContent = "Invalid access key. Try again.";
  }
});
