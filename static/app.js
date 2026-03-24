const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const browseButton = document.getElementById("browse-button");
const dropTitle = document.getElementById("drop-title");
const dropSubtext = document.getElementById("drop-subtext");
const dropScreen = document.getElementById("drop-screen");
const uploadScreen = document.getElementById("upload-screen");
const resultScreen = document.getElementById("result-screen");
const uploadFileName = document.getElementById("upload-file-name");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const resultFileName = document.getElementById("result-file-name");
const resultOutput = document.getElementById("result-output");
const okButton = document.getElementById("ok-button");
const resultErrorTemplate = document.getElementById("result-error-template");
let currentUploadId = "";

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
    dropTitle.textContent = "Release to upload";
    dropSubtext.textContent = "The server will accept the file and run eyeD3.";
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    if (eventName !== "drop") {
      resetDropMessage();
    }
  });
});

dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  resetDropMessage();
  if (file) {
    uploadFile(file);
  }
});

browseButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) {
    uploadFile(file);
  }
});

okButton.addEventListener("click", async () => {
  okButton.disabled = true;
  okButton.textContent = "Moving file...";

  if (currentUploadId) {
    const confirmed = await confirmUpload(currentUploadId);
    if (!confirmed) {
      okButton.disabled = false;
      okButton.textContent = "OK";
      return;
    }
  }

  currentUploadId = "";
  showScreen(dropScreen);
  resultFileName.textContent = "";
  resultOutput.textContent = "";
  resetDropMessage();
  clearResultError();
  fileInput.value = "";
  okButton.disabled = false;
  okButton.textContent = "OK";
});

function uploadFile(file) {
  showScreen(uploadScreen);
  clearResultError();
  uploadFileName.textContent = `Uploading ${file.name}`;
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
      showResult(payload, false);
      return;
    }

    showResult(
      payload || {
        fileName: file.name,
        output: "",
        error: "The upload or analysis failed."
      },
      true
    );
  });

  xhr.addEventListener("error", () => {
    showResult(
      {
        fileName: file.name,
        output: "",
        error: "The browser could not reach the server."
      },
      true
    );
  });

  xhr.send(formData);
}

function showResult(payload, isError) {
  currentUploadId = payload.uploadId || "";
  setProgress(100);
  showScreen(resultScreen);
  resultFileName.textContent = payload.fileName ? `File: ${payload.fileName}` : "";
  resultOutput.textContent = payload.output || "No output returned.";
  clearResultError();

  if (payload.error) {
    const fragment = resultErrorTemplate.content.cloneNode(true);
    fragment.querySelector("#result-error-text").textContent = payload.error;
    resultScreen.insertBefore(fragment, resultOutput);
  }

  if (isError && !payload.output) {
    resultOutput.textContent = "No eyeD3 output was returned.";
  }
}

function showScreen(screen) {
  [dropScreen, uploadScreen, resultScreen].forEach((element) => {
    element.classList.toggle("screen-active", element === screen);
  });
}

function setProgress(value) {
  progressFill.style.width = `${value}%`;
  progressLabel.textContent = `${value}%`;
}

function resetDropMessage() {
  dropTitle.textContent = "Drop your MP3 file here";
  dropSubtext.textContent = "Drag and drop an MP3 file to begin.";
}

function clearResultError() {
  const existingError = resultScreen.querySelector(".result-error");
  if (existingError) {
    existingError.remove();
  }
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function confirmUpload(uploadId) {
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
      return true;
    }

    clearResultError();
    const fragment = resultErrorTemplate.content.cloneNode(true);
    fragment.querySelector("#result-error-text").textContent =
      payload?.error || "The server could not move the file into the upload directory.";
    resultScreen.insertBefore(fragment, resultOutput);
    return false;
  } catch (error) {
    clearResultError();
    const fragment = resultErrorTemplate.content.cloneNode(true);
    fragment.querySelector("#result-error-text").textContent =
      "The browser could not reach the server to finalize the upload.";
    resultScreen.insertBefore(fragment, resultOutput);
    return false;
  }
}
