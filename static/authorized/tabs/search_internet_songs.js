import { elements } from "/authorized/dom.js";
import { postJSON } from "/authorized/api.js";
import { audioPlayerSetTitle, setSongSourceAndPlay } from "/authorized/audio-player.js";

export function initTab() {
  const searchButton = document.getElementById("search-internet-button");
  const searchInput = document.getElementById("search-internet-query-input");
  const searchStatus = document.getElementById("search-internet-status");
  const searchResults = document.getElementById("search-internet-results");

  if (!searchButton || !searchInput) {
    return {};
  }

  searchButton.addEventListener("click", () => {
    performSearch();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      performSearch();
    }
  });

  async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      showStatus("Please enter a search query.", "error");
      return;
    }

    searchButton.disabled = true;
    searchButton.textContent = "Searching...";
    searchStatus.hidden = false;
    searchStatus.className = "search-internet-status searching";
    searchStatus.textContent = "Searching for songs...";
    searchResults.hidden = true;

    try {
      const result = await postJSON(
        "/internet-songs-search",
        { query },
        "Unable to search songs."
      );

      if (!result.ok) {
        showStatus(result.error || "Search failed.", "error");
        return;
      }

      displayResults(result);
    } catch (error) {
      showStatus(`Error: ${error.message}`, "error");
    } finally {
      searchButton.disabled = false;
      searchButton.textContent = "Search";
    }
  }

  function displayResults(data) {
    const items = data.payload.items || [];
    if (items.length === 0) {
      showStatus("No results found.", "info");
      return;
    }

    const resultsList = document.getElementById("search-internet-results-list");
    resultsList.innerHTML = "";

    items.forEach((item) => {
      if (!item.download_command)
        return;
      const itemElement = createResultItem(item);
      resultsList.appendChild(itemElement);
    });

    searchStatus.hidden = true;
    searchResults.hidden = false;
  }

  function createResultItem(item) {
    const div = document.createElement("div");
    div.className = "search-internet-result-item";

    // Thumbnail (falls back to a placeholder when the item has no image).
    const thumb = document.createElement("div");
    thumb.className = "search-internet-result-thumb";
    const img = document.createElement("img");
    img.src = item.image || "/authorized/no-photo-song.png";
    img.alt = item.title || "";
    img.loading = "lazy";
    thumb.appendChild(img);
    div.appendChild(thumb);

    // Info column: platform, title, duration, other info, actions.
    const info = document.createElement("div");
    info.className = "search-internet-result-info";

    if (item.platform) {
      const platform = document.createElement("div");
      platform.className = "search-internet-result-platform";
      platform.textContent = item.platform;
      info.appendChild(platform);
    }

    const titleDiv = document.createElement("div");
    titleDiv.className = "search-internet-result-title";
    titleDiv.textContent = item.title || "Unknown Title";
    info.appendChild(titleDiv);

    // Duration plus any extra info (size, quality, ...) on a single line.
    const metaParts = [];
    if (item.time) metaParts.push(item.time);
    if (item.size) metaParts.push(item.size);
    if (item.quality) metaParts.push(`${item.quality}kbps`);
    if (metaParts.length > 0) {
      const metaDiv = document.createElement("div");
      metaDiv.className = "search-internet-result-meta";
      metaDiv.textContent = metaParts.join(" • ");
      info.appendChild(metaDiv);
    }

    const actions = document.createElement("div");
    actions.className = "search-internet-result-actions";
    info.appendChild(actions);

    div.appendChild(info);

    // Actions depend on whether the song can be downloaded and if it's cached.
    if (item.download_command) {
      if (item.is_cached) {
        // Already on the server — show the finished state, as if the download
        // had just completed.
        showDownloadedState(item, actions);
      } else {
        actions.appendChild(createDownloadButton(item, actions));
      }
    }

    return div;
  }

  function createDownloadButton(item, actions) {
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "search-internet-download-btn";
    downloadBtn.textContent = "Download";
    downloadBtn.addEventListener("click", () => {
      handleDownload(item, downloadBtn, actions);
    });
    return downloadBtn;
  }

  // Replace the actions area with the audio player + DropMi button for a song
  // that lives in the server cache.
  function renderDownloaded(actions, item, filename) {
    actions.innerHTML = "";

    const playBtn = document.createElement("button");
    playBtn.className = "search-internet-play-btn";
    playBtn.textContent = "Play";
    playBtn.addEventListener("click", () => {
      setSongSourceAndPlay(`/internet-song-cached/${filename}`);
      audioPlayerSetTitle(`Now Playing Internet Song: ${item.title} (${filename})`)
    });
    actions.appendChild(playBtn);

    const dropmiBtn = document.createElement("button");
    dropmiBtn.className = "search-internet-dropmi-btn";
    dropmiBtn.textContent = "DropMi";
    dropmiBtn.addEventListener("click", () => {
      handleDropMi(filename);
    });
    actions.appendChild(dropmiBtn);
  }

  function disableAllDownloadButtons() {
    const allDownloadButtons = document.querySelectorAll(".search-internet-download-btn");
    allDownloadButtons.forEach(btn => {
      btn.disabled = true;
    });
  }

  function enableAllDownloadButtons() {
    const allDownloadButtons = document.querySelectorAll(".search-internet-download-btn");
    allDownloadButtons.forEach(btn => {
      btn.disabled = false;
    });
  }

  async function handleDownload(item, downloadBtn, actions) {
    searchStatus.hidden = true;
    disableAllDownloadButtons();
    downloadBtn.textContent = "Downloading...";

    try {
      const result = await postJSON(
        "/internet-song-download",
        { download_command: item.download_command },
        "Unable to download song."
      );

      if (!result.ok) {
        showErrorWithResults(result.error || "Download failed.");
        downloadBtn.textContent = "Download";
        enableAllDownloadButtons();
        return;
      }

      renderDownloaded(actions, item, result.payload.filename);
      enableAllDownloadButtons();
    } catch (error) {
      showErrorWithResults(`Error: ${error.message}`);
      downloadBtn.textContent = "Download";
      enableAllDownloadButtons();
    }
  }

  async function showDownloadedState(item, actions) {

    try {
      renderDownloaded(actions, item, item.is_cached);
    } catch {
      actions.innerHTML = "";
      actions.appendChild(createDownloadButton(item, actions));
    }
  }

  function handleDropMi(filename) {
    // Switch to the drop tab, then hand off the filename. drop.js catches this
    // event, calls /upload-internet-song, and runs the rest of the flow.
    const dropTabButton = document.getElementById("tab-drop");
    if (dropTabButton) {
      dropTabButton.click();
    }

    // Defer the event so the drop tab has finished loading and registered its
    // listener before we dispatch.
    setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent("internet-song-dropmi", { detail: { filename } })
      );
    }, 0);
  }

  function showStatus(message, type) {
    searchStatus.hidden = false;
    searchStatus.className = `search-internet-status ${type}`;
    searchStatus.textContent = message;
    searchResults.hidden = true;
  }

  function showErrorWithResults(message) {
    searchStatus.hidden = false;
    searchStatus.className = "search-internet-status error";
    searchStatus.textContent = message;
    searchResults.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return {};
}
