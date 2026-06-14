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
// Parsed [time, verse] pairs of the selected synced lyric, plus the 50ms poller
// that shows the current line under the audio player.
let syncedLyrics = [];
let syncedLyricsTimer = null;
let lastShownLyricIndex = -1;
let lyricsDelayMs = 0; // Delay in milliseconds for synced lyrics sync

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
    // Stop the lyric poller (the DOM is about to be torn down) without touching
    // the kept audio URL; it restarts on return.
    stopSyncedLyrics();
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
  setupSyncedLyrics(getSelectedLyricsOption());
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
  lyricsDelayMs = 0;
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

function setAudioPlayerFile(file) {
  clearAudioPlayer();
  currentAudioURL = URL.createObjectURL(file);
  elements.audioPlayer.src = currentAudioURL;
  elements.audioPlayer.load();
}

function clearAudioPlayer() {
  stopSyncedLyrics();
  elements.audioPlayer.pause();
  elements.audioPlayer.removeAttribute("src");
  elements.audioPlayer.load();

  if (currentAudioURL) {
    URL.revokeObjectURL(currentAudioURL);
    currentAudioURL = "";
  }
}

// Parse LRC-style synced lyrics ("[mm:ss.xx] verse") into time-sorted
// { time (seconds), text } pairs. A line may carry multiple time tags.
// Apply a delay (in milliseconds) to all timestamps in synced lyrics text.
// Returns the modified lyrics text with adjusted timestamps.
function applySyncedLyricsDelay(lyricsText, delayMs) {
  if (!lyricsText || delayMs === 0) {
    return lyricsText;
  }

  // Regex to match LRC timestamp lines: [MM:SS.CC] text
  const timestampRegex = /^\[(\d{2}):(\d{2})\.(\d{2})\](.*)/gm;
  const delaySeconds = delayMs / 1000;

  return lyricsText.replace(timestampRegex, (match, minutes, seconds, centiseconds, text) => {
    let totalSeconds = parseInt(minutes, 10) * 60 + parseInt(seconds, 10) + parseInt(centiseconds, 10) / 100;
    totalSeconds += delaySeconds;

    // Ensure time doesn't go negative
    if (totalSeconds < 0) {
      totalSeconds = 0;
    }

    const newMinutes = Math.floor(totalSeconds / 60);
    const newSeconds = Math.floor(totalSeconds % 60);
    const newCentiseconds = Math.round((totalSeconds % 1) * 100);

    return `[${String(newMinutes).padStart(2, "0")}:${String(newSeconds).padStart(2, "0")}.${String(newCentiseconds).padStart(2, "0")}]${text}`;
  });
}

function parseSyncedLyrics(text) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  const tagPattern = /\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  const entries = [];

  text.split(/\r?\n/).forEach((line) => {
    tagPattern.lastIndex = 0;
    const times = [];
    let match;
    let lastTagEnd = 0;
    while ((match = tagPattern.exec(line)) !== null) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseFloat(match[2].replace(":", "."));
      if (!Number.isNaN(minutes) && !Number.isNaN(seconds)) {
        times.push(minutes * 60 + seconds);
      }
      lastTagEnd = tagPattern.lastIndex;
    }
    if (times.length === 0) {
      return;
    }
    const verse = line.slice(lastTagEnd).trim();
    times.forEach((time) => entries.push({ time, text: verse }));
  });

  entries.sort((a, b) => a.time - b.time);
  return entries;
}

function setupSyncedLyrics(option) {
  syncedLyrics = parseSyncedLyrics(option?.syncedLyrics || "");
  lastShownLyricIndex = -1;

  if (syncedLyrics.length === 0) {
    stopSyncedLyrics();
    return;
  }

  elements.syncedLyricLine.hidden = false;
  elements.syncedLyricLine.textContent = "";
  if (syncedLyricsTimer === null) {
    syncedLyricsTimer = setInterval(updateSyncedLyric, 50);
  }
  updateSyncedLyric();
}

function updateSyncedLyric() {
  if (syncedLyrics.length === 0 || !elements.audioPlayer) {
    return;
  }

  const position = (elements.audioPlayer.currentTime || 0) - (lyricsDelayMs / 1000);
  let index = -1;
  for (let i = 0; i < syncedLyrics.length; i += 1) {
    if (syncedLyrics[i].time <= position) {
      index = i;
    } else {
      break;
    }
  }

  if (index === lastShownLyricIndex) {
    return;
  }
  lastShownLyricIndex = index;
  elements.syncedLyricLine.textContent = index >= 0 ? syncedLyrics[index].text : "";
}

function stopSyncedLyrics() {
  if (syncedLyricsTimer !== null) {
    clearInterval(syncedLyricsTimer);
    syncedLyricsTimer = null;
  }
  syncedLyrics = [];
  lastShownLyricIndex = -1;
  if (elements.syncedLyricLine) {
    elements.syncedLyricLine.hidden = true;
    elements.syncedLyricLine.textContent = "";
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
