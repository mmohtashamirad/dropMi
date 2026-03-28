import { elements } from "/static/dom.js";
import { login, logout } from "/static/auth-client.js";
import {
  clearLoginError,
  hideSessionBar,
  resetAuthenticatedUI,
  showLoginError,
  showSessionBar
} from "/static/auth-ui.js";
import {
  getSelectedMetadata,
  renderConfirmError,
  resetResultScreen,
  showResult
} from "/static/result-ui.js";
import {
  resetDropMessage,
  resetUploadScreen,
  setDraggingState,
  showScreen
} from "/static/screen-ui.js";
import { cancelUpload, confirmUpload, uploadFile } from "/static/upload-client.js";

let currentUploadId = "";
let dragDepth = 0;
let activeUpload = null;
const themeStorageKey = "sondrop-theme";

initializeTheme();

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

  showSessionBar(elements.usernameInput.value.trim());
  elements.passwordInput.value = "";
  elements.loginButton.disabled = false;
  elements.loginButton.textContent = "Log in";
  showScreen(elements.dropScreen);
});

elements.logoutButton.addEventListener("click", handleLogout);
elements.themeToggleButton.addEventListener("click", toggleTheme);

elements.dropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  setDraggingState(true);
});

elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  setDraggingState(true);
});

elements.dropZone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    setDraggingState(false);
    resetDropMessage();
  }
});

elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDraggingState(false);
  const [file] = event.dataTransfer.files;
  resetDropMessage();
  if (file) {
    startUpload(file);
  }
});

elements.browseButton.addEventListener("click", () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) {
    startUpload(file);
  }
});

elements.cancelUploadButton.addEventListener("click", () => {
  if (!activeUpload) {
    return;
  }

  activeUpload.abort();
});

elements.okButton.addEventListener("click", async () => {
  elements.okButton.disabled = true;
  elements.cancelResultButton.disabled = true;
  elements.okButton.textContent = "Moving file...";

  if (currentUploadId) {
    const confirmation = await confirmUpload(currentUploadId, getSelectedMetadata());
    if (!confirmation.ok) {
      renderConfirmError(confirmation.error);
      elements.okButton.disabled = false;
      elements.cancelResultButton.disabled = false;
      elements.okButton.textContent = "OK";
      return;
    }
  }

  finishResultAction();
});

elements.cancelResultButton.addEventListener("click", async () => {
  elements.cancelResultButton.disabled = true;
  elements.okButton.disabled = true;
  elements.cancelResultButton.textContent = "Deleting file...";

  if (currentUploadId) {
    const cancellation = await cancelUpload(currentUploadId);
    if (!cancellation.ok) {
      renderConfirmError(cancellation.error);
      elements.cancelResultButton.disabled = false;
      elements.okButton.disabled = false;
      elements.cancelResultButton.textContent = "Cancel";
      return;
    }
  }

  finishResultAction();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!elements.resultScreen.classList.contains("screen-active")) {
    return;
  }

  if (elements.cancelResultButton.disabled) {
    return;
  }

  event.preventDefault();
  elements.cancelResultButton.click();
});

function startUpload(file) {
  activeUpload = uploadFile(file, {
    onSuccess(payload) {
      activeUpload = null;
      currentUploadId = payload.uploadId || "";
      showResult(payload, false);
    },
    onError(payload) {
      activeUpload = null;
      currentUploadId = payload.uploadId || "";
      showResult(payload, true);
    },
    onCancel() {
      activeUpload = null;
      currentUploadId = "";
      resetUploadScreen();
      resetDropMessage();
      elements.fileInput.value = "";
      showScreen(elements.dropScreen);
    }
  });
}

function finishResultAction() {
  currentUploadId = "";
  resetResultScreen();
  showScreen(elements.dropScreen);
  elements.okButton.disabled = false;
  elements.cancelResultButton.disabled = false;
  elements.okButton.textContent = "OK";
  elements.cancelResultButton.textContent = "Cancel";
}

async function handleLogout() {
  if (activeUpload) {
    activeUpload.abort();
  }

  await logout();

  activeUpload = null;
  currentUploadId = "";
  dragDepth = 0;
  clearLoginError();
  hideSessionBar();
  resetAuthenticatedUI();
  elements.passwordInput.value = "";
  showScreen(elements.loginScreen);
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
