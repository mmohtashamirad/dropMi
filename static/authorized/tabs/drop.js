import { elements } from "/authorized/dom.js";
import {
  applyResultEdits,
  captureResultEdits,
  clearResultError,
  getSelectedLyricsOption,
  getSelectedMetadata,
  renderConfirmError,
  renderDuplicateNotice,
  resetResultScreen,
  setLyricsOptions,
  showResult,
  updateSongrecResult,
  highlightMissingRequiredRows
} from "/authorized/result-ui.js";
import {
  setSongSource,
  setSongSourceAndPlay,
  setSongSourceFromFile,
  clearAudioPlayer,
  setLyricsDelay,
  setupSyncedLyrics,
  stopSyncedLyrics,
  audioPlayerSetTitle
} from "/authorized/audio-player.js";
import {
  resetDropMessage,
  resetUploadScreen,
  setDraggingState,
  showScreen
} from "/authorized/screen-ui.js";
import { beaconCancelUpload, cancelUpload, confirmUpload, findDuplicates, findLyricsBySearchText, reShazam, uploadFile, uploadInternetSong } from "/authorized/upload-client.js";

let currentUploadId = "";
let currentFileName = "";
let currentResultPayload = null;
let dragDepth = 0;
let activeUpload = null;
let lyricsSearchRequestId = 0;
let pendingFiles = [];
let queuedFiles = [];
let queueTotal = 0;
let queueCompleted = 0;
let currentLyricsOptions = [];
// Snapshot of the result screen taken when leaving the Drop tab, so returning
// restores it instead of resetting.
let preservedResult = null;
let findingDuplicates = false; // Track if duplicate check is in progress

// Holding OK for this long arms a force upload (admins only; enforced server-side).
const FORCE_UPLOAD_HOLD_MS = 3000;
let okHoldStart = 0;
let okHoldTimer = null;

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

// Filename handed off from the internet song search DropMi button. The event
// arrives while this tab is still loading (the search tab switches tabs, then
// dispatches), so we stash it and let initTab start the upload once the drop
// screen's DOM exists. This listener is module-level so it's always live.
let pendingInternetSongFilename = null;
document.addEventListener("internet-song-dropmi", (event) => {
  pendingInternetSongFilename = event.detail?.filename || null;
});

function persistSnapshot(snapshot) {
  if (!snapshot || !snapshot.uploadId) {
    return;
  }
  try {
    const state = {
      filename: snapshot.filename,
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

  // When a lyric option is selected, track the song position and show the
  // current synced line under the audio player.
  elements.lyricsOptions.addEventListener("change", () => {
    setupSyncedLyrics(getSelectedLyricsOption());
  });

  // Press-and-hold OK arms a force upload. The red cue appears once the hold
  // passes the threshold; the actual decision is the measured hold time.
  const clearOkHold = () => {
    if (okHoldTimer !== null) {
      clearTimeout(okHoldTimer);
      okHoldTimer = null;
    }
    if (elements.okButton.classList.contains("force-armed")) {
      elements.okButton.classList.remove("force-armed");
      elements.okButton.textContent = "OK";
    }
  };
  elements.okButton.addEventListener("pointerdown", () => {
    okHoldStart = Date.now();
    clearOkHold();
    okHoldTimer = setTimeout(() => {
      elements.okButton.classList.add("force-armed");
      elements.okButton.textContent = "Force OK";
    }, FORCE_UPLOAD_HOLD_MS);
  });
  elements.okButton.addEventListener("pointerup", clearOkHold);
  elements.okButton.addEventListener("pointerleave", () => {
    okHoldStart = 0;
    clearOkHold();
  });
  elements.okButton.addEventListener("pointercancel", () => {
    okHoldStart = 0;
    clearOkHold();
  });

  elements.okButton.addEventListener("click", async () => {
    const forceUpload = okHoldStart > 0 && Date.now() - okHoldStart >= FORCE_UPLOAD_HOLD_MS;
    okHoldStart = 0;
    clearOkHold();

    // Highlight any required empty rows (e.g. Language). If any missing, stop.
    const hasMissing = highlightMissingRequiredRows();
    if (hasMissing) {
      return;
    }

    const metadata = getSelectedMetadata();
    let selectedLyrics = getSelectedLyricsOption();

    // Apply delay to synced lyrics timestamps before saving
    let lyricsDelayMs = 0;
    const lyricsDelayInput = document.getElementById("lyrics-delay-input");
    if (lyricsDelayInput) {
      const delaySecs = parseFloat(lyricsDelayInput.value) || 0;
      lyricsDelayMs = delaySecs * 1000;
    }
    if (selectedLyrics && lyricsDelayMs !== 0) {
      selectedLyrics = {
        ...selectedLyrics,
        syncedLyrics: applySyncedLyricsDelay(selectedLyrics.syncedLyrics || "", lyricsDelayMs)
      };
    }

    elements.okButton.disabled = true;
    elements.cancelResultButton.disabled = true;
    elements.okButton.textContent = forceUpload ? "Force uploading..." : "Moving file...";

    if (currentUploadId) {
      const confirmation = await confirmUpload(
        currentUploadId,
        metadata,
        selectedLyrics,
        forceUpload
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

  const lyricsDelayInput = document.getElementById("lyrics-delay-input");
  if (lyricsDelayInput) {
    lyricsDelayInput.addEventListener("input", () => {
      const delaySecs = parseFloat(lyricsDelayInput.value) || 0;
      lyricsDelayMs = delaySecs * 1000;
      // Immediately update displayed lyric with new delay
      updateSyncedLyric();
    });
  }

  elements.playResultButton.addEventListener("click", () => {
    if (!currentUploadId) {
      return;
    }
    setSongSourceAndPlay(`/uploaded-audio?${new URLSearchParams({ uploadId: currentUploadId }).toString()}`);
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

  // Arrived here from the internet song search DropMi button: start that upload
  // and ignore any stored snapshot. Otherwise restore a same-session snapshot
  // (kept in memory, includes the file queue), else a result persisted to
  // localStorage on a previous visit (within 12h).
  if (pendingInternetSongFilename) {
    const filename = pendingInternetSongFilename;
    pendingInternetSongFilename = null;
    startInternetSongUpload(filename);
  } else {
    const snapshot = preservedResult || loadStoredResult();
    preservedResult = null;
    if (snapshot) {
      restoreResultState(snapshot);
    } else {
      showScreen(elements.dropScreen);
    }
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
  currentFileName = "";
  currentLyricsOptions = [];
  dragDepth = 0;
}

function captureResultState() {
  return {
    filename: currentFileName,
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
  // Re-attach the audio. After a reload the blob is gone, so stream the temp file
  // back from the server by upload id.
  if (currentUploadId) {
    setSongSource(`/uploaded-audio?${new URLSearchParams({ uploadId: currentUploadId }).toString()}`, getSelectedLyricsOption());
    if (snapshot.filename) {
      audioPlayerSetTitle(`Now Playing Dropped Song: ${snapshot.filename}`);
    }
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

  currentFileName = nextFile.name;
  resetResultScreen();
  resetUploadScreen();
  elements.lyricsSearchInput.value = "";
  setSongSourceFromFile(nextFile);
  audioPlayerSetTitle(`Now Playing Dropped Song: ${nextFile.name}`)
  startUpload(nextFile);
}

function startUpload(source, isInternetSong = false) {
  updateQueueStatus();
  const callbacks = {
    onSuccess(payload) {
      activeUpload = null;
      currentUploadId = payload.uploadId || "";
      currentResultPayload = payload;
      currentLyricsOptions = payload.lyricsOptions || [];
      updateQueueStatus();
      // Internet songs have no local File, so load the audio from the server by
      // uploadId — the same way a page reload restores the player.
      if (isInternetSong && currentUploadId) {
        elements.audioPlayer.player.src = `/uploaded-audio?${new URLSearchParams({ uploadId: currentUploadId }).toString()}`;
        elements.audioPlayer.player.load();
      }
      showResult(payload, false);
      elements.reshazamButton.disabled = !currentUploadId;
      fillLyricsSearchInput();
      maybeStartLyricsSearch();

      // Check for duplicates in the background
      if (currentUploadId) {
        findDuplicatesInBackground(currentUploadId);
      }
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
  };

  if (isInternetSong) {
    uploadInternetSong(source, callbacks);
  } else {
    activeUpload = uploadFile(source, callbacks);
  }
}

// Like a single-file drop, but the song already lives in the server's cache
// (handed off from the internet song search tab). Mirrors processNextFile.
function startInternetSongUpload(filename) {
  clearStoredResult();
  resetResultScreen();
  resetUploadScreen();
  elements.lyricsSearchInput.value = "";
  startUpload(filename, true);
}

function finishResultAction() {
  clearStoredResult();
  currentUploadId = "";
  currentResultPayload = null;
  currentLyricsOptions = [];
  lyricsSearchRequestId += 1;
  const lyricsDelayInput = document.getElementById("lyrics-delay-input");
  if (lyricsDelayInput) {
    lyricsDelayInput.value = "0.00";
  }
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

async function findDuplicatesInBackground(uploadId) {
  findingDuplicates = true;
  elements.okButton.disabled = true;  
  elements.okButton.textContent = "Finding Similar songs...";

  const result = await findDuplicates(uploadId);
  if (result.ok && currentUploadId === uploadId) {
    // Update the current result payload with duplicates
    if (currentResultPayload) {
      currentResultPayload.duplicates = result.duplicates;
      // Render the updated duplicate notice
      renderDuplicateNotice(result.duplicates || []);
    }
  }

  findingDuplicates = false;
  elements.okButton.disabled = false;
  elements.okButton.textContent = "OK";
}
