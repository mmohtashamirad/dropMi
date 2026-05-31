import { login, checkSession } from "/public/auth-client.js";
import { elements } from "/public/dom.js";

const themeStorageKey = "dropMi-theme";

applyStoredTheme();
redirectIfAuthenticated();

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLoginError();
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "Logging in...";

  const result = await login(elements.usernameInput.value, elements.passwordInput.value);
  if (!result.ok) {
    showLoginError(result.error);
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = "Log in";
    return;
  }

  elements.passwordInput.value = "";
  window.location.assign("/");
});

async function redirectIfAuthenticated() {
  if (await checkSession()) {
    window.location.replace("/");
  }
}

function applyStoredTheme() {
  const storedTheme = localStorage.getItem(themeStorageKey);
  document.body.dataset.theme = storedTheme === "light" ? "light" : "dark";
}

function showLoginError(message) {
  elements.loginError.hidden = false;
  elements.loginError.textContent = message;
}

function clearLoginError() {
  elements.loginError.hidden = true;
  elements.loginError.textContent = "";
}
