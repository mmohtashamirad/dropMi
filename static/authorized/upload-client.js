import { parseJSON, postJSON } from "/authorized/api.js";
import { elements } from "/authorized/dom.js";
import { setProgress, showScreen } from "/authorized/screen-ui.js";

export function uploadFile(file, callbacks) {
  showScreen(elements.uploadScreen);
  elements.uploadFileName.textContent = `Uploading ${file.name}`;
  setProgress(0);

  const formData = new FormData();
  formData.append("file", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload");

  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) {
      return;
    }

    const percent = Math.round((event.loaded / event.total) * 100);
    setProgress(percent);
  });

  xhr.addEventListener("load", () => {
    const payload = parseJSON(xhr.responseText);
    if (xhr.status >= 200 && xhr.status < 300 && payload) {
      callbacks.onSuccess(payload);
      return;
    }

    callbacks.onError(
      payload || {
        fileName: file.name,
        output: "",
        error: "The upload or analysis failed."
      }
    );
  });

  xhr.addEventListener("error", () => {
    callbacks.onError({
      fileName: file.name,
      output: "",
      error: "The browser could not reach the server."
    });
  });

  xhr.addEventListener("abort", () => {
    callbacks.onCancel();
  });

  xhr.send(formData);

  return {
    abort() {
      xhr.abort();
    }
  };
}

export async function confirmUpload(uploadId, selectedMetadata, selectedLyrics) {
  return submitUploadAction(
    "/confirm",
    {
      uploadId,
      selectedMetadata,
      selectedLyrics
    },
    "The server could not move the file into the upload directory."
  );
}

export async function findLyrics(selectedMetadata) {
  const artist = (selectedMetadata.artist || "").trim();
  const trackName = (selectedMetadata.track_name || "").trim();
  const album = (selectedMetadata.album || "").trim();

  if (!artist || !trackName) {
    return {
      ok: false,
      error: "Fill in at least artist and track name before searching for lyrics."
    };
  }

  const query = new URLSearchParams({
    artist_name: artist,
    track_name: trackName
  });

  if (album) {
    query.set("album_name", album);
  }

  try {
    const response = await fetch(`https://lrclib.net/api/search?${query.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        error: "LRCLIB could not search for lyrics right now."
      };
    }

    const lyricsOptions = Array.isArray(payload)
      ? payload
          .filter((item) => item.syncedLyrics || item.plainLyrics)
          .map((item) => ({
            title: buildLyricsTitle(item),
            artist: item.artistName || "",
            album: item.albumName || "",
            duration: item.duration || 0,
            syncedLyrics: item.syncedLyrics || "",
            plainLyrics: item.plainLyrics || ""
          }))
      : [];

    return {
      ok: true,
      payload: {
        lyricsOptions
      }
    };
  } catch {
    return {
      ok: false,
      error: "The browser could not reach LRCLIB."
    };
  }
}

export async function cancelUpload(uploadId) {
  return submitUploadAction(
    "/cancel",
    {
      uploadId
    },
    "The server could not delete the uploaded file."
  );
}

async function submitUploadAction(url, body, fallbackError) {
  const result = await postJSON(url, body, fallbackError);

  if (result.ok) {
    return {
      ok: true,
      payload: result.payload
    };
  }

  return {
    ok: false,
    error: result.error
  };
}

function buildLyricsTitle(item) {
  const trackName = (item.trackName || "").trim();
  const artistName = (item.artistName || "").trim();
  return [trackName, artistName].filter(Boolean).join(" - ") || "Untitled lyrics";
}
