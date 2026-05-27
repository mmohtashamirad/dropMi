const PAGE_SIZE = 5;

export function initTab() {
  const state = {
    offset: 0,
    total: 0,
    loading: false,
  };

  const prevButton = document.getElementById("library-prev");
  const nextButton = document.getElementById("library-next");
  const pageInput = document.getElementById("library-page-input");

  prevButton.addEventListener("click", () => {
    if (state.loading) return;
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    loadLibraryPage(state);
  });

  nextButton.addEventListener("click", () => {
    if (state.loading) return;
    if (state.offset + PAGE_SIZE >= state.total) return;
    state.offset += PAGE_SIZE;
    loadLibraryPage(state);
  });

  const jumpToInputPage = () => {
    if (state.loading) return;
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    const currentPage = Math.floor(state.offset / PAGE_SIZE) + 1;
    const requested = Number.parseInt(pageInput.value, 10);
    if (!Number.isFinite(requested)) {
      pageInput.value = String(currentPage);
      return;
    }
    const clamped = Math.min(totalPages, Math.max(1, requested));
    pageInput.value = String(clamped);
    const newOffset = (clamped - 1) * PAGE_SIZE;
    if (newOffset === state.offset) return;
    state.offset = newOffset;
    loadLibraryPage(state);
  };

  pageInput.addEventListener("change", jumpToInputPage);
  pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToInputPage();
    }
  });

  loadLibraryPage(state);
  return {};
}

async function loadLibraryPage(state) {
  const count = document.getElementById("library-count");
  const stateBox = document.getElementById("library-state");
  const tableWrap = document.getElementById("library-table-wrap");
  const tableBody = document.getElementById("library-table-body");
  const pagination = document.getElementById("library-pagination");
  const pageInput = document.getElementById("library-page-input");
  const pageTotal = document.getElementById("library-page-total");
  const prevButton = document.getElementById("library-prev");
  const nextButton = document.getElementById("library-next");

  state.loading = true;
  prevButton.disabled = true;
  nextButton.disabled = true;

  try {
    const response = await fetch(`/library-songs?offset=${state.offset}&limit=${PAGE_SIZE}`);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || "Unable to load the music library.");
    }

    const songs = Array.isArray(payload?.songs) ? payload.songs : [];
    const total = Number.isFinite(payload?.total) ? payload.total : songs.length;
    state.total = total;

    if (state.offset >= total && total > 0) {
      state.offset = Math.max(0, total - PAGE_SIZE - ((total - 1) % PAGE_SIZE));
      await loadLibraryPage(state);
      return;
    }

    count.textContent = `${total} ${total === 1 ? "song" : "songs"}`;

    if (total === 0) {
      tableWrap.hidden = true;
      pagination.hidden = true;
      stateBox.hidden = false;
      stateBox.textContent = "No songs have been indexed yet.";
      return;
    }

    stateBox.hidden = true;
    tableWrap.hidden = false;
    tableBody.replaceChildren(...songs.map(createSongRow));

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.floor(state.offset / PAGE_SIZE) + 1;
    pageInput.value = String(currentPage);
    pageInput.max = String(totalPages);
    pageTotal.textContent = String(totalPages);
    pagination.hidden = false;
    prevButton.disabled = state.offset === 0;
    nextButton.disabled = state.offset + PAGE_SIZE >= total;
  } catch (error) {
    count.textContent = "Unavailable";
    tableWrap.hidden = true;
    pagination.hidden = true;
    stateBox.hidden = false;
    stateBox.textContent = error.message || "Unable to load the music library.";
  } finally {
    state.loading = false;
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
