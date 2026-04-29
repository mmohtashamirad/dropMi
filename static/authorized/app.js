import { elements } from "/authorized/dom.js";
import { checkSession, logout } from "/authorized/auth-client.js";
import {
  hideSessionBar,
  resetAuthenticatedUI,
  showSessionBar
} from "/authorized/auth-ui.js";
import {
  getSelectedLyricsOption,
  getSelectedMetadata,
  renderConfirmError,
  resetResultScreen,
  setLyricsOptions,
  showResult
} from "/authorized/result-ui.js";
import {
  resetDropMessage,
  resetUploadScreen,
  setDraggingState,
  showScreen
} from "/authorized/screen-ui.js";
import { cancelUpload, confirmUpload, findLyrics, uploadFile } from "/authorized/upload-client.js";

let currentUploadId = "";
let dragDepth = 0;
let activeUpload = null;
let lyricsSearchRequestId = 0;
const themeStorageKey = "sondrop-theme";

initializeTheme();
initializeApp();

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

elements.findLyricsButton.addEventListener("click", () => {
  startLyricsSearch({ showMissingMetadataError: true });
});

elements.okButton.addEventListener("click", async () => {
  elements.okButton.disabled = true;
  elements.cancelResultButton.disabled = true;
  elements.okButton.textContent = "Moving file...";

  if (currentUploadId) {
    const confirmation = await confirmUpload(
      currentUploadId,
      getSelectedMetadata(),
      getSelectedLyricsOption()
    );
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
      maybeStartLyricsSearch();
    },
    onError(payload) {
      activeUpload = null;
      currentUploadId = payload.uploadId || "";
      showResult(payload, true);
      maybeStartLyricsSearch();
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
  lyricsSearchRequestId += 1;
  resetResultScreen();
  showScreen(elements.dropScreen);
  elements.okButton.disabled = false;
  elements.cancelResultButton.disabled = false;
  elements.findLyricsButton.disabled = false;
  elements.okButton.textContent = "OK";
  elements.cancelResultButton.textContent = "Cancel";
  elements.findLyricsButton.textContent = "Find lyrics";
}

function maybeStartLyricsSearch() {
  const metadata = getSelectedMetadata();
  if (!metadata.artist || !metadata.track_name) {
    return;
  }

  startLyricsSearch({ showMissingMetadataError: false });
}

async function startLyricsSearch({ showMissingMetadataError }) {
  const requestId = lyricsSearchRequestId + 1;
  lyricsSearchRequestId = requestId;

  elements.findLyricsButton.disabled = true;
  elements.findLyricsButton.textContent = "Finding lyrics...";
  clearTransientResultError();

  const result = await findLyrics(getSelectedMetadata());
  if (requestId !== lyricsSearchRequestId) {
    return;
  }

  if (!result.ok) {
    if (showMissingMetadataError || result.error !== "Fill in at least artist and track name before searching for lyrics.") {
      renderConfirmError(result.error);
    }
    elements.findLyricsButton.disabled = false;
    elements.findLyricsButton.textContent = "Find lyrics";
    return;
  }

  setLyricsOptions(result.payload?.lyricsOptions || []);
  elements.findLyricsButton.disabled = false;
  elements.findLyricsButton.textContent = "Find lyrics";
}

async function handleLogout() {
  if (activeUpload) {
    activeUpload.abort();
  }

  await logout();

  activeUpload = null;
  currentUploadId = "";
  dragDepth = 0;
  hideSessionBar();
  resetAuthenticatedUI();
  window.location.assign("/");
}

async function initializeApp() {
  const session = await checkSession();
  if (!session.authenticated) {
    window.location.replace("/");
    return;
  }

  showSessionBar(session.username);
  showScreen(elements.dropScreen);
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

function clearTransientResultError() {
  const error = elements.resultScreen.querySelector(".result-error");
  if (error) {
    error.remove();
  }
}
