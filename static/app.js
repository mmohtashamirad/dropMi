import { elements } from "/static/dom.js";
import { confirmUpload, uploadFile } from "/static/upload.js";
import {
  renderConfirmError,
  resetDropMessage,
  resetResultScreen,
  setDraggingState,
  showResult,
  showScreen
} from "/static/ui.js";

let currentUploadId = "";
let dragDepth = 0;

elements.dropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  setDraggingState(true);
});

elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  setDraggingState(true);
});

elements.dropZone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    setDraggingState(false);
    resetDropMessage();
  }
});

elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDraggingState(false);
  const [file] = event.dataTransfer.files;
  resetDropMessage();
  if (file) {
    startUpload(file);
  }
});

elements.browseButton.addEventListener("click", () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) {
    startUpload(file);
  }
});

elements.okButton.addEventListener("click", async () => {
  elements.okButton.disabled = true;
  elements.okButton.textContent = "Moving file...";

  if (currentUploadId) {
    const confirmation = await confirmUpload(currentUploadId);
    if (!confirmation.ok) {
      renderConfirmError(confirmation.error);
      elements.okButton.disabled = false;
      elements.okButton.textContent = "OK";
      return;
    }
  }

  currentUploadId = "";
  resetResultScreen();
  showScreen(elements.dropScreen);
  elements.okButton.disabled = false;
  elements.okButton.textContent = "OK";
});

function startUpload(file) {
  uploadFile(file, {
    onSuccess(payload) {
      currentUploadId = payload.uploadId || "";
      showResult(payload, false);
    },
    onError(payload) {
      currentUploadId = payload.uploadId || "";
      showResult(payload, true);
    }
  });
}
