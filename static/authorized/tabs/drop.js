import { elements } from "/authorized/dom.js";
import {
  applyResultEdits,
  captureResultEdits,
  clearResultError,
  getSelectedLyricsOption,
  getSelectedMetadata,
  renderConfirmError,
  resetResultScreen,
  setLyricsOptions,
  showResult,
  updateSongrecResult,
  highlightMissingRequiredRows
} from "/authorized/result-ui.js";
import {
  resetDropMessage,
  resetUploadScreen,
  setDraggingState,
  showScreen
} from "/authorized/screen-ui.js";
import { beaconCancelUpload, cancelUpload, confirmUpload, findLyricsBySearchText, reShazam, uploadFile } from "/authorized/upload-client.js";

let currentUploadId = "";
let currentResultPayload = null;
let dragDepth = 0;
let activeUpload = null;
let lyricsSearchRequestId = 0;
let pendingFiles = [];
let queuedFiles = [];
let queueTotal = 0;
let queueCompleted = 0;
let currentAudioURL = "";
let currentLyricsOptions = [];
// Snapshot of the result screen taken when leaving the Drop tab, so returning
// restores it instead of resetting.
let preservedResult = null;

// Persist a pending result across page closes/reloads for up to 12h, so the
// user can reopen and still confirm. The server keeps the temp file (its own
// cleanup only removes files older than 24h); we cancel a stale one once the
// stored entry expires.
const RESULT_STORAGE_KEY = "dropmi:pending-result";
const RESULT_STORAGE_TTL_MS = 12 * 60 * 60 * 1000;

// If the window/tab is closing while a finished upload is on the result screen,
// save it (latest edits included) so it can be restored on the next visit.
window.addEventListener("pagehide", () => {
  if (currentUploadId && elements.resultScreen?.classList.contains("screen-active")) {
    persistSnapshot(captureResultState());
  }
});

function persistSnapshot(snapshot) {
  if (!snapshot || !snapshot.uploadId) {
    return;
  }
  try {
    const state = {
      uploadId: snapshot.uploadId,
      payload: snapshot.payload,
      lyricsOptions: snapshot.lyricsOptions,
      lyricsSearchText: snapshot.lyricsSearchText,
      edits: snapshot.edits
    };
    localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), state }));
  } catch {
    // localStorage may be unavailable or full; persistence is best-effort.
  }
}

function loadStoredResult() {
  let raw = null;
  try {
    raw = localStorage.getItem(RESULT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearStoredResult();
    return null;
  }

  if (!parsed?.state?.uploadId) {
    clearStoredResult();
    return null;
  }

  if (Date.now() - (parsed.savedAt || 0) > RESULT_STORAGE_TTL_MS) {
    // Expired: drop it and cancel the now-stale server temp file.
    beaconCancelUpload(parsed.state.uploadId);
    clearStoredResult();
    return null;
  }

  return parsed.state;
}

function clearStoredResult() {
  try {
    localStorage.removeItem(RESULT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function initTab() {
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
    const files = event.dataTransfer.files;
    resetDropMessage();
    enqueueFiles(files);
  });

  elements.browseButton.addEventListener("click", () => {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener("change", () => {
    enqueueFiles(elements.fileInput.files);
  });

  elements.cancelUploadButton.addEventListener("click", () => {
    if (!activeUpload) {
      return;
    }

    clearQueue();
    activeUpload.abort();
  });

  elements.findLyricsButton.addEventListener("click", () => {
    startLyricsSearch({ showMissingMetadataError: true });
  });

  elements.lyricsSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.findLyricsButton.click();
    }
  });

  elements.okButton.addEventListener("click", async () => {
    // Highlight any required empty rows (e.g. Language). If any missing, stop.
    const hasMissing = highlightMissingRequiredRows();
    if (hasMissing) {
      return;
    }

    const metadata = getSelectedMetadata();

    elements.okButton.disabled = true;
    elements.cancelResultButton.disabled = true;
    elements.okButton.textContent = "Moving file...";

    if (currentUploadId) {
      const confirmation = await confirmUpload(
        currentUploadId,
        metadata,
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

  elements.reshazamButton.addEventListener("click", async () => {
    if (!currentUploadId) {
      return;
    }

    elements.reshazamButton.disabled = true;
    elements.reshazamButton.textContent = "Re-shazaming...";
    clearResultError();

    const result = await reShazam(currentUploadId);
    if (!result.ok) {
      renderConfirmError(result.error);
      elements.reshazamButton.disabled = false;
      elements.reshazamButton.textContent = "Re-shazam";
      return;
    }

    if (result.payload) {
      currentResultPayload = currentResultPayload
        ? {
            ...currentResultPayload,
            songrecOutput: result.payload.songrecOutput || ""
          }
        : {
            uploadId: currentUploadId,
            songrecOutput: result.payload.songrecOutput || ""
          };
      updateSongrecResult(currentResultPayload.songrecOutput);
      fillLyricsSearchInput();
      maybeStartLyricsSearch();
    }

    elements.reshazamButton.disabled = false;
    elements.reshazamButton.textContent = "Re-shazam";
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

  // Restore a same-session snapshot (kept in memory, includes the file queue),
  // else a result persisted to localStorage on a previous visit (within 12h).
  const snapshot = preservedResult || loadStoredResult();
  preservedResult = null;
  if (snapshot) {
    restoreResultState(snapshot);
  } else {
    showScreen(elements.dropScreen);
  }

  return {
    beforeLeave: handleTabLeave,
    beforeLogout: handleLogout
  };
}

// Leaving for another tab: if a finished upload is waiting on the result
// screen, snapshot it so returning restores it (the temp file stays). Anything
// else (mid-upload, drop screen) is just torn down.
function handleTabLeave() {
  if (currentUploadId && !activeUpload && elements.resultScreen.classList.contains("screen-active")) {
    preservedResult = captureResultState();
    // Keep the loaded audio so the player still has the file on return. We hold
    // onto the object URL (don't revoke it) and re-attach it when restoring.
    preservedResult.audioURL = currentAudioURL;
    persistSnapshot(preservedResult);
    dragDepth = 0;
    return;
  }
  discardActiveUpload();
}

// Logging out ends the session, so cancel any pending temp file and drop state.
function handleLogout() {
  if (currentUploadId) {
    cancelUpload(currentUploadId);
  }
  clearStoredResult();
  preservedResult = null;
  discardActiveUpload();
}

function discardActiveUpload() {
  if (activeUpload) {
    activeUpload.abort();
  }
  clearQueue();
  clearAudioPlayer();
  activeUpload = null;
  currentUploadId = "";
  currentLyricsOptions = [];
  dragDepth = 0;
}

function captureResultState() {
  return {
    uploadId: currentUploadId,
    payload: currentResultPayload,
    lyricsOptions: currentLyricsOptions.slice(),
    lyricsSearchText: elements.lyricsSearchInput.value,
    edits: captureResultEdits(),
    queueCompleted,
    queueTotal,
    pendingFiles: pendingFiles.slice(),
    queuedFiles: queuedFiles.slice()
  };
}

function restoreResultState(snapshot) {
  currentUploadId = snapshot.uploadId;
  currentResultPayload = snapshot.payload;
  currentLyricsOptions = snapshot.lyricsOptions || [];
  pendingFiles = snapshot.pendingFiles || [];
  queuedFiles = snapshot.queuedFiles || [];
  queueTotal = snapshot.queueTotal || 0;
  queueCompleted = snapshot.queueCompleted || 0;

  showResult(snapshot.payload || {}, Boolean(snapshot.payload?.error));
  setLyricsOptions(currentLyricsOptions);
  applyResultEdits(snapshot.edits);
  elements.lyricsSearchInput.value = snapshot.lyricsSearchText || "";
  elements.reshazamButton.disabled = !currentUploadId;
  // Re-attach the audio. Within a session we keep the local object URL; after a
  // full reload the blob is gone, so stream the still-present temp file back
  // from the server by upload id.
  if (snapshot.audioURL) {
    currentAudioURL = snapshot.audioURL;
    elements.audioPlayer.src = snapshot.audioURL;
    elements.audioPlayer.load();
  } else if (currentUploadId) {
    elements.audioPlayer.src = `/upload-audio?${new URLSearchParams({ uploadId: currentUploadId }).toString()}`;
    elements.audioPlayer.load();
  }
  updateQueueStatus();
}

function enqueueFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (files.length === 0) {
    return;
  }

  queuedFiles = files;
  pendingFiles = files.slice();
  queueTotal = files.length;
  queueCompleted = 0;
  currentUploadId = "";
  currentLyricsOptions = [];
  preservedResult = null;
  clearStoredResult();
  processNextFile();
}

function processNextFile() {
  const nextFile = pendingFiles.shift();
  if (!nextFile) {
    finishQueue();
    return;
  }

  resetResultScreen();
  resetUploadScreen();
  elements.lyricsSearchInput.value = "";
  setAudioPlayerFile(nextFile);
  startUpload(nextFile);
}

function startUpload(file) {
  updateQueueStatus();
  activeUpload = uploadFile(file, {
    onSuccess(payload) {
      activeUpload = null;
      currentUploadId = payload.uploadId || "";
      currentResultPayload = payload;
      currentLyricsOptions = payload.lyricsOptions || [];
      updateQueueStatus();
      showResult(payload, false);
      elements.reshazamButton.disabled = !currentUploadId;
      fillLyricsSearchInput();
      maybeStartLyricsSearch();
    },
    onError(payload) {
      activeUpload = null;
      currentUploadId = payload.uploadId || "";
      currentResultPayload = payload;
      currentLyricsOptions = payload.lyricsOptions || [];
      updateQueueStatus();
      showResult(payload, true);
      elements.reshazamButton.disabled = !currentUploadId;
      fillLyricsSearchInput();
      maybeStartLyricsSearch();
    },
    onCancel() {
      activeUpload = null;
      currentUploadId = "";
      resetUploadScreen();
      resetDropMessage();
      elements.fileInput.value = "";
      elements.lyricsSearchInput.value = "";
      clearAudioPlayer();
      showScreen(elements.dropScreen);
    }
  });
}

function finishResultAction() {
  clearStoredResult();
  currentUploadId = "";
  currentResultPayload = null;
  currentLyricsOptions = [];
  lyricsSearchRequestId += 1;
  resetResultScreen();
  elements.reshazamButton.disabled = true;
  elements.reshazamButton.textContent = "Re-shazam";
  elements.okButton.disabled = false;
  elements.cancelResultButton.disabled = false;
  elements.findLyricsButton.disabled = false;
  elements.okButton.textContent = "OK";
  elements.cancelResultButton.textContent = "Cancel";
  elements.findLyricsButton.textContent = "Find lyrics";
  elements.lyricsSearchInput.value = "";
  queueCompleted += 1;

  if (pendingFiles.length > 0) {
    processNextFile();
    return;
  }

  finishQueue();
}

function finishQueue() {
  clearQueue();
  clearAudioPlayer();
  resetDropMessage();
  elements.fileInput.value = "";
  showScreen(elements.dropScreen);
}

function clearQueue() {
  pendingFiles = [];
  queuedFiles = [];
  queueTotal = 0;
  queueCompleted = 0;
  setQueueStatus("");
}

function updateQueueStatus() {
  const currentPosition = queueCompleted + 1;
  const status = queueTotal > 1 ? `File ${currentPosition} of ${queueTotal}` : "";
  setQueueStatus(status);
}

function setQueueStatus(status) {
  const tooltip = status ? buildQueueTooltip() : "";
  elements.uploadQueueStatus.textContent = status;
  elements.resultQueueStatus.textContent = status;
  elements.uploadQueueStatus.title = tooltip;
  elements.resultQueueStatus.title = tooltip;
  elements.uploadQueueStatus.hidden = !status;
  elements.resultQueueStatus.hidden = !status;
}

function buildQueueTooltip() {
  return queuedFiles
    .map((file, index) => `${index + 1}. ${file.name}`)
    .join("\n");
}

function setAudioPlayerFile(file) {
  clearAudioPlayer();
  currentAudioURL = URL.createObjectURL(file);
  elements.audioPlayer.src = currentAudioURL;
  elements.audioPlayer.load();
}

function clearAudioPlayer() {
  elements.audioPlayer.pause();
  elements.audioPlayer.removeAttribute("src");
  elements.audioPlayer.load();

  if (currentAudioURL) {
    URL.revokeObjectURL(currentAudioURL);
    currentAudioURL = "";
  }
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
  const lyricsSearchText = elements.lyricsSearchInput.value.trim();

  elements.findLyricsButton.disabled = true;
  elements.reshazamButton.disabled = true;
  elements.findLyricsButton.textContent = "Finding lyrics...";
  clearResultError();

  const result = await findLyricsBySearchText(lyricsSearchText);
  if (requestId !== lyricsSearchRequestId) {
    return;
  }

  if (!result.ok) {
    if (showMissingMetadataError || result.error !== "Enter a lyrics search before searching.") {
      renderConfirmError(result.error);
    }
    elements.findLyricsButton.disabled = false;
    elements.findLyricsButton.textContent = "Find lyrics";
    elements.reshazamButton.disabled = !currentUploadId;
    return;
  }

  currentLyricsOptions = result.payload?.lyricsOptions || [];
  setLyricsOptions(currentLyricsOptions);
  elements.findLyricsButton.disabled = false;
  elements.findLyricsButton.textContent = "Find lyrics";
  elements.reshazamButton.disabled = !currentUploadId;
}

function fillLyricsSearchInput() {
  const metadata = getSelectedMetadata();
  elements.lyricsSearchInput.value = [metadata.artist, metadata.track_name]
    .filter(Boolean)
    .join(" ");
}
