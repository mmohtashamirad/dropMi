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
  elements.resultScreen.insertBefore(fragment, elements.resultOutput);
}

export function showResult(payload, isError) {
  setProgress(100);
  showScreen(elements.resultScreen);
  elements.resultFileName.textContent = payload.fileName ? `File: ${payload.fileName}` : "";
  elements.resultOutput.textContent = payload.output || "No output returned.";
  clearResultError();

  if (payload.error) {
    renderConfirmError(payload.error);
  }

  if (isError && !payload.output) {
    elements.resultOutput.textContent = "No eyeD3 output was returned.";
  }
}

export function resetResultScreen() {
  elements.resultFileName.textContent = "";
  elements.resultOutput.textContent = "";
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
}
