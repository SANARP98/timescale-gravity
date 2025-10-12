const inventoryBox = document.getElementById("inventory-box");
const inventoryRefresh = document.getElementById("inventory-refresh");
const fetchForm = document.getElementById("fetch-form");
const fetchResultBox = document.getElementById("fetch-result");
const backtestForm = document.getElementById("backtest-form");
const backtestMessage = document.getElementById("backtest-message");
const backtestSummaryBox = document.getElementById("backtest-summary");
const tradesTabs = document.querySelectorAll(".tab-button");
const tradesPanels = document.querySelectorAll(".tab-panel");
const tradesRecentPanel = document.getElementById("trades-recent");
const tradesAllPanel = document.getElementById("trades-all");
const dailyChartCanvas = document.getElementById("daily-chart");
const dailyChartPlaceholder = document.getElementById("daily-chart-empty");
const dailyStatsTable = document.getElementById("daily-stats-table");
const toastContainer = document.getElementById("toast-container");
const copyTradesBtn = document.getElementById("copy-trades-btn");
const backtestOutputCard = document.getElementById("backtest-output-card");
const dataViewerModal = document.getElementById("data-viewer-modal");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalTableContainer = document.getElementById("modal-table-container");
const modalChartContainer = document.getElementById("modal-chart-container");
const modalCandlestickCanvas = document.getElementById("modal-candlestick-chart");
const modalCloseBtn = document.getElementById("modal-close-btn");


let dailyChart = null;
let currentInventorySort = "asc";
let modalChart = null;

function setButtonLoading(button, isLoading, loadingText = "Loading...") {
  if (!button) return;
  const textEl = button.querySelector(".btn-text");
  const spinnerEl = button.querySelector(".btn-spinner");

  if (isLoading) {
    if (textEl) {
      if (!button.dataset.originalText) {
        button.dataset.originalText = textEl.textContent || "";
      }
      textEl.textContent = loadingText;
    }
    if (spinnerEl) {
      spinnerEl.classList.remove("hidden");
    }
    button.disabled = true;
  } else {
    if (textEl) {
      const original = button.dataset.originalText || textEl.textContent || "";
      textEl.textContent = original;
    }
    if (spinnerEl) {
      spinnerEl.classList.add("hidden");
    }
    button.disabled = false;
    if (button.dataset.originalText) {
      delete button.dataset.originalText;
    }
  }
}

function showToast(message, type = "info", duration = 5000) {
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  const hide = () => {
    toast.classList.remove("visible");
    toast.classList.add("hide");
    setTimeout(() => {
      toast.remove();
    }, 250);
  };

  setTimeout(hide, duration);

  toast.addEventListener("click", hide, { once: true });
}

function toPayload(form) {
  const payload = {};
  const formData = new FormData(form);
  for (const [name, value] of formData.entries()) {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
      if (value !== "") {
        payload[name] = value;
      }
      continue;
    }
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      payload[name] = true;
    } else if (value !== "") {
      payload[name] = value;
    }
  }

  Array.from(form.elements)
    .filter(
      (el) =>
        el instanceof HTMLInputElement &&
        el.type === "checkbox" &&
        !(el.name in payload)
    )
    .forEach((checkbox) => {
      payload[checkbox.name] = checkbox.checked;
    });

  return payload;
}

function setStatus(element, message, isError = false) {
  element.classList.remove("status-success", "status-error");
  element.textContent = message;
  if (isError) {
    element.classList.add("status-error");
  } else {
    element.classList.add("status-success");
  }
}

function renderMetrics(summary) {
  const metrics = [
    ["total_trades", "Trades"],
    ["wins", "Wins"],
    ["losses", "Losses"],
    ["winrate_percent", "Winrate %", (val) => val.toFixed(2)],
    ["net_rupees", "Net ₹", formatMoney],
    ["gross_rupees", "Gross ₹", formatMoney],
    ["costs_rupees", "Costs ₹", formatMoney],
    ["roi_percent", "ROI %", (val) => val.toFixed(2)],
    ["max_drawdown", "Max DD ₹", formatMoney],
    ["avg_win", "Avg Win ₹", formatMoney],
    ["avg_loss", "Avg Loss ₹", formatMoney],
    ["risk_reward", "Risk:Reward", (val) => val.toFixed(2)],
  ];

  const items = metrics
    .filter(([key]) => key in summary)
    .map(([key, label, formatter]) => {
      const raw = summary[key];
      const numeric = Number(raw);
      let value =
        typeof formatter === "function"
          ? formatter(Number(raw))
          : typeof raw === "number"
          ? Number(raw).toLocaleString()
          : raw;

      if (value === undefined || value === null || value === "") {
        value = "—";
      }

      let metricClass = "";
      if (Number.isFinite(numeric)) {
        if (key === "net_rupees" || key === "roi_percent") {
          metricClass = numeric > 0 ? "positive" : numeric < 0 ? "negative" : "";
        } else if (key === "avg_win") {
          metricClass = numeric > 0 ? "positive" : "";
        } else if (key === "avg_loss" || key === "max_drawdown") {
          metricClass = numeric < 0 ? "negative" : "";
        } else if (key === "gross_rupees") {
          metricClass = numeric > 0 ? "positive" : "";
        } else if (key === "costs_rupees") {
          metricClass = numeric > 0 ? "negative" : "";
        } else if (key === "wins") {
          metricClass = numeric > 0 ? "positive" : "";
        } else if (key === "losses") {
          metricClass = numeric > 0 ? "negative" : "";
        } else if (key === "winrate_percent") {
          metricClass = numeric >= 50 ? "positive" : numeric > 0 ? "negative" : "";
        }
      }

      if (value !== "—" && (key.includes("rupees") || key === "avg_win" || key === "avg_loss" || key === "max_drawdown")) {
        value = `₹${value}`;
      }

      const valueClass = metricClass ? `value ${metricClass}` : "value";
      const itemClass = metricClass ? `metric-${metricClass}` : "";
      return `<li class="${itemClass}"><span class="label">${label}</span><span class="${valueClass}">${value}</span></li>`;
    })
    .join("");

  return `<ul class="metrics-grid">${items}</ul>`;
}

function renderExitReasons(exitCounts) {
  if (!exitCounts || Object.keys(exitCounts).length === 0) {
    return "";
  }
  const rows = Object.entries(exitCounts)
    .map(
      ([reason, count]) =>
        `<tr><td>${reason}</td><td>${count}</td></tr>`
    )
    .join("");
  return `
    <h3>Exit Reasons</h3>
    <table>
      <thead>
        <tr><th>Reason</th><th>Count</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderTrades(trades, heading) {
  if (!trades || trades.length === 0) {
    return "";
  }
  const headers = Object.keys(trades[0]);
  const thead = headers
    .map((header) => `<th>${header.replace(/_/g, " ")}</th>`)
    .join("");
  const rows = trades
    .map((trade) => {
      const cells = headers
        .map((header) => {
          const value = trade[header];
          let formatted = value;
          let cellClass = "";

          if (header.includes("time")) {
            formatted = formatTimestamp(value);
          } else if (typeof value === "number") {
            formatted = formatValue(value);
            if (header === "pnl_rupees") {
              const numeric = Number(value);
              if (!Number.isNaN(numeric)) {
                cellClass = numeric >= 0 ? "positive" : "negative";
              }
            }
            if (header.endsWith("rupees")) {
              formatted = `₹${formatted}`;
            }
          } else if (header.endsWith("rupees") && value !== null && value !== undefined && value !== "") {
            formatted = `₹${formatValue(value)}`;
          } else if (value === null || value === undefined) {
            formatted = "";
          }

          return `<td${cellClass ? ` class="${cellClass}"` : ""}>${formatted}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `
    ${heading ? `<h3>${heading}</h3>` : ""}
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderTradesPanel(panel, trades, heading) {
  if (!panel) return;
  panel.innerHTML = "";
  if (!trades || trades.length === 0) {
    panel.textContent = "No trades available for the selected window.";
    return;
  }
  panel.innerHTML = renderTrades(trades, heading);
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
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clearStatusClasses(element) {
  element.classList.remove("status-success", "status-error");
}

function toDateInputValue(timestamp) {
  if (!timestamp) return "";
  if (typeof timestamp !== "string") {
    return "";
  }
  const [datePart] = timestamp.split("T");
  return datePart || "";
}

function setFormValue(form, name, value) {
  if (!form) return;
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement
  ) {
    field.value = value ?? "";
  }
}

function populateFormsFromInventory(item) {
  if (!item) return;
  const { symbol, exchange, interval, startTs, endTs } = item;
  const startDate = toDateInputValue(startTs);
  const endDate = toDateInputValue(endTs);

  if (fetchForm) {
    setFormValue(fetchForm, "symbol", symbol);
    setFormValue(fetchForm, "exchange", exchange);
    setFormValue(fetchForm, "interval", interval);
    const fetchStart = toDateInputValue(endTs) || startDate;
    setFormValue(fetchForm, "start_date", fetchStart);
    setFormValue(fetchForm, "end_date", endDate || fetchStart);
    if (fetchResultBox) {
      clearStatusClasses(fetchResultBox);
      fetchResultBox.textContent =
        endDate
          ? `Prefilled using TimescaleDB coverage (${fetchStart} → ${endDate}).`
          : "Prefilled using TimescaleDB coverage.";
    }
  }

  if (backtestForm) {
    setFormValue(backtestForm, "symbol", symbol);
    setFormValue(backtestForm, "exchange", exchange);
    setFormValue(backtestForm, "interval", interval);
    setFormValue(backtestForm, "option_selection", "both");
    if (startDate) setFormValue(backtestForm, "start_date", startDate);
    if (endDate) setFormValue(backtestForm, "end_date", endDate);
    if (backtestMessage) {
      clearStatusClasses(backtestMessage);
      backtestMessage.textContent =
        startDate && endDate
          ? `Ready to backtest ${symbol} ${interval} (${startDate} → ${endDate}).`
          : `Ready to backtest ${symbol} ${interval}.`;
    }
  }
}

function renderInventoryTable(items, sortOrder = "asc") {
  if (!items || items.length === 0) {
    return "";
  }

  const sortIcon = sortOrder === "asc"
    ? '<span class="sort-arrow sort-asc">▲</span>'
    : '<span class="sort-arrow sort-desc">▼</span>';

  const rows = items
    .map(
      (item) => `
      <tr>
        <td>${item.symbol}</td>
        <td>${item.exchange}</td>
        <td>${item.interval}</td>
        <td>${Number(item.rows_count).toLocaleString()}</td>
        <td>${formatTimestamp(item.start_ts)}</td>
        <td>${formatTimestamp(item.end_ts)}</td>
        <td>
          <div class="table-actions-group">
            <button
              type="button"
              class="table-action"
              data-action="use"
              data-symbol="${item.symbol}"
              data-exchange="${item.exchange}"
              data-interval="${item.interval}"
              data-start-ts="${item.start_ts ?? ""}"
              data-end-ts="${item.end_ts ?? ""}"
            >
              Use in forms
            </button>
            <button
              type="button"
              class="table-action-icon"
              title="View Data"
              data-action="view"
              data-symbol="${item.symbol}"
              data-exchange="${item.exchange}"
              data-interval="${item.interval}"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </button>
            <button
              type="button"
              class="table-action-delete"
              data-action="delete"
              data-symbol="${item.symbol}"
              data-exchange="${item.exchange}"
              data-interval="${item.interval}"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>`
    )
    .join("");
  return `
    <table>
      <thead>
        <tr>
          <th class="sortable-header" data-sort-order="${sortOrder}">
            <span class="header-content">Symbol ${sortIcon}</span>
          </th>
          <th>Exchange</th>
          <th>Interval</th>
          <th>Bars</th>
          <th>First Bar (IST)</th>
          <th>Last Bar (IST)</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function clearTradesPanels() {
  if (tradesRecentPanel) tradesRecentPanel.innerHTML = "";
  if (tradesAllPanel) tradesAllPanel.innerHTML = "";
}

function clearBacktestOutput() {
  if (backtestSummaryBox) backtestSummaryBox.innerHTML = "";
  clearTradesPanels();
  resetDailyVisuals();
  if (copyTradesBtn) copyTradesBtn.classList.add("hidden");
  document.body.classList.remove("roi-positive", "roi-negative");
  document.body.style.removeProperty("--roi-intensity");
}

function resetDailyVisuals() {
  if (dailyChart) {
    dailyChart.destroy();
    dailyChart = null;
  }
  if (dailyChartCanvas) {
    const ctx = dailyChartCanvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, dailyChartCanvas.width, dailyChartCanvas.height);
    }
    dailyChartCanvas.classList.add("hidden");
  }
  if (dailyChartPlaceholder) {
    dailyChartPlaceholder.textContent = "Run a backtest to visualize daily performance.";
  }
  if (dailyStatsTable) {
    dailyStatsTable.innerHTML = "";
  }
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
  const data = stats.map((item) => Number(item.net_pnl) || 0);

  // Calculate cumulative P&L
  let cumulative = 0;
  const cumulativeData = data.map((value) => {
    cumulative += value;
    return cumulative;
  });

  const backgroundColors = data.map((value) =>
    value >= 0 ? "rgba(88, 181, 255, 0.65)" : "rgba(255, 118, 132, 0.65)"
  );
  const borderColors = data.map((value) =>
    value >= 0 ? "rgba(88, 181, 255, 0.95)" : "rgba(255, 118, 132, 0.95)"
  );

  dailyChartCanvas.classList.remove("hidden");
  const parentWidth = dailyChartCanvas.parentElement
    ? dailyChartCanvas.parentElement.clientWidth
    : 600;
  dailyChartCanvas.height = 400;
  dailyChartCanvas.width = Math.max(parentWidth, 320);
  dailyChart = new Chart(dailyChartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Daily P&L",
          data,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 1,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line",
          label: "Cumulative P&L",
          data: cumulativeData,
          borderColor: "rgba(111, 255, 181, 1)",
          backgroundColor: "rgba(111, 255, 181, 0.1)",
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "rgba(111, 255, 181, 1)",
          pointBorderColor: "#0b0d17",
          pointBorderWidth: 2,
          tension: 0.3,
          fill: true,
          yAxisID: "y",
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
          type: "linear",
          display: true,
          position: "left",
          grid: {
            color: "rgba(80, 92, 134, 0.2)",
          },
          ticks: {
            color: "rgba(197, 205, 224, 0.85)",
            font: {
              size: 11,
            },
            callback: (value) =>
              "₹" + Number(value).toLocaleString("en-IN", {
                maximumFractionDigits: 0,
              }),
          },
        },
        x: {
          grid: {
            color: "rgba(80, 92, 134, 0.1)",
          },
          ticks: {
            color: "rgba(197, 205, 224, 0.85)",
            font: {
              size: 11,
            },
            maxRotation: 45,
            minRotation: 0,
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: {
            color: "rgba(197, 205, 224, 0.95)",
            font: {
              size: 12,
              weight: "600",
            },
            padding: 15,
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        tooltip: {
          backgroundColor: "rgba(18, 21, 34, 0.95)",
          titleColor: "#f5f7ff",
          bodyColor: "#c5cde0",
          borderColor: "rgba(80, 92, 134, 0.5)",
          borderWidth: 1,
          padding: 12,
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

  if (!stats || stats.length === 0) {
    dailyStatsTable.innerHTML = "";
    return;
  }

  const rows = stats
    .map((item) => {
      const net = Number(item.net_pnl) || 0;
      const rowClass = net > 0 ? "positive" : net < 0 ? "negative" : "";
      const netDisplay = formatMoney(net) || "0.00";
      const winsClass = Number(item.wins) > 0 ? "positive" : "";
      const lossesClass = Number(item.losses) > 0 ? "negative" : "";
      return `
        <tr class="${rowClass}">
          <td>${item.date_label || item.date}</td>
          <td class="${rowClass}">₹${netDisplay}</td>
          <td>${item.trades}</td>
          <td class="${winsClass}">${item.wins}</td>
          <td class="${lossesClass}">${item.losses}</td>
        </tr>
      `;
    })
    .join("");

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

function setActiveTab(target) {
  const targetId = `trades-${target}`;
  tradesTabs.forEach((button) => {
    const isActive = button.dataset.tabTarget === target;
    button.classList.toggle("active", isActive);
  });
  tradesPanels.forEach((panel) => {
    const shouldShow = panel.id === targetId;
    panel.classList.toggle("hidden", !shouldShow);
  });
}

function setupCollapsibles() {
  document.querySelectorAll(".collapsible").forEach((section) => {
    const trigger = section.querySelector(".collapsible-trigger");
    const content = section.querySelector(".collapsible-content");
    const icon = section.querySelector(".collapse-icon");
    if (!trigger || !content) return;

    if (section.classList.contains("open")) {
      content.style.maxHeight = `${content.scrollHeight}px`;
      if (icon) icon.textContent = "▲";
    }

    trigger.addEventListener("click", () => {
      const isOpen = section.classList.toggle("open");
      if (isOpen) {
        content.style.maxHeight = `${content.scrollHeight}px`;
        if (icon) icon.textContent = "▲";
      } else {
        content.style.maxHeight = null;
        if (icon) icon.textContent = "▼";
      }
    });
  });
}

async function loadInventory(sortOrder = "asc") {
  if (!inventoryBox) return;
  clearStatusClasses(inventoryBox);
  inventoryBox.textContent = "Loading...";
  currentInventorySort = sortOrder;
  try {
    const response = await fetch(`/inventory?sort_order=${sortOrder}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to load inventory.");
    }
    const items = await response.json();
    if (!items || items.length === 0) {
      inventoryBox.textContent = "No TimescaleDB data yet. Ingest a slice to see coverage.";
      return;
    }
    inventoryBox.innerHTML = renderInventoryTable(items, sortOrder);
    const section = inventoryBox.closest(".collapsible");
    const content = section?.querySelector(".collapsible-content");
    if (section && section.classList.contains("open") && content) {
      content.style.maxHeight = `${content.scrollHeight}px`;
    }
  } catch (error) {
    inventoryBox.textContent = `Error loading inventory: ${error.message}`;
    inventoryBox.classList.add("status-error");
  }
}

async function deleteInventoryItem(symbol, exchange, interval) {
  if (!confirm(`Are you sure you want to delete all data for ${symbol} ${exchange} ${interval}?\n\nThis action cannot be undone!`)) {
    return;
  }

  try {
    const response = await fetch(`/inventory/${encodeURIComponent(symbol)}/${encodeURIComponent(exchange)}/${encodeURIComponent(interval)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to delete data.");
    }

    const data = await response.json();
    showToast(`✅ ${data.message}`, "success");

    await loadInventory(currentInventorySort);
  } catch (error) {
    showToast(`❌ ${error.message}`, "error");
  }
}

async function handleFetchSubmit(event) {
  event.preventDefault();
  const payload = toPayload(fetchForm);
  const submitBtn = fetchForm.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true, "Fetching...");
  setStatus(fetchResultBox, "Submitting request to OpenAlgo...", false);

  try {
    const response = await fetch("/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Fetch request failed.");
    }

    const data = await response.json();
    setStatus(
      fetchResultBox,
      `✅ Upserted ${data.rows_upserted} rows into TimescaleDB.`,
      false
    );
    showToast(`Upserted ${data.rows_upserted} rows into TimescaleDB.`, "success");
    await loadInventory(currentInventorySort);
  } catch (error) {
    setStatus(fetchResultBox, `❌ ${error.message}`, true);
    showToast(`❌ ${error.message}`, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function handleBacktestSubmit(event) {
  event.preventDefault();
  const payload = toPayload(backtestForm);
  const submitBtn = backtestForm.querySelector('button[type="submit"]');
  setButtonLoading(submitBtn, true, "Running...");
  setStatus(backtestMessage, "Running backtest from TimescaleDB...", false);  
  clearBacktestOutput();

  try {
    const response = await fetch("/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Backtest failed.");
    }

    const data = await response.json();
    setStatus(backtestMessage, "✅ Backtest completed successfully!", false);
    showToast("Backtest completed successfully!", "success");

    if (Array.isArray(data.fetch_events) && data.fetch_events.length) {
      data.fetch_events.forEach((event) => {
        const range = `${event.start_date} → ${event.end_date}`;
        const rowsValue = Number(event.rows_upserted || 0);
        const rowsText = rowsValue
          ? `${rowsValue.toLocaleString()} rows`
          : "no new rows";
        showToast(`Auto-fetched ${event.symbol} for ${range} (${rowsText}).`, "info", 6500);
      });
    }

    if (data.output_csv) {
      backtestMessage.innerHTML += `<br><span class="status-success">📁 Saved CSV: ${data.output_csv}</span>`;
    }

    if (data.summary) {
      backtestSummaryBox.innerHTML = `
        ${renderMetrics(data.summary)}
        ${renderExitReasons(data.summary.exit_reason_counts)}
      `;

      // Add the background glow based on ROI
      if (data.summary.roi_percent) {
        const roi = Number(data.summary.roi_percent);
        // Calculate intensity, capping at 1. A 50% ROI gives max intensity.
        const intensity = Math.min(Math.abs(roi) / 50, 1);

        document.body.style.setProperty("--roi-intensity", intensity);

        if (roi > 0) {
          document.body.classList.add("roi-positive");
        } else if (roi < 0) {
          document.body.classList.add("roi-negative");
        }
      }
    }

    const recentTrades = data.trades_tail || [];
    const allTrades = data.trades_all || [];

    renderTradesPanel(
      tradesRecentPanel,
      recentTrades,
      `Last ${recentTrades.length} Trades`
    );
    renderTradesPanel(
      tradesAllPanel,
      allTrades,
      `All Trades (${allTrades.length})`
    );

    renderDailyChart(data.daily_stats || []);
    renderDailyStatsTable(data.daily_stats || []);
    setActiveTab("recent");

    if (copyTradesBtn && allTrades.length > 0) {
      copyTradesBtn.classList.remove("hidden");
      copyTradesBtn.onclick = () => copyTradesToClipboard(allTrades);
    }
  } catch (error) {
    setStatus(backtestMessage, `❌ ${error.message}`, true);
    showToast(`❌ ${error.message}`, "error");
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

function copyTradesToClipboard(trades) {
  if (!trades || trades.length === 0) {
    showToast("No trades to copy.", "info");
    return;
  }
  try {
    const headers = Object.keys(trades[0]);
    const headerRow = headers.join("\t");
    const rows = trades.map(trade => 
      headers.map(header => String(trade[header] ?? "")).join("\t")
    );
    const tsvContent = [headerRow, ...rows].join("\n");

    navigator.clipboard.writeText(tsvContent);
    showToast(`✅ Copied ${trades.length} trades to clipboard.`, "success");
  } catch (error) {
    console.error("Failed to copy trades:", error);
    showToast("❌ Failed to copy trades to clipboard.", "error");
  }
}

if (fetchForm) {
  fetchForm.addEventListener("submit", handleFetchSubmit);
}

if (backtestForm) {
  backtestForm.addEventListener("submit", handleBacktestSubmit);
}

if (inventoryRefresh) {
  inventoryRefresh.addEventListener("click", async () => {
    setButtonLoading(inventoryRefresh, true, "Refreshing...");
    try {
      await loadInventory(currentInventorySort);
      showToast("Inventory refreshed", "info", 3500);
    } catch (error) {
      showToast(`❌ ${error.message}`, "error");
    } finally {
      setButtonLoading(inventoryRefresh, false);
    }
  });
}

function setupModal() {
  if (!dataViewerModal || !modalCloseBtn) return;

  const closeModal = () => {
    dataViewerModal.classList.add("hidden");
    if (modalTableContainer) modalTableContainer.innerHTML = ""; // Clear content on close
    if (modalChart) {
      modalChart.destroy();
      modalChart = null;
    }
  };

  modalCloseBtn.addEventListener("click", closeModal);
  dataViewerModal.addEventListener("click", (event) => {
    if (event.target === dataViewerModal) {
      closeModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dataViewerModal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

function renderModalTable(data) {
  if (!data || data.length === 0) {
    return "<p>No data to display.</p>";
  }
  const headers = Object.keys(data[0]);
  const thead = headers.map(h => `<th>${h}</th>`).join("");
  const rows = data.map(row => {
    const cells = headers.map(h => {
      let value = row[h];
      if (value === null || value === undefined) {
        value = "–";
      } else if (h === 'ts') {
        value = formatTimestamp(value);
      } else if (typeof value === 'number') {
        value = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      return `<td>${value}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return `<table><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderModalCandlestickChart(data) {
  if (modalChart) {
    modalChart.destroy();
    modalChart = null;
  }
  if (!modalCandlestickCanvas || !data || data.length === 0) return;

  const chartData = data.map(d => ({
    x: new Date(d.ts).valueOf(),
    o: d.open,
    h: d.high,
    l: d.low,
    c: d.close,
  }));

  modalChart = new Chart(modalCandlestickCanvas, {
    type: 'candlestick',
    data: {
      datasets: [{
        label: 'OHLC',
        data: chartData,
        color: {
          up: '#6fffb5',
          down: '#ff8b8b',
          unchanged: '#c5cde0',
        },
        borderColor: {
          up: '#6fffb5',
          down: '#ff8b8b',
          unchanged: '#c5cde0',
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute',
            tooltipFormat: 'MMM dd, yyyy HH:mm',
            displayFormats: {
              minute: 'HH:mm',
              hour: 'MMM dd HH:mm',
            }
          },
          grid: { color: "rgba(80, 92, 134, 0.1)" },
          ticks: { color: "rgba(197, 205, 224, 0.85)", font: { size: 11 } },
        },
        y: {
          grid: { color: "rgba(80, 92, 134, 0.2)" },
          ticks: { color: "rgba(197, 205, 224, 0.85)", font: { size: 11 } },
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(18, 21, 34, 0.95)",
          titleColor: "#f5f7ff",
          bodyColor: "#c5cde0",
          borderColor: "rgba(80, 92, 134, 0.5)",
          borderWidth: 1,
        }
      }
    }
  });
}

async function showDataViewer(symbol, exchange, interval) {
  if (!dataViewerModal || !modalTitle || !modalTableContainer) return;

  modalTitle.textContent = `Data for: ${symbol} ${exchange} ${interval}`;
  modalTableContainer.innerHTML = `<p class="muted" style="text-align: center; padding: 2rem;">Loading data...</p>`;
  dataViewerModal.classList.remove("hidden");

  try {
    const response = await fetch(`/data/${encodeURIComponent(symbol)}/${encodeURIComponent(exchange)}/${encodeURIComponent(interval)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Failed to load data."}));
      throw new Error(err.detail);
    }
    const data = await response.json();
    modalTableContainer.innerHTML = renderModalTable(data);
    renderModalCandlestickChart(data);
  } catch (error) {
    modalTableContainer.innerHTML = `<p class="status-error" style="text-align: center; padding: 2rem;">Error: ${error.message}</p>`;
    showToast(`❌ Could not load data: ${error.message}`, "error");
  }
}

if (inventoryBox) {
  inventoryBox.addEventListener("click", (event) => {
    // Check if clicked on sortable header
    const sortHeader = event.target.closest(".sortable-header");
    if (sortHeader) {
      const currentSort = sortHeader.dataset.sortOrder || "asc";
      const newSort = currentSort === "asc" ? "desc" : "asc";
      currentInventorySort = newSort;
      loadInventory(newSort);
      return;
    }

    // Check if clicked on action button
    const button = event.target.closest("button[data-symbol]");
    if (!button) return;

    const action = button.dataset.action;
    const symbol = button.dataset.symbol || "";
    const exchange = button.dataset.exchange || "";
    const interval = button.dataset.interval || "";

    if (action === "delete") {
      deleteInventoryItem(symbol, exchange, interval);
    } else if (action === "use") {
      populateFormsFromInventory({
        symbol,
        exchange,
        interval,
        startTs: button.dataset.startTs || "",
        endTs: button.dataset.endTs || "",
      });
    } else if (action === "view") {
      showDataViewer(symbol, exchange, interval);
    }
  });
}

if (tradesTabs.length > 0) {
  tradesTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget || "recent");
    });
  });
  setActiveTab("recent");
}

loadInventory(currentInventorySort);
setupCollapsibles();
setupModal();
