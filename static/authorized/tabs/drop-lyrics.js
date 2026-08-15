import { elements } from "/authorized/dom.js";
import {
  clearResultError,
  getSelectedLyricsOption,
  getSelectedMetadata,
  renderConfirmError,
  setLyricsOptions
} from "/authorized/result-ui.js";
import {
  setLyricsDelay,
  setupSyncedLyrics
} from "/authorized/audio-player.js";
import { findLyricsBySearchText } from "/authorized/upload-client.js";

// State container
export const lyricsState = {
  currentOptions: [],
  searchRequestId: 0,
  hasUploadedFile: false,
  currentUploadId: ""
};

export function resetLyricsState() {
  lyricsState.currentOptions = [];
  lyricsState.searchRequestId += 1;
  lyricsState.hasUploadedFile = false;
}

export function clearLyricsState() {
  lyricsState.currentOptions = [];
  lyricsState.hasUploadedFile = false;
}

export function captureLyricsState() {
  return {
    lyricsOptions: lyricsState.currentOptions.slice(),
    lyricsSearchText: elements.lyricsSearchInput.value
  };
}

export function restoreLyricsState(state) {
  lyricsState.currentOptions = state.lyricsOptions || [];
  elements.lyricsSearchInput.value = state.lyricsSearchText || "";
}

export async function addUploadedFileLyricsToOptions(payload) {
  // If the uploaded file has lyrics, fetch them and add as first option
  if (payload.SongMetadata?.lyrics) {
    try {
      const response = await fetch(payload.SongMetadata.lyrics);
      if (response.ok) {
        const lyricsText = await response.text();
        if (lyricsText.trim()) {
          const uploadedLyric = {
            title: "Uploaded File Lyrics",
            artist: payload.SongMetadata?.artist || "",
            album: payload.SongMetadata?.album || "",
            syncedLyrics: lyricsText,
            plainLyrics: lyricsText
          };
          lyricsState.currentOptions.unshift(uploadedLyric);
          return true; // Lyrics were added
        }
      }
    } catch (err) {
      console.debug("Could not fetch uploaded file lyrics:", err);
    }
  }
  return false; // No lyrics were added
}

export function selectFirstLyricsOption() {
  // Select the first lyrics option (uploaded file lyrics if it was added)
  const firstRadio = elements.lyricsOptions.querySelector('input[name="selected-lyrics-option"]');
  if (firstRadio) {
    firstRadio.checked = true;
    // Trigger the change event to load the lyrics into the player
    elements.lyricsOptions.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function maybeStartLyricsSearch() {
  const metadata = getSelectedMetadata();
  if (!metadata.artist || !metadata.track_name) {
    return;
  }

  startLyricsSearch({ showMissingMetadataError: false });
}

export async function startLyricsSearch({ showMissingMetadataError }) {
  const requestId = lyricsState.searchRequestId + 1;
  lyricsState.searchRequestId = requestId;
  const lyricsSearchText = elements.lyricsSearchInput.value.trim();

  elements.findLyricsButton.disabled = true;
  elements.reshazamButton.disabled = true;
  elements.findLyricsButton.textContent = "Finding lyrics...";
  clearResultError();

  const result = await findLyricsBySearchText(lyricsSearchText);
  if (requestId !== lyricsState.searchRequestId) {
    return;
  }

  if (!result.ok) {
    if (showMissingMetadataError || result.error !== "Enter a lyrics search before searching.") {
      renderConfirmError(result.error);
    }
    elements.findLyricsButton.disabled = false;
    elements.findLyricsButton.textContent = "Find lyrics";
    elements.reshazamButton.disabled = !lyricsState.currentUploadId;
    return;
  }

  const searchResults = result.payload?.lyricsOptions || [];
  // If the first option is uploaded file lyrics, preserve it
  if (lyricsState.currentOptions.length > 0 && lyricsState.currentOptions[0].title === "Uploaded File Lyrics") {
    lyricsState.currentOptions = [lyricsState.currentOptions[0], ...searchResults];
  } else {
    lyricsState.currentOptions = searchResults;
    lyricsState.hasUploadedFile = false;
  }
  setLyricsOptions(lyricsState.currentOptions);

  // Re-select uploaded file lyrics if they exist (they'll be at index 1 after NO_LYRICS_OPTION is prepended)
  if (lyricsState.hasUploadedFile) {
    const radios = elements.lyricsOptions.querySelectorAll('input[name="selected-lyrics-option"]');
    if (radios.length > 1) {
      radios[1].checked = true;
      // Trigger the change event to load the lyrics into the player
      elements.lyricsOptions.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  elements.findLyricsButton.disabled = false;
  elements.findLyricsButton.textContent = "Find lyrics";
  elements.reshazamButton.disabled = !lyricsState.currentUploadId;
}

export function fillLyricsSearchInput() {
  const metadata = getSelectedMetadata();
  elements.lyricsSearchInput.value = [metadata.artist, metadata.track_name]
    .filter(Boolean)
    .join(" ");
}

export function applySyncedLyricsDelay(syncedLyrics, delayMs) {
  if (!syncedLyrics || delayMs === 0) {
    return syncedLyrics;
  }

  return syncedLyrics.split('\n').map(line => {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2})\](.*)/);
    if (!match) {
      return line;
    }

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const centiseconds = parseInt(match[3], 10);
    const text = match[4];

    let totalMs = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
    totalMs += delayMs;

    if (totalMs < 0) {
      totalMs = 0;
    }

    const newMinutes = Math.floor(totalMs / 60000);
    const newSeconds = Math.floor((totalMs % 60000) / 1000);
    const newCentiseconds = Math.round((totalMs % 1000) / 10);

    return `[${String(newMinutes).padStart(2, '0')}:${String(newSeconds).padStart(2, '0')}.${String(newCentiseconds).padStart(2, '0')}]${text}`;
  }).join('\n');
}

export function initLyricsEventListeners() {
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

  const lyricsDelayInput = document.getElementById("lyrics-delay-input");
  if (lyricsDelayInput) {
    lyricsDelayInput.addEventListener("input", () => {
      const delaySecs = parseFloat(lyricsDelayInput.value) || 0;
      // Immediately update displayed lyric with new delay
      setLyricsDelay(delaySecs * 1000);
    });
  }
}
