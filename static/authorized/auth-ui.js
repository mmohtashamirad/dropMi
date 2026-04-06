import { elements } from "/authorized/dom.js";
import { resetResultScreen } from "/authorized/result-ui.js";
import { resetDropMessage, resetUploadScreen } from "/authorized/screen-ui.js";

export function showSessionBar(username) {
  elements.sessionUser.textContent = username;
  elements.sessionBar.hidden = false;
}

export function hideSessionBar() {
  elements.sessionUser.textContent = "";
  elements.sessionBar.hidden = true;
}

export function resetAuthenticatedUI() {
  resetResultScreen();
  resetUploadScreen();
  resetDropMessage();
  elements.fileInput.value = "";
  hideSessionBar();
}
