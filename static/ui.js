import { elements } from "/static/dom.js";

export function setDraggingState(isDragging) {
  elements.dropZone.classList.toggle("is-dragging", isDragging);
  if (isDragging) {
    elements.dropTitle.textContent = "Release to upload";
    elements.dropSubtext.textContent = "The server will accept the file and run eyeD3.";
  }
}

export function showScreen(screen) {
  [elements.loginScreen, elements.dropScreen, elements.uploadScreen, elements.resultScreen].forEach((element) => {
    element.classList.toggle("screen-active", element === screen);
  });
}

export function setProgress(value) {
  elements.progressFill.style.width = `${value}%`;
  elements.progressLabel.textContent = `${value}%`;
}

export function resetDropMessage() {
  elements.dropTitle.textContent = "Drop your MP3 file here";
  elements.dropSubtext.textContent = "Drag and drop an MP3 file to begin.";
}

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
  resetDropMessage();
  clearResultError();
  elements.fileInput.value = "";
}

export function resetUploadScreen() {
  elements.uploadFileName.textContent = "Preparing upload...";
  setProgress(0);
}

export function showLoginError(message) {
  elements.loginError.hidden = false;
  elements.loginError.textContent = message;
}

export function clearLoginError() {
  elements.loginError.hidden = true;
  elements.loginError.textContent = "";
}

export function resetAuthenticatedUI() {
  resetResultScreen();
  resetUploadScreen();
  resetDropMessage();
  elements.fileInput.value = "";
  hideSessionBar();
}

export function showSessionBar(username) {
  elements.sessionUser.textContent = username;
  elements.sessionBar.hidden = false;
}

export function hideSessionBar() {
  elements.sessionUser.textContent = "";
  elements.sessionBar.hidden = true;
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
    elements.resultTableBody.appendChild(row);
  });
}

function renderEmptyComparisonTable(message) {
  elements.resultTableBody.innerHTML = "";
  const row = document.createElement("tr");
  row.appendChild(createTextCell("Result"));

  const valueCell = document.createElement("td");
  valueCell.colSpan = 2;
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
  } catch (error) {
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

function looksLikeImage(value) {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/"));
}
