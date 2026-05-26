import { elements, refreshElements } from "/authorized/dom.js";
import { checkSession, logout } from "/authorized/auth-client.js";
import { hideSessionBar, showSessionBar } from "/authorized/auth-ui.js";

const themeStorageKey = "sondrop-theme";

initializeTheme();
bindShellEvents();
initializeApp();

function bindShellEvents() {
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.themeToggleButton.addEventListener("click", toggleTheme);
}

let activeTabController = null;

async function handleLogout() {
  if (activeTabController?.beforeLogout) {
    activeTabController.beforeLogout();
  }

  await logout();

  activeTabController = null;
  hideSessionBar();
  window.location.assign("/");
}

async function initializeApp() {
  const session = await checkSession();
  if (!session.authenticated) {
    window.location.replace("/");
    return;
  }

  showSessionBar(session.username);

  const tabLoaded = await loadTab("drop");
  if (!tabLoaded) {
    return;
  }
}

async function loadTab(tabKey) {
  try {
    const response = await fetch(`/tab-content?tab=${encodeURIComponent(tabKey)}`);
    if (!response.ok) {
      showTabLoadError();
      return false;
    }

    elements.panel.innerHTML = await response.text();
    refreshElements();

    const tabModule = await importTabModule(tabKey);
    activeTabController = tabModule.initTab();
    return true;
  } catch {
    showTabLoadError();
    return false;
  }
}

function importTabModule(tabKey) {
  switch (tabKey) {
    case "drop":
      return import("/authorized/tabs/drop.js");
    default:
      throw new Error(`Unknown tab module: ${tabKey}`);
  }
}

function showTabLoadError() {
  elements.panel.innerHTML = `
    <div class="screen screen-active">
      <h1 class="screen-title">Tab unavailable</h1>
      <p class="subtext">Could not load this tab. Please refresh and try again.</p>
    </div>
  `;
}

function initializeTheme() {
  const storedTheme = localStorage.getItem(themeStorageKey);
  const theme = storedTheme === "light" ? "light" : "dark";
  applyTheme(theme);
}

function toggleTheme() {
  const currentTheme = document.body.dataset.theme === "light" ? "light" : "dark";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem(themeStorageKey, nextTheme);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  elements.themeToggleButton.textContent = theme === "dark" ? "Light" : "Dark";
}

