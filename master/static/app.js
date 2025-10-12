const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

function activateTab(targetId) {
  panels.forEach((panel) => {
    const isTarget = panel.id === targetId;
    panel.classList.toggle("active", isTarget);
    panel.setAttribute("aria-hidden", isTarget ? "false" : "true");
  });
  tabs.forEach((tab) => {
    const isTarget = tab.dataset.target === targetId;
    tab.classList.toggle("active", isTarget);
    tab.setAttribute("aria-selected", isTarget ? "true" : "false");
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.target));
});

// --- Helpers -----------------------------------------------------------------

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
}

function setOutput(element, value, fallback = "") {
  if (!element) return;
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) {
    element.textContent = "";
    if (fallback) {
      element.dataset.empty = fallback;
    }
    return;
  }
  element.textContent = value;
}

function renderTable(container, data) {
  if (!container) return;
  container.innerHTML = "";
  if (!data || Object.keys(data).length === 0) {
    container.dataset.empty = "No data.";
    return;
  }
  container.removeAttribute("data-empty");
  Object.entries(data).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "table-row";
    const keySpan = document.createElement("span");
    keySpan.textContent = key;
    const valueSpan = document.createElement("span");
    valueSpan.textContent = typeof value === "number" ? value.toLocaleString() : String(value);
    row.appendChild(keySpan);
    row.appendChild(valueSpan);
    container.appendChild(row);
  });
}

function jsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (err) {
    payload = text;
  }
  if (!response.ok) {
    const detail = payload?.detail || response.statusText;
    throw new Error(Array.isArray(detail) ? detail.join(", ") : detail);
  }
  return payload;
}

// --- Single backtest ---------------------------------------------------------

const inventoryList = document.getElementById("inventory-list");
const inventoryRefreshBtn = document.getElementById("inventory-refresh");
const fetchForm = document.getElementById("fetch-form");
const fetchResult = document.getElementById("fetch-result");
const backtestForm = document.getElementById("backtest-form");
const backtestSummary = document.getElementById("backtest-summary");
const backtestTrades = document.getElementById("backtest-trades");
const backtestDaily = document.getElementById("backtest-daily");
const strategySelect = document.getElementById("single-strategy-select");
const inventoryModal = document.getElementById("inventory-modal");
const inventoryModalTitle = document.getElementById("modal-title");
const inventoryModalBody = document.getElementById("modal-body-content");
const inventoryModalClose = document.getElementById("modal-close");

async function loadSingleStrategies() {
  try {
    const strategies = await fetchJSON("/api/single/strategies");
    strategySelect.innerHTML = "";
    if (!strategies.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No strategies loaded";
      strategySelect.appendChild(option);
      return;
    }
    strategies.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.title || item.name;
      if (index === 0) option.selected = true;
      strategySelect.appendChild(option);
    });
  } catch (err) {
    setOutput(fetchResult, String(err), "Failed to load strategies.");
  }
}

function renderInventory(items) {
  inventoryList.innerHTML = "";
  if (!items.length) {
    inventoryList.textContent = "";
    return;
  }
  items.forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "list-item inventory-entry";
    entry.tabIndex = 0;
    entry.setAttribute("role", "button");
    entry.dataset.symbol = item.symbol;
    entry.dataset.exchange = item.exchange;
    entry.dataset.interval = item.interval;
    entry.dataset.startTs = item.start_ts || "";
    entry.dataset.endTs = item.end_ts || "";

    const title = document.createElement("div");
    title.className = "inventory-title";
    title.innerHTML = `<strong>${item.symbol}</strong><span>${item.exchange} · ${item.interval}</span>`;

    const range = document.createElement("div");
    range.className = "inventory-meta";
    const rows = item.rows_count?.toLocaleString?.() ?? item.rows_count;
    range.innerHTML = `
      <span>Rows: ${rows}</span>
      <span>Range: ${item.start_ts || "—"} → ${item.end_ts || "—"}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "inventory-actions";

    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "inventory-action secondary";
    useBtn.textContent = "Use in forms";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "inventory-action secondary";
    viewBtn.textContent = "View rows";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "inventory-action danger";
    deleteBtn.textContent = "Delete";

    actions.append(useBtn, viewBtn, deleteBtn);
    entry.append(title, range, actions);

    entry.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest(".inventory-action")) {
        return;
      }
      prefillFromInventory(item);
    });
    entry.addEventListener("keypress", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        prefillFromInventory(item);
      }
    });

    useBtn.addEventListener("click", () => prefillFromInventory(item));
    viewBtn.addEventListener("click", () => previewInventory(item));
    deleteBtn.addEventListener("click", () => deleteInventory(item, deleteBtn));

    inventoryList.appendChild(entry);
  });
}

async function refreshInventory() {
  setBusy(inventoryRefreshBtn, true);
  try {
    const items = await fetchJSON("/api/single/inventory");
    renderInventory(items);
  } catch (err) {
    inventoryList.textContent = `Error: ${err.message}`;
  } finally {
    setBusy(inventoryRefreshBtn, false);
  }
}

async function handleFetchSubmit(event) {
  event.preventDefault();
  const formData = new FormData(fetchForm);
  const payload = {};
  formData.forEach((value, key) => {
    if (value !== "") payload[key] = value;
  });
  try {
    const result = await fetchJSON("/api/single/fetch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setOutput(fetchResult, jsonStringify(result));
    refreshInventory();
  } catch (err) {
    setOutput(fetchResult, `Error: ${err.message}`);
  }
}

function parseJSONField(value, defaultValue) {
  if (!value || !value.trim()) return defaultValue;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error("Strategy parameters must be valid JSON.");
  }
}

async function handleBacktestSubmit(event) {
  event.preventDefault();
  const formData = new FormData(backtestForm);
  const payload = {};
  formData.forEach((value, key) => {
    if (key === "strategy_params") return;
    if (key === "write_csv") {
      payload[key] = formData.get("write_csv") === "on";
      return;
    }
    if (value !== "") payload[key] = value;
  });

  const rawParams = formData.get("strategy_params");
  try {
    payload.strategy_params = parseJSONField(rawParams, {});
  } catch (err) {
    setOutput(backtestTrades, `Error: ${err.message}`);
    return;
  }

  if (payload.last_n_trades) {
    payload.last_n_trades = Number(payload.last_n_trades);
  }
  if (payload.starting_capital) {
    payload.starting_capital = Number(payload.starting_capital);
  }
  if (payload.qty_per_point) {
    payload.qty_per_point = Number(payload.qty_per_point);
  }

  setOutput(backtestSummary, "");
  setOutput(backtestTrades, "Running backtest…");
  setOutput(backtestDaily, "");

  try {
    const result = await fetchJSON("/api/single/backtest", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderTable(backtestSummary, result.summary);
    setOutput(backtestTrades, jsonStringify(result.trades_all));
    setOutput(backtestDaily, jsonStringify(result.daily_stats));
  } catch (err) {
    setOutput(backtestTrades, `Error: ${err.message}`);
  }
}

// --- Permutation runner ------------------------------------------------------

const multiStrategySelect = document.getElementById("multi-strategy-select");
const multiConfigForm = document.getElementById("multi-config-form");
const multiStartBtn = document.getElementById("multi-start");
const multiPauseBtn = document.getElementById("multi-pause");
const multiResetBtn = document.getElementById("multi-reset");
const multiClearBtn = document.getElementById("multi-clear");
const multiRefreshBtn = document.getElementById("multi-refresh");
const multiStatus = document.getElementById("multi-status");
const multiHistoryBtn = document.getElementById("multi-history-refresh");
const historyTable = document.getElementById("history-table");

async function loadMultiStrategies() {
  try {
    const data = await fetchJSON("/api/multi/strategies");
    const items = data.strategies || [];
    multiStrategySelect.innerHTML = "";
    if (!items.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No strategies found";
      multiStrategySelect.appendChild(option);
      return;
    }
    items.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.title || item.name;
      if (index === 0) option.selected = true;
      multiStrategySelect.appendChild(option);
    });
  } catch (err) {
    setOutput(multiStatus, `Error: ${err.message}`);
  }
}

function parseParamRanges(raw) {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Parameter ranges must be an object.");
    }
    return parsed;
  } catch (err) {
    throw new Error("Parameter ranges must be valid JSON object.");
  }
}

async function applyMultiConfig(event) {
  event.preventDefault();
  const formData = new FormData(multiConfigForm);
  const payload = {
    strategy: formData.get("strategy"),
    symbols: (formData.get("symbols") || "")
      .split(",")
      .map((sym) => sym.trim())
      .filter(Boolean),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    starting_capital: Number(formData.get("starting_capital")),
    qty_per_point: Number(formData.get("qty_per_point")),
    max_workers: Number(formData.get("max_workers")),
  };

  try {
    payload.param_ranges = parseParamRanges(formData.get("param_ranges") || "{}");
  } catch (err) {
    setOutput(multiStatus, `Error: ${err.message}`);
    return;
  }

  if (!payload.symbols.length) {
    setOutput(multiStatus, "Error: Provide at least one symbol.");
    return;
  }

  try {
    const result = await fetchJSON("/api/multi/configure", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setOutput(multiStatus, jsonStringify(result.status));
  } catch (err) {
    setOutput(multiStatus, `Error: ${err.message}`);
  }
}

async function updateMultiStatus() {
  try {
    const status = await fetchJSON("/api/multi/status");
    setOutput(multiStatus, jsonStringify(status));
  } catch (err) {
    setOutput(multiStatus, `Error: ${err.message}`);
  }
}

async function controlRunner(endpoint, button) {
  setBusy(button, true);
  try {
    const result = await fetchJSON(`/api/multi/${endpoint}`, { method: "POST" });
    setOutput(multiStatus, jsonStringify(result.status));
  } catch (err) {
    setOutput(multiStatus, `Error: ${err.message}`);
  } finally {
    setBusy(button, false);
  }
}

function renderHistory(rows) {
  const tbody = historyTable.querySelector("tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.className = "empty";
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "No history yet.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const created = new Date(row.created_at).toLocaleString();
    const params = jsonStringify(row.params);
    const summary = jsonStringify(row.summary);
    tr.innerHTML = `
      <td>${created}</td>
      <td>${row.strategy}</td>
      <td>${row.symbol}</td>
      <td><pre>${params}</pre></td>
      <td><pre>${summary}</pre></td>
    `;
    tbody.appendChild(tr);
  });
}

async function refreshHistory() {
  try {
    const rows = await fetchJSON("/api/multi/history");
    renderHistory(rows);
  } catch (err) {
    setOutput(multiStatus, `Error loading history: ${err.message}`);
  }
}

// --- Inventory helpers -------------------------------------------------------

function prefillFromInventory(item) {
  const symbol = item.symbol;
  const exchange = item.exchange;
  const interval = item.interval;
  const startDate = item.start_ts ? item.start_ts.slice(0, 10) : "";
  const endDate = item.end_ts ? item.end_ts.slice(0, 10) : "";

  if (fetchForm) {
    const fields = ["symbol", "exchange", "interval", "start_date", "end_date"];
    fields.forEach((name) => {
      const input = fetchForm.elements.namedItem(name);
      if (!(input instanceof HTMLInputElement)) return;
      if (name === "symbol") input.value = symbol;
      if (name === "exchange") input.value = exchange;
      if (name === "interval") input.value = interval;
      if (name === "start_date" && startDate) input.value = startDate;
      if (name === "end_date" && endDate) input.value = endDate;
    });
  }

  if (backtestForm) {
    const map = {
      symbol,
      exchange,
      interval,
      start_date: startDate,
      end_date: endDate,
    };
    Object.entries(map).forEach(([field, value]) => {
      const input = backtestForm.elements.namedItem(field);
      if (input instanceof HTMLInputElement && value) {
        input.value = value;
      }
    });
  }
}

async function previewInventory(item) {
  if (!inventoryModal || !inventoryModalBody || !inventoryModalTitle) {
    return;
  }
  try {
    const path = `/api/single/data/${encodeURIComponent(item.symbol)}/${encodeURIComponent(item.exchange)}/${encodeURIComponent(item.interval)}`;
    const rows = await fetchJSON(path);
    const limited = Array.isArray(rows) ? rows.slice(0, 250) : rows;
    inventoryModalTitle.textContent = `${item.symbol} · ${item.exchange} · ${item.interval}`;
    renderModalTable(Array.isArray(limited) ? limited : []);
    inventoryModal.classList.remove("hidden");
  } catch (err) {
    inventoryModalTitle.textContent = "Error loading series";
    inventoryModalBody.innerHTML = `<pre class="output"> ${String(err.message || err)} </pre>`;
    inventoryModal.classList.remove("hidden");
  }
}

async function deleteInventory(item, button) {
  if (!confirm(`Delete ${item.symbol} ${item.exchange} ${item.interval} from TimescaleDB?`)) {
    return;
  }
  setBusy(button, true);
  try {
    await fetchJSON(
      `/api/single/inventory/${encodeURIComponent(item.symbol)}/${encodeURIComponent(item.exchange)}/${encodeURIComponent(item.interval)}`,
      { method: "DELETE" },
    );
    await refreshInventory();
  } catch (err) {
    alert(`Failed to delete series: ${err.message}`);
    setBusy(button, false);
  }
}

function closeInventoryModal() {
  if (inventoryModal) {
    inventoryModal.classList.add("hidden");
    if (inventoryModalBody) {
      inventoryModalBody.innerHTML = "";
    }
  }
}

function renderModalTable(rows) {
  if (!inventoryModalBody) return;
  inventoryModalBody.innerHTML = "";
  if (!rows.length) {
    inventoryModalBody.dataset.empty = "No rows available for this slice.";
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const columns = Object.keys(rows[0]);
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const td = document.createElement("td");
      const value = row[col];
      td.textContent = value === null || value === undefined ? "—" : value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  inventoryModalBody.removeAttribute("data-empty");
  inventoryModalBody.appendChild(table);
}

if (inventoryModalClose) {
  inventoryModalClose.addEventListener("click", closeInventoryModal);
}

if (inventoryModal) {
  inventoryModal.addEventListener("click", (event) => {
    if (event.target === inventoryModal) {
      closeInventoryModal();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && inventoryModal && !inventoryModal.classList.contains("hidden")) {
    closeInventoryModal();
  }
});

// --- Event wiring ------------------------------------------------------------

if (inventoryRefreshBtn) inventoryRefreshBtn.addEventListener("click", refreshInventory);
if (fetchForm) fetchForm.addEventListener("submit", handleFetchSubmit);
if (backtestForm) backtestForm.addEventListener("submit", handleBacktestSubmit);
if (multiConfigForm) multiConfigForm.addEventListener("submit", applyMultiConfig);
if (multiStartBtn) multiStartBtn.addEventListener("click", () => controlRunner("start", multiStartBtn));
if (multiPauseBtn) multiPauseBtn.addEventListener("click", () => controlRunner("pause", multiPauseBtn));
if (multiResetBtn) multiResetBtn.addEventListener("click", () => controlRunner("reset", multiResetBtn));
if (multiClearBtn) multiClearBtn.addEventListener("click", () => controlRunner("clear-results", multiClearBtn));
if (multiRefreshBtn) multiRefreshBtn.addEventListener("click", updateMultiStatus);
if (multiHistoryBtn) multiHistoryBtn.addEventListener("click", refreshHistory);

// --- Initial load ------------------------------------------------------------

loadSingleStrategies()
  .then(() => refreshInventory())
  .catch((err) => setOutput(fetchResult, `Error: ${err.message}`));

loadMultiStrategies()
  .then(() => Promise.all([updateMultiStatus(), refreshHistory()]))
  .catch((err) => setOutput(multiStatus, `Error: ${err.message}`));
