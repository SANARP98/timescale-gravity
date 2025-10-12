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
const dailyChartImage = document.getElementById("daily-chart-image");
const dailyChartPlaceholder = document.getElementById("daily-chart-empty");
const dailyStatsTable = document.getElementById("daily-stats-table");

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
      const value =
        typeof formatter === "function"
          ? formatter(Number(raw))
          : typeof raw === "number"
          ? Number(raw).toLocaleString()
          : raw;
      return `<li><span class="label">${label}</span><span class="value">${value}</span></li>`;
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

function renderInventoryTable(items) {
  if (!items || items.length === 0) {
    return "";
  }
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
          <button
            type="button"
            class="table-action"
            data-symbol="${item.symbol}"
            data-exchange="${item.exchange}"
            data-interval="${item.interval}"
            data-start-ts="${item.start_ts ?? ""}"
            data-end-ts="${item.end_ts ?? ""}"
          >
            Use in forms
          </button>
        </td>
      </tr>`
    )
    .join("");
  return `
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
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

function resetDailyVisuals() {
  if (dailyChartImage) {
    dailyChartImage.classList.add("hidden");
    dailyChartImage.src = "";
  }
  if (dailyChartPlaceholder) {
    dailyChartPlaceholder.textContent = "Run a backtest to visualize daily performance.";
  }
  if (dailyStatsTable) {
    dailyStatsTable.innerHTML = "";
  }
}

function renderDailyChart(stats) {
  if (!dailyChartImage) {
    return;
  }

  if (!stats || stats.length === 0) {
    if (dailyChartImage) {
      dailyChartImage.classList.add("hidden");
      dailyChartImage.src = "";
    }
    if (dailyChartPlaceholder) dailyChartPlaceholder.textContent = "No trades to chart.";
    return;
  }

  const labels = stats.map((item) => item.date_label || item.date);
  const data = stats.map((item) => Number(item.net_pnl) || 0);
  const backgroundColors = data.map((value) =>
    value >= 0 ? "rgba(88, 181, 255, 0.65)" : "rgba(255, 118, 132, 0.65)"
  );
  const borderColors = data.map((value) =>
    value >= 0 ? "rgba(88, 181, 255, 0.95)" : "rgba(255, 118, 132, 0.95)"
  );

  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = Math.max(480, labels.length * 60);
  offscreenCanvas.height = 260;
  const ctx = offscreenCanvas.getContext("2d");
  if (!ctx || typeof Chart === "undefined") {
    return;
  }

  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Net P&L (₹)",
          data,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      scales: {
        y: {
          ticks: {
            callback: (value) =>
              Number(value).toLocaleString("en-IN", {
                maximumFractionDigits: 0,
              }),
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  });

  const pngDataUrl = offscreenCanvas.toDataURL("image/png");
  dailyChartImage.src = pngDataUrl;
  dailyChartImage.classList.remove("hidden");
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
      const rowClass = net >= 0 ? "positive" : "negative";
      return `
        <tr class="${rowClass}">
          <td>${item.date_label || item.date}</td>
          <td>${formatMoney(net)}</td>
          <td>${item.trades}</td>
          <td>${item.wins}</td>
          <td>${item.losses}</td>
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

async function loadInventory() {
  if (!inventoryBox) return;
  clearStatusClasses(inventoryBox);
  inventoryBox.textContent = "Loading...";
  try {
    const response = await fetch("/inventory");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to load inventory.");
    }
    const items = await response.json();
    if (!items || items.length === 0) {
      inventoryBox.textContent = "No TimescaleDB data yet. Ingest a slice to see coverage.";
      return;
    }
    inventoryBox.innerHTML = renderInventoryTable(items);
  } catch (error) {
    inventoryBox.textContent = `Error loading inventory: ${error.message}`;
    inventoryBox.classList.add("status-error");
  }
}

async function handleFetchSubmit(event) {
  event.preventDefault();
  const payload = toPayload(fetchForm);
  setStatus(fetchResultBox, "Submitting...", false);

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
    await loadInventory();
  } catch (error) {
    setStatus(fetchResultBox, `❌ ${error.message}`, true);
  }
}

async function handleBacktestSubmit(event) {
  event.preventDefault();
  const payload = toPayload(backtestForm);
  setStatus(backtestMessage, "Running backtest...", false);
  backtestSummaryBox.innerHTML = "";
  clearTradesPanels();
  resetDailyVisuals();

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
    setStatus(backtestMessage, "Backtest completed successfully.", false);

    if (data.output_csv) {
      backtestMessage.innerHTML += `<br><span class="status-success">📁 Saved CSV: ${data.output_csv}</span>`;
    }

    if (data.summary) {
      backtestSummaryBox.innerHTML = `
        ${renderMetrics(data.summary)}
        ${renderExitReasons(data.summary.exit_reason_counts)}
      `;
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
  } catch (error) {
    setStatus(backtestMessage, `❌ ${error.message}`, true);
  }
}

if (fetchForm) {
  fetchForm.addEventListener("submit", handleFetchSubmit);
}

if (backtestForm) {
  backtestForm.addEventListener("submit", handleBacktestSubmit);
}

if (inventoryRefresh) {
  inventoryRefresh.addEventListener("click", () => {
    loadInventory();
  });
}

if (inventoryBox) {
  inventoryBox.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-symbol]");
    if (!button) return;
    populateFormsFromInventory({
      symbol: button.dataset.symbol || "",
      exchange: button.dataset.exchange || "",
      interval: button.dataset.interval || "",
      startTs: button.dataset.startTs || "",
      endTs: button.dataset.endTs || "",
    });
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

loadInventory();
