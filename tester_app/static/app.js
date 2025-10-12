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
const toggleConfigBtn = document.getElementById("toggle-config-btn");
const configForm = document.getElementById("config-form");
const applyConfigBtn = document.getElementById("apply-config-btn");
const resetConfigBtn = document.getElementById("reset-config-btn");
const configInfo = document.getElementById("config-info");
const strategySelect = document.getElementById("strategy-select");
const strategyDescription = document.getElementById("strategy-description");

let statusTimer = null;
let historyCache = [];
let currentSort = { column: null, direction: null };
let availableStrategies = [];
let currentStrategy = null;

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

  const fields = [
    ["Completed", `${status.completed_jobs}/${status.total_jobs}`],
    ["Remaining", formatNumber(status.remaining_jobs, 0)],
    ["Progress %", formatNumber(status.progress_percent)],
  ];

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
    const rows = [
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
  const noRuns = historyCache.length === 0;
  if (historyExportAllBtn) {
    historyExportAllBtn.disabled = noRuns;
  }
  if (exportAllBtn) {
    exportAllBtn.disabled = noRuns;
  }

  if (noRuns) {
    historyStatus.textContent = "No tester runs stored yet.";
    historyTableBody.innerHTML = "";
    return;
  }

  historyStatus.textContent = `${historyCache.length} runs stored.`;
  const rowsHtml = historyCache
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
      strategySelect.innerHTML = '<option value="">No strategies available</option>';
      return;
    }

    // Populate dropdown
    strategySelect.innerHTML = availableStrategies
      .map(s => `<option value="${s.name}">${s.title}</option>`)
      .join("");

    // Select first strategy by default
    currentStrategy = availableStrategies[0];
    strategySelect.value = currentStrategy.name;
    updateStrategyDescription();

    logger.info(`Loaded ${availableStrategies.length} strategies`);
  } catch (error) {
    console.error("Failed to load strategies:", error);
    strategySelect.innerHTML = '<option value="">Error loading strategies</option>';
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
    // TODO: In future, rebuild config form based on strategy parameters
  }
}

function parseCommaSeparatedNumbers(value, asFloat = true) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (asFloat ? parseFloat(s) : parseInt(s, 10)))
    .filter((n) => !isNaN(n));
}

function getConfigFromForm() {
  const symbols = document.getElementById("symbols").value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    symbols,
    start_date: document.getElementById("start-date").value,
    end_date: document.getElementById("end-date").value,
    starting_capital: parseFloat(document.getElementById("starting-capital").value),
    qty_per_point: parseFloat(document.getElementById("qty-per-point").value),
    max_workers: parseInt(document.getElementById("max-workers").value, 10),
    target_min: parseFloat(document.getElementById("target-min").value),
    target_max: parseFloat(document.getElementById("target-max").value),
    stoploss_min: parseFloat(document.getElementById("stoploss-min").value),
    stoploss_max: parseFloat(document.getElementById("stoploss-max").value),
    ema_fast: parseCommaSeparatedNumbers(document.getElementById("ema-fast").value, false),
    ema_slow: parseCommaSeparatedNumbers(document.getElementById("ema-slow").value, false),
    atr_min: parseCommaSeparatedNumbers(document.getElementById("atr-min").value, true),
    daily_loss_cap: parseCommaSeparatedNumbers(document.getElementById("daily-loss-cap").value, true),
  };
}

function setDefaultConfig() {
  document.getElementById("symbols").value = "NIFTY28OCT2525200CE,NIFTY28OCT2525200PE";
  document.getElementById("start-date").value = "2025-09-01";
  document.getElementById("end-date").value = "2025-10-06";
  document.getElementById("starting-capital").value = "100000";
  document.getElementById("qty-per-point").value = "150";
  document.getElementById("max-workers").value = "2";
  document.getElementById("target-min").value = "2";
  document.getElementById("target-max").value = "10";
  document.getElementById("stoploss-min").value = "2";
  document.getElementById("stoploss-max").value = "10";
  document.getElementById("ema-fast").value = "3,5";
  document.getElementById("ema-slow").value = "10,20";
  document.getElementById("atr-min").value = "1,2,3";
  document.getElementById("daily-loss-cap").value = "-1000,-1500,-2000,-2500,-3000";
}

function calculateTotalJobs(config) {
  const numSymbols = config.symbols.length;
  const numTargets = Math.floor((config.target_max - config.target_min) / 0.5) + 1;
  const numStoploss = Math.floor((config.stoploss_max - config.stoploss_min) / 0.5) + 1;
  const numEmaFast = config.ema_fast.length;
  const numEmaSlow = config.ema_slow.length;
  const numAtrMin = config.atr_min.length;
  const numDailyLossCap = config.daily_loss_cap.length;

  return numSymbols * numTargets * numStoploss * numEmaFast * numEmaSlow * numAtrMin * numDailyLossCap;
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
      if (!historyCache.length) return;
      const ids = historyCache.map((item) => item.id).filter(Boolean);
      try {
        await downloadHistoryCsv({ ids, fallbackName: `tester_results_${Date.now()}.csv`, button: historyExportAllBtn });
      } catch (error) {
        console.error("History export failed", error);
      }
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
        const formConfig = getConfigFromForm();

        // Validate
        if (formConfig.symbols.length === 0) {
          throw new Error("At least one symbol is required");
        }
        if (formConfig.target_min > formConfig.target_max) {
          throw new Error("Target min must be <= target max");
        }
        if (formConfig.stoploss_min > formConfig.stoploss_max) {
          throw new Error("Stoploss min must be <= stoploss max");
        }

        // Build param_ranges from form values
        const targetPoints = [];
        for (let i = formConfig.target_min; i <= formConfig.target_max; i += 0.5) {
          targetPoints.push(i);
        }

        const stoplossPoints = [];
        for (let i = formConfig.stoploss_min; i <= formConfig.stoploss_max; i += 0.5) {
          stoplossPoints.push(i);
        }

        const paramRanges = {
          target_points: targetPoints,
          stoploss_points: stoplossPoints,
          ema_fast: formConfig.ema_fast,
          ema_slow: formConfig.ema_slow,
          atr_min_points: formConfig.atr_min,
          daily_loss_cap: formConfig.daily_loss_cap,
          trade_direction: ["long_only"],
          confirm_trend_at_entry: [true],
          enable_eod_square_off: [true],
        };

        // Build config payload
        const config = {
          strategy: currentStrategy ? currentStrategy.name : "scalp_with_trend",
          symbols: formConfig.symbols,
          start_date: formConfig.start_date,
          end_date: formConfig.end_date,
          starting_capital: formConfig.starting_capital,
          qty_per_point: formConfig.qty_per_point,
          max_workers: formConfig.max_workers,
          param_ranges: paramRanges,
        };

        const totalJobs = calculateTotalJobs(formConfig);
        if (totalJobs > 100000) {
          if (!confirm(`This configuration will generate ${totalJobs.toLocaleString()} jobs. This may take a very long time. Continue?`)) {
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

        configInfo.textContent = `Configuration applied! Strategy: ${config.strategy}, Total jobs: ${result.status.total_jobs.toLocaleString()}`;
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
