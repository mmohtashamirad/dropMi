import { elements } from "/authorized/dom.js";
import { resetDropMessage, setProgress, showScreen } from "/authorized/screen-ui.js";

const NO_LYRICS_OPTION = {
  title: "Enter Your Own Lyrics",
  artist: "",
  album: "",
  syncedLyrics: "",
  plainLyrics: "No lyric or removed by DropMi"
};

let lastEyeD3Output = "";
let lastSongrecOutput = "";

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
  fragment.querySelector(".result-error-close").addEventListener("click", clearResultError);
  const tableWrap = elements.resultTableBody.closest(".result-table-wrap");
  elements.resultScreen.insertBefore(fragment, tableWrap || elements.resultScreen.firstChild);
}

export function showResult(payload, isError) {
  lastEyeD3Output = payload.eyeD3Output || "";
  lastSongrecOutput = payload.songrecOutput || "";

  setProgress(100);
  showScreen(elements.resultScreen);
  elements.resultFileName.textContent = payload.fileName ? `File: ${payload.fileName}` : "";
  renderDuplicateNotice(payload.duplicate);
  renderComparisonTable(lastEyeD3Output, lastSongrecOutput);
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
  lastEyeD3Output = "";
  lastSongrecOutput = "";
  elements.resultFileName.textContent = "";
  renderDuplicateNotice(null);
  elements.resultTableBody.innerHTML = "";
  elements.lyricsOptions.innerHTML = "";
  elements.lyricsSection.hidden = true;
  resetDropMessage();
  clearResultError();
  elements.fileInput.value = "";
}

export function updateSongrecResult(songrecOutput) {
  lastSongrecOutput = songrecOutput || "";
  renderComparisonTable(lastEyeD3Output, lastSongrecOutput);
}

export function setLyricsOptions(options) {
  renderLyricsOptions(options || []);
}

export function getSelectedMetadata() {
  const metadata = {};
  const inputs = elements.resultTableBody.querySelectorAll("[data-selected-tag]");

  inputs.forEach((input) => {
    metadata[input.dataset.selectedTag] = input.value.trim();
  });

  return metadata;
}

export function getSelectedLyricsOption() {
  const selected = elements.lyricsOptions.querySelector('input[name="selected-lyrics-option"]:checked');
  if (!selected) {
    return null;
  }

  try {
    return JSON.parse(selected.value);
  } catch {
    return null;
  }
}

export function highlightMissingRequiredRows() {
  const inputs = elements.resultTableBody.querySelectorAll('[data-selected-tag][required]');
  let anyMissing = false;
  inputs.forEach((input) => {
    const tr = input.closest('tr');
    if (!tr) return;
    if (!input.value.trim()) {
      tr.classList.add('required-missing');
      anyMissing = true;
    } else {
      tr.classList.remove('required-missing');
    }
  });
  return anyMissing;
}

function renderComparisonTable(eyeD3Output, songrecOutput) {
  const eyeD3Data = extractEyeD3Fields(eyeD3Output);
  const songrecData = extractSongrecFields(songrecOutput);
  const rows = [
    ["Artist", eyeD3Data.artist, songrecData.artist],
    ["Track Name", eyeD3Data.trackName, songrecData.trackName],
    ["Album", eyeD3Data.album, songrecData.album],
    ["Genre", eyeD3Data.genre, songrecData.genre],
    ["Comment", eyeD3Data.comment, songrecData.comment],
    ["Language", eyeD3Data.language, songrecData.language],
    ["Album Art", eyeD3Data.albumArt, songrecData.albumArt]
  ];

  elements.resultTableBody.innerHTML = "";
  rows.forEach(([label, eyeD3Value, songrecValue]) => {
    const row = document.createElement("tr");
    row.appendChild(createTextCell(label));
    row.appendChild(createValueCell(eyeD3Value));
    row.appendChild(createValueCell(songrecValue));
    row.appendChild(createEditableCell(label, songrecValue || ""));
    elements.resultTableBody.appendChild(row);
  });
}

function renderDuplicateNotice(duplicate) {
  elements.duplicateNotice.innerHTML = "";

  if (!duplicate) {
    elements.duplicateNotice.hidden = true;
    return;
  }

  const title = document.createElement("strong");
  title.textContent = "Possible duplicate found";
  elements.duplicateNotice.appendChild(title);

  const details = document.createElement("p");
  const score = formatSimilarity(duplicate.similarity);
  const fileName = duplicate.fileName || "an existing song";
  const duration = formatDuration(duplicate.duration);
  details.textContent = [
    `${fileName} matched with score ${score}`,
    duration ? `duration ${duration}` : ""
  ].filter(Boolean).join(" · ");
  elements.duplicateNotice.appendChild(details);

  if (duplicate.relativePath) {
    const playerLabel = document.createElement("p");
    playerLabel.className = "duplicate-player-label";
    playerLabel.textContent = "Existing song";
    elements.duplicateNotice.appendChild(playerLabel);

    const player = document.createElement("audio");
    player.className = "duplicate-player";
    player.controls = true;
    player.preload = "metadata";
    player.src = `/song?${new URLSearchParams({ path: duplicate.relativePath }).toString()}`;
    elements.duplicateNotice.appendChild(player);
  }

  elements.duplicateNotice.hidden = false;
}

function renderLyricsOptions(options) {
  elements.lyricsOptions.innerHTML = "";

  if (!Array.isArray(options)) {
    elements.lyricsSection.hidden = true;
    return;
  }

  elements.lyricsSection.hidden = false;

  [NO_LYRICS_OPTION, ...options].forEach((option, index) => {
    const item = document.createElement("details");
    item.className = "lyrics-option";

    const summary = document.createElement("summary");
    summary.className = "lyrics-summary";
    const summaryTitle = document.createElement("span");
    summaryTitle.className = "lyrics-summary-title";
    summaryTitle.textContent = option.title || "Lyrics option";
    summary.appendChild(summaryTitle);

    const duration = formatDuration(option.duration);
    if (duration) {
      const summaryDuration = document.createElement("span");
      summaryDuration.className = "lyrics-duration";
      summaryDuration.textContent = duration;
      summary.appendChild(summaryDuration);
    }
    item.appendChild(summary);

    const selectorRow = document.createElement("label");
    selectorRow.className = "lyrics-selector";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "selected-lyrics-option";
    // set initial radio value; for editable option we'll update on input
    radio.value = JSON.stringify(option);
    selectorRow.appendChild(radio);
    const selectorText = document.createElement("span");
    selectorText.textContent = "Use these lyrics";
    selectorRow.appendChild(selectorText);
    item.appendChild(selectorRow);

    const meta = document.createElement("p");
    meta.className = "lyrics-meta";
    meta.textContent = [option.artist, option.album].filter(Boolean).join(" · ");
    if (meta.textContent) {
      item.appendChild(meta);
    }

    // For the special No Lyrics option (index 0) render an editable textarea
    if (index === 0) {
      const textarea = document.createElement('textarea');
      textarea.className = 'lyrics-edit-box';
      textarea.value = option.syncedLyrics || option.plainLyrics || '';
      // keep radio value in sync with edited content
      textarea.addEventListener('input', () => {
        try {
          const updated = Object.assign({}, option, { syncedLyrics: textarea.value, plainLyrics: textarea.value });
          radio.value = JSON.stringify(updated);
        } catch (e) {
          // ignore
        }
      });
      // ensure initial radio value includes current textarea value
      try {
        const initial = Object.assign({}, option, { syncedLyrics: textarea.value, plainLyrics: textarea.value });
        radio.value = JSON.stringify(initial);
      } catch (e) {}
      item.appendChild(textarea);
    } else {
      const body = document.createElement("pre");
      body.className = "lyrics-body";
      body.textContent = option.syncedLyrics || option.plainLyrics || "No lyrics available.";
      item.appendChild(body);
    }

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
    comment: extractEyeD3Comment(parsed),
    language: extractEyeD3Language(parsed),
    albumArt: extractEyeD3AlbumArt(parsed)
  };
}

function extractSongrecFields(output) {
  const parsed = parseEmbeddedJSON(output);
  const track = parsed?.track || {};

  return {
    artist: track.subtitle || firstArtistId(track.artists),
    trackName: track.title || "",
    album: extractSongrecAlbum(track),
    genre: track.genres?.primary || "",
    comment: "",
    language: "",
    albumArt: track.images?.coverart || track.images?.coverarthq || track.images?.background || ""
  };
}

function extractSongrecAlbum(track) {
  if (!Array.isArray(track.sections) || track.sections.length === 0) {
    return "";
  }

  const metadata = track.sections[0].metadata;
  if (!Array.isArray(metadata)) {
    return "";
  }

  const albumMeta = metadata.find((item) => item?.title === "Album");
  return albumMeta?.text || "";
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

function extractEyeD3Comment(parsed) {
  if (typeof parsed.comment === "string") {
    return parsed.comment;
  }

  if (typeof parsed.comments === "string") {
    return parsed.comments;
  }

  if (Array.isArray(parsed.comments)) {
    const comment = parsed.comments.find((item) => item?.text || item?.comment);
    return comment?.text || comment?.comment || "";
  }

  return "";
}

function extractEyeD3Language(parsed) {
  if (typeof parsed.language === "string") {
    return parsed.language;
  }

  if (typeof parsed.languages === "string") {
    return parsed.languages;
  }

  if (Array.isArray(parsed.languages)) {
    return parsed.languages.filter(Boolean).join(", ");
  }

  return extractEyeD3TextFrame(parsed, "TLAN");
}

function extractEyeD3TextFrame(parsed, frameID) {
  const frames = parsed.text_frames || parsed.textFrames;
  if (!Array.isArray(frames)) {
    return "";
  }

  const frame = frames.find((item) => item?.id === frameID || item?.frame_id === frameID);
  return frame?.text || frame?.value || "";
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
    comment: "",
    language: "",
    albumArt: ""
  };
}

function createTextCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

function formatDuration(duration) {
  const seconds = Math.round(Number(duration));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatSimilarity(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return "0%";
  }

  return `${Math.round(score * 100)}%`;
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

  if (label === "Language") {
    input.required = true;
  }

  // Remove red highlight when user starts typing
  input.addEventListener('input', () => {
    const tr = input.closest('tr');
    if (tr && input.value.trim()) tr.classList.remove('required-missing');
  });

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
