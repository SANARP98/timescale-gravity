# DB-Aware History Caching System 🚀

Intelligent database-backed caching layer for OpenAlgo historical data with automatic gap filling, TTL management, metrics tracking, and data validation.

## 🎯 Features

### Core Features
- ✅ **Smart Cache Lookup** - Checks TimescaleDB before making API calls
- ✅ **Automatic Gap Filling** - Detects and backfills missing date ranges
- ✅ **Zero Breaking Changes** - Drop-in replacement for existing strategies
- ✅ **Option Symbol Support** - Handles PE/CE pairs automatically

### Advanced Features (NEW!)
- 🔄 **Cache TTL** - Auto-refresh stale data (configurable, default 24h)
- 📊 **Performance Metrics** - Track hit/miss rates per series
- ✅ **Data Validation** - Detect OHLC errors, nulls, gaps, duplicates
- 🏥 **Health Checks** - Monitor system status and data quality
- 🛠️ **Admin CLI** - Manage cache via command-line tool

## 📦 Installation

Already installed! The enhancements are integrated into `db_aware_history.py`.

## 🚀 Usage

### Basic Usage (Strategies)

No changes needed! Your strategies automatically use the enhanced caching:

```python
from db_aware_history import get_history_smart

# This now includes TTL checks, metrics, and validation
df = get_history_smart(
    client,
    symbol="NIFTY24OCT2525000CE",
    exchange="NFO",
    interval="5m",
    start_date="2025-10-01",
    end_date="2025-10-14"
)
```

### Configuration (Environment Variables)

Add to your `.env` file:

```bash
# Cache TTL (time-to-live) in hours - when to auto-refresh data
CACHE_TTL_HOURS=24                    # Default: 24 hours

# Enable/disable cache performance metrics
ENABLE_CACHE_METRICS=true             # Default: true

# Enable/disable data validation checks
ENABLE_DATA_VALIDATION=true           # Default: true
```

### Admin CLI Tool

Comprehensive command-line interface for cache management:

#### View Cache Statistics
```bash
python cache_admin.py stats                # Overall stats
python cache_admin.py stats --verbose      # Per-series stats
```

**Example Output:**
```
====================================================================
                    Cache Statistics
====================================================================

📊 Overall Cache Performance

  Series Count:    12
  Cache Hits:      145
  Cache Misses:    8
  Partial Hits:    12
  Errors:          0
  TTL Refreshes:   3
  Hit Rate:        95.15%
```

#### List Cached Series
```bash
python cache_admin.py list                 # All series
python cache_admin.py list --stale-only    # Only stale data
```

**Example Output:**
```
Symbol               Exchange   Interval   First Date   Last Date    Rows     Age (h)  Stale
────────────────────────────────────────────────────────────────────────────────────────────
NIFTY24OCT2525000CE  NFO        5m         2025-10-01   2025-10-14   2800     2.5      ✓
BANKNIFTY24OCT25PE   NFO        15m        2025-09-15   2025-10-13   1200     28.3     ⚠️

Total Series: 2
⚠️  1 series are stale (older than 24h)
```

#### Clear Cached Data
```bash
python cache_admin.py clear NIFTY NFO 5m       # With confirmation
python cache_admin.py clear NIFTY NFO 5m --yes # Skip confirmation
```

#### Health Check
```bash
python cache_admin.py health                   # Basic check
python cache_admin.py health --verbose         # Detailed diagnostics
```

**Example Output:**
```
✅ Status: HEALTHY
   Timestamp: 2025-10-14T15:30:00+05:30

──────────────────────────────────────────────────────────────
Database
──────────────────────────────────────────────────────────────

  ✅ Database Connection
  ✅ Table 'ohlcv' exists

──────────────────────────────────────────────────────────────
Metrics
──────────────────────────────────────────────────────────────

  ✅ Metrics Tracking Enabled

──────────────────────────────────────────────────────────────
Warnings
──────────────────────────────────────────────────────────────

  ⚠️  2 series have stale data (older than 24h)
```

#### Reset Metrics
```bash
python cache_admin.py reset-stats              # With confirmation
python cache_admin.py reset-stats --yes        # Skip confirmation
```

#### Export Data
```bash
python cache_admin.py export                   # Export to cache_export.json
python cache_admin.py export -o backup.json    # Custom output file
```

Exports comprehensive JSON with:
- Cache statistics
- Per-series metrics
- Cached series list with coverage info
- System health status

## 🔧 How It Works

### 1. Cache TTL (Time-To-Live)

Data freshness is automatically managed:

```
Request Data
    ↓
Check Last Update
    ↓
Is data older than TTL? (default 24h)
    ├─ YES → Auto-refresh from API (last 7 days)
    └─ NO  → Use cached data
```

**Benefits:**
- Always have fresh data without manual refreshes
- Configurable TTL per environment
- Tracks TTL refreshes in metrics

### 2. Performance Metrics

Automatically tracks:
- **Cache Hits** - Data served from cache
- **Cache Misses** - Data fetched from API
- **Partial Hits** - Cache used + gaps filled
- **Errors** - API/DB failures
- **TTL Refreshes** - Auto-refresh events
- **Hit Rate** - Overall cache effectiveness

Metrics are persisted to `.cache_metrics.json` and survive restarts.

### 3. Data Validation

Optional validation checks (enabled by default):

**Checks performed:**
- ✅ Required columns present (timestamp, OHLC, volume)
- ✅ No null values in critical columns
- ✅ Valid OHLC relationships (high ≥ low, etc.)
- ✅ No duplicate timestamps
- ✅ No large time gaps (> 2x median interval)

**Example Output:**
```
[DB_AWARE] ⚠️ Data warnings: ['Column close has 3 null values', 'Found 2 large time gaps']
```

### 4. Intelligent Fetching Logic

```
┌─────────────────────────────────┐
│  Request: 2025-10-01 → 10-14   │
└──────────┬──────────────────────┘
           │
    ┌──────▼──────┐
    │ Check Cache │
    └──────┬──────┘
           │
    ┌──────▼──────────────┐
    │ Is cache stale?     │
    └──┬───────────┬──────┘
       │YES        │NO
       │           │
┌──────▼─────┐    │
│ Refresh    │    │
│ (last 7d)  │    │
└──────┬─────┘    │
       │          │
    ┌──▼──────────▼───────┐
    │ Coverage Check      │
    └──┬───────┬──────┬───┘
       │FULL   │PART  │NONE
       │       │      │
  ┌────▼───┐ ┌▼────┐ │
  │ Cache  │ │Fill │ │
  │ Hit    │ │Gaps │ │
  └────┬───┘ └┬────┘ │
       │      │      │
    ┌──▼──────▼──────▼──┐
    │ Return from DB    │
    └───────────────────┘
```

## 📊 Performance Benefits

### Before Enhancements
```
Every request → API call → Slow, wasteful
No visibility into cache performance
No automatic data refresh
No data quality checks
```

### After Enhancements
```
Most requests → Cache hit → Instant! ⚡
Auto-refresh stale data (TTL)
Track hit rates & optimize usage
Catch data quality issues early
```

**Real-world example:**
- **Before**: 100 strategy runs = 100 API calls (slow, rate-limited)
- **After**: 100 runs = 1 API call + 99 cache hits (95%+ hit rate!)

## 🔍 Monitoring & Optimization

### Check Cache Performance
```bash
# Quick stats
python cache_admin.py stats

# Detailed per-series breakdown
python cache_admin.py stats --verbose

# Find stale data
python cache_admin.py list --stale-only
```

### Optimize Cache Hit Rate

**Low hit rate?** Common causes:
1. **Short TTL** - Increase `CACHE_TTL_HOURS` if appropriate
2. **Frequently changing date ranges** - Strategies requesting varying ranges
3. **Option symbols expiring** - Natural for short-dated options

**Good hit rates:**
- **80%+** - Excellent (most data served from cache)
- **60-80%** - Good (some gap filling needed)
- **<60%** - Review usage patterns

### Regular Maintenance

```bash
# Weekly health check
python cache_admin.py health --verbose

# Clean up old expired options (if needed)
python cache_admin.py list --stale-only
python cache_admin.py clear NIFTY24SEPCE NFO 5m --yes

# Export for analysis
python cache_admin.py export -o weekly_report.json
```

## 🛠️ Troubleshooting

### "Metrics tracking is disabled"
Add to `.env`:
```bash
ENABLE_CACHE_METRICS=true
```

### "Cache is stale" warnings
This is normal! It means auto-refresh is working. To reduce frequency:
```bash
CACHE_TTL_HOURS=48  # Increase from 24h to 48h
```

### Data validation warnings
Review warnings to identify data quality issues:
```python
from db_aware_history import validate_data

validation = validate_data(df, "NIFTY", "NFO", "5m")
print(validation)
```

### Clear corrupt data
```bash
# Clear specific series
python cache_admin.py clear SYMBOL EXCHANGE INTERVAL --yes

# Force fresh fetch
df = get_history_smart(client, symbol, exchange, interval, force_api=True)
```

### Database connection errors
Check TimescaleDB is running:
```bash
psql "postgresql://postgres:postgres@localhost:5432/trading" -c "SELECT 1"
```

## 📈 Best Practices

### 1. Configure TTL appropriately
- **Intraday strategies**: 12-24 hours
- **Daily strategies**: 24-48 hours
- **Historical analysis**: 72+ hours

### 2. Monitor hit rates
```bash
# Add to cron for daily reports
0 9 * * * cd /path/to/water-life-copy && python cache_admin.py stats > /tmp/cache_stats.txt
```

### 3. Enable validation in development
```bash
ENABLE_DATA_VALIDATION=true  # Catch issues early
```

Disable in production if causing performance issues.

### 4. Regular health checks
```bash
python cache_admin.py health --verbose
```

Run before important trading sessions.

### 5. Export metrics for analysis
```bash
python cache_admin.py export -o "cache_$(date +%Y%m%d).json"
```

Analyze trends over time to optimize cache configuration.

## 🎓 Advanced Usage

### Programmatic Access

```python
from db_aware_history import (
    get_cache_stats,
    list_cached_series,
    clear_cache_for_series,
    health_check,
)

# Get cache stats in your code
stats = get_cache_stats()
print(f"Hit rate: {stats['hit_rate']}%")

# Check specific series
series_stats = get_cache_stats("NIFTY", "NFO", "5m")

# List all cached data
df = list_cached_series()
stale_series = df[df['stale'] == True]

# Clear programmatically
if stale_series:
    for _, row in stale_series.iterrows():
        clear_cache_for_series(row['symbol'], row['exchange'], row['interval'])

# Health check
health = health_check()
if health['status'] != 'healthy':
    print(f"Issues: {health['issues']}")
```

### Custom Validation

```python
from db_aware_history import validate_data

df = get_history_smart(client, symbol, exchange, interval)
validation = validate_data(df, symbol, exchange, interval)

if not validation['valid']:
    print(f"Validation failed: {validation['issues']}")

if validation['warnings']:
    for warning in validation['warnings']:
        print(f"Warning: {warning}")
```

### Disable Features Selectively

```python
# Fetch without validation (faster)
df = get_history_smart(
    client, symbol, exchange, interval,
    validate=False
)

# Force API fetch (bypass cache)
df = get_history_smart(
    client, symbol, exchange, interval,
    force_api=True
)
```

## 📚 API Reference

### Main Functions

#### `get_history_smart()`
```python
def get_history_smart(
    client,
    symbol: str,
    exchange: str,
    interval: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    force_api: bool = False,
    validate: bool = True,
) -> pd.DataFrame
```

#### `get_cache_stats()`
```python
def get_cache_stats(
    symbol: Optional[str] = None,
    exchange: Optional[str] = None,
    interval: Optional[str] = None
) -> Dict[str, Any]
```

#### `list_cached_series()`
```python
def list_cached_series() -> pd.DataFrame
```

Returns DataFrame with columns:
- `symbol`, `exchange`, `interval`
- `first_ts`, `last_ts` (timezone-aware)
- `rows_count`, `age_hours`, `stale` (bool)

#### `clear_cache_for_series()`
```python
def clear_cache_for_series(
    symbol: str,
    exchange: str,
    interval: str
) -> int  # Returns number of rows deleted
```

#### `health_check()`
```python
def health_check() -> Dict[str, Any]
```

Returns dict with:
- `status`: "healthy" or "unhealthy"
- `database_connected`: bool
- `table_exists`: bool
- `total_rows`, `series_count`: int
- `issues`: List[str]
- `warnings`: List[str]
- `cache_stats`: Dict (if metrics enabled)

## 🤝 Contributing

Found a bug or have a suggestion? Create an issue or PR!

## 📄 License

Part of the timescale-gravity project.

---

**Made with ❤️ for faster, smarter trading strategies**
