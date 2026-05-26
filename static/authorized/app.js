import { elements, refreshElements } from "/authorized/dom.js";
import { checkSession, logout } from "/authorized/auth-client.js";
import { hideSessionBar, showSessionBar } from "/authorized/auth-ui.js";

const themeStorageKey = "sondrop-theme";
let activeTabController = null;
let activeTabKey = "";
let availableTabs = [];

initializeTheme();
bindShellEvents();
initializeApp();

function bindShellEvents() {
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.themeToggleButton.addEventListener("click", toggleTheme);
}

async function handleLogout() {
  if (activeTabController?.beforeLogout) {
    activeTabController.beforeLogout();
  }

  await logout();

  activeTabController = null;
  activeTabKey = "";
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

  availableTabs = await fetchUserTabs();
  if (availableTabs.length === 0) {
    showTabLoadError();
    return;
  }

  renderTabs(availableTabs);
  const firstTab = availableTabs.find((tab) => tab.key === "drop") || availableTabs[0];
  await loadTab(firstTab.key);
}

async function fetchUserTabs() {
  try {
    const response = await fetch("/user-tabs");
    if (!response.ok) {
      return [];
    }

    const payload = await response.json().catch(() => null);
    return Array.isArray(payload?.tabs) ? payload.tabs : [];
  } catch {
    return [];
  }
}

function renderTabs(tabs) {
  elements.tabList.replaceChildren();

  tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.className = "tab-button";
    button.type = "button";
    button.textContent = tab.title || tab.key;
    button.dataset.tabKey = tab.key;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.addEventListener("click", () => {
      loadTab(tab.key);
    });
    elements.tabList.appendChild(button);
  });

  elements.tabList.hidden = false;
}

async function loadTab(tabKey) {
  if (tabKey === activeTabKey) {
    return true;
  }

  const tab = availableTabs.find((item) => item.key === tabKey);
  if (!tab) {
    showTabLoadError();
    return false;
  }

  setTabsDisabled(true);

  try {
    if (activeTabController?.beforeLeave) {
      activeTabController.beforeLeave();
    }

    const response = await fetch(`/tab-content?tab=${encodeURIComponent(tab.key)}`);
    if (!response.ok) {
      showTabLoadError();
      return false;
    }

    elements.panel.innerHTML = await response.text();
    refreshElements();

    const tabModule = await importTabModule(tab);
    activeTabController = tabModule.initTab?.() || null;
    activeTabKey = tab.key;
    updateActiveTab();
    return true;
  } catch {
    showTabLoadError();
    return false;
  } finally {
    setTabsDisabled(false);
  }
}

function importTabModule(tab) {
  const basePath = tab.adminOnly ? "/admin/tabs" : "/authorized/tabs";
  return import(`${basePath}/${tab.key}.js`);
}

function updateActiveTab() {
  elements.tabList.querySelectorAll(".tab-button").forEach((button) => {
    const isActive = button.dataset.tabKey === activeTabKey;
    button.classList.toggle("tab-button-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function setTabsDisabled(isDisabled) {
  elements.tabList.querySelectorAll(".tab-button").forEach((button) => {
    button.disabled = isDisabled;
  });
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
