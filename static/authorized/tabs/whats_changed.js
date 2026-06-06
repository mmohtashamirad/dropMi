export function initTab() {
  loadChangelog();
  return {};
}

async function loadChangelog() {
  const count = document.getElementById("changelog-count");
  const stateBox = document.getElementById("changelog-state");
  const tableWrap = document.getElementById("changelog-table-wrap");
  const tableBody = document.getElementById("changelog-table-body");

  try {
    const response = await fetch("/authorized/changelog.txt", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Change history is not available yet.");
    }

    const entries = parseChangelog(await response.text());
    count.textContent = `${entries.length} ${entries.length === 1 ? "change" : "changes"}`;

    if (entries.length === 0) {
      tableWrap.hidden = true;
      stateBox.hidden = false;
      stateBox.textContent = "No change history has been recorded yet.";
      return;
    }

    stateBox.hidden = true;
    tableWrap.hidden = false;
    tableBody.replaceChildren(...entries.map(createRow));
  } catch (error) {
    count.textContent = "Unavailable";
    tableWrap.hidden = true;
    stateBox.hidden = false;
    stateBox.textContent = error.message || "Unable to load the change history.";
  }
}

// Each line is "YYYY-MM-DD HH:MM:SS , author , commit message". The message may
// itself contain " , ", so everything past the second separator is the message.
function parseChangelog(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(" , ");
      return {
        date: parts[0] || "",
        author: parts[1] || "",
        message: parts.slice(2).join(" , ")
      };
    });
}

function createRow(entry) {
  const row = document.createElement("tr");
  row.appendChild(createCell(entry.date, "library-duration"));
  row.appendChild(createCell(entry.author));
  row.appendChild(createCell(entry.message));
  return row;
}

function createCell(value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value || "-";
  if (className) {
    cell.className = className;
  }
  return cell;
}
