import { elements } from "/authorized/dom.js";
import { postJSON } from "/authorized/api.js";

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
      const itemElement = createResultItem(item);
      resultsList.appendChild(itemElement);
    });

    searchStatus.hidden = true;
    searchResults.hidden = false;
  }

  function createResultItem(item) {
    const div = document.createElement("div");
    div.className = "search-internet-result-item";

    const titleDiv = document.createElement("div");
    titleDiv.className = "search-internet-result-title";
    titleDiv.textContent = item.title || "Unknown Title";

    const metaDiv = document.createElement("div");
    metaDiv.className = "search-internet-result-meta";

    const metaParts = [];
    if (item.time) metaParts.push(`Duration: ${item.time}`);
    if (item.size) metaParts.push(`Size: ${item.size}`);
    if (item.quality) metaParts.push(`Quality: ${item.quality}kbps`);

    metaDiv.textContent = metaParts.join(" • ");

    div.appendChild(titleDiv);
    div.appendChild(metaDiv);

    // Add download button
    if (item.download_command) {
      const downloadBtn = document.createElement("button");
      downloadBtn.className = "search-internet-download-btn";
      downloadBtn.textContent = "Download";
      downloadBtn.addEventListener("click", async () => {
        await handleDownload(item, downloadBtn, div);
      });
      div.appendChild(downloadBtn);
    }

    return div;
  }

  async function handleDownload(item, downloadBtn, itemDiv) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Downloading...";

    try {
      const result = await postJSON(
        "/internet-song-download",
        { download_command: item.download_command },
        "Unable to download song."
      );

      if (!result.ok) {
        showStatus(result.error || "Download failed.", "error");
        downloadBtn.disabled = false;
        downloadBtn.textContent = "Download";
        return;
      }

      // Remove download button
      downloadBtn.remove();

      // Add audio player
      const audioPlayer = document.createElement("audio");
      audioPlayer.className = "search-internet-player";
      audioPlayer.controls = true;
      audioPlayer.src = `/internet-song-cached/${result.payload.filename}`;

      itemDiv.appendChild(audioPlayer);

      // Add DropMi button
      const dropmiBtn = document.createElement("button");
      dropmiBtn.className = "search-internet-dropmi-btn";
      dropmiBtn.textContent = "DropMi";
      dropmiBtn.addEventListener("click", () => {
        handleDropMi(result.payload.filename);
      });
      itemDiv.appendChild(dropmiBtn);
    } catch (error) {
      showStatus(`Error: ${error.message}`, "error");
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download";
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

  return {};
}
