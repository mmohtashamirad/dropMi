const PAGE_SIZE_OPTIONS = [5, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;
const FILTER_DEBOUNCE_MS = 1500;

export function initTab() {
  const pageSizeSelect = document.getElementById("events-page-size");
  const initialPageSize = parsePageSize(pageSizeSelect?.value, DEFAULT_PAGE_SIZE);

  const state = {
    offset: 0,
    total: 0,
    pageSize: initialPageSize,
    filter: "",
    loading: false,
  };

  const prevButton = document.getElementById("events-prev");
  const nextButton = document.getElementById("events-next");
  const pageInput = document.getElementById("events-page-input");
  const filterInput = document.getElementById("events-filter-input");

  prevButton.addEventListener("click", () => {
    if (state.loading) return;
    state.offset = Math.max(0, state.offset - state.pageSize);
    loadEventsPage(state);
  });

  nextButton.addEventListener("click", () => {
    if (state.loading) return;
    if (state.offset + state.pageSize >= state.total) return;
    state.offset += state.pageSize;
    loadEventsPage(state);
  });

  const jumpToInputPage = () => {
    if (state.loading) return;
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const currentPage = Math.floor(state.offset / state.pageSize) + 1;
    const requested = Number.parseInt(pageInput.value, 10);
    if (!Number.isFinite(requested)) {
      pageInput.value = String(currentPage);
      return;
    }
    const clamped = Math.min(totalPages, Math.max(1, requested));
    pageInput.value = String(clamped);
    const newOffset = (clamped - 1) * state.pageSize;
    if (newOffset === state.offset) return;
    state.offset = newOffset;
    loadEventsPage(state);
  };

  pageInput.addEventListener("change", jumpToInputPage);
  pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToInputPage();
    }
  });

  pageSizeSelect.addEventListener("change", () => {
    if (state.loading) return;
    const newSize = parsePageSize(pageSizeSelect.value, state.pageSize);
    if (newSize === state.pageSize) return;
    state.offset = Math.floor(state.offset / newSize) * newSize;
    state.pageSize = newSize;
    loadEventsPage(state);
  });

  let filterDebounceTimer = null;
  const cancelFilterDebounce = () => {
    if (filterDebounceTimer !== null) {
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = null;
    }
  };
  const applyFilter = () => {
    cancelFilterDebounce();
    const value = filterInput.value.trim();
    if (value === state.filter) return;
    state.filter = value;
    state.offset = 0;
    loadEventsPage(state);
  };
  filterInput.addEventListener("input", () => {
    cancelFilterDebounce();
    filterDebounceTimer = setTimeout(applyFilter, FILTER_DEBOUNCE_MS);
  });
  filterInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyFilter();
    }
  });

  loadEventsPage(state);
  return {
    beforeLeave() {
      cancelFilterDebounce();
    },
  };
}

function parsePageSize(raw, fallback) {
  const value = Number.parseInt(raw, 10);
  if (PAGE_SIZE_OPTIONS.includes(value)) {
    return value;
  }
  return fallback;
}

async function loadEventsPage(state) {
  const count = document.getElementById("events-count");
  const stateBox = document.getElementById("events-state");
  const tableWrap = document.getElementById("events-table-wrap");
  const tableBody = document.getElementById("events-table-body");
  const pagination = document.getElementById("events-pagination");
  const pageInput = document.getElementById("events-page-input");
  const pageTotal = document.getElementById("events-page-total");
  const pageSizeSelect = document.getElementById("events-page-size");
  const prevButton = document.getElementById("events-prev");
  const nextButton = document.getElementById("events-next");

  state.loading = true;
  prevButton.disabled = true;
  nextButton.disabled = true;
  pageSizeSelect.disabled = true;

  try {
    const params = new URLSearchParams({
      offset: String(state.offset),
      limit: String(state.pageSize),
    });
    if (state.filter) {
      params.set("q", state.filter);
    }
    const response = await fetch(`/events?${params.toString()}`);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || "Unable to load events.");
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    const total = Number.isFinite(payload?.total) ? payload.total : events.length;
    state.total = total;

    if (state.offset >= total && total > 0) {
      const lastPageIndex = Math.max(0, Math.ceil(total / state.pageSize) - 1);
      state.offset = lastPageIndex * state.pageSize;
      await loadEventsPage(state);
      return;
    }

    count.textContent = `${total} ${total === 1 ? "event" : "events"}`;

    if (total === 0) {
      tableWrap.hidden = true;
      pagination.hidden = true;
      stateBox.hidden = false;
      stateBox.textContent = state.filter
        ? "No events match the current filter."
        : "No events have been recorded yet.";
      return;
    }

    stateBox.hidden = true;
    tableWrap.hidden = false;
    tableBody.replaceChildren(...events.map(createEventRow));

    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const currentPage = Math.floor(state.offset / state.pageSize) + 1;
    pageInput.value = String(currentPage);
    pageInput.max = String(totalPages);
    pageTotal.textContent = String(totalPages);
    pagination.hidden = false;
    prevButton.disabled = state.offset === 0;
    nextButton.disabled = state.offset + state.pageSize >= total;
  } catch (error) {
    count.textContent = "Unavailable";
    tableWrap.hidden = true;
    pagination.hidden = true;
    stateBox.hidden = false;
    stateBox.textContent = error.message || "Unable to load events.";
  } finally {
    state.loading = false;
    pageSizeSelect.disabled = false;
  }
}

function createEventRow(event) {
  const when = localDateTimeParts(event.timestamp);
  const row = document.createElement("tr");
  row.className = "event-row";
  row.title = "Click to expand";
  row.addEventListener("click", () => {
    row.classList.toggle("event-row-expanded");
  });
  row.appendChild(createTextCell(event.id, "library-duration"));
  row.appendChild(createTextCell(when.date));
  row.appendChild(createTextCell(when.time));
  row.appendChild(createTextCell(event.type));
  row.appendChild(createTextCell(event.username));
  row.appendChild(createInfoCell(event.info));
  return row;
}

function createInfoCell(info) {
  const cell = document.createElement("td");
  const value = document.createElement("div");
  value.className = "event-info";
  value.textContent = info || "-";
  cell.appendChild(value);
  return cell;
}

function createTextCell(value, className = "") {
  const cell = document.createElement("td");
  const text = value === 0 ? "0" : value;
  cell.textContent = text || "-";
  if (className) {
    cell.className = className;
  }
  return cell;
}

function localDateTimeParts(timestamp) {
  if (!timestamp) {
    return { date: "-", time: "-" };
  }
  // Stored value is UTC (RFC3339); render it in the viewer's local time zone.
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return { date: timestamp, time: "" };
  }
  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
}
