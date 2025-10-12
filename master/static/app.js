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

function humanize(label) {
  return label.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function generateStrategyField(name, schema, required) {
  const title = schema.title || humanize(name);
  const description = schema.description ? `<p class="field-help">${schema.description}</p>` : "";
  const defaultValue = schema.default ?? "";
  const defaultString = typeof defaultValue === "object" ? JSON.stringify(defaultValue) : defaultValue ?? "";
  const requiredAttr = required ? " required" : "";

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const options = schema.enum
      .map((value) => {
        const label = String(value).replace(/_/g, " ");
        const selected = String(value) === String(defaultValue) ? " selected" : "";
        return `<option value="${value}"${selected}>${label}</option>`;
      })
      .join("");
    return `
      <label>
        ${title}
        <select name="${name}" data-type="${schema.type || "string"}"${requiredAttr}>
          ${options}
        </select>
        ${description}
      </label>
    `;
  }

  if (schema.type === "boolean") {
    const trueSelected = defaultValue === true ? " selected" : "";
    const falseSelected = defaultValue === false ? " selected" : "";
    return `
      <label>
        ${title}
        <select name="${name}" data-type="boolean"${requiredAttr}>
          <option value="true"${trueSelected}>True</option>
          <option value="false"${falseSelected}>False</option>
        </select>
        ${description}
      </label>
    `;
  }

  if (schema.type === "integer" || schema.type === "number") {
    const step =
      schema.type === "integer"
        ? "1"
        : schema.multipleOf
        ? String(schema.multipleOf)
        : "0.01";
    const minAttr = schema.minimum !== undefined ? ` min="${schema.minimum}"` : "";
    const maxAttr = schema.maximum !== undefined ? ` max="${schema.maximum}"` : "";
    const placeholder = schema.examples && schema.examples.length > 0 ? ` placeholder="${schema.examples[0]}"` : "";
    return `
      <label>
        ${title}
        <input name="${name}" type="number" value="${defaultString}" step="${step}" data-type="${schema.type}"${minAttr}${maxAttr}${placeholder}${requiredAttr}>
        ${description}
      </label>
    `;
  }

  const inputType = schema.format === "date-time" ? "datetime-local" : schema.format === "date" ? "date" : "text";
  const placeholder = schema.examples && schema.examples.length > 0 ? ` placeholder="${schema.examples[0]}"` : "";
  return `
    <label>
      ${title}
      <input name="${name}" type="${inputType}" value="${defaultString || ""}" data-type="string"${placeholder}${requiredAttr}>
      ${description}
    </label>
  `;
}

function renderSingleStrategyParams(strategyName) {
  if (!strategyParamsContainer) return;

  const strategy = singleStrategies.find((entry) => entry.name === strategyName);
  if (!strategy || !strategy.parameters || !strategy.parameters.properties) {
    strategyParamsContainer.innerHTML = "";
    return;
  }

  const { properties, required = [] } = strategy.parameters;
  const fieldsHtml = Object.entries(properties)
    .map(([name, schema]) => generateStrategyField(name, schema, required.includes(name)))
    .join("");

  strategyParamsContainer.innerHTML = `
    <div class="form-section-title">Strategy Parameters</div>
    <div id="strategy-params-form" class="form-section-fields" role="group" aria-label="Strategy Parameters">
      ${fieldsHtml}
    </div>
  `;
}

function collectStrategyParams() {
  const group = document.getElementById("strategy-params-form");
  if (!group) return {};

  const params = {};
  const fields = group.querySelectorAll("input[name], select[name], textarea[name]");
  fields.forEach((field) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
      return;
    }
    const name = field.name;
    if (!name) return;
    const type = field.dataset.type;

    let value;
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      value = field.checked;
    } else {
      value = field.value;
    }

    if (value === "" || value === undefined || value === null) {
      return;
    }

    if (type === "integer") {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        params[name] = parsed;
      }
      return;
    }

    if (type === "number") {
      const parsed = parseFloat(value);
      if (!Number.isNaN(parsed)) {
        params[name] = parsed;
      }
      return;
    }

    if (type === "boolean") {
      params[name] = value === true || value === "true";
      return;
    }

    params[name] = value;
  });

  return params;
}

function formatMoney(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "";
  return numeric.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return value;
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showBacktestLoading() {
  if (backtestSummary) {
    backtestSummary.innerHTML = '<p class="muted">Preparing summary…</p>';
  }
  if (exitReasonsContainer) {
    exitReasonsContainer.innerHTML = "";
  }
  if (backtestTrades) {
    backtestTrades.innerHTML = '<p class="muted">Fetching trades…</p>';
  }
  resetDailyVisuals("Loading daily performance...");
  if (dailyStatsTable) {
    dailyStatsTable.innerHTML = '<p class="muted">Preparing daily stats…</p>';
  }
}

function resetDailyVisuals(message = "Run a backtest to visualize daily performance.") {
  if (dailyChart && typeof dailyChart.destroy === "function") {
    dailyChart.destroy();
  }
  dailyChart = null;
  if (dailyChartCanvas) {
    dailyChartCanvas.classList.add("hidden");
  }
  if (dailyChartPlaceholder) {
    dailyChartPlaceholder.textContent = message;
  }
  if (dailyStatsTable) {
    dailyStatsTable.innerHTML = "";
  }
}

function determineMetricClass(key, numeric) {
  if (!Number.isFinite(numeric)) return "";
  switch (key) {
    case "net_rupees":
    case "gross_rupees":
    case "avg_win":
    case "wins":
    case "total_trades":
    case "roi_percent":
      return numeric > 0 ? "positive" : numeric < 0 ? "negative" : "";
    case "avg_loss":
    case "max_drawdown":
    case "losses":
    case "costs_rupees":
      return numeric > 0 ? "negative" : numeric < 0 ? "positive" : "";
    case "winrate_percent":
      if (numeric >= 50) return "positive";
      if (numeric > 0 && numeric < 50) return "negative";
      return "";
    default:
      if (numeric > 0) return "positive";
      if (numeric < 0) return "negative";
      return "";
  }
}

function renderSummaryMetrics(summary) {
  if (!backtestSummary) return null;
  backtestSummary.innerHTML = "";

  if (!summary || typeof summary !== "object") {
    backtestSummary.dataset.empty = "Run a backtest to see results.";
    return null;
  }

  const { exit_reason_counts: exitCounts, ...rest } = summary;
  const metricsLayout = [
    ["total_trades", "Trades"],
    ["wins", "Wins"],
    ["losses", "Losses"],
    ["winrate_percent", "Winrate %"],
    ["net_rupees", "Net ₹"],
    ["gross_rupees", "Gross ₹"],
    ["costs_rupees", "Costs ₹"],
    ["roi_percent", "ROI %"],
    ["avg_win", "Avg Win ₹"],
    ["avg_loss", "Avg Loss ₹"],
    ["max_drawdown", "Max DD ₹"],
    ["risk_reward", "Risk:Reward"],
  ];

  const handled = new Set();
  const items = [];

  metricsLayout.forEach(([key, label]) => {
    if (!(key in rest)) return;
    handled.add(key);
    const raw = rest[key];
    if (typeof raw === "object" || raw === undefined) return;
    let display = raw;
    let numeric = Number(raw);
    if (Number.isNaN(numeric)) numeric = undefined;

    if (key.includes("rupees") || key.startsWith("avg_") || key === "max_drawdown") {
      display = numeric !== undefined ? `₹${formatMoney(numeric)}` : "—";
    } else if (key === "winrate_percent" || key === "roi_percent") {
      display = numeric !== undefined ? `${numeric.toFixed(2)}%` : "—";
    } else if (typeof raw === "number") {
      display = formatValue(raw);
    }

    const metricClass = numeric !== undefined ? determineMetricClass(key, numeric) : "";
    const valueClass = metricClass ? `value ${metricClass}` : "value";
    const itemClass = metricClass ? `metric-${metricClass}` : "";

    items.push(
      `<li class="${itemClass}"><span class="label">${label}</span><span class="${valueClass}">${display ?? "—"}</span></li>`,
    );
  });

  Object.entries(rest).forEach(([key, value]) => {
    if (handled.has(key)) return;
    if (value === null || value === undefined) return;
    if (typeof value === "object") return;
    handled.add(key);

    const label = humanize(key);
    let numeric = Number(value);
    if (Number.isNaN(numeric)) numeric = undefined;
    let display = value;

    if (typeof value === "number") {
      display = formatValue(value);
    }

    const metricClass = numeric !== undefined ? determineMetricClass(key, numeric) : "";
    const valueClass = metricClass ? `value ${metricClass}` : "value";
    const itemClass = metricClass ? `metric-${metricClass}` : "";

    items.push(
      `<li class="${itemClass}"><span class="label">${label}</span><span class="${valueClass}">${display}</span></li>`,
    );
  });

  if (!items.length) {
    backtestSummary.dataset.empty = "Summary metrics unavailable.";
    return exitCounts || null;
  }

  backtestSummary.removeAttribute("data-empty");
  backtestSummary.innerHTML = `<ul class="metrics-grid">${items.join("")}</ul>`;
  return exitCounts || null;
}

function renderExitReasons(counts) {
  if (!exitReasonsContainer) return;
  exitReasonsContainer.innerHTML = "";
  if (!counts || typeof counts !== "object" || Object.keys(counts).length === 0) {
    exitReasonsContainer.dataset.empty = "Exit reasons unavailable.";
    return;
  }

  const rows = Object.entries(counts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([reason, count]) => `<tr><td>${humanize(reason)}</td><td>${count}</td></tr>`)
    .join("");

  exitReasonsContainer.removeAttribute("data-empty");
  exitReasonsContainer.innerHTML = `
    <table>
      <thead><tr><th>Reason</th><th>Count</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderTradesTable(trades) {
  if (!backtestTrades) return;
  backtestTrades.innerHTML = "";
  if (!Array.isArray(trades) || trades.length === 0) {
    backtestTrades.dataset.empty = "No trades recorded for this run.";
    return;
  }

  const headers = Object.keys(trades[0]);
  const headerRow = headers.map((header) => `<th>${humanize(header)}</th>`).join("");
  const bodyRows = trades
    .map((trade) => {
      const cells = headers
        .map((header) => {
          const value = trade[header];
          let display = value;
          let cellClass = "";

          if (header.includes("time")) {
            display = formatTimestamp(value);
          } else if (typeof value === "number") {
            if (header.endsWith("rupees") || header.includes("pnl") || header.includes("net")) {
              cellClass = value >= 0 ? "positive" : "negative";
              display = `₹${formatMoney(value)}`;
            } else {
              display = formatValue(value);
            }
          } else if (header.endsWith("rupees") && value !== null && value !== undefined && value !== "") {
            const numeric = Number(value);
            if (!Number.isNaN(numeric)) {
              cellClass = numeric >= 0 ? "positive" : "negative";
              display = `₹${formatMoney(numeric)}`;
            }
          } else if (value === null || value === undefined) {
            display = "—";
          }

          return `<td${cellClass ? ` class="${cellClass}"` : ""}>${display}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  backtestTrades.removeAttribute("data-empty");
  backtestTrades.innerHTML = `
    <table>
      <thead><tr>${headerRow}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function renderDailyChart(stats) {
  if (!dailyChartCanvas || typeof Chart === "undefined") {
    return;
  }

  if (dailyChart) {
    dailyChart.destroy();
    dailyChart = null;
  }

  if (!stats || stats.length === 0) {
    if (dailyChartCanvas) dailyChartCanvas.classList.add("hidden");
    if (dailyChartPlaceholder) dailyChartPlaceholder.textContent = "No trades to chart.";
    return;
  }

  const labels = stats.map((item) => item.date_label || item.date);
  const dailyValues = stats.map((item) => Number(item.net_pnl ?? item.net_rupees) || 0);

  let cumulative = 0;
  const cumulativeData = dailyValues.map((value) => {
    cumulative += value;
    return cumulative;
  });

  const barColors = dailyValues.map((value) =>
    value >= 0 ? "rgba(34, 197, 94, 0.7)" : "rgba(248, 113, 113, 0.75)",
  );

  dailyChartCanvas.classList.remove("hidden");
  dailyChart = new Chart(dailyChartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Daily P&L",
          data: dailyValues,
          backgroundColor: barColors,
          borderRadius: 4,
          borderSkipped: false,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line",
          label: "Cumulative P&L",
          data: cumulativeData,
          borderColor: "rgba(56, 189, 248, 0.95)",
          backgroundColor: "rgba(56, 189, 248, 0.15)",
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          yAxisID: "y",
          fill: true,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        y: {
          ticks: {
            callback: (value) =>
              `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
          },
          grid: {
            color: "rgba(226, 232, 240, 0.25)",
          },
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0,
          },
          grid: {
            color: "rgba(226, 232, 240, 0.12)",
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.dataset.label || "";
              const value = Number(context.parsed.y).toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
              return `${label}: ₹${value}`;
            },
          },
        },
      },
    },
  });

  if (dailyChartPlaceholder) {
    dailyChartPlaceholder.textContent = "";
  }
}

function renderDailyStatsTable(stats) {
  if (!dailyStatsTable) return;
  dailyStatsTable.innerHTML = "";

  if (!stats || stats.length === 0) {
    dailyStatsTable.dataset.empty = "No daily stats available.";
    return;
  }

  const rows = stats
    .map((item) => {
      const net = Number(item.net_pnl ?? item.net_rupees) || 0;
      const trades = item.trades ?? item.total_trades ?? "—";
      const wins = item.wins ?? "—";
      const losses = item.losses ?? "—";
      const rowClass = net > 0 ? "positive" : net < 0 ? "negative" : "";
      return `
        <tr class="${rowClass}">
          <td>${item.date_label || item.date || "—"}</td>
          <td class="${rowClass}">₹${formatMoney(net)}</td>
          <td>${trades}</td>
          <td class="${Number(wins) > 0 ? "positive" : ""}">${wins}</td>
          <td class="${Number(losses) > 0 ? "negative" : ""}">${losses}</td>
        </tr>
      `;
    })
    .join("");

  dailyStatsTable.removeAttribute("data-empty");
  dailyStatsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Net ₹</th>
          <th>Trades</th>
          <th>Wins</th>
          <th>Losses</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function displayBacktestError(message) {
  const safeMessage = message || "Unable to run backtest.";
  if (backtestSummary) {
    backtestSummary.innerHTML = `<p class="muted">Error: ${safeMessage}</p>`;
  }
  if (exitReasonsContainer) {
    exitReasonsContainer.innerHTML = "";
    exitReasonsContainer.dataset.empty = "Exit reasons unavailable.";
  }
  if (backtestTrades) {
    backtestTrades.innerHTML = `<p class="muted">Error: ${safeMessage}</p>`;
  }
  resetDailyVisuals("No chart available.");
}

// --- Single backtest ---------------------------------------------------------

const inventoryList = document.getElementById("inventory-list");
const inventoryRefreshBtn = document.getElementById("inventory-refresh");
const fetchForm = document.getElementById("fetch-form");
const fetchResult = document.getElementById("fetch-result");
const backtestForm = document.getElementById("backtest-form");
const backtestSummary = document.getElementById("backtest-summary");
const backtestTrades = document.getElementById("backtest-trades");
const exitReasonsContainer = document.getElementById("exit-reasons");
const dailyChartCanvas = document.getElementById("daily-chart");
const dailyChartPlaceholder = document.getElementById("daily-chart-empty");
const dailyStatsTable = document.getElementById("daily-stats-table");
const strategySelect = document.getElementById("single-strategy-select");
const inventoryModal = document.getElementById("inventory-modal");
const inventoryModalTitle = document.getElementById("modal-title");
const inventoryModalBody = document.getElementById("modal-body-content");
const inventoryModalClose = document.getElementById("modal-close");
const strategyParamsContainer = document.getElementById("single-strategy-params");

let singleStrategies = [];
let dailyChart = null;

async function loadSingleStrategies() {
  if (!strategySelect) return;
  try {
    const strategies = await fetchJSON("/api/single/strategies");
    singleStrategies = Array.isArray(strategies) ? strategies : [];

    const previousSelection = strategySelect.value;
    strategySelect.innerHTML = "";

    if (!singleStrategies.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No strategies loaded";
      strategySelect.appendChild(option);
      if (strategyParamsContainer) {
        strategyParamsContainer.innerHTML = "";
      }
      return;
    }

    singleStrategies.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.title || item.name;
      if (item.name === previousSelection) {
        option.selected = true;
      }
      strategySelect.appendChild(option);
    });

    if (!strategySelect.value) {
      strategySelect.value = singleStrategies[0].name;
    }
    renderSingleStrategyParams(strategySelect.value);
  } catch (err) {
    setOutput(fetchResult, String(err), "Failed to load strategies.");
    if (strategyParamsContainer) {
      strategyParamsContainer.innerHTML = "";
    }
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

async function handleBacktestSubmit(event) {
  event.preventDefault();
  const formData = new FormData(backtestForm);
  const payload = {};
  payload.write_csv = formData.get("write_csv") === "on";

  formData.forEach((value, key) => {
    if (key === "write_csv") return;
    const isStrategyField =
      strategyParamsContainer &&
      strategyParamsContainer.querySelector(`[name="${key}"]`);
    if (isStrategyField) return;
    if (value !== "") {
      payload[key] = value;
    }
  });

  payload.strategy_params = collectStrategyParams();

  if (payload.last_n_trades) {
    payload.last_n_trades = Number(payload.last_n_trades);
  }
  if (payload.starting_capital) {
    payload.starting_capital = Number(payload.starting_capital);
  }
  if (payload.qty_per_point) {
    payload.qty_per_point = Number(payload.qty_per_point);
  }

  showBacktestLoading();

  try {
    const result = await fetchJSON("/api/single/backtest", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const exitCounts = renderSummaryMetrics(result.summary);
    renderExitReasons(exitCounts);
    renderTradesTable(result.trades_all);
    renderDailyChart(result.daily_stats || []);
    renderDailyStatsTable(result.daily_stats || []);
  } catch (err) {
    displayBacktestError(err.message || "Backtest failed.");
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
if (strategySelect) {
  strategySelect.addEventListener("change", (event) => {
    renderSingleStrategyParams(event.target.value);
  });
}
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
