#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DB-Aware History Fetcher with Smart Caching & Enhancements
-----------------------------------------------------------
Intelligent data layer that checks TimescaleDB first before fetching from API.

Features:
- ✅ Checks DB coverage before making API calls
- ✅ Only fetches missing date ranges from OpenAlgo API
- ✅ Automatically backfills gaps in data
- ✅ Cache TTL (auto-refresh stale data)
- ✅ Cache hit/miss metrics tracking
- ✅ Data validation and health checks
- ✅ Returns unified results from DB
- ✅ Zero breaking changes for existing strategies

Usage:
    from db_aware_history import get_history_smart

    df = get_history_smart(
        client,
        symbol="NIFTY24OCT2525000CE",
        exchange="NFO",
        interval="5m",
        start_date="2025-09-01",
        end_date="2025-10-14"
    )
"""

import os
import sys
import json
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from collections import defaultdict
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# Import TimescaleDB functions from parent directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tsdb_pipeline import (
    ensure_schema,
    get_series_coverage,
    fetch_history_to_tsdb,
    read_ohlcv_from_tsdb,
    get_conn,
)

load_dotenv()
IST_TZ = "Asia/Kolkata"

# ==================== Configuration ====================
CACHE_TTL_HOURS = int(os.getenv("CACHE_TTL_HOURS", 24))  # Default: 24 hours
ENABLE_METRICS = os.getenv("ENABLE_CACHE_METRICS", "true").lower() == "true"
METRICS_FILE = os.path.join(os.path.dirname(__file__), ".cache_metrics.json")
ENABLE_DATA_VALIDATION = os.getenv("ENABLE_DATA_VALIDATION", "true").lower() == "true"

# ==================== Metrics Tracking ====================
class CacheMetrics:
    """Track cache performance metrics"""

    def __init__(self):
        self.stats = defaultdict(lambda: {"hits": 0, "misses": 0, "partial_hits": 0, "errors": 0, "ttl_refreshes": 0})
        self.load_metrics()

    def load_metrics(self):
        """Load metrics from disk"""
        if Path(METRICS_FILE).exists():
            try:
                with open(METRICS_FILE, 'r') as f:
                    data = json.load(f)
                    self.stats = defaultdict(
                        lambda: {"hits": 0, "misses": 0, "partial_hits": 0, "errors": 0, "ttl_refreshes": 0},
                        data
                    )
            except Exception as e:
                print(f"[METRICS] Warning: Could not load metrics: {e}")

    def save_metrics(self):
        """Persist metrics to disk"""
        try:
            with open(METRICS_FILE, 'w') as f:
                json.dump(dict(self.stats), f, indent=2)
        except Exception as e:
            print(f"[METRICS] Warning: Could not save metrics: {e}")

    def record_hit(self, symbol: str, exchange: str, interval: str):
        """Record a cache hit"""
        key = f"{symbol}@{exchange}:{interval}"
        self.stats[key]["hits"] += 1
        if ENABLE_METRICS:
            self.save_metrics()

    def record_miss(self, symbol: str, exchange: str, interval: str):
        """Record a cache miss"""
        key = f"{symbol}@{exchange}:{interval}"
        self.stats[key]["misses"] += 1
        if ENABLE_METRICS:
            self.save_metrics()

    def record_partial_hit(self, symbol: str, exchange: str, interval: str):
        """Record a partial cache hit (needed gap filling)"""
        key = f"{symbol}@{exchange}:{interval}"
        self.stats[key]["partial_hits"] += 1
        if ENABLE_METRICS:
            self.save_metrics()

    def record_error(self, symbol: str, exchange: str, interval: str):
        """Record an error during fetch"""
        key = f"{symbol}@{exchange}:{interval}"
        self.stats[key]["errors"] += 1
        if ENABLE_METRICS:
            self.save_metrics()

    def record_ttl_refresh(self, symbol: str, exchange: str, interval: str):
        """Record a TTL-triggered refresh"""
        key = f"{symbol}@{exchange}:{interval}"
        self.stats[key]["ttl_refreshes"] += 1
        if ENABLE_METRICS:
            self.save_metrics()

    def get_stats(self, symbol: Optional[str] = None, exchange: Optional[str] = None, interval: Optional[str] = None) -> Dict[str, Any]:
        """Get cache statistics"""
        if symbol and exchange and interval:
            key = f"{symbol}@{exchange}:{interval}"
            return self.stats.get(key, {"hits": 0, "misses": 0, "partial_hits": 0, "errors": 0, "ttl_refreshes": 0})

        # Return aggregated stats
        total = {"hits": 0, "misses": 0, "partial_hits": 0, "errors": 0, "ttl_refreshes": 0, "series_count": len(self.stats)}
        for stats in self.stats.values():
            total["hits"] += stats["hits"]
            total["misses"] += stats["misses"]
            total["partial_hits"] += stats["partial_hits"]
            total["errors"] += stats["errors"]
            total["ttl_refreshes"] += stats["ttl_refreshes"]

        if total["hits"] + total["misses"] + total["partial_hits"] > 0:
            total["hit_rate"] = round(
                (total["hits"] + total["partial_hits"]) /
                (total["hits"] + total["misses"] + total["partial_hits"]) * 100,
                2
            )
        else:
            total["hit_rate"] = 0.0

        return total

    def get_all_series_stats(self) -> Dict[str, Dict[str, Any]]:
        """Get stats for all series"""
        return dict(self.stats)

    def reset(self):
        """Clear all metrics"""
        self.stats.clear()
        self.save_metrics()

# Global metrics instance
_metrics = CacheMetrics() if ENABLE_METRICS else None


# ==================== Data Validation ====================
def validate_data(df: pd.DataFrame, symbol: str, exchange: str, interval: str) -> Dict[str, Any]:
    """
    Validate OHLCV data for common issues.

    Returns:
        Dict with validation results and warnings
    """
    issues = []
    warnings = []

    if df.empty:
        issues.append("DataFrame is empty")
        return {"valid": False, "issues": issues, "warnings": warnings}

    # Check required columns
    required_cols = ["timestamp", "open", "high", "low", "close", "volume"]
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        issues.append(f"Missing required columns: {missing_cols}")

    # Check for nulls
    for col in required_cols:
        if col in df.columns:
            null_count = df[col].isnull().sum()
            if null_count > 0:
                warnings.append(f"Column '{col}' has {null_count} null values")

    # Validate OHLC relationships
    if all(col in df.columns for col in ["open", "high", "low", "close"]):
        invalid_ohlc = (
            (df["high"] < df["low"]) |
            (df["high"] < df["open"]) |
            (df["high"] < df["close"]) |
            (df["low"] > df["open"]) |
            (df["low"] > df["close"])
        ).sum()

        if invalid_ohlc > 0:
            warnings.append(f"Found {invalid_ohlc} bars with invalid OHLC relationships (high < low, etc.)")

    # Check for duplicate timestamps
    if "timestamp" in df.columns:
        dup_count = df["timestamp"].duplicated().sum()
        if dup_count > 0:
            warnings.append(f"Found {dup_count} duplicate timestamps")

    # Check for gaps in time series
    if "timestamp" in df.columns and len(df) > 1:
        df_sorted = df.sort_values("timestamp")
        time_diffs = df_sorted["timestamp"].diff().dropna()
        if len(time_diffs) > 0:
            median_diff = time_diffs.median()
            large_gaps = (time_diffs > median_diff * 2).sum()
            if large_gaps > 0:
                warnings.append(f"Found {large_gaps} large time gaps (> 2x median interval)")

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "row_count": len(df),
        "date_range": f"{df['timestamp'].min()} to {df['timestamp'].max()}" if "timestamp" in df.columns else "N/A"
    }


# ==================== Cache Staleness Check ====================
def is_cache_stale(coverage: Dict[str, Any], ttl_hours: int = CACHE_TTL_HOURS) -> bool:
    """
    Check if cached data is stale based on TTL.

    Args:
        coverage: Coverage info from get_series_coverage
        ttl_hours: Time-to-live in hours

    Returns:
        True if cache is stale and should be refreshed
    """
    if not coverage or coverage.get("last_ts") is None:
        return True

    last_ts = coverage["last_ts"]
    now = pd.Timestamp.now(tz=IST_TZ)
    age_hours = (now - last_ts).total_seconds() / 3600

    return age_hours > ttl_hours


# ==================== Smart History Fetcher ====================
def get_history_smart(
    client,
    symbol: str,
    exchange: str,
    interval: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    force_api: bool = False,
    validate: bool = ENABLE_DATA_VALIDATION,
) -> pd.DataFrame:
    """
    Intelligent history fetcher that checks DB first, then fetches missing data from API.

    Args:
        client: OpenAlgo client instance
        symbol: Trading symbol
        exchange: Exchange (NFO, NSE, etc.)
        interval: Time interval (5m, 15m, 1h, D, etc.)
        start_date: Start date (YYYY-MM-DD) or datetime, defaults to 2 days ago
        end_date: End date (YYYY-MM-DD) or datetime, defaults to yesterday
        force_api: If True, bypass DB and fetch directly from API
        validate: If True, run data validation checks

    Returns:
        DataFrame with columns: [timestamp, open, high, low, close, volume, oi]
        Sorted by timestamp ascending, timezone-aware (Asia/Kolkata)
    """

    # Ensure schema exists
    ensure_schema()

    # Normalize dates
    if start_date is None:
        start_date = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')
    if end_date is None:
        end_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    # Convert to datetime if string
    if isinstance(start_date, str):
        start_dt = pd.to_datetime(start_date).tz_localize(IST_TZ)
    else:
        start_dt = pd.to_datetime(start_date)
        if start_dt.tzinfo is None:
            start_dt = start_dt.tz_localize(IST_TZ)

    if isinstance(end_date, str):
        end_dt = pd.to_datetime(end_date).tz_localize(IST_TZ)
    else:
        end_dt = pd.to_datetime(end_date)
        if end_dt.tzinfo is None:
            end_dt = end_dt.tz_localize(IST_TZ)

    # If force_api, bypass DB check
    if force_api:
        print(f"[DB_AWARE] Force API mode: fetching {symbol} from OpenAlgo...")
        if _metrics:
            _metrics.record_miss(symbol, exchange, interval)
        try:
            # Still upsert to DB for future use
            fetch_history_to_tsdb(symbol, exchange, interval, start_date, end_date)
        except Exception as e:
            print(f"[DB_AWARE] Warning: API fetch failed: {e}")
            if _metrics:
                _metrics.record_error(symbol, exchange, interval)
            # Try reading from DB anyway as fallback

        df = read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)

        if validate and not df.empty:
            validation = validate_data(df, symbol, exchange, interval)
            if not validation["valid"]:
                print(f"[DB_AWARE] ⚠️ Data validation failed: {validation['issues']}")
            if validation["warnings"]:
                print(f"[DB_AWARE] ⚠️ Data warnings: {validation['warnings']}")

        return df

    # Check existing coverage in DB
    coverage = get_series_coverage(symbol, exchange, interval)

    # Check if cache is stale (TTL expired)
    if coverage and is_cache_stale(coverage, CACHE_TTL_HOURS):
        print(f"[DB_AWARE] 🔄 Cache is stale (older than {CACHE_TTL_HOURS}h), refreshing recent data...")
        if _metrics:
            _metrics.record_ttl_refresh(symbol, exchange, interval)

        # Refresh data from last week to now
        refresh_start = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        refresh_end = datetime.now().strftime('%Y-%m-%d')
        try:
            fetch_history_to_tsdb(symbol, exchange, interval, refresh_start, refresh_end)
            coverage = get_series_coverage(symbol, exchange, interval)  # Re-check coverage
        except Exception as e:
            print(f"[DB_AWARE] Warning: TTL refresh failed: {e}")

    if coverage is None:
        # No data in DB, fetch everything from API
        print(f"[DB_AWARE] No data in DB for {symbol} {exchange} {interval}")
        print(f"[DB_AWARE] Fetching {start_date} → {end_date} from OpenAlgo API...")
        if _metrics:
            _metrics.record_miss(symbol, exchange, interval)

        try:
            fetch_history_to_tsdb(symbol, exchange, interval, start_date, end_date)
        except Exception as e:
            print(f"[DB_AWARE] API fetch failed: {e}")
            if _metrics:
                _metrics.record_error(symbol, exchange, interval)
            # Return empty DataFrame
            return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume", "oi"])

        # Read back from DB
        df = read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)

        if validate and not df.empty:
            validation = validate_data(df, symbol, exchange, interval)
            if validation["warnings"]:
                print(f"[DB_AWARE] ⚠️ Data warnings: {validation['warnings']}")

        return df

    # We have some data, check if it covers requested range
    db_start = coverage["first_ts"]
    db_end = coverage["last_ts"]

    print(f"[DB_AWARE] DB coverage for {symbol}: {db_start.date()} → {db_end.date()}")
    print(f"[DB_AWARE] Requested range: {start_dt.date()} → {end_dt.date()}")

    # Check if DB fully covers requested range
    requested_start_date = start_dt.date()
    requested_end_date = end_dt.date()
    coverage_start_date = db_start.date()
    coverage_end_date = db_end.date()

    if coverage_start_date <= requested_start_date and coverage_end_date >= requested_end_date:
        # DB has all requested data
        print(f"[DB_AWARE] ✅ Using cached data from DB (fully covers requested range)")
        if _metrics:
            _metrics.record_hit(symbol, exchange, interval)

        df = read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)

        if validate and not df.empty:
            validation = validate_data(df, symbol, exchange, interval)
            if validation["warnings"]:
                print(f"[DB_AWARE] ⚠️ Data warnings: {validation['warnings']}")

        return df

    # Partial coverage - need to fetch missing ranges
    print(f"[DB_AWARE] 📊 Partial coverage detected, filling gaps...")
    if _metrics:
        _metrics.record_partial_hit(symbol, exchange, interval)

    fetch_needed = False

    if requested_start_date < coverage_start_date:
        # Need data before DB range
        gap_start = start_date
        gap_end = (db_start - timedelta(days=1)).strftime('%Y-%m-%d')
        print(f"[DB_AWARE] Gap detected BEFORE DB range: {gap_start} → {gap_end}")
        print(f"[DB_AWARE] Fetching missing data from API...")
        try:
            fetch_history_to_tsdb(symbol, exchange, interval, gap_start, gap_end)
            fetch_needed = True
        except Exception as e:
            print(f"[DB_AWARE] Warning: Could not fetch earlier data: {e}")
            if _metrics:
                _metrics.record_error(symbol, exchange, interval)

    if requested_end_date > coverage_end_date:
        # Need data after DB range
        gap_start = (db_end + timedelta(days=1)).strftime('%Y-%m-%d')
        gap_end = end_date
        print(f"[DB_AWARE] Gap detected AFTER DB range: {gap_start} → {gap_end}")
        print(f"[DB_AWARE] Fetching missing data from API...")
        try:
            fetch_history_to_tsdb(symbol, exchange, interval, gap_start, gap_end)
            fetch_needed = True
        except Exception as e:
            print(f"[DB_AWARE] Warning: Could not fetch later data: {e}")
            if _metrics:
                _metrics.record_error(symbol, exchange, interval)

    if fetch_needed:
        print(f"[DB_AWARE] ✅ Backfilled gaps, now using DB with updated coverage")

    # Read unified data from DB (now includes any backfilled ranges)
    df = read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)

    if validate and not df.empty:
        validation = validate_data(df, symbol, exchange, interval)
        if validation["warnings"]:
            print(f"[DB_AWARE] ⚠️ Data warnings: {validation['warnings']}")

    return df


def get_history_smart_with_client_history(
    client,
    symbol: str,
    exchange: str,
    interval: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> pd.DataFrame:
    """
    Wrapper that mimics the original client.history() interface.
    Drop-in replacement for strategies that use: client.history(...)

    This function has the same signature but uses intelligent DB caching.
    """
    return get_history_smart(client, symbol, exchange, interval, start_date, end_date)


# For backward compatibility with water-life-copy/fetch_history.py
def fetch_history_smart(
    client,
    symbol: str,
    exchange: str,
    interval: str,
    start_date: str,
    end_date: str,
    output_csv: Optional[str] = None
) -> str:
    """
    Fetch historical data intelligently (DB-aware) and save to CSV.

    Compatible with the original fetch_history.py interface.

    Returns:
        Path to the output CSV file
    """
    if output_csv is None:
        output_csv = f"{symbol}_history.csv"

    df = get_history_smart(client, symbol, exchange, interval, start_date, end_date)

    if df.empty:
        print(f"⚠️ No data retrieved for {symbol} {exchange} {interval}")
    else:
        # Save to CSV
        df.to_csv(output_csv)
        print(f"✅ Historical data saved to {output_csv} ({len(df)} rows)")

    return output_csv


# ==================== Cache Management Functions ====================
def get_cache_stats(symbol: Optional[str] = None, exchange: Optional[str] = None, interval: Optional[str] = None) -> Dict[str, Any]:
    """
    Get cache performance statistics.

    Args:
        symbol: Optional symbol filter
        exchange: Optional exchange filter
        interval: Optional interval filter

    Returns:
        Dict with cache statistics
    """
    if not _metrics:
        return {"error": "Metrics tracking is disabled. Set ENABLE_CACHE_METRICS=true"}

    return _metrics.get_stats(symbol, exchange, interval)


def get_all_series_stats() -> Dict[str, Dict[str, Any]]:
    """Get statistics for all cached series"""
    if not _metrics:
        return {"error": "Metrics tracking is disabled"}

    return _metrics.get_all_series_stats()


def reset_cache_stats():
    """Reset all cache statistics"""
    if _metrics:
        _metrics.reset()
        print("[DB_AWARE] ✅ Cache statistics reset")
    else:
        print("[DB_AWARE] ⚠️ Metrics tracking is disabled")


def clear_cache_for_series(symbol: str, exchange: str, interval: str) -> int:
    """
    Clear cached data for a specific series.

    Returns:
        Number of rows deleted
    """
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM ohlcv
                WHERE symbol = %(symbol)s
                  AND exchange = %(exchange)s
                  AND interval = %(interval)s
                """,
                {"symbol": symbol, "exchange": exchange, "interval": interval}
            )
            deleted = cur.rowcount
            conn.commit()

        print(f"[DB_AWARE] 🗑️ Deleted {deleted} rows for {symbol}@{exchange}:{interval}")
        return deleted
    except Exception as e:
        print(f"[DB_AWARE] ❌ Error clearing cache: {e}")
        return 0


def list_cached_series() -> pd.DataFrame:
    """
    List all cached series in the database.

    Returns:
        DataFrame with series info (symbol, exchange, interval, coverage, row count)
    """
    try:
        with get_conn() as conn:
            sql = """
                SELECT
                    symbol,
                    exchange,
                    interval,
                    MIN(ts) AS first_ts,
                    MAX(ts) AS last_ts,
                    COUNT(*)::bigint AS rows_count
                FROM ohlcv
                GROUP BY symbol, exchange, interval
                ORDER BY symbol, exchange, interval;
            """
            df = pd.read_sql(sql, conn, parse_dates=["first_ts", "last_ts"])

        if df.empty:
            print("[DB_AWARE] No cached series found")
            return df

        # Convert to IST timezone
        df["first_ts"] = pd.to_datetime(df["first_ts"], utc=True).dt.tz_convert(IST_TZ)
        df["last_ts"] = pd.to_datetime(df["last_ts"], utc=True).dt.tz_convert(IST_TZ)

        # Calculate age
        now = pd.Timestamp.now(tz=IST_TZ)
        df["age_hours"] = ((now - df["last_ts"]).dt.total_seconds() / 3600).round(1)
        df["stale"] = df["age_hours"] > CACHE_TTL_HOURS

        return df
    except Exception as e:
        print(f"[DB_AWARE] ❌ Error listing cached series: {e}")
        return pd.DataFrame()


def health_check() -> Dict[str, Any]:
    """
    Run a health check on the caching system.

    Returns:
        Dict with health status and diagnostics
    """
    health = {
        "status": "healthy",
        "timestamp": datetime.now(tz=IST_TZ).isoformat(),
        "issues": [],
        "warnings": []
    }

    try:
        # Check database connection
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            health["database_connected"] = True

            # Check if ohlcv table exists
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'ohlcv'
                )
            """)
            health["table_exists"] = cur.fetchone()[0]

            if health["table_exists"]:
                # Get table stats
                cur.execute("SELECT COUNT(*) FROM ohlcv")
                health["total_rows"] = cur.fetchone()[0]

                cur.execute("""
                    SELECT COUNT(DISTINCT (symbol, exchange, interval))
                    FROM ohlcv
                """)
                health["series_count"] = cur.fetchone()[0]
            else:
                health["issues"].append("Table 'ohlcv' does not exist")
                health["status"] = "unhealthy"

    except Exception as e:
        health["database_connected"] = False
        health["issues"].append(f"Database connection failed: {e}")
        health["status"] = "unhealthy"

    # Check metrics
    if ENABLE_METRICS and _metrics:
        health["metrics_enabled"] = True
        health["cache_stats"] = _metrics.get_stats()
    else:
        health["metrics_enabled"] = False
        health["warnings"].append("Cache metrics tracking is disabled")

    # Check for stale series
    try:
        cached_series = list_cached_series()
        if not cached_series.empty:
            stale_count = cached_series["stale"].sum()
            if stale_count > 0:
                health["warnings"].append(f"{stale_count} series have stale data (older than {CACHE_TTL_HOURS}h)")
                health["stale_series_count"] = int(stale_count)
    except Exception as e:
        health["warnings"].append(f"Could not check for stale series: {e}")

    return health
