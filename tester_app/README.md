# Strategy Tester App - Multi-Strategy Backtesting Platform

A modular, extensible backtesting platform that automatically discovers and tests multiple trading strategies with configurable parameter ranges.

## 🚀 Quick Start

### Docker (Recommended)
```bash
docker-compose up --build tester-app
```
Access at: **http://localhost:8100**

### Local Development
```bash
cd tester_app
uvicorn main:app --reload --host 0.0.0.0 --port 8100
```
Access at: **http://localhost:8100**

## ✨ Features

- 🎯 **Multi-Strategy Support** - Automatically discovers strategies from `app/strategies/`
- 🔄 **Dynamic UI** - Strategy selector with adaptive configuration
- 📊 **Sortable Results** - Click column headers to sort by any metric
- ⚙️ **Parameter Ranges** - Test thousands of configurations automatically
- ⏸️ **Pause/Resume** - Control execution at any time
- 🔀 **Parallel Execution** - Configurable workers for faster results
- 💾 **Database Storage** - All results stored in TimescaleDB
- 📤 **Export** - Download results as CSV
- 🛡️ **Robust** - Handles "no trades" cases gracefully

## 📦 Currently Supported Strategies

### 1. Scalp with Trend
EMA crossover strategy with trend confirmation and ATR filters.

**Parameters:**
- Target/Stoploss points
- EMA Fast/Slow periods
- ATR minimum
- Daily loss cap
- Trade direction
- EOD square-off

### 2. Random Scalp
Simple buy-every-N-bars strategy for testing and validation.

**Parameters:**
- Trade frequency (bars)
- Profit target (₹)
- Stop loss (₹)
- Quantity multiplier

## 🏗️ Architecture

```
tester_app/
├── strategies/          # Strategy registry and auto-discovery
│   └── __init__.py     # StrategyRegistry class
├── core/               # Business logic
│   ├── runner.py       # PermutationRunner, JobGenerator
│   └── database.py     # Database operations
├── templates/          # HTML templates
├── static/            # CSS and JavaScript
│   ├── style.css      # Styling
│   └── app.js         # Frontend logic
├── main.py            # FastAPI application
└── export_results.py  # Export functionality
```

## 📖 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get started in 5 minutes
- **[DOCKER.md](DOCKER.md)** - Docker deployment guide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System design and patterns
- **[REFACTOR_SUMMARY.md](REFACTOR_SUMMARY.md)** - Complete changelog

## 🎮 Usage

### 1. Select Strategy
Use the dropdown at the top to choose which strategy to test.

### 2. Configure Parameters
Click "Show" next to Configuration to set:
- Symbols to test
- Date range
- Parameter ranges (targets, stops, EMAs, etc.)
- Number of parallel workers

### 3. Apply & Start
Click "Apply Configuration" then "Start / Resume" to begin testing.

### 4. View Results
Scroll to "Previous Runs" table to see all results. Click any column header to sort.

### 5. Find Best Configs
Click "Net ₹" header twice to sort descending and see the most profitable configurations first.

## 🔧 Configuration

### Environment Variables
```bash
# Database
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=trading

# Tester App
TESTER_MAX_WORKERS=4  # Number of parallel workers
```

### Parameter Ranges Example
```json
{
  "strategy": "scalp_with_trend",
  "symbols": ["NIFTY28OCT2525200CE", "NIFTY28OCT2525200PE"],
  "start_date": "2025-09-01",
  "end_date": "2025-10-06",
  "starting_capital": 100000,
  "qty_per_point": 150,
  "max_workers": 4,
  "param_ranges": {
    "target_points": [2, 3, 4, 5, 6, 7, 8, 9, 10],
    "stoploss_points": [2, 3, 4, 5, 6, 7, 8, 9, 10],
    "ema_fast": [3, 5],
    "ema_slow": [10, 20],
    "atr_min_points": [1.0, 2.0, 3.0],
    "daily_loss_cap": [-1000, -1500, -2000, -2500, -3000]
  }
}
```

## 🆕 Adding a New Strategy

### 1. Create Strategy File
Create `app/strategies/my_strategy.py`:

```python
from pydantic import BaseModel, Field

class StrategyParams(BaseModel):
    """Define your strategy parameters with Pydantic."""
    my_param: float = Field(1.0, title="My Parameter", gt=0)

def get_info():
    """Metadata for the UI."""
    return {
        "name": "my_strategy",
        "title": "My Strategy",
        "description": "Brief description of what it does.",
        "parameters": StrategyParams.model_json_schema(),
    }

def run(config, write_csv=False):
    """Execute the strategy."""
    # Your implementation here
    return {
        "data": {},  # OHLCV data used
        "trades": pd.DataFrame(),  # All trades
        "summary": {  # Performance metrics
            "total_trades": 10,
            "wins": 6,
            "losses": 4,
            "winrate_percent": 60.0,
            "net_rupees": 5000.0,
            "gross_rupees": 5200.0,
            "costs_rupees": 200.0,
            "roi_percent": 5.0,
            "risk_reward": 1.5,
        },
        "message": "Optional message",
    }
```

### 2. Restart the App
The strategy is automatically discovered - no code changes needed!

### 3. Verify
```bash
curl http://localhost:8100/strategies
# Should show your new strategy
```

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main UI |
| `/strategies` | GET | List all available strategies |
| `/status` | GET | Current runner status |
| `/start` | POST | Start/resume testing |
| `/pause` | POST | Pause testing |
| `/reset` | POST | Reset runner to beginning |
| `/configure` | POST | Apply new configuration |
| `/clear-results` | POST | Clear all stored results |
| `/history` | GET | List all stored results |
| `/history/export-file` | GET | Export results as CSV |

## 📊 Database Schema

```sql
CREATE TABLE tester_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    strategy TEXT NOT NULL,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    interval TEXT NOT NULL,
    params JSONB NOT NULL,
    summary JSONB NOT NULL
);
```

## 🐛 Troubleshooting

### Strategies Not Loading
```bash
# Check files exist
ls -la ../app/strategies/

# Verify discovery
python -c "from tester_app.strategies import get_registry; print(get_registry().list_strategies())"
```

### Import Errors
```bash
# Ensure PYTHONPATH is set
export PYTHONPATH=/path/to/timescale-gravity
```

### Database Connection
```bash
# Test connection
python -c "from tsdb_pipeline import get_conn; print(get_conn())"
```

### View Logs
```bash
# Docker
docker-compose logs -f tester-app

# Local
# Logs print to console
```

## 🎯 Performance Tips

1. **Adjust Workers**: Set `TESTER_MAX_WORKERS` to your CPU core count
2. **Narrow Ranges**: Start with small parameter ranges to test quickly
3. **Use Filters**: Filter results by strategy/symbol to reduce data
4. **Monitor Resources**: Watch CPU/memory usage with `docker stats`

## 🔄 Migration from Old Version

The refactored version is **backward compatible**:
- ✅ Old results still visible in history
- ✅ Database schema unchanged
- ✅ All old features preserved
- ✅ Backup files: `main.py.old`, `main.py.backup`

To rollback:
```bash
cd tester_app
mv main.py main_new.py
mv main.py.old main.py
```

## 📝 Development

### Project Structure
```
tester_app/
├── strategies/           # Strategy registry
├── core/                # Core logic
│   ├── runner.py       # Permutation runner
│   └── database.py     # DB operations
├── templates/           # Jinja2 templates
├── static/             # Frontend assets
├── main.py             # FastAPI app
└── export_results.py   # Export utilities
```

### Key Classes

**StrategyRegistry** - Discovers and manages strategies
**PermutationRunner** - Executes parameter permutations
**JobGenerator** - Creates job combinations
**Job** - Represents a single backtest task

### Adding Features

1. **New API Endpoint**: Add to `main.py`
2. **New UI Component**: Update `templates/index.html` and `static/app.js`
3. **New Strategy**: Drop file in `app/strategies/`
4. **New Core Logic**: Add to `core/` modules

## 🧪 Testing

```bash
# Test strategy discovery
python -c "from tester_app.strategies import get_registry; r = get_registry(); print(f'Found {len(r.list_strategies())} strategies')"

# Test runner
python -c "from tester_app.core.runner import JobGenerator; jobs = JobGenerator.generate_jobs('scalp_with_trend', {'symbols': ['TEST']}); print(f'Generated {len(jobs)} jobs')"

# Test database
python -c "from tester_app.core.database import db_stats; print(db_stats())"

# Test API
curl http://localhost:8100/strategies
curl http://localhost:8100/status
```

## 📄 License

[Your License Here]

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add your strategy or feature
4. Test thoroughly
5. Submit a pull request

## 📞 Support

- **Issues**: Check logs and troubleshooting section
- **Docs**: See documentation files in this directory
- **API**: Use `/strategies` endpoint to verify setup

---

**Built with FastAPI, TimescaleDB, and love for algorithmic trading** ❤️
