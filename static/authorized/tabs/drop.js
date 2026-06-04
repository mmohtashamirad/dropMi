import { elements } from "/authorized/dom.js";
import {
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

// If the window/tab is closed (or refreshed/navigated away) while a finished
// upload is awaiting confirmation on the result screen, cancel it so the
// server's temp file is cleaned up — same as pressing Cancel.
window.addEventListener("pagehide", () => {
  if (currentUploadId) {
    const uploadId = currentUploadId;
    currentUploadId = "";
    beaconCancelUpload(uploadId);
  }
});

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

  showScreen(elements.dropScreen);

  return {
    beforeLeave: cleanupTab,
    beforeLogout: cleanupTab
  };
}

function cleanupTab() {
  if (activeUpload) {
    activeUpload.abort();
  }
  // A finished upload waiting on the result screen still has a server temp
  // file; cancel it on the way out, like pressing Cancel.
  if (currentUploadId) {
    cancelUpload(currentUploadId);
  }
  clearQueue();
  clearAudioPlayer();
  activeUpload = null;
  currentUploadId = "";
  dragDepth = 0;
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
  currentUploadId = "";
  currentResultPayload = null;
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

  setLyricsOptions(result.payload?.lyricsOptions || []);
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
