import { elements } from "/static/dom.js";
import { resetResultScreen } from "/static/result-ui.js";
import { resetDropMessage, resetUploadScreen } from "/static/screen-ui.js";

export function showLoginError(message) {
  elements.loginError.hidden = false;
  elements.loginError.textContent = message;
}

export function clearLoginError() {
  elements.loginError.hidden = true;
  elements.loginError.textContent = "";
}

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
