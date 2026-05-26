export function initTab() {
  loadLibrarySongs();
  return {};
}

async function loadLibrarySongs() {
  const count = document.getElementById("library-count");
  const state = document.getElementById("library-state");
  const tableWrap = document.getElementById("library-table-wrap");
  const tableBody = document.getElementById("library-table-body");

  try {
    const response = await fetch("/library-songs");
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || "Unable to load the music library.");
    }

    const songs = Array.isArray(payload?.songs) ? payload.songs : [];
    count.textContent = `${songs.length} ${songs.length === 1 ? "song" : "songs"}`;

    if (songs.length === 0) {
      tableWrap.hidden = true;
      state.hidden = false;
      state.textContent = "No songs have been indexed yet.";
      return;
    }

    state.hidden = true;
    tableWrap.hidden = false;
    tableBody.replaceChildren(...songs.map(createSongRow));
  } catch (error) {
    count.textContent = "Unavailable";
    tableWrap.hidden = true;
    state.hidden = false;
    state.textContent = error.message || "Unable to load the music library.";
  }
}

function createSongRow(song) {
  const row = document.createElement("tr");
  row.appendChild(createTrackCell(song));
  row.appendChild(createTextCell(song.artist));
  row.appendChild(createTextCell(song.album));
  row.appendChild(createTextCell(song.genre));
  row.appendChild(createTextCell(song.language));
  row.appendChild(createTextCell(formatDuration(song.duration), "library-duration"));
  row.appendChild(createFileCell(song));
  return row;
}

function createTrackCell(song) {
  const cell = document.createElement("td");
  const title = document.createElement("div");
  title.className = "library-track-title";
  title.textContent = song.trackName || song.fileName || "Untitled";

  const meta = document.createElement("div");
  meta.className = "library-track-meta";
  meta.textContent = [formatFileSize(song.fileSize), song.comment].filter(Boolean).join(" · ");

  cell.append(title, meta);
  return cell;
}

function createFileCell(song) {
  const cell = document.createElement("td");
  const file = document.createElement("div");
  file.className = "library-file-name";
  file.textContent = song.fileName || "-";
  if (song.path) {
    file.title = song.path;
  }

  cell.appendChild(file);
  return cell;
}

function createTextCell(value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value || "-";
  if (className) {
    cell.className = className;
  }
  return cell;
}

function formatDuration(duration) {
  const totalSeconds = Math.round(Number(duration) || 0);
  if (totalSeconds <= 0) {
    return "-";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatFileSize(fileSize) {
  const bytes = Number(fileSize) || 0;
  if (bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
