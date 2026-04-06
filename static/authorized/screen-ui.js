import { elements } from "/authorized/dom.js";

export function setDraggingState(isDragging) {
  elements.dropZone.classList.toggle("is-dragging", isDragging);
  if (isDragging) {
    elements.dropTitle.textContent = "Release to upload";
    elements.dropSubtext.textContent = "The server will accept the file and run eyeD3.";
  }
}

export function showScreen(screen) {
  [elements.dropScreen, elements.uploadScreen, elements.resultScreen].forEach((element) => {
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

export function resetUploadScreen() {
  elements.uploadFileName.textContent = "Preparing upload...";
  setProgress(0);
}
