import { setSongSourceAndPlay, audioPlayerSetTitle } from "/authorized/audio-player.js";

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const FILTER_DEBOUNCE_MS = 1500;

export function initTab() {
  const pageSizeSelect = document.getElementById("library-page-size");
  const initialPageSize = parsePageSize(pageSizeSelect?.value, DEFAULT_PAGE_SIZE);

  const state = {
    offset: 0,
    total: 0,
    pageSize: initialPageSize,
    filter: "",
    loading: false,
  };

  const prevButton = document.getElementById("library-prev");
  const nextButton = document.getElementById("library-next");
  const pageInput = document.getElementById("library-page-input");
  const filterInput = document.getElementById("library-filter-input");

  prevButton.addEventListener("click", () => {
    if (state.loading) return;
    state.offset = Math.max(0, state.offset - state.pageSize);
    loadLibraryPage(state);
  });

  nextButton.addEventListener("click", () => {
    if (state.loading) return;
    if (state.offset + state.pageSize >= state.total) return;
    state.offset += state.pageSize;
    loadLibraryPage(state);
  });

  const jumpToInputPage = () => {
    if (state.loading) return;
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const currentPage = Math.floor(state.offset / state.pageSize) + 1;
    const requested = Number.parseInt(pageInput.value, 10);
    if (!Number.isFinite(requested)) {
      pageInput.value = String(currentPage);
      return;
    }
    const clamped = Math.min(totalPages, Math.max(1, requested));
    pageInput.value = String(clamped);
    const newOffset = (clamped - 1) * state.pageSize;
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

  pageSizeSelect.addEventListener("change", () => {
    if (state.loading) return;
    const newSize = parsePageSize(pageSizeSelect.value, state.pageSize);
    if (newSize === state.pageSize) return;
    state.offset = Math.floor(state.offset / newSize) * newSize;
    state.pageSize = newSize;
    loadLibraryPage(state);
  });

  let filterDebounceTimer = null;
  const cancelFilterDebounce = () => {
    if (filterDebounceTimer !== null) {
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = null;
    }
  };
  const applyFilter = () => {
    cancelFilterDebounce();
    const value = filterInput.value.trim();
    if (value === state.filter) return;
    state.filter = value;
    state.offset = 0;
    loadLibraryPage(state);
  };
  filterInput.addEventListener("input", () => {
    cancelFilterDebounce();
    filterDebounceTimer = setTimeout(applyFilter, FILTER_DEBOUNCE_MS);
  });
  filterInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyFilter();
    }
  });

  loadLibraryPage(state);
  return {
    beforeLeave() {
      cancelFilterDebounce();
    },
  };
}

function parsePageSize(raw, fallback) {
  const value = Number.parseInt(raw, 10);
  if (PAGE_SIZE_OPTIONS.includes(value)) {
    return value;
  }
  return fallback;
}

async function loadLibraryPage(state) {
  const count = document.getElementById("library-count");
  const stateBox = document.getElementById("library-state");
  const tableWrap = document.getElementById("library-table-wrap");
  const tableBody = document.getElementById("library-table-body");
  const pagination = document.getElementById("library-pagination");
  const pageInput = document.getElementById("library-page-input");
  const pageTotal = document.getElementById("library-page-total");
  const pageSizeSelect = document.getElementById("library-page-size");
  const prevButton = document.getElementById("library-prev");
  const nextButton = document.getElementById("library-next");

  state.loading = true;
  prevButton.disabled = true;
  nextButton.disabled = true;
  pageSizeSelect.disabled = true;

  try {
    const params = new URLSearchParams({
      offset: String(state.offset),
      limit: String(state.pageSize),
    });
    if (state.filter) {
      params.set("q", state.filter);
    }
    const response = await fetch(`/library-songs?${params.toString()}`);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || "Unable to load the music library.");
    }

    const songs = Array.isArray(payload?.songs) ? payload.songs : [];
    const total = Number.isFinite(payload?.total) ? payload.total : songs.length;
    state.total = total;

    if (state.offset >= total && total > 0) {
      const lastPageIndex = Math.max(0, Math.ceil(total / state.pageSize) - 1);
      state.offset = lastPageIndex * state.pageSize;
      await loadLibraryPage(state);
      return;
    }

    count.textContent = `${total} ${total === 1 ? "song" : "songs"}`;

    if (total === 0) {
      tableWrap.hidden = true;
      pagination.hidden = true;
      stateBox.hidden = false;
      stateBox.textContent = state.filter
        ? "No songs match the current filter."
        : "No songs have been indexed yet.";
      return;
    }

    stateBox.hidden = true;
    tableWrap.hidden = false;
    tableBody.replaceChildren(...songs.map(createSongRow));

    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const currentPage = Math.floor(state.offset / state.pageSize) + 1;
    pageInput.value = String(currentPage);
    pageInput.max = String(totalPages);
    pageTotal.textContent = String(totalPages);
    pagination.hidden = false;
    prevButton.disabled = state.offset === 0;
    nextButton.disabled = state.offset + state.pageSize >= total;
  } catch (error) {
    count.textContent = "Unavailable";
    tableWrap.hidden = true;
    pagination.hidden = true;
    stateBox.hidden = false;
    stateBox.textContent = error.message || "Unable to load the music library.";
  } finally {
    state.loading = false;
    pageSizeSelect.disabled = false;
  }
}

function createSongRow(song) {
  const row = document.createElement("tr");
  row.appendChild(createArtworkCell(song));
  row.appendChild(createTrackCell(song));
  row.appendChild(createTextCell(song.artist));
  row.appendChild(createTextCell(song.album));
  row.appendChild(createTextCell(song.genre));
  row.appendChild(createTextCell(song.language));
  row.appendChild(createTextCell(formatDuration(song.duration), "library-duration"));
  row.appendChild(createFileCell(song));
  row.appendChild(createEditCell(song));
  row.appendChild(createDeleteCell(song));
  row.appendChild(createDownloadCell(song));
  return row;
}

async function playSong(song) {
  if (!song.path) return;
  const path = song.path.split("/").slice(-3).join("/");
  const url = `/song?${new URLSearchParams({ path: path }).toString()}`;
  const title = song.trackName || song.fileName || "Unknown";
  const artist = song.artist ? song.artist : "";

  let lyricsOption = null;
  try {
    const lyricsResponse = await fetch(`/song-lyric?${new URLSearchParams({ path: path }).toString()}`);
    if (lyricsResponse.ok) {
      const lyricsData = await lyricsResponse.json();
      if (lyricsData.lyrics) {
        lyricsOption = { syncedLyrics: lyricsData.lyrics };
      }
    }
  } catch (error) {
    // Silently ignore lyrics fetch errors
  }

  setSongSourceAndPlay(url, lyricsOption);
  audioPlayerSetTitle(`Now Playing: ${artist} - ${title}  (${path})`);
}

function createArtworkCell(song) {
  const path = song.path.split("/").slice(-3).join("/");
  const cell = document.createElement("td");
  cell.style.textAlign = "center";
  cell.style.padding = "4px";

  const img = document.createElement("img");
  img.style.width = "100px";
  img.style.height = "100px";
  img.style.objectFit = "cover";
  img.style.cursor = "pointer";
  img.style.borderRadius = "4px";
  img.alt = song.trackName || song.fileName || "Album art";

  const artworkUrl = `/song-artwork?${new URLSearchParams({ path: path }).toString()}`;
  img.src = artworkUrl;
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    window.open(artworkUrl, "_blank");
  });

  img.addEventListener("error", () => {
    img.style.display = "none";
  });

  cell.appendChild(img);
  return cell;
}

function createTrackCell(song) {
  const cell = document.createElement("td");
  const title = document.createElement("div");
  title.className = "library-track-title";
  title.textContent = song.trackName || song.fileName || "Untitled";
  title.style.cursor = "pointer";
  title.addEventListener("click", () => playSong(song));

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

function createDeleteCell(song) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "library-action-btn small-icon";
  button.title = `Delete ${song.fileName || "song"}`;

  const img = document.createElement("img");
  img.src = "/authorized/delete.png";
  img.alt = "Delete";
  button.appendChild(img);

  button.addEventListener("click", async (e) => {
    e.stopPropagation();
    const confirmed = confirm(`Are you sure you want to delete "${song.fileName || "this song"}"?`);
    if (!confirmed) {
      return;
    }

    if (song.path) {
      const path = song.path.split("/").slice(-3).join("/");
      try {
        const response = await fetch(`/delete-song?${new URLSearchParams({ path: path }).toString()}`, {
          method: "DELETE"
        });

        if (response.ok) {
          // Remove the row from the table
          const row = button.closest("tr");
          if (row) {
            row.remove();
          }
        } else {
          alert("Failed to delete song: " + (await response.text()));
        }
      } catch (error) {
        alert("Error deleting song: " + error.message);
      }
    }
  });

  cell.appendChild(button);
  return cell;
}

function createEditCell(song) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "library-action-btn small-icon";
  button.title = `Edit ${song.fileName || "song"}`;

  const img = document.createElement("img");
  img.src = "/authorized/edit.png";
  img.alt = "Edit";
  button.appendChild(img);

  button.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (song.path) {
      const path = song.path.split("/").slice(-3).join("/");
      const dropTabButton = document.getElementById("tab-drop");
      if (dropTabButton) {
        dropTabButton.click();
      }
      setTimeout(() => {
        document.dispatchEvent(
          new CustomEvent("library-song-edit", { detail: { path } })
        );
      }, 0);
    }
  });

  cell.appendChild(button);
  return cell;
}

function createDownloadCell(song) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "library-action-btn large-icon";
  button.title = `Download ${song.fileName || "song"}`;

  const img = document.createElement("img");
  img.src = "/authorized/download.png";
  img.alt = "Download";
  button.appendChild(img);

  button.addEventListener("click", () => {
    if (song.path) {
      const path = song.path.split("/").slice(-3).join("/");
      const url = `/song?${new URLSearchParams({ path: path }).toString()}`;
      const link = document.createElement("a");
      link.href = url;
      link.download = song.fileName || "dropMi.mp3";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });

  cell.appendChild(button);
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
