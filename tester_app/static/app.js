const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");
const clearBtn = document.getElementById("clear-btn");
const exportAllBtn = document.getElementById("export-all-btn");
const statusMessage = document.getElementById("status-message");
const statusStats = document.getElementById("status-stats");
const lastResultEl = document.getElementById("last-result");
const dbStatsEl = document.getElementById("db-stats");
const historyStatus = document.getElementById("history-status");
const historyTableBody = document.querySelector("#history-table tbody");
const historyExportAllBtn = document.getElementById("history-export-all-btn");
const historyFilterInput = document.getElementById("history-filter");
const historyFilterBtn = document.getElementById("history-filter-btn");
const historyFilterClearBtn = document.getElementById("history-filter-clear-btn");
const toggleConfigBtn = document.getElementById("toggle-config-btn");
const configForm = document.getElementById("config-form");
const applyConfigBtn = document.getElementById("apply-config-btn");
const resetConfigBtn = document.getElementById("reset-config-btn");
const configInfo = document.getElementById("config-info");
const strategySelect = document.getElementById("strategy-select");
const strategyDescription = document.getElementById("strategy-description");
const testNameInput = document.getElementById("test-name");
const symbolsInput = document.getElementById("symbols");
const paramFieldsContainer = document.getElementById("param-fields");
const paramJsonPreview = document.getElementById("param-json-preview");
const paramCopyBtn = document.getElementById("param-copy-btn");
const paramResetBtn = document.getElementById("param-reset-btn");

let statusTimer = null;
let historyCache = [];
let currentSort = { column: null, direction: null };
let availableStrategies = [];
let currentStrategy = null;
let historyFilterText = "";
let historyFiltered = [];

async function postControl(endpoint) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request to ${endpoint} failed`);
  }
  return response.json();
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (typeof value === "number") {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(digits, 2),
    });
  }
  return String(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function renderStatus(status) {
  if (!status) return;

  let message = "Idle";
  let statusClass = "status-idle";
  if (status.running) {
    message = `Running • ${formatNumber(status.progress_percent)}% complete`;
    statusClass = "status-positive";
  } else if (status.paused) {
    message = "Paused";
    statusClass = "status-paused";
  } else if (status.completed_jobs && status.completed_jobs >= status.total_jobs) {
    message = "Completed all permutations.";
    statusClass = "status-positive";
  }

  statusMessage.textContent = message;
  statusMessage.className = statusClass;

  const fields = [];
  if (status.test_name) {
    fields.push(["Batch", status.test_name]);
  }
  fields.push(
    ["Completed", `${status.completed_jobs}/${status.total_jobs}`],
    ["Remaining", formatNumber(status.remaining_jobs, 0)],
    ["Progress %", formatNumber(status.progress_percent)]
  );

  if (status.max_workers) {
    fields.push(["Workers", formatNumber(status.max_workers, 0)]);
  }

  const activeJobs = Array.isArray(status.current_jobs)
    ? status.current_jobs
    : status.current_job
    ? [status.current_job]
    : [];

  if (activeJobs.length) {
    fields.push(["Active Jobs", formatNumber(activeJobs.length, 0)]);
    const job = activeJobs[0];
    fields.push(["Symbol", job.symbol]);
    fields.push(["Target", job.target_points]);
    fields.push(["Stoploss", job.stoploss_points]);
    fields.push(["EMA Fast / Slow", `${job.ema_fast} / ${job.ema_slow}`]);
    fields.push(["ATR Min", job.atr_min_points]);
    fields.push(["Daily Loss Cap", job.daily_loss_cap]);
    if (activeJobs.length > 1) {
      fields.push(["Additional Jobs", `${activeJobs.length - 1} more running`]);
    }
  } else {
    fields.push(["Active Jobs", "0"]);
  }

  statusStats.innerHTML = fields
    .map(
      ([label, value]) => `
        <div class="stat-card">
          <div class="label">${label}</div>
          <div class="value">${value}</div>
        </div>
      `
    )
    .join("");

  if (status.last_result && lastResultEl) {
    const { summary, params } = status.last_result;
    const batchName = status.last_result.test_name || status.test_name || "—";
    const rows = [
      ["Batch", batchName],
      ["Symbol", status.last_result.symbol],
      ["Target", params.target_points],
      ["Stoploss", params.stoploss_points],
      ["EMA Fast", params.ema_fast],
      ["EMA Slow", params.ema_slow],
      ["ATR Min", params.atr_min_points],
      ["Daily Loss Cap", params.daily_loss_cap],
      ["Trades", summary.trades],
      ["Wins", summary.wins],
      ["Losses", summary.losses],
      ["Winrate %", formatNumber(summary.winrate_percent)],
      ["Net ₹", formatNumber(summary.net_rupees)],
      ["Gross ₹", formatNumber(summary.gross_rupees)],
      ["Costs ₹", formatNumber(summary.costs_rupees)],
      ["ROI %", formatNumber(summary.roi_percent)],
      ["Risk:Reward", formatNumber(summary.risk_reward)],
      ["Finished", summary.last_run_at ? new Date(summary.last_run_at).toLocaleString() : "—"],
    ];

    lastResultEl.innerHTML = rows
      .map(
        ([key, value]) => `
          <div class="stat-card">
            <div class="label">${key}</div>
            <div class="value">${value}</div>
          </div>
        `
      )
      .join("");
  }

  if (status.database && dbStatsEl) {
    const dbRows = [
      ["Tester Rows", formatNumber(status.database.results_rows, 0)],
      ["Tester Payload Bytes", formatNumber(status.database.results_payload_bytes, 0)],
      ["Tester Table Size", formatNumber(status.database.results_table_bytes, 0)],
      ["Database Size", status.database.database_pretty],
    ];
    dbStatsEl.innerHTML = dbRows
      .map(
        ([key, value]) => `
          <div class="stat-card">
            <div class="label">${key}</div>
            <div class="value">${value}</div>
          </div>
        `
      )
      .join("");
  }

  if (status.last_error) {
    const errorNode = document.createElement("div");
    errorNode.className = "error-text";
    errorNode.textContent = `Last error: ${status.last_error}`;
    statusStats.appendChild(errorNode);
  }
}

function getSortValue(item, column) {
  const params = item.params || {};
  const summary = item.summary || {};

  switch(column) {
    case 'created_at':
      return new Date(item.created_at).getTime();
    case 'strategy':
      return item.strategy || '';
    case 'symbol':
      return item.symbol;
    case 'test_name':
      return item.test_name || '';
    case 'target':
      return params.target_points ?? params.target ?? 0;
    case 'ema':
      return (params.ema_fast ?? 0) + (params.ema_slow ?? 0);
    case 'atr':
      return params.atr_min_points ?? params.atr_min ?? 0;
    case 'dlc':
      return params.daily_loss_cap ?? params.dailyLossCap ?? 0;
    case 'trades':
      return summary.trades ?? summary.total_trades ?? 0;
    case 'winrate':
      return summary.winrate_percent ?? 0;
    case 'net':
      return summary.net_rupees ?? 0;
    default:
      return 0;
  }
}

function sortHistory(column) {
  if (currentSort.column === column) {
    // Toggle direction
    if (currentSort.direction === 'asc') {
      currentSort.direction = 'desc';
    } else if (currentSort.direction === 'desc') {
      // Reset to no sort
      currentSort.column = null;
      currentSort.direction = null;
    } else {
      currentSort.direction = 'asc';
    }
  } else {
    // New column, start with ascending
    currentSort.column = column;
    currentSort.direction = 'asc';
  }

  if (currentSort.column) {
    historyCache.sort((a, b) => {
      const aVal = getSortValue(a, currentSort.column);
      const bVal = getSortValue(b, currentSort.column);

      if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  renderHistoryRows();
  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('.history-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (currentSort.column === th.dataset.sort && currentSort.direction) {
      th.classList.add(`sort-${currentSort.direction}`);
    }
  });
}

function renderHistory(items) {
  if (!historyStatus || !historyTableBody) return;
  historyCache = Array.isArray(items) ? items : [];
  renderHistoryRows();
}

function renderHistoryRows() {
  if (!historyStatus || !historyTableBody) return;
  const totalRuns = historyCache.length;
  const filter = historyFilterText.trim().toLowerCase();
  const filteredItems = filter
    ? historyCache.filter((item) => (item.test_name || "").toLowerCase().includes(filter))
    : historyCache;

  historyFiltered = filteredItems;

  if (!filteredItems.length) {
    historyStatus.textContent = filter
      ? `No runs match “${historyFilterText}”.`
      : "No tester runs stored yet.";
    historyTableBody.innerHTML = "";
    return;
  }

  historyStatus.textContent = filter
    ? `${filteredItems.length} runs match “${historyFilterText}” out of ${totalRuns}.`
    : `${totalRuns} runs stored.`;

  if (historyExportAllBtn) {
    historyExportAllBtn.disabled = filteredItems.length === 0;
  }
  if (exportAllBtn) {
    exportAllBtn.disabled = filteredItems.length === 0;
  }

  const rowsHtml = filteredItems
    .map((item) => {
      const params = item.params || {};
      const summary = item.summary || {};
      const target = params.target_points ?? params.target ?? null;
      const stop = params.stoploss_points ?? params.stoploss ?? null;
      const emaFast = params.ema_fast ?? params.emaFast ?? "—";
      const emaSlow = params.ema_slow ?? params.emaSlow ?? "—";
      const atrMin = params.atr_min_points ?? params.atr_min ?? null;
      const dlc = params.daily_loss_cap ?? params.dailyLossCap ?? null;
      const trades = summary.trades ?? summary.total_trades ?? null;
      const winrate = summary.winrate_percent ?? null;
      const net = summary.net_rupees ?? null;

      return `
        <tr data-id="${item.id}">
          <td>${formatDateTime(item.created_at)}</td>
          <td>${item.strategy || 'Unknown'}</td>
          <td>${item.symbol}</td>
          <td>${item.test_name ? item.test_name : '—'}</td>
          <td>${formatNumber(target)} / ${formatNumber(stop)}</td>
          <td>${formatNumber(emaFast, 0)} / ${formatNumber(emaSlow, 0)}</td>
          <td>${formatNumber(atrMin)}</td>
          <td>${formatNumber(dlc)}</td>
          <td>${formatNumber(trades, 0)}</td>
          <td>${formatNumber(winrate)}</td>
          <td>${formatNumber(net)}</td>
          <td><button class="action-btn history-export" data-id="${item.id}">Export CSV</button></td>
        </tr>
      `;
    })
    .join("");

  historyTableBody.innerHTML = rowsHtml;
  historyTableBody.querySelectorAll(".history-export").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (id) {
        downloadHistoryCsv({ ids: [id], fallbackName: `tester_result_${id}.csv`, button });
      }
    });
  });
}

async function loadHistory() {
  if (!historyStatus || !historyTableBody) return;
  historyStatus.textContent = "Loading…";
  try {
    const response = await fetch("/history");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to load history");
    }
    const items = await response.json();
    renderHistory(items);
  } catch (error) {
    historyStatus.textContent = `Failed to load history: ${error.message}`;
    historyTableBody.innerHTML = "";
    historyCache = [];
    [historyExportAllBtn, exportAllBtn].forEach((btn) => {
      if (btn) btn.disabled = true;
    });
  }
}

async function refreshStatus() {
  try {
    const response = await fetch("/status");
    if (!response.ok) throw new Error("Failed to fetch status");
    const status = await response.json();
    renderStatus(status);
  } catch (error) {
    statusMessage.textContent = `Failed to load status: ${error.message}`;
    statusMessage.className = "status-idle";
  }
}

function parseFilenameFromDisposition(disposition) {
  if (!disposition) return null;
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (match && match[1]) {
    return decodeURIComponent(match[1].replace(/"/g, ""));
  }
  const simple = disposition.match(/filename="?([^";]+)"?/i);
  return simple ? simple[1] : null;
}

async function downloadCsvFromEndpoint(url, fallbackName, button) {
  const originalText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing…";
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Export failed.");
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      throw new Error("Received empty file.");
    }

    const disposition = response.headers.get("Content-Disposition");
    const filename = parseFilenameFromDisposition(disposition) || fallbackName;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

    statusMessage.textContent = `Downloaded ${filename}`;
    statusMessage.className = "status-positive";
  } catch (error) {
    statusMessage.textContent = `Export error: ${error.message}`;
    statusMessage.className = "status-idle";
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function downloadHistoryCsv({ ids = null, fallbackName, button }) {
  const params = new URLSearchParams();
  if (Array.isArray(ids) && ids.length) {
    params.set("ids", ids.join(","));
  }
  const url = `/history/export-file${params.toString() ? `?${params.toString()}` : ""}`;
  return downloadCsvFromEndpoint(url, fallbackName, button);
}

function scheduleStatus() {
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(refreshStatus, 4000);
}

async function loadStrategies() {
  try {
    const response = await fetch("/strategies");
    if (!response.ok) throw new Error("Failed to load strategies");

    const data = await response.json();
    availableStrategies = data.strategies || [];

    if (availableStrategies.length === 0) {
      if (strategySelect) {
        strategySelect.innerHTML = '<option value="">No strategies available</option>';
      }
      renderParamFields();
      return;
    }

    // Populate dropdown
    if (strategySelect) {
      strategySelect.innerHTML = availableStrategies
        .map((s) => `<option value="${s.name}">${s.title}</option>`)
        .join("");
      currentStrategy = availableStrategies[0];
      strategySelect.value = currentStrategy.name;
      updateStrategyDescription();
    }

    renderParamFields();
  } catch (error) {
    console.error("Failed to load strategies:", error);
    if (strategySelect) {
      strategySelect.innerHTML = '<option value="">Error loading strategies</option>';
    }
    renderParamFields();
  }
}

function updateStrategyDescription() {
  if (!currentStrategy) return;

  strategyDescription.innerHTML = `
    <strong>${currentStrategy.title}</strong><br/>
    ${currentStrategy.description || 'No description available.'}
  `;
}

function onStrategyChange() {
  const selectedName = strategySelect.value;
  currentStrategy = availableStrategies.find(s => s.name === selectedName);

  if (currentStrategy) {
    updateStrategyDescription();
    renderParamFields();
  }
}

function parseSymbolsInput(raw) {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function coerceParamValue(value, type) {
  if (type === "integer") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) throw new Error(`Invalid integer value: ${value}`);
    return parsed;
  }
  if (type === "number") {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) throw new Error(`Invalid number value: ${value}`);
    return parsed;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const normalized = String(value).toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    throw new Error(`Invalid boolean value: ${value}`);
  }
  return String(value);
}

function expandRangeToken(token, type) {
  const trimmed = token.trim();
  if (!trimmed) return [];

  const rangeMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)(?::(-?\d+(?:\.\d+)?))?$/);
  if (!rangeMatch || (type !== "integer" && type !== "number")) {
    return [coerceParamValue(trimmed, type)];
  }

  const start = Number.parseFloat(rangeMatch[1]);
  const end = Number.parseFloat(rangeMatch[2]);
  let step = rangeMatch[3] !== undefined ? Number.parseFloat(rangeMatch[3]) : undefined;

  if (step === undefined || Number.isNaN(step) || step === 0) {
    step = start <= end ? 1 : -1;
  }

  const values = [];
  const epsilon = 1e-9;
  if (step > 0) {
    for (let current = start; current <= end + epsilon; current += step) {
      values.push(type === "integer" ? Math.round(current) : Number.parseFloat(current.toFixed(6)));
    }
  } else {
    for (let current = start; current >= end - epsilon; current += step) {
      values.push(type === "integer" ? Math.round(current) : Number.parseFloat(current.toFixed(6)));
    }
  }

  return values;
}

function parseRangeValues(raw, type) {
  if (!raw) return [];
  const segments = raw.split(/[,\n]+/).map((segment) => segment.trim()).filter(Boolean);
  let values = [];
  segments.forEach((segment) => {
    values = values.concat(expandRangeToken(segment, type));
  });
  return Array.from(new Set(values.map((val) => (typeof val === "number" ? Number(val) : val))));
}

function renderParamFields() {
  if (!paramFieldsContainer) return;
  paramFieldsContainer.innerHTML = "";

  if (!currentStrategy || !currentStrategy.parameters || !currentStrategy.parameters.properties) {
    paramFieldsContainer.dataset.empty = "Strategy exposes no tunable parameters.";
    if (paramJsonPreview) {
      paramJsonPreview.value = "";
      paramJsonPreview.placeholder = "Select a strategy to generate parameter JSON";
    }
    return;
  }

  const { properties } = currentStrategy.parameters;
  const fields = Object.entries(properties)
    .map(([name, schema]) => generateParamField(name, schema))
    .join("");

  paramFieldsContainer.removeAttribute("data-empty");
  paramFieldsContainer.innerHTML = fields;

  paramFieldsContainer.querySelectorAll("input[data-param], select[data-param], textarea[data-param]").forEach((field) => {
    field.addEventListener("input", () => updateParamJsonPreview());
    field.addEventListener("change", () => updateParamJsonPreview());
  });

  updateParamJsonPreview();
}

function generateParamField(name, schema) {
  const title = schema.title || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const description = schema.description ? `<p class="field-help">${schema.description}</p>` : "";
  const type = schema.type || "string";
  const defaultValue = schema.default;
  const defaultString =
    defaultValue === undefined || defaultValue === null
      ? ""
      : Array.isArray(defaultValue)
      ? defaultValue.join(",")
      : String(defaultValue);

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const options = schema.enum
      .map((value) => {
        const label = String(value).replace(/_/g, " ");
        const selected = Array.isArray(defaultValue)
          ? defaultValue.includes(value)
          : String(value) === String(defaultValue);
        return `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
      })
      .join("");

    return `
      <div class="config-group">
        <label>${title}</label>
        <select name="${name}" data-param="${name}" data-type="${type}" multiple size="4">
          ${options}
        </select>
        ${description}
      </div>
    `;
  }

  if (type === "boolean") {
    const trueSelected = defaultValue === true || (Array.isArray(defaultValue) && defaultValue.includes(true));
    const falseSelected = defaultValue === false || (Array.isArray(defaultValue) && defaultValue.includes(false));
    return `
      <div class="config-group">
        <label>${title}</label>
        <select name="${name}" data-param="${name}" data-type="boolean" multiple size="2">
          <option value="true"${trueSelected ? " selected" : ""}>True</option>
          <option value="false"${falseSelected ? " selected" : ""}>False</option>
        </select>
        <p class="field-help">Select one or both options.</p>
        ${description}
      </div>
    `;
  }

  if (type === "integer" || type === "number") {
    return `
      <div class="config-group">
        <label>${title}</label>
        <input name="${name}" type="text" value="${defaultString}" data-param="${name}" data-type="${type}" placeholder="e.g. 2,4,6 or 2-10:2" />
        <p class="field-help">Comma lists or ranges (start-end[:step]).</p>
        ${description}
      </div>
    `;
  }

  return `
    <div class="config-group">
      <label>${title}</label>
      <input name="${name}" type="text" value="${defaultString}" data-param="${name}" data-type="string" placeholder="Comma-separated values" />
      ${description}
    </div>
  `;
}

function collectParamRanges(strict = false) {
  const ranges = {};
  const errors = [];
  if (!paramFieldsContainer) {
    return { ranges, errors };
  }

  paramFieldsContainer.querySelectorAll("[data-param]").forEach((field) => {
    const name = field.dataset.param;
    const type = field.dataset.type || "string";

    try {
      if (field instanceof HTMLSelectElement && field.multiple) {
        const selectedValues = Array.from(field.selectedOptions).map((option) => coerceParamValue(option.value, type));
        if (selectedValues.length) {
          ranges[name] = selectedValues;
        }
        return;
      }

      const raw = field.value.trim();
      if (!raw) return;
      const values = parseRangeValues(raw, type);
      if (values.length) {
        ranges[name] = values;
      }
    } catch (err) {
      errors.push(err.message);
    }
  });

  if (strict && errors.length) {
    throw new Error(errors[0]);
  }

  return { ranges, errors };
}

function updateParamJsonPreview() {
  if (!paramJsonPreview) return;
  try {
    const { ranges, errors } = collectParamRanges(false);
    if (Object.keys(ranges).length === 0) {
      paramJsonPreview.value = "";
      paramJsonPreview.placeholder = "No parameter ranges specified.";
    } else {
      paramJsonPreview.value = JSON.stringify(ranges, null, 2);
    }
    if (errors.length) {
      paramJsonPreview.dataset.error = errors[0];
      paramJsonPreview.title = errors[0];
    } else {
      delete paramJsonPreview.dataset.error;
      paramJsonPreview.removeAttribute("title");
    }
  } catch (err) {
    paramJsonPreview.value = "";
    paramJsonPreview.placeholder = err.message;
    paramJsonPreview.dataset.error = err.message;
    paramJsonPreview.title = err.message;
  }
}

function setDefaultConfig() {
  if (symbolsInput) {
    symbolsInput.value = "NIFTY28OCT2525200CE\nNIFTY28OCT2525200PE";
  }
  document.getElementById("start-date").value = "2025-09-01";
  document.getElementById("end-date").value = "2025-10-06";
  document.getElementById("starting-capital").value = "100000";
  document.getElementById("qty-per-point").value = "150";
  document.getElementById("max-workers").value = "2";
  if (testNameInput) {
    testNameInput.value = "";
  }
  renderParamFields();
}

function estimateTotalJobs(symbolCount, paramRanges) {
  if (!symbolCount) return 0;
  let total = symbolCount;
  Object.entries(paramRanges).forEach(([key, values]) => {
    if (key === "symbols") return;
    const arr = Array.isArray(values) ? values : [values];
    if (arr.length) {
      total *= arr.length;
    }
  });
  return total;
}

function setupControls() {
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      try {
        await postControl("/start");
        await refreshStatus();
      } catch (error) {
        alert(error.message);
      } finally {
        startBtn.disabled = false;
      }
    });
  }
  if (pauseBtn) {
    pauseBtn.addEventListener("click", async () => {
      pauseBtn.disabled = true;
      try {
        await postControl("/pause");
        await refreshStatus();
      } catch (error) {
        alert(error.message);
      } finally {
        pauseBtn.disabled = false;
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (!confirm("Reset will clear progress and start from the first permutation.\nContinue?")) {
        return;
      }
      resetBtn.disabled = true;
      try {
        await postControl("/reset");
        await refreshStatus();
      } catch (error) {
        alert(error.message);
      } finally {
        resetBtn.disabled = false;
      }
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (!confirm("This will delete all tester results stored in the database. Continue?")) {
        return;
      }
      clearBtn.disabled = true;
      try {
        await postControl("/clear-results");
        await refreshStatus();
        await loadHistory();
      } catch (error) {
        alert(error.message);
      } finally {
        clearBtn.disabled = false;
      }
    });
  }
  if (exportAllBtn) {
    exportAllBtn.addEventListener("click", async () => {
      try {
        await downloadHistoryCsv({ fallbackName: `tester_results_${Date.now()}.csv`, button: exportAllBtn });
      } catch (error) {
        console.error("Export all failed", error);
      }
    });
  }
  if (historyExportAllBtn) {
    historyExportAllBtn.addEventListener("click", async () => {
      const source = historyFilterText ? historyFiltered : historyCache;
      if (!source.length) return;
      const ids = source.map((item) => item.id).filter(Boolean);
      try {
        await downloadHistoryCsv({ ids, fallbackName: `tester_results_${Date.now()}.csv`, button: historyExportAllBtn });
      } catch (error) {
        console.error("History export failed", error);
      }
    });
  }

  if (historyFilterBtn && historyFilterInput) {
    const applyHistoryFilter = () => {
      historyFilterText = historyFilterInput.value.trim();
      renderHistoryRows();
    };
    historyFilterBtn.addEventListener("click", applyHistoryFilter);
    historyFilterInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyHistoryFilter();
      }
    });
  }

  if (historyFilterClearBtn && historyFilterInput) {
    historyFilterClearBtn.addEventListener("click", () => {
      historyFilterText = "";
      historyFilterInput.value = "";
      renderHistoryRows();
    });
  }

  if (toggleConfigBtn) {
    toggleConfigBtn.addEventListener("click", () => {
      if (configForm.classList.contains("hidden")) {
        configForm.classList.remove("hidden");
        toggleConfigBtn.textContent = "Hide";
      } else {
        configForm.classList.add("hidden");
        toggleConfigBtn.textContent = "Show";
      }
    });
  }

  if (applyConfigBtn) {
    applyConfigBtn.addEventListener("click", async () => {
      applyConfigBtn.disabled = true;
      configInfo.textContent = "";
      configInfo.className = "config-info";

      try {
        const symbols = parseSymbolsInput(symbolsInput.value);
        if (!symbols.length) {
          throw new Error("At least one symbol is required");
        }

        const startDate = document.getElementById("start-date").value;
        const endDate = document.getElementById("end-date").value;
        if (!startDate || !endDate) {
          throw new Error("Start and end dates are required");
        }

        const startingCapital = Number(document.getElementById("starting-capital").value);
        const qtyPerPoint = Number(document.getElementById("qty-per-point").value);
        const maxWorkers = Number(document.getElementById("max-workers").value);
        if (Number.isNaN(startingCapital) || Number.isNaN(qtyPerPoint) || Number.isNaN(maxWorkers)) {
          throw new Error("Provide valid numeric values for capital, quantity, and workers");
        }

        const { ranges } = collectParamRanges(true);
        if (!Object.keys(ranges).length) {
          throw new Error("Specify at least one parameter range");
        }

        const paramRanges = { ...ranges, symbols };

        const config = {
          strategy: currentStrategy ? currentStrategy.name : strategySelect.value,
          test_name: testNameInput ? testNameInput.value.trim() || null : null,
          symbols,
          start_date: startDate,
          end_date: endDate,
          starting_capital: startingCapital,
          qty_per_point: qtyPerPoint,
          max_workers: maxWorkers,
          param_ranges: paramRanges,
        };

        const totalJobs = estimateTotalJobs(symbols.length, ranges);
        if (totalJobs > 100000) {
          const proceed = confirm(
            `This configuration will generate ${totalJobs.toLocaleString()} jobs. This may take a very long time. Continue?`
          );
          if (!proceed) {
            applyConfigBtn.disabled = false;
            return;
          }
        }

        const response = await fetch("/configure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || "Configuration failed");
        }

        const result = await response.json();
        renderStatus(result.status);

        const summaryParts = [
          `Strategy: ${config.strategy}`,
          `Jobs: ${result.status.total_jobs.toLocaleString()}`,
        ];
        if (config.test_name) {
          summaryParts.unshift(`Batch: ${config.test_name}`);
        }

        configInfo.textContent = `Configuration applied! ${summaryParts.join(" • ")}`;
        configInfo.className = "config-info success";

        // Auto-hide config panel after 2 seconds
        setTimeout(() => {
          if (configForm && toggleConfigBtn) {
            configForm.classList.add("hidden");
            toggleConfigBtn.textContent = "Show";
          }
        }, 2000);
      } catch (error) {
        configInfo.textContent = `Error: ${error.message}`;
        configInfo.className = "config-info error";
      } finally {
        applyConfigBtn.disabled = false;
      }
    });
  }

  if (paramCopyBtn && paramJsonPreview) {
    paramCopyBtn.addEventListener("click", async () => {
      if (!paramJsonPreview.value) {
        configInfo.textContent = "Nothing to copy yet.";
        configInfo.className = "config-info";
        return;
      }
      try {
        await navigator.clipboard.writeText(paramJsonPreview.value);
        configInfo.textContent = "Parameter JSON copied to clipboard.";
        configInfo.className = "config-info success";
      } catch (error) {
        configInfo.textContent = `Unable to copy: ${error.message}`;
        configInfo.className = "config-info error";
      }
    });
  }

  if (paramResetBtn) {
    paramResetBtn.addEventListener("click", () => {
      renderParamFields();
      configInfo.textContent = "Parameter ranges reset to strategy defaults.";
      configInfo.className = "config-info";
      setTimeout(() => {
        configInfo.textContent = "";
      }, 1500);
    });
  }

  if (resetConfigBtn) {
    resetConfigBtn.addEventListener("click", () => {
      setDefaultConfig();
      configInfo.textContent = "Reset to defaults";
      configInfo.className = "config-info";
      setTimeout(() => {
        configInfo.textContent = "";
      }, 2000);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupControls();
  loadStrategies();  // Load strategies first
  refreshStatus();
  loadHistory();
  scheduleStatus();

  // Setup sorting on table headers
  document.querySelectorAll('.history-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (column) {
        sortHistory(column);
      }
    });
  });

  // Setup strategy selector
  if (strategySelect) {
    strategySelect.addEventListener('change', onStrategyChange);
  }
});
