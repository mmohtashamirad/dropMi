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
  return submitUploadAction(
    "/lyrics/search",
    {
      selectedMetadata
    },
    "The server could not search for lyrics."
  );
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
