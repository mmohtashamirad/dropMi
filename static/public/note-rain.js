const NOTE_SYMBOLS = ["♪", "♫", "♩", "♬", "♭", "♮"];
const DEFAULT_COUNT = 16;

const STYLE_ID = "note-rain-styles";
const STYLES = `
.note-rain {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.note-rain .note {
  position: absolute;
  top: 0;
  color: var(--accent);
  opacity: 0;
  will-change: transform;
  animation-name: note-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes note-fall {
  0% { transform: translateY(-10vh) rotate(var(--note-rot, 0deg)); opacity: 0; }
  12% { opacity: 0.5; }
  78% { opacity: 0.5; }
  90% { opacity: 0.1; }
  100% { transform: translateY(110vh) rotate(var(--note-rot, 0deg)); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .note-rain .note {
    animation: none;
    opacity: 0;
  }
}
`;

// Inject the note-rain CSS once. Uses the page's --accent custom property.
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

// Random symbol, horizontal position and size. Re-applied on every fall so each
// loop looks different.
function placeNote(note) {
  note.textContent = pick(NOTE_SYMBOLS);
  note.style.left = `${random(0, 100).toFixed(2)}%`;
  note.style.fontSize = `${random(1.1, 2.6).toFixed(2)}rem`;
  // A single fixed tilt for this fall; the keyframe keeps it constant.
  note.style.setProperty("--note-rot", `${random(-45, 45).toFixed(1)}deg`);
}

// Fill `container` with a bunch of music notes that slowly fall at random
// speeds. Pass the element that should hold the rain.
export function initNoteRain(container, count = DEFAULT_COUNT) {
  if (!container) {
    return;
  }
  ensureStyles();
  container.classList.add("note-rain");

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  for (let i = 0; i < count; i += 1) {
    const note = document.createElement("span");
    note.className = "note";
    placeNote(note);
    note.style.animationDuration = `${random(14, 30).toFixed(1)}s`;
    // Negative delay so the rain is already in progress and staggered on load.
    note.style.animationDelay = `-${random(0, 30).toFixed(1)}s`;
    note.addEventListener("animationiteration", () => placeNote(note));
    container.appendChild(note);
  }
}
