import { elements } from "/authorized/dom.js";
import { resetDropMessage, setProgress, showScreen } from "/authorized/screen-ui.js";

export function clearResultError() {
  const existingError = elements.resultScreen.querySelector(".result-error");
  if (existingError) {
    existingError.remove();
  }
}

export function renderConfirmError(message) {
  clearResultError();
  const fragment = elements.resultErrorTemplate.content.cloneNode(true);
  fragment.querySelector("#result-error-text").textContent = message;
  elements.resultScreen.insertBefore(fragment, elements.resultTableBody.parentElement);
}

export function showResult(payload, isError) {
  setProgress(100);
  showScreen(elements.resultScreen);
  elements.resultFileName.textContent = payload.fileName ? `File: ${payload.fileName}` : "";
  renderComparisonTable(payload.eyeD3Output, payload.songrecOutput);
  renderLyricsOptions(payload.lyricsOptions || []);
  clearResultError();

  if (payload.error) {
    renderConfirmError(payload.error);
  }

  if (isError && !payload.eyeD3Output && !payload.songrecOutput) {
    renderEmptyComparisonTable("No analysis output returned.");
  }
}

export function resetResultScreen() {
  elements.resultFileName.textContent = "";
  elements.resultTableBody.innerHTML = "";
  elements.lyricsOptions.innerHTML = "";
  elements.lyricsSection.hidden = true;
  resetDropMessage();
  clearResultError();
  elements.fileInput.value = "";
}

export function getSelectedMetadata() {
  const metadata = {};
  const inputs = elements.resultTableBody.querySelectorAll("[data-selected-tag]");

  inputs.forEach((input) => {
    metadata[input.dataset.selectedTag] = input.value.trim();
  });

  return metadata;
}

function renderComparisonTable(eyeD3Output, songrecOutput) {
  const eyeD3Data = extractEyeD3Fields(eyeD3Output);
  const songrecData = extractSongrecFields(songrecOutput);
  const rows = [
    ["Artist", eyeD3Data.artist, songrecData.artist],
    ["Track Name", eyeD3Data.trackName, songrecData.trackName],
    ["Album", eyeD3Data.album, songrecData.album],
    ["Genre", eyeD3Data.genre, songrecData.genre],
    ["Album Art", eyeD3Data.albumArt, songrecData.albumArt]
  ];

  elements.resultTableBody.innerHTML = "";
  rows.forEach(([label, eyeD3Value, songrecValue]) => {
    const row = document.createElement("tr");
    row.appendChild(createTextCell(label));
    row.appendChild(createValueCell(eyeD3Value));
    row.appendChild(createValueCell(songrecValue));
    row.appendChild(createEditableCell(label, songrecValue || eyeD3Value || ""));
    elements.resultTableBody.appendChild(row);
  });
}

function renderLyricsOptions(options) {
  elements.lyricsOptions.innerHTML = "";

  if (!Array.isArray(options) || options.length === 0) {
    elements.lyricsSection.hidden = true;
    return;
  }

  elements.lyricsSection.hidden = false;

  options.forEach((option) => {
    const item = document.createElement("details");
    item.className = "lyrics-option";

    const summary = document.createElement("summary");
    summary.className = "lyrics-summary";
    summary.textContent = option.title || "Lyrics option";
    item.appendChild(summary);

    const meta = document.createElement("p");
    meta.className = "lyrics-meta";
    meta.textContent = [option.artist, option.album].filter(Boolean).join(" · ");
    if (meta.textContent) {
      item.appendChild(meta);
    }

    const body = document.createElement("pre");
    body.className = "lyrics-body";
    body.textContent = option.syncedLyrics || option.plainLyrics || "No lyrics available.";
    item.appendChild(body);

    elements.lyricsOptions.appendChild(item);
  });
}

function renderEmptyComparisonTable(message) {
  elements.resultTableBody.innerHTML = "";
  const row = document.createElement("tr");
  row.appendChild(createTextCell("Result"));

  const valueCell = document.createElement("td");
  valueCell.colSpan = 3;
  valueCell.textContent = message;
  row.appendChild(valueCell);

  elements.resultTableBody.appendChild(row);
}

function extractEyeD3Fields(output) {
  const parsed = parseEmbeddedJSON(output);
  if (!parsed) {
    return emptyMetadata();
  }

  return {
    artist: parsed.artist || parsed.album_artist || "",
    trackName: parsed.title || "",
    album: parsed.album || "",
    genre: extractEyeD3Genre(parsed),
    albumArt: extractEyeD3AlbumArt(parsed)
  };
}

function extractSongrecFields(output) {
  const parsed = parseEmbeddedJSON(output);
  const track = parsed?.track || {};

  return {
    artist: track.subtitle || firstArtistId(track.artists),
    trackName: track.title || "",
    album: "",
    genre: track.genres?.primary || "",
    albumArt: track.images?.coverart || track.images?.coverarthq || track.images?.background || ""
  };
}

function extractEyeD3Genre(parsed) {
  if (typeof parsed.genre === "string") {
    return parsed.genre;
  }

  if (parsed.genre?.name) {
    return parsed.genre.name;
  }

  return "";
}

function extractEyeD3AlbumArt(parsed) {
  const images = parsed.images;
  if (!images) {
    return "";
  }

  if (Array.isArray(images) && images[0]?.image_data) {
    return images[0].image_data;
  }

  return "";
}

function firstArtistId(artists) {
  if (!Array.isArray(artists) || artists.length === 0) {
    return "";
  }

  return artists[0].name || artists[0].id || "";
}

function parseEmbeddedJSON(text) {
  if (!text) {
    return null;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function emptyMetadata() {
  return {
    artist: "",
    trackName: "",
    album: "",
    genre: "",
    albumArt: ""
  };
}

function createTextCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

function createValueCell(value) {
  const cell = document.createElement("td");

  if (!value) {
    cell.textContent = "—";
    return cell;
  }

  if (looksLikeImage(value)) {
    const image = document.createElement("img");
    image.className = "result-art";
    image.src = value;
    image.alt = "Album art";
    cell.appendChild(image);
    return cell;
  }

  cell.textContent = value;
  return cell;
}

function createEditableCell(label, value) {
  const cell = document.createElement("td");
  const input = document.createElement(label === "Album Art" ? "textarea" : "input");
  const tagKey = toMetadataKey(label);

  input.className = "editable-value";
  input.value = value;
  input.setAttribute("aria-label", `${label} selected value`);
  input.dataset.selectedTag = tagKey;

  if (label === "Album Art") {
    input.rows = 3;
    const preview = document.createElement("div");
    preview.className = "editable-art-preview";
    updateArtPreview(preview, value);
    input.addEventListener("input", () => {
      updateArtPreview(preview, input.value.trim());
    });
    cell.appendChild(input);
    cell.appendChild(preview);
    return cell;
  }

  input.type = "text";
  cell.appendChild(input);
  return cell;
}

function updateArtPreview(container, value) {
  container.innerHTML = "";

  if (!looksLikeImage(value)) {
    return;
  }

  const image = document.createElement("img");
  image.className = "result-art";
  image.src = value;
  image.alt = "Selected album art";
  container.appendChild(image);
}

function looksLikeImage(value) {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/"));
}

function toMetadataKey(label) {
  return label.toLowerCase().replace(/\s+/g, "_");
}
