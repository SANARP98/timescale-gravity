const inventoryBox = document.getElementById("inventory-box");
const inventoryRefresh = document.getElementById("inventory-refresh");
const fetchForm = document.getElementById("fetch-form");
const fetchResultBox = document.getElementById("fetch-result");
const backtestForm = document.getElementById("backtest-form");
const backtestMessage = document.getElementById("backtest-message");
const backtestSummaryBox = document.getElementById("backtest-summary");
const backtestTradesBox = document.getElementById("backtest-trades");

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

function renderTrades(trades) {
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
        .map((header) => `<td>${formatValue(trade[header])}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `
    <h3>Last ${trades.length} Trades</h3>
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-IN", {
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
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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
  backtestTradesBox.innerHTML = "";

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

    if (data.trades_tail && data.trades_tail.length > 0) {
      backtestTradesBox.innerHTML = renderTrades(data.trades_tail);
    } else {
      backtestTradesBox.textContent = "No trades produced for the selected window.";
    }
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

loadInventory();
