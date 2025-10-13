#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DB-Aware History Fetcher
------------------------
Intelligent data layer that checks TimescaleDB first before fetching from API.

Features:
- Checks DB coverage before making API calls
- Only fetches missing date ranges from OpenAlgo API
- Automatically backfills gaps in data
- Returns unified results from DB
- Zero breaking changes for existing strategies

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
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
from dotenv import load_dotenv

# Import TimescaleDB functions from parent directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tsdb_pipeline import (
    ensure_schema,
    get_series_coverage,
    fetch_history_to_tsdb,
    read_ohlcv_from_tsdb,
)

load_dotenv()
IST_TZ = "Asia/Kolkata"


def get_history_smart(
    client,
    symbol: str,
    exchange: str,
    interval: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    force_api: bool = False,
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
        try:
            # Still upsert to DB for future use
            fetch_history_to_tsdb(symbol, exchange, interval, start_date, end_date)
        except Exception as e:
            print(f"[DB_AWARE] Warning: API fetch failed: {e}")
            # Try reading from DB anyway as fallback

        return read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)

    # Check existing coverage in DB
    coverage = get_series_coverage(symbol, exchange, interval)

    if coverage is None:
        # No data in DB, fetch everything from API
        print(f"[DB_AWARE] No data in DB for {symbol} {exchange} {interval}")
        print(f"[DB_AWARE] Fetching {start_date} → {end_date} from OpenAlgo API...")

        try:
            fetch_history_to_tsdb(symbol, exchange, interval, start_date, end_date)
        except Exception as e:
            print(f"[DB_AWARE] API fetch failed: {e}")
            # Return empty DataFrame
            return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume", "oi"])

        # Read back from DB
        return read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)

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
        return read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)

    # Partial coverage - need to fetch missing ranges
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

    if fetch_needed:
        print(f"[DB_AWARE] ✅ Backfilled gaps, now using DB with updated coverage")

    # Read unified data from DB (now includes any backfilled ranges)
    return read_ohlcv_from_tsdb(symbol, exchange, interval, start_dt, end_dt, target_tz=IST_TZ)


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
