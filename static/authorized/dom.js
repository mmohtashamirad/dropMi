const elementIds = {
  audioPlayer: "audio-player",
  browseButton: "browse-button",
  cancelResultButton: "cancel-result-button",
  cancelUploadButton: "cancel-upload-button",
  dropScreen: "drop-screen",
  dropSubtext: "drop-subtext",
  dropTitle: "drop-title",
  dropZone: "drop-zone",
  duplicateNotice: "duplicate-notice",
  fileInput: "file-input",
  findLyricsButton: "find-lyrics-button",
  reshazamButton: "reshazam-button",
  lyricsSearchInput: "lyrics-search-input",
  lyricsOptions: "lyrics-options",
  lyricsSection: "lyrics-section",
  syncedLyricLine: "synced-lyric-line",
  logoutButton: "logout-button",
  okButton: "ok-button",
  panel: "tab-panel",
  progressFill: "progress-fill",
  progressLabel: "progress-label",
  resultErrorTemplate: "result-error-template",
  resultFileName: "result-file-name",
  resultScreen: "result-screen",
  resultTableBody: "result-table-body",
  sessionBar: "session-bar",
  sessionUser: "session-user",
  tabList: "user-tabs",
  themeToggleButton: "theme-toggle-button",
  uploadFileName: "upload-file-name",
  uploadQueueStatus: "upload-queue-status",
  resultQueueStatus: "result-queue-status",
  uploadScreen: "upload-screen"
};

export const elements = {};

export function refreshElements() {
  Object.entries(elementIds).forEach(([key, id]) => {
    elements[key] = document.getElementById(id);
  });
  return elements;
}

refreshElements();
