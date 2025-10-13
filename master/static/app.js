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
const permutationForm = document.getElementById("permutation-form");
const permutationStrategySelect = document.getElementById("permutation-strategy-select");
const permutationParamsContainer = document.getElementById("permutation-params");
const runModeButtons = document.querySelectorAll(".mode-toggle-btn");
const inventoryModal = document.getElementById("inventory-modal");
const inventoryModalTitle = document.getElementById("modal-title");
const inventoryModalBody = document.getElementById("modal-body-content");
const inventoryModalClose = document.getElementById("modal-close");
const strategyParamsContainer = document.getElementById("single-strategy-params");
const multiStrategySelect = document.getElementById("multi-strategy-select");
const multiConfigForm = document.getElementById("multi-config-form");
const multiStartBtn = document.getElementById("multi-start");
const multiPauseBtn = document.getElementById("multi-pause");
const multiResetBtn = document.getElementById("multi-reset");
const multiClearBtn = document.getElementById("multi-clear");
const multiRefreshBtn = document.getElementById("multi-refresh");
const multiStatus = document.getElementById("multi-status-display");
const multiHistoryBtn = document.getElementById("multi-history-refresh");
const historyTable = document.getElementById("history-table");
const autoPopulateBtn = document.getElementById("auto-populate-ranges");
const multiParamRangesFields = document.getElementById("multi-param-ranges-fields");
const batchModal = document.getElementById("batch-detail-modal");
const batchModalTitle = document.getElementById("batch-modal-title");
const batchModalBody = document.getElementById("batch-modal-body");
const batchModalClose = document.getElementById("batch-modal-close");

let singleStrategies = [];
let dailyChart = null;
let currentRunMode = "single";

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
          } else if (header.includes("target") && !header.includes("rupees") && !header.includes("pnl")) {
            // Special styling for target columns
            cellClass = "target-value";
            display = typeof value === "number" ? formatValue(value) : value;
          } else if ((header.includes("stoploss") || header.includes("stop_loss")) && !header.includes("rupees") && !header.includes("pnl")) {
            // Special styling for stoploss columns
            cellClass = "stoploss-value";
            display = typeof value === "number" ? formatValue(value) : value;
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
    value >= 0
      ? "rgba(16, 185, 129, 0.85)"  // Emerald green
      : "rgba(239, 68, 68, 0.85)"    // Red
  );

  const barBorderColors = dailyValues.map((value) =>
    value >= 0
      ? "rgba(5, 150, 105, 1)"       // Darker emerald
      : "rgba(220, 38, 38, 1)"        // Darker red
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
          borderColor: barBorderColors,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
          yAxisID: "y",
          order: 2,
          barThickness: "flex",
          maxBarThickness: 40,
        },
        {
          type: "line",
          label: "Cumulative P&L",
          data: cumulativeData,
          borderColor: "rgba(59, 130, 246, 1)",      // Blue
          backgroundColor: "rgba(59, 130, 246, 0.08)", // Light blue fill
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: "rgba(59, 130, 246, 1)",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointHoverBackgroundColor: "rgba(37, 99, 235, 1)",
          pointHoverBorderColor: "#ffffff",
          pointHoverBorderWidth: 2,
          yAxisID: "y",
          fill: true,
          tension: 0.3,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 2.5,
      interaction: {
        mode: "index",
        intersect: false,
      },
      layout: {
        padding: {
          left: 5,
          right: 5,
          top: 10,
          bottom: 5,
        },
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: (value) =>
              `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
            font: {
              size: 11,
              family: "'Inter', system-ui, sans-serif",
              weight: "500",
            },
            color: "#475569",
            padding: 8,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.15)",
            lineWidth: 1,
            drawBorder: false,
          },
          border: {
            display: false,
          },
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 20,
            font: {
              size: 10,
              family: "'Inter', system-ui, sans-serif",
              weight: "500",
            },
            color: "#64748b",
            padding: 6,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.08)",
            lineWidth: 1,
            drawBorder: false,
            drawTicks: false,
          },
          border: {
            display: false,
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: {
            boxWidth: 14,
            boxHeight: 14,
            padding: 12,
            font: {
              size: 12,
              family: "'Inter', system-ui, sans-serif",
              weight: "600",
            },
            color: "#1e293b",
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#f1f5f9",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148, 163, 184, 0.3)",
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          cornerRadius: 8,
          titleFont: {
            size: 13,
            weight: "600",
            family: "'Inter', system-ui, sans-serif",
          },
          bodyFont: {
            size: 12,
            family: "'Inter', system-ui, sans-serif",
          },
          displayColors: true,
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

function switchRunMode(mode) {
  currentRunMode = mode;
  runModeButtons.forEach((button) => {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle("active", isActive);
  });
  if (backtestForm) {
    backtestForm.classList.toggle("hidden", mode !== "single");
  }
  if (permutationForm) {
    permutationForm.classList.toggle("hidden", mode !== "permutation");
  }
  if (mode === "permutation" && permutationStrategySelect) {
    if (!permutationStrategySelect.value && strategySelect && strategySelect.value) {
      permutationStrategySelect.value = strategySelect.value;
    }
    renderPermutationParams(permutationStrategySelect.value || strategySelect?.value || "");
  }
  if (mode === "single" && strategySelect && !strategySelect.value && permutationStrategySelect?.value) {
    strategySelect.value = permutationStrategySelect.value;
    renderSingleStrategyParams(strategySelect.value);
  }
}

function parseSymbolsInput(raw) {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function coerceValue(value, type) {
  if (type === "integer") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid integer value: ${value}`);
    }
    return parsed;
  }
  if (type === "number") {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid number value: ${value}`);
    }
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
  const cleaned = token.trim();
  if (!cleaned) return [];

  const rangeMatch = cleaned.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)(?::(-?\d+(?:\.\d+)?))?$/);
  if (!rangeMatch || (type !== "integer" && type !== "number")) {
    return [coerceValue(cleaned, type)];
  }

  const start = Number.parseFloat(rangeMatch[1]);
  const end = Number.parseFloat(rangeMatch[2]);
  let step = rangeMatch[3] !== undefined ? Number.parseFloat(rangeMatch[3]) : undefined;

  if (step === undefined || Number.isNaN(step) || step === 0) {
    const defaultStep = start <= end ? 1 : -1;
    step = type === "integer" ? defaultStep : defaultStep;
  }

  const values = [];
  if (step === 0) {
    return values;
  }

  const useInt = type === "integer";
  const epsilon = 1e-9;
  if (step > 0) {
    for (let current = start; current <= end + epsilon; current += step) {
      values.push(useInt ? Math.round(current) : Number.parseFloat(current.toFixed(6)));
    }
  } else {
    for (let current = start; current >= end - epsilon; current += step) {
      values.push(useInt ? Math.round(current) : Number.parseFloat(current.toFixed(6)));
    }
  }

  return values;
}

function parseRangeValues(raw, type) {
  if (!raw) return [];
  const segments = raw.split(",").map((segment) => segment.trim()).filter(Boolean);
  let values = [];
  segments.forEach((segment) => {
    values = values.concat(expandRangeToken(segment, type));
  });
  return uniqueValues(values);
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = typeof value === "number" ? value.toFixed(6) : String(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generatePermutationField(name, schema) {
  const title = schema.title || humanize(name);
  const description = schema.description ? `<p class="field-help">${schema.description}</p>` : "";
  const defaultValue = schema.default;
  const defaultString =
    defaultValue === undefined || defaultValue === null
      ? ""
      : typeof defaultValue === "object"
      ? JSON.stringify(defaultValue)
      : String(defaultValue);
  const dataAttrs = `data-param="${name}" data-type="${schema.type || "string"}"`;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const options = schema.enum
      .map((value) => {
        const label = String(value).replace(/_/g, " ");
        const selected = String(value) === String(defaultValue) ? " selected" : "";
        return `<option value="${value}"${selected}>${label}</option>`;
      })
      .join("");
    const size = Math.min(schema.enum.length, 6);
    const selectId = `select-${name}-${Date.now()}`;
    return `
      <label>
        ${title}
        <div class="multi-select-wrapper">
          <select ${dataAttrs} name="${name}" id="${selectId}" multiple size="${size}">
            ${options}
          </select>
          <div class="selected-items" data-for="${selectId}"></div>
        </div>
        <p class="field-help">💡 Click to select multiple values. Click × on chips below to remove.</p>
        ${description}
      </label>
    `;
  }

  if (schema.type === "boolean") {
    const trueSelected = defaultValue === true ? " selected" : "";
    const falseSelected = defaultValue === false ? " selected" : "";
    const selectId = `select-${name}-${Date.now()}`;
    return `
      <label>
        ${title}
        <div class="multi-select-wrapper">
          <select ${dataAttrs} name="${name}" id="${selectId}" multiple size="2">
            <option value="true"${trueSelected}>True</option>
            <option value="false"${falseSelected}>False</option>
          </select>
          <div class="selected-items" data-for="${selectId}"></div>
        </div>
        <p class="field-help">💡 Click to select one or both values. Click × on chips below to remove.</p>
        ${description}
      </label>
    `;
  }

  if (schema.type === "integer" || schema.type === "number") {
    const placeholder = "e.g. 2,4,6 or 2-10:2";
    return `
      <label>
        ${title}
        <input name="${name}" type="text" value="${defaultString}" ${dataAttrs} placeholder="${placeholder}">
        <p class="field-help">Provide comma-separated values or ranges (start-end[:step]). Leave blank to use strategy defaults.</p>
        ${description}
      </label>
    `;
  }

  return `
    <label>
      ${title}
      <input name="${name}" type="text" value="${defaultString}" ${dataAttrs} placeholder="Comma-separated values">
      ${description}
    </label>
  `;
}

function initializeMultiSelectChips(container) {
  if (!container) return;

  // Use setTimeout to ensure DOM is fully rendered
  setTimeout(() => {
    const multiSelects = container.querySelectorAll('select[multiple]');

    multiSelects.forEach((select) => {
      const selectId = select.id;
      if (!selectId) return;

      const chipsContainer = container.querySelector(`.selected-items[data-for="${selectId}"]`);
      if (!chipsContainer) {
        console.warn(`Chips container not found for select ${selectId}`);
        return;
      }

      // Function to update chips display
      const updateChips = () => {
        chipsContainer.innerHTML = '';
        const selectedOptions = Array.from(select.selectedOptions);

        if (selectedOptions.length === 0) {
          chipsContainer.style.display = 'none';
        } else {
          chipsContainer.style.display = 'flex';
        }

        selectedOptions.forEach((option) => {
          const chip = document.createElement('span');
          chip.className = 'selected-item';
          chip.innerHTML = `
            ${option.textContent}
            <button type="button" class="remove-btn" data-value="${option.value}">×</button>
          `;

          // Add click handler to remove button
          const removeBtn = chip.querySelector('.remove-btn');
          if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              option.selected = false;
              updateChips();
            });
          }

          chipsContainer.appendChild(chip);
        });
      };

      // Update chips when selection changes
      select.addEventListener('change', updateChips);

      // Initialize chips for pre-selected options
      updateChips();
    });
  }, 50);
}

function renderPermutationParams(strategyName) {
  if (!permutationParamsContainer) return;
  permutationParamsContainer.innerHTML = "";

  const strategy = singleStrategies.find((entry) => entry.name === strategyName);
  if (!strategy || !strategy.parameters || !strategy.parameters.properties) {
    permutationParamsContainer.dataset.empty = "Strategy exposes no tunable parameters for batching.";
    return;
  }

  const { properties } = strategy.parameters;
  const fields = Object.entries(properties)
    .map(([name, schema]) => generatePermutationField(name, schema))
    .join("");

  permutationParamsContainer.removeAttribute("data-empty");
  permutationParamsContainer.innerHTML = `
    <div class="form-section-title">Parameter Ranges</div>
    <div class="form-section-fields">${fields}</div>
  `;

  // Initialize multi-select chip displays
  initializeMultiSelectChips(permutationParamsContainer);
}

function collectPermutationParamRanges() {
  if (!permutationParamsContainer) return {};
  const params = {};
  const fields = permutationParamsContainer.querySelectorAll("[data-param]");

  fields.forEach((field) => {
    const name = field.dataset.param;
    const type = field.dataset.type || "string";

    if (field instanceof HTMLSelectElement && field.multiple) {
      const selected = Array.from(field.selectedOptions).map((option) => coerceValue(option.value, type));
      if (selected.length) {
        params[name] = uniqueValues(selected);
      }
      return;
    }

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const raw = field.value.trim();
      if (!raw) return;
      try {
        const values = parseRangeValues(raw, type);
        if (values.length) {
          params[name] = values;
        }
      } catch (err) {
        throw err;
      }
    }
  });

  return params;
}

// --- Single backtest ---------------------------------------------------------

async function loadSingleStrategies() {
  try {
    const strategies = await fetchJSON("/api/single/strategies");
    singleStrategies = Array.isArray(strategies) ? strategies : [];

    const previousSingle = strategySelect?.value;
    const previousPermutation = permutationStrategySelect?.value;

    if (strategySelect) {
      strategySelect.innerHTML = "";
    }
    if (permutationStrategySelect) {
      permutationStrategySelect.innerHTML = "";
    }

    if (!singleStrategies.length) {
      if (strategySelect) {
        const option = new Option("No strategies loaded", "");
        strategySelect.add(option);
      }
      if (permutationStrategySelect) {
        const option = new Option("No strategies loaded", "");
        permutationStrategySelect.add(option);
      }
      if (strategyParamsContainer) {
        strategyParamsContainer.innerHTML = "";
      }
      if (permutationParamsContainer) {
        permutationParamsContainer.innerHTML = "";
        permutationParamsContainer.dataset.empty = "Strategy exposes no tunable parameters for batching.";
      }
      return;
    }

    singleStrategies.forEach((item) => {
      if (strategySelect) {
        const option = new Option(item.title || item.name, item.name);
        option.selected = item.name === previousSingle;
        strategySelect.add(option);
      }
      if (permutationStrategySelect) {
        const option = new Option(item.title || item.name, item.name);
        option.selected = item.name === previousPermutation;
        permutationStrategySelect.add(option);
      }
    });

    if (strategySelect) {
      const hasPrevious = previousSingle && singleStrategies.some((entry) => entry.name === previousSingle);
      if (!hasPrevious) {
        strategySelect.value = singleStrategies[0].name;
      }
      renderSingleStrategyParams(strategySelect.value);
    }

    if (permutationStrategySelect) {
      const hasPrevious = previousPermutation && singleStrategies.some((entry) => entry.name === previousPermutation);
      if (!hasPrevious) {
        const fallback = strategySelect?.value || singleStrategies[0].name;
        permutationStrategySelect.value = fallback;
      }
      renderPermutationParams(permutationStrategySelect.value);
    }
  } catch (err) {
    if (fetchResult) {
      setOutput(fetchResult, String(err), "Failed to load strategies.");
    }
    if (strategyParamsContainer) {
      strategyParamsContainer.innerHTML = "";
    }
    if (permutationParamsContainer) {
      permutationParamsContainer.innerHTML = "";
      permutationParamsContainer.dataset.empty = "Unable to load strategy parameters.";
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

async function handlePermutationSubmit(event) {
  event.preventDefault();
  if (!permutationForm) return;

  const formData = new FormData(permutationForm);
  const submitBtn = permutationForm.querySelector('button[type="submit"]');

  const strategy = formData.get("strategy");
  if (!strategy) {
    setOutput(multiStatus, "Error: Select a strategy for the permutation batch.");
    return;
  }

  const symbols = parseSymbolsInput(formData.get("symbols") || "");
  if (!symbols.length) {
    setOutput(multiStatus, "Error: Provide at least one symbol (comma or newline separated)." );
    return;
  }

  const payload = {
    strategy,
    test_name: (formData.get("test_name") || "").trim() || null,
    symbols,
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    starting_capital: Number(formData.get("starting_capital")),
    qty_per_point: Number(formData.get("qty_per_point")),
    max_workers: Number(formData.get("max_workers")),
    exchange: (formData.get("exchange") || "NFO").toUpperCase(),
    interval: formData.get("interval") || "5m",
    option_selection: formData.get("option_selection") || "both",
    param_ranges: {},
  };

  if (Number.isNaN(payload.starting_capital) || Number.isNaN(payload.qty_per_point) || Number.isNaN(payload.max_workers)) {
    setOutput(multiStatus, "Error: Provide valid numeric values for capital, quantity, and workers.");
    return;
  }

  try {
    payload.param_ranges = collectPermutationParamRanges();
  } catch (err) {
    setOutput(multiStatus, `Error: ${err.message}`);
    return;
  }

  try {
    setBusy(submitBtn, true);
    const configure = await fetchJSON("/api/multi/configure", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setOutput(multiStatus, jsonStringify(configure.status));

    const start = await fetchJSON("/api/multi/start", { method: "POST" });
    setOutput(multiStatus, jsonStringify(start.status));

    await Promise.all([updateMultiStatus(), refreshHistory()]);
  } catch (err) {
    setOutput(multiStatus, `Error: ${err.message}`);
  } finally {
    setBusy(submitBtn, false);
  }
}

async function loadMultiStrategies() {
  if (!multiStrategySelect) return;
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

    // Render param fields for the first strategy
    if (items.length > 0) {
      renderMultiParamFields(items[0].name);
    }
  } catch (err) {
    if (multiStatus) {
      multiStatus.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
    }
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

function renderMultiParamFields(strategyName) {
  if (!multiParamRangesFields) return;
  multiParamRangesFields.innerHTML = "";

  const strategy = singleStrategies.find((entry) => entry.name === strategyName);
  if (!strategy || !strategy.parameters || !strategy.parameters.properties) {
    multiParamRangesFields.innerHTML = '<p class="field-help muted">No tunable parameters for this strategy.</p>';
    return;
  }

  const { properties } = strategy.parameters;
  const fields = Object.entries(properties)
    .map(([name, schema]) => generatePermutationField(name, schema))
    .join("");

  multiParamRangesFields.innerHTML = fields;

  // Initialize multi-select chip displays
  initializeMultiSelectChips(multiParamRangesFields);
}

function collectMultiParamRanges() {
  if (!multiParamRangesFields) return {};
  const params = {};
  const fields = multiParamRangesFields.querySelectorAll("[data-param]");

  fields.forEach((field) => {
    const name = field.dataset.param;
    const type = field.dataset.type || "string";

    // Handle multi-select dropdowns (for enums and booleans)
    if (field instanceof HTMLSelectElement && field.multiple) {
      const selected = Array.from(field.selectedOptions).map((option) => coerceValue(option.value, type));
      if (selected.length) {
        params[name] = uniqueValues(selected);
      }
      return;
    }

    // Handle text inputs (for numeric ranges)
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const raw = field.value.trim();
      if (!raw) return;
      try {
        const values = parseRangeValues(raw, type);
        if (values.length) {
          params[name] = values;
        }
      } catch (err) {
        throw err;
      }
    }
  });

  return params;
}

async function autoPopulateRanges() {
  if (!multiStrategySelect || !multiParamRangesFields || !autoPopulateBtn) return;

  const strategyName = multiStrategySelect.value;
  if (!strategyName) {
    alert("Please select a strategy first.");
    return;
  }

  const strategy = singleStrategies.find((entry) => entry.name === strategyName);
  if (!strategy || !strategy.parameters || !strategy.parameters.properties) {
    alert("This strategy has no tunable parameters.");
    return;
  }

  const { properties } = strategy.parameters;

  // Auto-populate with default values as ranges
  Object.entries(properties).forEach(([name, schema]) => {
    const field = multiParamRangesFields.querySelector(`[data-param="${name}"]`);
    if (!field || !(field instanceof HTMLInputElement)) return;

    const defaultValue = schema.default;
    if (defaultValue === undefined || defaultValue === null) return;

    const type = schema.type || "string";

    if (type === "integer" || type === "number") {
      // Create a small range around the default value
      const step = type === "integer" ? 1 : 0.5;
      const start = Math.max(0, defaultValue - step * 2);
      const end = defaultValue + step * 2;
      field.value = `${start}-${end}:${step}`;
    } else if (type === "boolean") {
      field.value = "true,false";
    } else if (Array.isArray(schema.enum)) {
      field.value = schema.enum.join(",");
    } else {
      field.value = String(defaultValue);
    }
  });

  alert("Parameter ranges auto-populated! Review and adjust as needed.");
}

async function applyMultiConfig(event) {
  event.preventDefault();
  const formData = new FormData(multiConfigForm);
  // Handle option_selection (can be multi-select now)
  const optionSelectionField = multiConfigForm.querySelector('[name="option_selection"]');
  let optionSelectionValues = ["both"]; // default
  if (optionSelectionField && optionSelectionField.multiple) {
    const selected = Array.from(optionSelectionField.selectedOptions).map(opt => opt.value);
    if (selected.length > 0) {
      optionSelectionValues = selected;
    }
  } else if (optionSelectionField) {
    optionSelectionValues = [formData.get("option_selection") || "both"];
  }

  const payload = {
    strategy: formData.get("strategy"),
    symbols: parseSymbolsInput(formData.get("symbols") || ""),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    starting_capital: Number(formData.get("starting_capital")),
    qty_per_point: Number(formData.get("qty_per_point")),
    max_workers: Number(formData.get("max_workers")),
    test_name: (formData.get("test_name") || "").trim() || null,
    exchange: (formData.get("exchange") || "NFO").toUpperCase(),
    interval: (formData.get("interval") || "5m"),
  };

  try {
    payload.param_ranges = collectMultiParamRanges();
    // Add option_selection to param_ranges if multiple values selected
    if (optionSelectionValues.length > 0) {
      payload.param_ranges.option_selection = optionSelectionValues;
    }
  } catch (err) {
    if (multiStatus) {
      multiStatus.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
    }
    return;
  }

  if (!payload.symbols.length) {
    if (multiStatus) {
      multiStatus.innerHTML = `<p class="muted">Error: Provide at least one symbol.</p>`;
    }
    return;
  }

  try {
    const result = await fetchJSON("/api/multi/configure", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderStatusDisplay(result.status);
  } catch (err) {
    if (multiStatus) {
      multiStatus.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
    }
  }
}

function renderStatusDisplay(status) {
  if (!multiStatus) return;
  multiStatus.innerHTML = "";

  if (!status || typeof status !== "object") {
    multiStatus.dataset.empty = "Configure or start the runner to see status.";
    return;
  }

  multiStatus.removeAttribute("data-empty");

  const items = [];

  // Runner state
  const state = status.state || "idle";
  let stateBadge = `<span class="status-badge ${state}">${state.toUpperCase()}</span>`;
  items.push({ label: "Runner State", value: stateBadge, isHtml: true });

  // Strategy
  if (status.strategy) {
    items.push({ label: "Strategy", value: status.strategy, class: "highlight" });
  }

  // Test Name / Config Name
  if (status.test_name) {
    items.push({ label: "Config Name", value: status.test_name, class: "highlight" });
  }

  // Job counts
  if (status.total_jobs !== undefined) {
    items.push({ label: "Total Jobs", value: status.total_jobs.toLocaleString() });
  }
  if (status.pending_jobs !== undefined) {
    items.push({ label: "Pending Jobs", value: status.pending_jobs.toLocaleString() });
  }
  if (status.completed_jobs !== undefined) {
    const completedClass = status.completed_jobs > 0 ? "success" : "";
    items.push({ label: "Completed Jobs", value: status.completed_jobs.toLocaleString(), class: completedClass });
  }

  // Progress percentage
  if (status.total_jobs && status.total_jobs > 0) {
    const progress = ((status.completed_jobs || 0) / status.total_jobs * 100).toFixed(1);
    items.push({ label: "Progress", value: `${progress}%`, class: "highlight" });
  }

  // Workers
  if (status.max_workers) {
    items.push({ label: "Max Workers", value: status.max_workers });
  }

  // Database stats
  if (status.database) {
    const db = status.database;
    const dbHtml = `
      <div class="status-nested">
        <div class="status-nested-title">Database Stats</div>
        ${db.total_rows !== undefined ? `<div class="status-nested-item"><span>Total Rows</span><span>${db.total_rows.toLocaleString()}</span></div>` : ""}
        ${db.table_size ? `<div class="status-nested-item"><span>Table Size</span><span>${db.table_size}</span></div>` : ""}
        ${db.index_size ? `<div class="status-nested-item"><span>Index Size</span><span>${db.index_size}</span></div>` : ""}
      </div>
    `;
    items.push({ label: "Database", value: dbHtml, isHtml: true });
  }

  // Render items
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "status-item";

    const label = document.createElement("div");
    label.className = "status-label";
    label.textContent = item.label;

    const value = document.createElement("div");
    value.className = `status-value ${item.class || ""}`;
    if (item.isHtml) {
      value.innerHTML = item.value;
    } else {
      value.textContent = item.value;
    }

    div.appendChild(label);
    div.appendChild(value);
    multiStatus.appendChild(div);
  });
}

async function updateMultiStatus() {
  try {
    const status = await fetchJSON("/api/multi/status");
    renderStatusDisplay(status);
  } catch (err) {
    if (multiStatus) {
      multiStatus.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
    }
  }
}

async function controlRunner(endpoint, button) {
  setBusy(button, true);
  try {
    const result = await fetchJSON(`/api/multi/${endpoint}`, { method: "POST" });
    renderStatusDisplay(result.status);
  } catch (err) {
    if (multiStatus) {
      multiStatus.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
    }
  } finally {
    setBusy(button, false);
  }
}

function renderHistory(batches) {
  const tbody = historyTable.querySelector("tbody");
  tbody.innerHTML = "";
  if (!batches || !batches.length) {
    const tr = document.createElement("tr");
    tr.className = "empty";
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No history yet.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  batches.forEach((batch) => {
    const tr = document.createElement("tr");

    const started = new Date(batch.started_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const ended = new Date(batch.ended_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    // Create action buttons
    const actionsCell = document.createElement("td");
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "action-buttons";

    const exportBtn = document.createElement("button");
    exportBtn.className = "action-btn secondary";
    exportBtn.textContent = "Export CSV";
    exportBtn.onclick = () => exportBatch(batch.batch_id);

    const viewBtn = document.createElement("button");
    viewBtn.className = "action-btn";
    viewBtn.textContent = "View";
    viewBtn.onclick = () => viewBatchDetails(batch.batch_id, batch.test_name);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "action-btn danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = () => deleteBatch(batch.batch_id, batch.test_name, deleteBtn);

    actionsDiv.append(exportBtn, viewBtn, deleteBtn);
    actionsCell.appendChild(actionsDiv);

    tr.innerHTML = `
      <td><strong>${batch.test_name}</strong></td>
      <td>${batch.strategy}</td>
      <td>${started}</td>
      <td>${ended}</td>
      <td>${batch.total_runs}</td>
    `;
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });
}

async function refreshHistory() {
  try {
    const batches = await fetchJSON("/api/multi/history/batches");
    renderHistory(batches);
  } catch (err) {
    if (multiStatus) {
      multiStatus.innerHTML = `<p class="muted">Error loading history: ${err.message}</p>`;
    }
  }
}

function exportBatch(batchId) {
  const url = `/api/multi/history/export?batch_id=${encodeURIComponent(batchId)}`;
  window.open(url, "_blank");
}

async function deleteBatch(batchId, testName, button) {
  if (!confirm(`Delete batch "${testName}"? This will permanently remove all ${testName} runs from the database.`)) {
    return;
  }

  setBusy(button, true);
  try {
    const result = await fetchJSON(`/api/multi/history/batch/${encodeURIComponent(batchId)}`, {
      method: "DELETE",
    });
    alert(result.message || `Deleted ${result.deleted_count} rows`);
    await refreshHistory();
  } catch (err) {
    alert(`Failed to delete batch: ${err.message}`);
  } finally {
    setBusy(button, false);
  }
}

let currentSortColumn = null;
let currentSortDirection = "asc";

function makeSortableTable(table, data, columns) {
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  if (!thead || !tbody) return;

  // Add click handlers to headers
  const headers = thead.querySelectorAll("th");
  headers.forEach((th, index) => {
    th.style.cursor = "pointer";
    th.onclick = () => sortTableByColumn(table, data, columns, index);
  });

  // Initial render
  renderSortedTable(table, data, columns);
}

function sortTableByColumn(table, data, columns, columnIndex) {
  const columnKey = columns[columnIndex].key;

  // Toggle sort direction
  if (currentSortColumn === columnIndex) {
    currentSortDirection = currentSortDirection === "asc" ? "desc" : "asc";
  } else {
    currentSortColumn = columnIndex;
    currentSortDirection = "asc";
  }

  // Sort data
  const sortedData = [...data].sort((a, b) => {
    let aVal = getNestedValue(a, columnKey);
    let bVal = getNestedValue(b, columnKey);

    // Handle null/undefined
    if (aVal == null) aVal = "";
    if (bVal == null) bVal = "";

    // Numeric comparison
    if (typeof aVal === "number" && typeof bVal === "number") {
      return currentSortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }

    // String comparison
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    if (currentSortDirection === "asc") {
      return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
    } else {
      return bStr < aStr ? -1 : bStr > aStr ? 1 : 0;
    }
  });

  renderSortedTable(table, sortedData, columns);
}

function getNestedValue(obj, key) {
  if (key.includes(".")) {
    const parts = key.split(".");
    let value = obj;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) return null;
    }
    return value;
  }
  return obj[key];
}

function renderSortedTable(table, data, columns) {
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  // Update header indicators
  const headers = thead.querySelectorAll("th");
  headers.forEach((th, index) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (index === currentSortColumn) {
      th.classList.add(currentSortDirection === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });

  // Render rows
  tbody.innerHTML = "";
  data.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const td = document.createElement("td");
      let value = getNestedValue(row, col.key);

      if (col.format) {
        value = col.format(value, row);
      } else if (value === null || value === undefined) {
        value = "—";
      } else if (typeof value === "object") {
        value = JSON.stringify(value);
      }

      // Apply cell class if specified
      if (col.cellClass) {
        const className = typeof col.cellClass === "function"
          ? col.cellClass(value, row)
          : col.cellClass;
        if (className) td.className = className;
      }

      td.innerHTML = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

async function viewBatchDetails(batchId, testName) {
  if (!batchModal || !batchModalBody || !batchModalTitle) return;

  batchModalTitle.textContent = `Batch: ${testName}`;
  batchModalBody.innerHTML = '<p class="muted">Loading batch details...</p>';
  batchModal.classList.remove("hidden");

  try {
    const rows = await fetchJSON(`/api/multi/history/batch/${encodeURIComponent(batchId)}`);

    if (!rows || rows.length === 0) {
      batchModalBody.innerHTML = '<p class="muted">No runs found in this batch.</p>';
      return;
    }

    // Flatten params and summary for table display
    const flatRows = rows.map(row => {
      const flat = {
        symbol: row.symbol,
        exchange: row.exchange,
        interval: row.interval,
        created_at: row.created_at,
      };

      // Add params
      Object.entries(row.params || {}).forEach(([key, value]) => {
        flat[`param_${key}`] = value;
      });

      // Add summary
      Object.entries(row.summary || {}).forEach(([key, value]) => {
        flat[`summary_${key}`] = value;
      });

      return flat;
    });

    // Build columns dynamically
    const allKeys = new Set();
    flatRows.forEach(row => Object.keys(row).forEach(key => allKeys.add(key)));

    const columns = Array.from(allKeys).map(key => ({
      key,
      label: humanize(key),
      format: (value) => {
        if (key === "created_at") {
          return formatTimestamp(value);
        }
        if (key.includes("rupees") || key.includes("pnl")) {
          return typeof value === "number" ? `₹${formatMoney(value)}` : value;
        }
        if (key.endsWith("_percent")) {
          return typeof value === "number" ? `${value.toFixed(2)}%` : value;
        }
        return typeof value === "number" ? formatValue(value) : value;
      },
      cellClass: (value) => {
        // Special styling for target columns
        if (key.includes("target") && !key.includes("rupees") && !key.includes("pnl")) {
          return "target-value";
        }
        // Special styling for stoploss columns
        if ((key.includes("stoploss") || key.includes("stop_loss")) && !key.includes("rupees") && !key.includes("pnl")) {
          return "stoploss-value";
        }
        // Standard profit/loss coloring
        if ((key.includes("rupees") || key.includes("pnl")) && typeof value === "number") {
          return value >= 0 ? "positive" : "negative";
        }
        return "";
      }
    }));

    // Create table
    const table = document.createElement("table");
    table.className = "sortable-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    columns.forEach(col => {
      const th = document.createElement("th");
      th.textContent = col.label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.appendChild(tbody);

    batchModalBody.innerHTML = "";
    batchModalBody.appendChild(table);

    // Make table sortable
    currentSortColumn = null;
    currentSortDirection = "asc";
    makeSortableTable(table, flatRows, columns);

  } catch (err) {
    batchModalBody.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  }
}

function closeBatchModal() {
  if (batchModal) {
    batchModal.classList.add("hidden");
    if (batchModalBody) {
      batchModalBody.innerHTML = "";
    }
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

if (batchModalClose) {
  batchModalClose.addEventListener("click", closeBatchModal);
}

if (batchModal) {
  batchModal.addEventListener("click", (event) => {
    if (event.target === batchModal) {
      closeBatchModal();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (inventoryModal && !inventoryModal.classList.contains("hidden")) {
      closeInventoryModal();
    }
    if (batchModal && !batchModal.classList.contains("hidden")) {
      closeBatchModal();
    }
  }
});

// --- Event wiring ------------------------------------------------------------

if (inventoryRefreshBtn) inventoryRefreshBtn.addEventListener("click", refreshInventory);
if (fetchForm) fetchForm.addEventListener("submit", handleFetchSubmit);
if (backtestForm) backtestForm.addEventListener("submit", handleBacktestSubmit);
if (strategySelect) {
  strategySelect.addEventListener("change", (event) => {
    const { value } = event.target;
    renderSingleStrategyParams(value);
    if (permutationStrategySelect && currentRunMode === "permutation") {
      permutationStrategySelect.value = value;
      renderPermutationParams(value);
    }
  });
}
if (permutationStrategySelect) {
  permutationStrategySelect.addEventListener("change", (event) => {
    renderPermutationParams(event.target.value);
  });
}
if (permutationForm) {
  permutationForm.addEventListener("submit", handlePermutationSubmit);
}
if (runModeButtons.length) {
  runModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode || "single";
      switchRunMode(mode);
    });
  });
}
if (multiConfigForm) multiConfigForm.addEventListener("submit", applyMultiConfig);
if (multiStartBtn) multiStartBtn.addEventListener("click", () => controlRunner("start", multiStartBtn));
if (multiPauseBtn) multiPauseBtn.addEventListener("click", () => controlRunner("pause", multiPauseBtn));
if (multiResetBtn) multiResetBtn.addEventListener("click", () => controlRunner("reset", multiResetBtn));
if (multiClearBtn) multiClearBtn.addEventListener("click", () => controlRunner("clear-results", multiClearBtn));
if (multiRefreshBtn) multiRefreshBtn.addEventListener("click", updateMultiStatus);
if (multiHistoryBtn) multiHistoryBtn.addEventListener("click", refreshHistory);
if (autoPopulateBtn) autoPopulateBtn.addEventListener("click", autoPopulateRanges);
if (multiStrategySelect) {
  multiStrategySelect.addEventListener("change", (event) => {
    renderMultiParamFields(event.target.value);
  });
}

// --- Initial load ------------------------------------------------------------

switchRunMode(currentRunMode);

loadSingleStrategies()
  .then(() => refreshInventory())
  .catch((err) => {
    if (fetchResult) {
      setOutput(fetchResult, `Error: ${err.message}`);
    }
  });

// Initialize chips for option_selection in multi-config form
if (multiConfigForm) {
  setTimeout(() => {
    initializeMultiSelectChips(multiConfigForm);
  }, 100);
}

loadMultiStrategies()
  .then(() => Promise.all([updateMultiStatus(), refreshHistory()]))
  .catch((err) => setOutput(multiStatus, `Error: ${err.message}`));
