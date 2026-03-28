import { parseJSON, postJSON } from "/static/api.js";
import { elements } from "/static/dom.js";
import { setProgress, showScreen } from "/static/screen-ui.js";

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

export async function confirmUpload(uploadId) {
  return submitUploadAction(
    "/confirm",
    uploadId,
    "The server could not move the file into the upload directory."
  );
}

export async function cancelUpload(uploadId) {
  return submitUploadAction(
    "/cancel",
    uploadId,
    "The server could not delete the uploaded file."
  );
}

async function submitUploadAction(url, uploadId, fallbackError) {
  const result = await postJSON(url, { uploadId }, fallbackError);

  if (result.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: result.error
  };
}
