import { elements } from "/static/dom.js";
import { setProgress, showScreen } from "/static/ui.js";

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

  xhr.send(formData);
}

export async function confirmUpload(uploadId) {
  try {
    const response = await fetch("/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ uploadId })
    });

    const payload = await response.json().catch(() => null);
    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      error: payload?.error || "The server could not move the file into the upload directory."
    };
  } catch (error) {
    return {
      ok: false,
      error: "The browser could not reach the server to finalize the upload."
    };
  }
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}
