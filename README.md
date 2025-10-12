# Timescale Gravity 🚀

A professional backtesting platform for options trading strategies, powered by TimescaleDB and OpenAlgo. Test your Scalp-with-Trend strategy on historical data with PE/CE option pairs, featuring an intuitive web interface for data management and performance analysis.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-2.13+-orange.svg)

## ✨ Key Features

### 📊 Intelligent Data Management
- **Automatic PE/CE Pair Fetching**: Enter any option symbol (PE or CE) and automatically fetch both option types
- **Smart Gap Detection**: Only fetches missing date ranges, avoiding redundant API calls
- **TimescaleDB Storage**: High-performance time-series database optimized for OHLCV data
- **Interactive Inventory Management**: Sort (ascending/descending), delete, and manage stored data
- **One-Click Form Population**: Quickly reuse existing data for backtests

### 🎯 Advanced Backtesting Engine
- **Scalp-with-Trend Strategy**: Multi-bar hold intraday strategy with EMA crossovers and ATR filters
- **Flexible Option Selection**: Run backtests on:
  - **PE Only**: Test Put options independently
  - **CE Only**: Test Call options independently
  - **Both (PE + CE)**: Run simultaneous backtests with combined P&L
- **Comprehensive Trade Tracking**: Each trade tagged with symbol for detailed analysis
- **Configurable Parameters**: 20+ adjustable strategy parameters
- **Risk Management**: Daily loss caps, EOD square-off, and multiple exit scenarios
- **Realistic Execution**: Includes slippage and brokerage costs

### 📈 Rich Visualization & Analytics
- **Dual-View Charts**: Combined bar + line chart showing:
  - Daily P&L bars (green for profit, red for loss)
  - Cumulative P&L line (track overall performance curve)
- **Performance Dashboard**: 12+ key metrics including:
  - Win rate, ROI, Max Drawdown
  - Risk:Reward ratio, Average Win/Loss
  - Exit reason breakdown
- **Trade Journal**: Detailed trade-by-trade analysis with:
  - Entry/exit times and prices
  - Symbol identification (PE vs CE)
  - P&L per trade with costs breakdown
- **Daily Breakdown**: Performance statistics grouped by trading day

### 💎 Modern User Interface
- **Professional Dark Theme**: Easy on the eyes for long sessions
- **Single Column Layout**: Clean, focused workflow
- **Collapsible Advanced Options**: Hide complexity until needed
- **Real-time Feedback**: Loading spinners, progress indicators, and status messages
- **Sortable Tables**: Click column headers to sort data
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Configuration](#️-configuration)
- [Usage Guide](#-usage-guide)
- [API Documentation](#-api-documentation)
- [Strategy Details](#-strategy-details)
- [Troubleshooting](#-troubleshooting)
- [Development](#-development)
- [Roadmap](#️-roadmap)

## 🏗 Architecture

```
┌─────────────────────────────────────────────┐
│           Web Browser (UI)                  │
│  - Modern Dark Theme                        │
│  - Interactive Charts (Chart.js)            │
│  - Real-time Updates                        │
└──────────────────┬──────────────────────────┘
                   │ HTTP/REST
                   │
┌──────────────────▼──────────────────────────┐
│         FastAPI Application                 │
│  - RESTful API Endpoints                    │
│  - Request Validation (Pydantic)            │
│  - Error Handling                           │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
┌────────▼────────┐  ┌───────▼────────────┐
│  OpenAlgo API   │  │   TimescaleDB      │
│                 │  │  (PostgreSQL)      │
│ - Market Data   │  │ - OHLCV Hypertable│
│ - History API   │  │ - Compression     │
│ - Real-time     │  │ - Indexing        │
└─────────────────┘  └────────────────────┘
```

### Technology Stack

**Backend:**
- **Python 3.11+**: Modern Python with type hints
- **FastAPI**: High-performance async web framework
- **Pandas**: Powerful data manipulation
- **NumPy**: Numerical computing
- **Psycopg2**: PostgreSQL database adapter
- **OpenAlgo SDK**: Market data integration

**Database:**
- **TimescaleDB 2.13+**: Time-series optimized PostgreSQL extension
- **Automatic Hypertables**: Optimized partitioning for time-series data
- **Compression**: Automatic data compression for older chunks
- **Continuous Aggregates**: Pre-computed analytics (future)

**Frontend:**
- **Vanilla JavaScript (ES6+)**: No framework overhead
- **Chart.js 4.4+**: Interactive, responsive charts
- **CSS3**: Custom dark theme with animations
- **No Build Tools**: Direct deployment, instant updates

**Infrastructure:**
- **Docker & Docker Compose**: Containerized deployment
- **Uvicorn**: Lightning-fast ASGI server
- **Environment-based Configuration**: 12-factor app principles

## 📦 Prerequisites

### System Requirements
- **Docker Desktop** (v20.10+) or Docker Engine + Docker Compose
- **8GB RAM** minimum (16GB recommended for large datasets)
- **10GB free disk space** minimum
- **Modern web browser** (Chrome, Firefox, Safari, Edge)

### Required Accounts
- **OpenAlgo Account**: [Sign up here](https://openalgo.in)
  - Generate API key from dashboard
  - Note your API host URL (e.g., `http://127.0.0.1:5000`)

## 🚀 Quick Start

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/timescale-gravity.git
cd timescale-gravity
```

### 2. Configure Environment
```bash
# Copy example environment file
cp .env.example .env

# Edit with your credentials
nano .env  # or use your preferred editor
```

**Required Configuration (.env):**
```env
# OpenAlgo API Configuration
API_KEY=your_openalgo_api_key_here
OPENALGO_API_HOST=http://127.0.0.1:5000

# TimescaleDB Configuration
PGHOST=timescaledb
PGPORT=5432
PGUSER=postgres
PGPASSWORD=change_this_secure_password
PGDATABASE=trading

# Application Configuration (optional)
APP_PORT=8000
```

### 3. Launch Application
```bash
# Start all services
docker-compose up -d

# Verify services are running
docker-compose ps
```

**Expected Output:**
```
NAME                IMAGE                       STATUS
timescale-app       timescale-gravity-app       Up (healthy)
timescale-db        timescale/timescaledb       Up (healthy)
```

### 4. Access Application
Open your browser and navigate to:
```
http://localhost:8000
```

You should see the Timescale Gravity dashboard with:
- Available Data section (empty initially)
- Fetch & Upsert form
- Run Backtest form
- Backtest Output section

### 5. First Data Fetch
1. In **"1. Fetch & Upsert"** section, enter:
   - Symbol: `NIFTY14OCT2525000PE`
   - Exchange: `NFO`
   - Interval: `5m`
   - Start Date: `2025-09-01`
   - End Date: `2025-10-06`
2. Click **"Fetch & Upsert"**
3. Wait for completion (fetches both PE and CE automatically)
4. View ingested data in **"Available Data"** section

### 6. Run Your First Backtest
1. Click **"Use in forms"** button in Available Data
2. Scroll to **"2. Run Backtest"** (form auto-populated)
3. Select **"Both (PE + CE)"** for Option Selection
4. Click **"Run Backtest"**
5. View results:
   - Summary metrics
   - Trade journal
   - Daily P&L chart

🎉 **Congratulations!** You're now ready to backtest your strategies.

## ⚙️ Configuration

### Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `API_KEY` | OpenAlgo API authentication key | - | ✅ Yes |
| `OPENALGO_API_HOST` | OpenAlgo API base URL | `http://127.0.0.1:5000` | ✅ Yes |
| `PGHOST` | PostgreSQL/TimescaleDB hostname | `localhost` | ✅ Yes |
| `PGPORT` | PostgreSQL port number | `5432` | ✅ Yes |
| `PGUSER` | Database username | `postgres` | ✅ Yes |
| `PGPASSWORD` | Database password | - | ✅ Yes |
| `PGDATABASE` | Database name | `trading` | ✅ Yes |
| `APP_PORT` | Application HTTP port | `8000` | ❌ No |

### Strategy Default Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Starting Capital | ₹100,000 | > 0 | Initial capital for backtesting |
| Qty per Point | 150 | > 0 | Lot size multiplier per point |
| Target Points | 10.0 | > 0 | Profit target in points |
| Stoploss Points | 2.0 | > 0 | Stop loss in points |
| EMA Fast | 5 | 1-50 | Fast EMA period for trend |
| EMA Slow | 20 | 10-200 | Slow EMA period for trend |
| ATR Window | 14 | 5-50 | ATR calculation period |
| ATR Min Points | 2.0 | >= 0 | Minimum ATR filter |
| Daily Loss Cap | ₹-1,000 | < 0 | Max loss before stopping |
| Exit Bar Path | color | - | OHLC exit simulation |
| Brokerage/Trade | ₹20 | >= 0 | Per-trade brokerage |
| Slippage Points | 0.10 | >= 0 | Slippage per leg |

### Docker Compose Services

The `docker-compose.yml` defines two services:

```yaml
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg15
    container_name: timescale-db
    ports:
      - "5432:5432"
    volumes:
      - timescale_data:/var/lib/postgresql/data
      - ./db_setup.sql:/docker-entrypoint-initdb.d/01_setup.sql:ro
    environment:
      POSTGRES_PASSWORD: ${PGPASSWORD}
      POSTGRES_DB: ${PGDATABASE}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    container_name: timescale-app
    ports:
      - "${APP_PORT:-8000}:8000"
    depends_on:
      timescaledb:
        condition: service_healthy
    env_file:
      - .env
    environment:
      PGHOST: timescaledb
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 📖 Usage Guide

### Managing Historical Data

#### Fetching Data

The application automatically fetches both PE and CE options when you enter any option symbol:

**Example 1: Fetching PE**
```
Input:  NIFTY14OCT2525000PE
Result: Fetches both NIFTY14OCT2525000PE AND NIFTY14OCT2525000CE
```

**Example 2: Fetching CE**
```
Input:  BANKNIFTY21OCT2548000CE
Result: Fetches both BANKNIFTY21OCT2548000PE AND BANKNIFTY21OCT2548000CE
```

**Smart Gap Detection:**
- If you already have data from 2025-09-01 to 2025-09-15
- And you request 2025-09-01 to 2025-10-06
- The system only fetches 2025-09-16 to 2025-10-06 (the missing portion)

#### Viewing Available Data

The **Available Data** section shows:
- All stored symbols with their details
- Total bars ingested
- First and last bar timestamps (in IST)
- Actions: "Use in forms" and "Delete"

**Sorting:**
- Click the **"Symbol ▲"** header to sort ascending (A → Z)
- Click again to sort descending (**"Symbol ▼"** Z → A)
- Sort order persists across refreshes

#### Deleting Data

To remove unwanted data:
1. Click red **"Delete"** button next to the data row
2. Confirm in the dialog: *"Are you sure you want to delete...?"*
3. System removes all data for that symbol/exchange/interval
4. Table refreshes automatically

⚠️ **Warning**: Deletion is permanent and cannot be undone!

### Running Backtests

#### Option Selection Modes

**1. Both (PE + CE)** - Recommended
- Runs backtest on both Put and Call options
- Combines all trades chronologically
- Shows aggregate P&L across both
- Best for understanding overall strategy performance

**2. PE Only**
- Tests only the Put option
- Useful for analyzing bearish scenarios
- Metrics specific to PE trades

**3. CE Only**
- Tests only the Call option
- Useful for analyzing bullish scenarios
- Metrics specific to CE trades

#### Configuring Parameters

**Basic Settings:**
- Symbol, Exchange, Interval, Date Range
- Starting Capital (how much money to start with)
- Option Selection (PE/CE/Both)

**Risk Management:**
- Qty per Point: Lot size multiplier
- Target Points: When to take profits
- Stoploss Points: When to cut losses
- Daily Loss Cap: Max loss before stopping for the day

**Advanced Options** (collapsible):
- EMA periods for trend detection
- ATR filters for volatility
- Exit bar path simulation
- Trade direction (long/short/both)
- EOD square-off settings
- Number of trades to display

#### Interpreting Results

**Summary Metrics:**
- **Total Trades**: How many trades were executed
- **Wins/Losses**: Trade outcome distribution
- **Winrate %**: Percentage of profitable trades
- **Net ₹**: Total profit/loss after costs
- **ROI %**: Return on investment percentage
- **Max Drawdown**: Largest peak-to-trough decline
- **Avg Win/Loss**: Average profit per win, loss per loss
- **Risk:Reward**: Actual reward-to-risk ratio achieved

**Trade Journal:**
- **Last N Trades**: Quick view of recent performance
- **All Trades**: Complete trade history
- Each row shows: Entry/Exit times, Symbol (PE/CE), Side (LONG/SHORT), Prices, P&L

**Daily P&L Chart:**
- **Blue/Red Bars**: Daily profit (blue) or loss (red)
- **Green Line**: Cumulative P&L showing overall trajectory
- Hover over bars for detailed tooltips

**Daily Stats Table:**
- Date-by-date breakdown
- Net P&L per day
- Number of trades, wins, losses per day

### Best Practices

1. **Start Small**: Test on 1-2 weeks of data first
2. **Use Both Options**: Running PE+CE gives fuller picture
3. **Check Data Quality**: Verify data completeness before backtesting
4. **Save Important Results**: Use "Save Trades CSV" option
5. **Parameter Sensitivity**: Test multiple parameter combinations
6. **Realistic Costs**: Don't forget to include slippage and brokerage

## 🔌 API Documentation

### REST Endpoints

#### `GET /`
**Description**: Returns the main web UI (HTML page)

**Response**: HTML document

---

#### `GET /health`
**Description**: Health check endpoint for monitoring

**Response:**
```json
{
  "status": "ok"
}
```

---

#### `GET /inventory`
**Description**: List all available data series in the database

**Query Parameters:**
- `sort_order` (optional): `"asc"` or `"desc"` (default: `"asc"`)

**Response:**
```json
[
  {
    "symbol": "NIFTY14OCT2525000PE",
    "exchange": "NFO",
    "interval": "5m",
    "start_ts": "2025-09-01T09:15:00+05:30",
    "end_ts": "2025-10-06T15:30:00+05:30",
    "rows_count": 2450
  },
  {
    "symbol": "NIFTY14OCT2525000CE",
    "exchange": "NFO",
    "interval": "5m",
    "start_ts": "2025-09-01T09:15:00+05:30",
    "end_ts": "2025-10-06T15:30:00+05:30",
    "rows_count": 2450
  }
]
```

---

#### `POST /fetch`
**Description**: Fetch historical data from OpenAlgo and ingest into TimescaleDB

**Request Body:**
```json
{
  "symbol": "NIFTY14OCT2525000PE",
  "exchange": "NFO",
  "interval": "5m",
  "start_date": "2025-09-01",
  "end_date": "2025-10-06",
  "also_save_csv": "optional_filename.csv"
}
```

**Response:**
```json
{
  "rows_upserted": 4900
}
```

**Notes:**
- If symbol is an option (ends with PE/CE), both PE and CE are automatically fetched
- Smart gap detection prevents duplicate fetches
- Rows are upserted (inserted or updated on conflict)

---

#### `POST /backtest`
**Description**: Run backtest with specified parameters

**Request Body:**
```json
{
  "symbol": "NIFTY14OCT2525000PE",
  "exchange": "NFO",
  "interval": "5m",
  "start_date": "2025-09-01",
  "end_date": "2025-10-06",
  "option_selection": "both",
  "starting_capital": 100000,
  "qty_per_point": 150,
  "target_points": 10,
  "stoploss_points": 2,
  "ema_fast": 5,
  "ema_slow": 20,
  "atr_window": 14,
  "atr_min_points": 2,
  "daily_loss_cap": -1000,
  "exit_bar_path": "color",
  "trade_direction": "both",
  "confirm_trend_at_entry": true,
  "enable_eod_square_off": true,
  "square_off_time": "15:25",
  "write_csv": false,
  "last_n_trades": 10
}
```

**Response:**
```json
{
  "summary": {
    "total_trades": 45,
    "wins": 28,
    "losses": 17,
    "flats": 0,
    "winrate_percent": 62.22,
    "gross_rupees": 67500.00,
    "costs_rupees": 1950.00,
    "net_rupees": 65550.00,
    "final_equity": 165550.00,
    "roi_percent": 65.55,
    "avg_win": 3250.50,
    "avg_loss": -1150.25,
    "risk_reward": 2.83,
    "max_drawdown": -3250.00,
    "exit_reason_counts": {
      "Target Hit": 25,
      "Stoploss Hit": 15,
      "Square-off EOD": 5
    }
  },
  "trades_tail": [...],  // Last N trades
  "trades_all": [...],   // All trades
  "daily_stats": [...],  // Daily breakdown
  "output_csv": "scalp_with_trend_results_SYMBOL_5m.csv"
}
```

---

#### `DELETE /inventory/{symbol}/{exchange}/{interval}`
**Description**: Delete all data for a specific series

**Path Parameters:**
- `symbol`: Symbol name (URL encoded if needed)
- `exchange`: Exchange code
- `interval`: Time interval

**Example:**
```
DELETE /inventory/NIFTY14OCT2525000PE/NFO/5m
```

**Response:**
```json
{
  "rows_deleted": 2450,
  "message": "Deleted 2450 rows for NIFTY14OCT2525000PE NFO 5m"
}
```

## 📊 Strategy Details

### Scalp-with-Trend Strategy

A trend-following intraday scalping strategy designed for options trading.

#### Entry Logic

**Prerequisites (ALL must be true):**
1. **Trend Confirmation**:
   - For LONG: EMA(fast) > EMA(slow)
   - For SHORT: EMA(fast) < EMA(slow)
2. **Volatility Filter**: ATR >= ATR Min threshold
3. **Signal Bar**:
   - For LONG: Current bar high > Previous bar high
   - For SHORT: Current bar low < Previous bar low
4. **Session Active**: Within configured trading windows
5. **No Daily Stop**: Daily loss cap not reached

**Entry Execution:**
- Entry price = Open of NEXT bar after signal
- Immediately sets target and stoploss levels

#### Exit Logic

**Exit triggers (in priority order):**

1. **Target Hit**
   - Price reaches: Entry ± Target Points
   - Exit at target level

2. **Stoploss Hit**
   - Price reaches: Entry ∓ Stoploss Points
   - Exit at stoploss level

3. **EOD Square-off**
   - Time >= Square-off time (default 15:25)
   - OR last bar of trading day
   - Exit at closing price

#### Exit Bar Path Simulation

Determines intra-bar execution order when both target and stoploss are hit:

**"color" (default)**:
- Bullish bars (close >= open): Check low first, then high
- Bearish bars (close < open): Check high first, then low
- Most realistic simulation

**"bull"**:
- Always: Low → High → Close
- Optimistic assumption

**"bear"**:
- Always: High → Low → Close
- Pessimistic assumption

**"worst"**:
- If both triggered: Always assumes stoploss hit first
- Ultra-conservative

#### Risk Management

**Position Sizing:**
- Currently fixed: 1 position per symbol
- P&L = (Exit - Entry) × Qty per Point
- Future: Capital-based position sizing

**Daily Loss Cap:**
- Tracks cumulative P&L per day
- If day's P&L <= Loss Cap: No new trades that day
- Resets at start of next trading day

**Costs:**
- Brokerage: 2 × Brokerage per Trade (entry + exit)
- Slippage: 2 × Slippage Points × Qty per Point
- Total Costs = Brokerage + Slippage

#### Multi-Symbol Mode (PE + CE)

When running "Both":
- Each symbol backtested independently
- Trades from both symbols combined chronologically
- Each can have 1 active position simultaneously
- Metrics calculated across ALL trades
- Symbol column distinguishes PE vs CE trades

**Example Timeline:**
```
09:25 - PE enters LONG
09:30 - CE enters SHORT  (PE still open)
09:35 - PE exits (Target)
09:40 - CE exits (Stoploss)
09:45 - PE enters LONG again
...
```

## 🐛 Troubleshooting

### Common Issues and Solutions

#### Issue: Cannot connect to Docker daemon

**Error Message:**
```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock
```

**Solution:**
```bash
# Linux: Start Docker service
sudo systemctl start docker

# macOS/Windows: Open Docker Desktop application
```

---

#### Issue: Port already in use

**Error Message:**
```
Bind for 0.0.0.0:8000 failed: port is already allocated
```

**Solution:**
```bash
# Option 1: Change port in .env
echo "APP_PORT=8001" >> .env
docker-compose down
docker-compose up -d

# Option 2: Kill process using port 8000
# Linux/macOS:
sudo lsof -ti:8000 | xargs kill -9

# Windows:
netstat -ano | findstr :8000
taskkill /PID <PID_FROM_ABOVE> /F
```

---

#### Issue: TimescaleDB won't start

**Error Message:**
```
timescaledb exited with code 1
```

**Solution:**
```bash
# Check logs
docker-compose logs timescaledb

# Common fix: Reset volume
docker-compose down -v
docker-compose up -d

# If persists: Check disk space
df -h
```

---

#### Issue: OpenAlgo API connection failed

**Error Message:**
```
Failed to fetch data from OpenAlgo: Connection refused
```

**Solution:**
1. Verify OpenAlgo is running:
   ```bash
   curl http://127.0.0.1:5000/health
   ```

2. Check API key in `.env`:
   ```bash
   grep API_KEY .env
   ```

3. Test authentication:
   ```bash
   curl -X POST http://127.0.0.1:5000/api/v1/quotes \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"symbol":"NIFTY","exchange":"NSE"}'
   ```

---

#### Issue: No data in backtest

**Error Message:**
```
No data returned from TimescaleDB for the requested slice
```

**Solution:**
```bash
# 1. Verify data was fetched
docker-compose exec timescaledb psql -U postgres -d trading

# 2. Check data in database
SELECT symbol, exchange, interval,
       MIN(ts) as first, MAX(ts) as last, COUNT(*)
FROM ohlcv
GROUP BY symbol, exchange, interval;

# 3. Verify date range matches
# If no results: Fetch data first using UI or API
```

---

#### Issue: Backtest runs but shows 0 trades

**Possible Causes:**
1. **No entry signals generated**: Strategy conditions too strict
2. **Data quality issues**: Missing or gappy data
3. **Date mismatch**: Data exists but outside backtest range
4. **Daily loss cap hit immediately**: Check starting capital and loss cap

**Solution:**
```bash
# Debug mode: Check data quality
# In Python console:
from tsdb_pipeline import read_ohlcv_from_tsdb
df = read_ohlcv_from_tsdb('SYMBOL', 'NFO', '5m', '2025-09-01', '2025-10-06')
print(f"Rows: {len(df)}, Nulls: {df.isnull().sum()}")
print(df.head())
print(df.tail())
```

### Enabling Debug Logging

Edit `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      - LOG_LEVEL=DEBUG
```

Restart and view logs:
```bash
docker-compose restart app
docker-compose logs -f app
```

### Complete Reset

To start completely fresh:

```bash
# Stop all services and remove data
docker-compose down -v

# Remove images (optional)
docker-compose down --rmi all

# Start fresh
docker-compose up -d --build
```

## 💻 Development

### Local Development Setup

**1. Clone repository:**
```bash
git clone https://github.com/yourusername/timescale-gravity.git
cd timescale-gravity
```

**2. Create virtual environment:**
```bash
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate  # Windows
```

**3. Install dependencies:**
```bash
pip install -r requirements.txt
```

**4. Setup local database:**
```bash
# Install PostgreSQL + TimescaleDB locally
# OR use Docker for DB only:
docker run -d --name timescale-dev \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  timescale/timescaledb:latest-pg15

# Initialize schema
psql -h localhost -U postgres -d trading -f db_setup.sql
```

**5. Configure environment:**
```bash
cp .env.example .env
# Edit .env:
# - Set PGHOST=localhost
# - Add your OpenAlgo credentials
```

**6. Run development server:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**7. Access at:**
```
http://localhost:8000
```

Changes to Python/JS/CSS files will auto-reload!

### Project Structure

```
timescale-gravity/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI application & routes
│   ├── static/
│   │   ├── app.js             # Frontend JavaScript
│   │   └── style.css          # Styles & theme
│   └── templates/
│       └── index.html         # Main UI template
├── backtest_tsdb.py           # Backtesting engine
├── tsdb_pipeline.py           # Data ingestion pipeline
├── symbol_utils.py            # Symbol parsing utilities
├── db_setup.sql              # Database schema & setup
├── docker-compose.yml         # Docker orchestration
├── Dockerfile                 # Application container
├── requirements.txt           # Python dependencies
├── .env.example              # Environment template
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

### Key Modules

**`app/main.py`**:
- FastAPI application setup
- API route definitions
- Request/response models (Pydantic)
- Error handling

**`tsdb_pipeline.py`**:
- Database connection management
- Historical data fetching from OpenAlgo
- Smart gap detection
- PE/CE pair handling
- Data upsert logic

**`backtest_tsdb.py`**:
- Backtesting engine
- Strategy implementation
- Trade execution simulation
- Performance metrics calculation
- Multi-symbol support

**`symbol_utils.py`**:
- Option symbol parsing
- PE/CE pair generation
- Symbol validation

### Running Tests

```bash
# Install test dependencies
pip install pytest pytest-cov pytest-asyncio

# Run all tests
pytest

# Run with coverage
pytest --cov=. --cov-report=html

# Run specific test file
pytest tests/test_symbol_utils.py

# Run with verbose output
pytest -v
```

### Code Quality Tools

```bash
# Format code
black .

# Sort imports
isort .

# Lint
pylint app/ backtest_tsdb.py tsdb_pipeline.py symbol_utils.py

# Type checking
mypy app/ backtest_tsdb.py tsdb_pipeline.py symbol_utils.py

# Security audit
bandit -r app/ backtest_tsdb.py tsdb_pipeline.py
```

### Adding New Features

1. Create feature branch: `git checkout -b feature/awesome-feature`
2. Implement changes
3. Add tests
4. Update documentation
5. Submit pull request

## 🗺️ Roadmap

### Planned Features

**Q1 2025:**
- [ ] Capital-based position sizing
- [ ] Multiple strategy support
- [ ] Real-time paper trading mode
- [ ] Advanced charting (candlesticks, indicators overlay)
- [ ] Strategy comparison tool

**Q2 2025:**
- [ ] Portfolio-level backtesting
- [ ] Walk-forward analysis
- [ ] Parameter optimization (grid search)
- [ ] Export reports to PDF
- [ ] Telegram alerts integration

**Q3 2025:**
- [ ] Monte Carlo simulations
- [ ] Risk metrics dashboard (Sharpe, Sortino, Calmar)
- [ ] Trade replay visualization
- [ ] Backadjusted continuous contracts
- [ ] API rate limiting & caching

**Q4 2025:**
- [ ] Machine learning strategy builder
- [ ] Sentiment analysis integration
- [ ] Multi-timeframe analysis
- [ ] Options Greeks calculation
- [ ] Cloud deployment templates

### Feature Requests

Have an idea? [Open an issue](https://github.com/yourusername/timescale-gravity/issues) or discussion!

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Create** your feature branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'Add some AmazingFeature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

### Contribution Guidelines

- Write clear, descriptive commit messages
- Add tests for new features
- Update documentation as needed
- Follow existing code style (PEP 8 for Python)
- Ensure all tests pass before submitting
- One feature per pull request

### Reporting Issues

When reporting bugs, please include:
- Timescale Gravity version
- Operating system and version
- Docker version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [TimescaleDB](https://www.timescale.com/) - High-performance time-series database
- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [OpenAlgo](https://openalgo.in/) - Market data API provider
- [Chart.js](https://www.chartjs.org/) - Beautiful interactive charts
- [PostgreSQL](https://www.postgresql.org/) - World's most advanced open source database

## 📧 Support & Community

- **Documentation**: You're reading it! 📖
- **Issues**: [GitHub Issues](https://github.com/yourusername/timescale-gravity/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/timescale-gravity/discussions)
- **Email**: support@yourdomain.com

## ⚖️ Disclaimer

**This software is for educational and research purposes only.**

- Not financial advice
- Past performance does not guarantee future results
- Trading involves substantial risk of loss
- Test thoroughly before live trading
- The developers assume no responsibility for financial losses

**Use at your own risk. Always consult a financial advisor before trading.**

---

**Built with ❤️ for algorithmic traders**

*Last updated: 2025-01-12*
