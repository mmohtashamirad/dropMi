import { elements } from "/authorized/dom.js";

const AUDIO_VOLUME_STORAGE_KEY = "dropmi:audio-volume";
const DEFAULT_AUDIO_VOLUME = 0.5;

// Synced lyrics state
let syncedLyrics = [];
let syncedLyricsTimer = null;
let lastShownLyricIndex = -1;
let lyricsDelayMs = 0;

// Blob URL tracking for cleanup
let currentBlobURL = "";

export function loadAudioVolume() {
  try {
    const stored = localStorage.getItem(AUDIO_VOLUME_STORAGE_KEY);
    if (stored !== null) {
      const volume = parseFloat(stored);
      if (!isNaN(volume) && volume >= 0 && volume <= 1) {
        return volume;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_AUDIO_VOLUME;
}

export function saveAudioVolume(volume) {
  try {
    localStorage.setItem(AUDIO_VOLUME_STORAGE_KEY, String(volume));
  } catch {
    // ignore
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

  elements.audioPlayer.syncedLyricLine.hidden = false;
  elements.audioPlayer.syncedLyricLine.textContent = "";
  if (syncedLyricsTimer === null) {
    syncedLyricsTimer = setInterval(updateSyncedLyric, 50);
  }
  updateSyncedLyric();
}

function updateSyncedLyric() {
  if (syncedLyrics.length === 0 || !elements.audioPlayer.player) {
    return;
  }

  const position = (elements.audioPlayer.player.currentTime || 0) - (lyricsDelayMs / 1000);
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
  elements.audioPlayer.syncedLyricLine.textContent = index >= 0 ? syncedLyrics[index].text : "";
}

function stopSyncedLyrics() {
  if (syncedLyricsTimer !== null) {
    clearInterval(syncedLyricsTimer);
    syncedLyricsTimer = null;
  }
  syncedLyrics = [];
  lastShownLyricIndex = -1;
  if (elements.audioPlayer.syncedLyricLine) {
    elements.audioPlayer.syncedLyricLine.hidden = true;
    elements.audioPlayer.syncedLyricLine.textContent = "";
  }
}

export function initAudioPlayer() {
  if (!elements.audioPlayer.player) return;
  elements.audioPlayer.player.volume = loadAudioVolume();
  elements.audioPlayer.player.addEventListener("volumechange", () => {
    saveAudioVolume(elements.audioPlayer.player.volume);
  });
}

export function setSongSourceFromFile(file, lyricsOption = null) {
  clearAudioPlayer();
  currentBlobURL = URL.createObjectURL(file);
  setSongSource(currentBlobURL, lyricsOption);
}

export function setSongSource(src, lyricsOption = null) {
  if (!elements.audioPlayer.player) return;
  if (elements.audioPlayer.player.getAttribute("src") == src)
    return;
  elements.audioPlayer.player.src = src;
  elements.audioPlayer.player.load();
  updatePlayerTitle(src);
  setupSyncedLyrics(lyricsOption);
}

function updatePlayerTitle(src) {
  if (!elements.audioPlayer.title) return;

  let title = "";

  if (src) {
    // Extract filename from URL or use the search parameter
    try {
      const url = new URL(src, window.location.origin);
      const params = url.searchParams;

      // Try to get uploadId or path parameter
      if (params.has("uploadId")) {
        title = `Dropped file (${params.get("uploadId")})`
      } else if (params.has("path")) {
        title = params.get("path").split("/").slice(-2).join("/");
      } else {
        title = url.pathname.split("/").pop();
      }
    } catch {
      // If not a valid URL, use it as-is
      title = src.substring(0, 50);
    }
  }
  title = "Now Playing: " + title;

  elements.audioPlayer.title.textContent = title;
  elements.audioPlayer.title.hidden = false;
}

export function audioPlayerSetTitle(title) {
  if (!elements.audioPlayer.title) return;
  elements.audioPlayer.title.textContent = `${title}`;
  elements.audioPlayer.title.hidden = false;

}


export function setSongSourceAndPlay(src, lyricsOption = null) {
  if (!elements.audioPlayer.player) return;
  setSongSource(src, lyricsOption)
  elements.audioPlayer.player.play();

}

export function clearAudioPlayer() {
  if (!elements.audioPlayer.player) return;
  stopSyncedLyrics();
  elements.audioPlayer.player.pause();
  elements.audioPlayer.player.removeAttribute("src");
  elements.audioPlayer.player.load();

  if (elements.audioPlayer.title) {
    elements.audioPlayer.title.hidden = true;
    elements.audioPlayer.title.textContent = "";
  }

  if (currentBlobURL) {
    URL.revokeObjectURL(currentBlobURL);
    currentBlobURL = "";
  }
}

export function setLyricsDelay(delayMs) {
  lyricsDelayMs = delayMs;
}

export { setupSyncedLyrics, stopSyncedLyrics };