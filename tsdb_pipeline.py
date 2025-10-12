#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TimescaleDB ingest + reader for OpenAlgo OHLCV bars
- Creates schema if missing
- Fetches history from OpenAlgo
- Upserts into TimescaleDB (hypertable ohlcv)
- Exposes a reader to get a pandas DataFrame for backtests
- Automatically fetches both PE and CE for option symbols
"""

import os
import sys
from datetime import timedelta
from typing import Optional

import pandas as pd
from dotenv import load_dotenv

import psycopg2
import psycopg2.extras as extras

from symbol_utils import get_option_pair, is_option_symbol


# ---------- ENV ----------
load_dotenv()
PGHOST = os.getenv("PGHOST", "localhost")
PGPORT = int(os.getenv("PGPORT", "5432"))
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "postgres")
PGDATABASE = os.getenv("PGDATABASE", "trading")

API_KEY = os.getenv("API_KEY")
API_HOST = os.getenv("OPENALGO_API_HOST")


# ---------- CONSTANTS ----------
IST_TZ = "Asia/Kolkata"


# ---------- DB ----------
def get_conn():
    return psycopg2.connect(
        host=PGHOST,
        port=PGPORT,
        user=PGUSER,
        password=PGPASSWORD,
        dbname=PGDATABASE,
        options="-c TimeZone=UTC",
    )


SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ohlcv (
  ts           TIMESTAMPTZ       NOT NULL,
  symbol       TEXT              NOT NULL,
  exchange     TEXT              NOT NULL,
  interval     TEXT              NOT NULL,
  open         DOUBLE PRECISION  NOT NULL,
  high         DOUBLE PRECISION  NOT NULL,
  low          DOUBLE PRECISION  NOT NULL,
  close        DOUBLE PRECISION  NOT NULL,
  volume       DOUBLE PRECISION  NOT NULL,
  oi           DOUBLE PRECISION  NULL,
  PRIMARY KEY (ts, symbol, exchange, interval)
);

SELECT create_hypertable('ohlcv', by_range('ts'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS ohlcv_sei_ts_idx
  ON ohlcv (symbol, exchange, interval, ts DESC);

ALTER TABLE ohlcv SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol,exchange,interval'
);
"""


def ensure_schema():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
        conn.commit()


def get_series_coverage(symbol: str, exchange: str, interval: str) -> Optional[dict]:
    """Return coverage metadata (min/max ts, row count) for a series."""

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*)::bigint AS rows_count
            FROM ohlcv
            WHERE symbol = %(symbol)s
              AND exchange = %(exchange)s
              AND interval = %(interval)s
        """,
            {"symbol": symbol, "exchange": exchange, "interval": interval},
        )
        row = cur.fetchone()

    if not row or row[2] == 0:
        return None

    first_ts = pd.to_datetime(row[0], utc=True) if row[0] else None
    last_ts = pd.to_datetime(row[1], utc=True) if row[1] else None

    return {
        "first_ts": first_ts,
        "last_ts": last_ts,
        "rows_count": int(row[2]),
    }


def _as_rows(df: pd.DataFrame, symbol: str, exchange: str, interval: str):
    # Ensure DatetimeIndex
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)

    # Standardize to (open, high, low, close, volume, oi)
    for ts, row in df.iterrows():
        yield (
            ts.to_pydatetime(),
            symbol,
            exchange,
            interval,
            float(row["open"]),
            float(row["high"]),
            float(row["low"]),
            float(row["close"]),
            float(row.get("volume", 0.0)),
            float(row.get("oi", 0.0)) if pd.notna(row.get("oi", None)) else None,
        )


UPSERT_SQL = """
INSERT INTO ohlcv (ts, symbol, exchange, interval, open, high, low, close, volume, oi)
VALUES %s
ON CONFLICT (ts, symbol, exchange, interval) DO UPDATE
SET open = EXCLUDED.open,
    high = EXCLUDED.high,
    low  = EXCLUDED.low,
    close= EXCLUDED.close,
    volume = EXCLUDED.volume,
    oi = EXCLUDED.oi;
"""


def upsert_ohlcv(df: pd.DataFrame, symbol: str, exchange: str, interval: str, batch: int = 5000):
    if df is None or df.empty:
        return 0

    rows_iter = _as_rows(df, symbol, exchange, interval)
    affected = 0

    with get_conn() as conn, conn.cursor() as cur:
        batch_rows = []
        for r in rows_iter:
            batch_rows.append(r)
            if len(batch_rows) >= batch:
                extras.execute_values(cur, UPSERT_SQL, batch_rows, page_size=batch)
                affected += len(batch_rows)
                batch_rows.clear()
        if batch_rows:
            extras.execute_values(cur, UPSERT_SQL, batch_rows, page_size=batch)
            affected += len(batch_rows)
        conn.commit()
    return affected


def _to_dataframe(payload) -> pd.DataFrame:
    if isinstance(payload, pd.DataFrame):
        df = payload.copy()
    elif payload is None:
        return pd.DataFrame()
    else:
        current = payload
        if isinstance(current, dict):
            if "data" in current and isinstance(current["data"], (list, tuple)):
                current = current["data"]
            else:
                current = [current]
        try:
            df = pd.DataFrame.from_records(current)
        except Exception as exc:  # pragma: no cover - defensive
            raise RuntimeError(
                f"Unexpected response type from OpenAlgo history: {type(payload)}"
            ) from exc

    df = _denormalize_frame(df)
    df = _lowercase_columns(df)
    df = _apply_aliases(df)
    return df


def _lowercase_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(col).split(".")[-1].lower() for col in df.columns]
    return df


def _denormalize_frame(df: pd.DataFrame, max_depth: int = 3) -> pd.DataFrame:
    current = df.copy()
    depth = 0
    while depth < max_depth:
        if current.empty:
            return current
        first_value = current.iloc[0, 0]
        if len(current.columns) == 1 and isinstance(first_value, dict):
            current = pd.json_normalize(current.iloc[:, 0])
            depth += 1
            continue
        break
    # Flatten columns with dict entries
    for col in list(current.columns):
        if current[col].apply(lambda v: isinstance(v, dict)).any():
            expanded = pd.json_normalize(current[col].apply(lambda v: v or {}))
            expanded.columns = [f"{col}.{c}" for c in expanded.columns]
            current = current.drop(columns=[col]).join(expanded)
    return current


def _apply_aliases(df: pd.DataFrame) -> pd.DataFrame:
    aliases = {
        "o": "open",
        "openprice": "open",
        "open_price": "open",
        "openvalue": "open",
        "open_val": "open",
        "op": "open",
        "h": "high",
        "highprice": "high",
        "high_price": "high",
        "highvalue": "high",
        "l": "low",
        "lowprice": "low",
        "low_price": "low",
        "lowvalue": "low",
        "c": "close",
        "closeprice": "close",
        "close_price": "close",
        "closevalue": "close",
        "cp": "close",
        "v": "volume",
        "vol": "volume",
        "volume_value": "volume",
        "volume_traded": "volume",
    }
    rename_map = {}
    for col in df.columns:
        if col in aliases and aliases[col] not in df.columns:
            rename_map[col] = aliases[col]
    if rename_map:
        df = df.rename(columns=rename_map)
    return df


def list_available_series(target_tz: Optional[str] = "Asia/Kolkata", sort_order: str = "desc") -> list[dict]:
    """
    List all available series in TimescaleDB.

    Args:
        target_tz: Target timezone for timestamps (default: Asia/Kolkata)
        sort_order: Sort order for results - "asc" or "desc" (default: desc)

    Returns:
        List of series metadata dictionaries
    """
    order = "ASC" if sort_order.lower() == "asc" else "DESC"

    with get_conn() as conn:
        sql = f"""
            SELECT
                symbol,
                exchange,
                interval,
                MIN(ts) AS first_ts,
                MAX(ts) AS last_ts,
                COUNT(*)::bigint AS rows_count
            FROM ohlcv
            GROUP BY symbol, exchange, interval
            ORDER BY symbol {order}, exchange {order}, interval {order};
        """
        df = pd.read_sql(sql, conn, parse_dates=["first_ts", "last_ts"])

    if df.empty:
        return []

    if target_tz:
        df["first_ts"] = pd.to_datetime(df["first_ts"], utc=True).dt.tz_convert(target_tz)
        df["last_ts"] = pd.to_datetime(df["last_ts"], utc=True).dt.tz_convert(target_tz)
    else:
        df["first_ts"] = pd.to_datetime(df["first_ts"], utc=True)
        df["last_ts"] = pd.to_datetime(df["last_ts"], utc=True)

    return [
        {
            "symbol": row["symbol"],
            "exchange": row["exchange"],
            "interval": row["interval"],
            "start_ts": row["first_ts"].isoformat() if pd.notna(row["first_ts"]) else None,
            "end_ts": row["last_ts"].isoformat() if pd.notna(row["last_ts"]) else None,
            "rows_count": int(row["rows_count"]),
        }
        for _, row in df.iterrows()
    ]


def delete_series(symbol: str, exchange: str, interval: str) -> int:
    """
    Delete all data for a specific series from TimescaleDB.

    Args:
        symbol: The symbol to delete
        exchange: The exchange
        interval: The interval

    Returns:
        Number of rows deleted
    """
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

    print(f"🗑️  Deleted {deleted} rows for {symbol} {exchange} {interval}")
    return deleted


def _fetch_single_symbol(
    symbol: str,
    exchange: str,
    interval: str,
    start_date: str,
    end_date: str,
    also_save_csv: Optional[str] = None,
) -> int:
    """Internal function to fetch a single symbol"""

    def _coerce_ist(value: str, field_name: str) -> pd.Timestamp:
        if not value:
            raise ValueError(f"{field_name} is required")
        try:
            ts = pd.to_datetime(value)
        except (TypeError, ValueError) as exc:  # pragma: no cover - defensive
            raise ValueError(f"Invalid {field_name}: {value}") from exc
        if ts.tzinfo is None:
            ts = ts.tz_localize(IST_TZ)
        else:
            ts = ts.tz_convert(IST_TZ)
        return ts

    start_ist = _coerce_ist(start_date, "start_date")
    end_ist = _coerce_ist(end_date, "end_date")

    if end_ist < start_ist:
        raise ValueError("end_date must be on or after start_date")

    requested_start_date = start_ist.date()
    requested_end_date = end_ist.date()

    fetch_windows: list[tuple[pd.Timestamp, pd.Timestamp]] = []

    coverage = get_series_coverage(symbol, exchange, interval)
    if coverage and coverage["first_ts"] is not None and coverage["last_ts"] is not None:
        coverage_start_date = coverage["first_ts"].tz_convert(IST_TZ).date()
        coverage_end_date = coverage["last_ts"].tz_convert(IST_TZ).date()

        if (
            requested_start_date >= coverage_start_date
            and requested_end_date <= coverage_end_date
        ):
            print(
                f"ℹ️ Requested {symbol} {exchange} {interval} window "
                f"{requested_start_date} → {requested_end_date} already present in TimescaleDB."
            )
            return 0

        if requested_start_date < coverage_start_date:
            fetch_start = requested_start_date
            fetch_end = min(requested_end_date, coverage_start_date - timedelta(days=1))
            if fetch_start <= fetch_end:
                fetch_windows.append((fetch_start, fetch_end))

        if requested_end_date > coverage_end_date:
            fetch_start = max(requested_start_date, coverage_end_date + timedelta(days=1))
            fetch_end = requested_end_date
            if fetch_start <= fetch_end:
                fetch_windows.append((fetch_start, fetch_end))

        if not fetch_windows:
            print(
                f"ℹ️ Requested {symbol} {exchange} {interval} window "
                f"{requested_start_date} → {requested_end_date} already present in TimescaleDB."
            )
            return 0
    else:
        fetch_windows.append((requested_start_date, requested_end_date))

    try:
        from openalgo import api as openalgo_api  # pylint: disable=import-error
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "Missing dependency `openalgo`. Install within the container image or virtualenv."
        ) from exc

    client = openalgo_api(api_key=API_KEY, host=API_HOST)

    total_rows = 0
    csv_frames: list[pd.DataFrame] = []

    for window_start, window_end in fetch_windows:
        fetch_start_str = window_start.isoformat()
        fetch_end_str = window_end.isoformat()
        print(
            f"⬇️ Fetching {symbol} {exchange} {interval} | {fetch_start_str} → {fetch_end_str} (IST)"
        )

        raw = client.history(
            symbol=symbol,
            exchange=exchange,
            interval=interval,
            start_date=fetch_start_str,
            end_date=fetch_end_str,
        )
        df = _to_dataframe(raw)
        if {"error", "message"}.issubset(df.columns):
            raise RuntimeError(f"OpenAlgo error: {df.iloc[0]['message']}")
        if "error" in df.columns and "message" not in df.columns:
            raise RuntimeError(f"OpenAlgo error response: {df.iloc[0]['error']}")
        if "status" in df.columns and df["status"].iloc[0] not in ("ok", "success"):
            detail = df["status"].iloc[0]
            if "message" in df.columns:
                detail = f"{detail}: {df['message'].iloc[0]}"
            raise RuntimeError(f"OpenAlgo status {detail}")

        if df.empty:
            print(
                f"⚠️ OpenAlgo returned no rows for {symbol} {exchange} {interval} in "
                f"{fetch_start_str} → {fetch_end_str}. Skipping."
            )
            continue

        if "timestamp" in df.columns:
            df = df.set_index(pd.to_datetime(df["timestamp"], utc=False))
            df = df.drop(columns=["timestamp"])

        expected = {"open", "high", "low", "close", "volume"}
        if not expected.issubset(set(df.columns)):
            col_map = {}
            for c in ["open", "high", "low", "close", "volume", "oi"]:
                if c in df.columns:
                    col_map[c] = c
            missing = expected - set(col_map.keys())
            if missing:
                raise ValueError(f"Missing columns in history DataFrame: {missing}")
            df = df.rename(columns=col_map)

        idx = pd.to_datetime(df.index)
        if idx.tz is None:
            idx = idx.tz_localize("Asia/Kolkata")
        df.index = idx.tz_convert("UTC")

        rows = upsert_ohlcv(df, symbol, exchange, interval)
        total_rows += rows
        print(f"✅ Upserted {rows} rows for {symbol} {exchange} {interval} ({fetch_start_str} → {fetch_end_str})")

        if also_save_csv:
            csv_frames.append(df)

    if also_save_csv and csv_frames:
        combined = pd.concat(csv_frames).sort_index()
        combined.to_csv(also_save_csv)
        print(f"💾 Saved combined CSV to {also_save_csv}")

    if total_rows == 0:
        print(
            f"ℹ️ No new rows were ingested for {symbol} {exchange} {interval} in the requested range."
        )
    else:
        print(
            f"✅ Upserted total {total_rows} rows into TimescaleDB for {symbol} {exchange} {interval}"
        )

    return total_rows


def fetch_history_to_tsdb(
    symbol: str,
    exchange: str,
    interval: str,
    start_date: str,
    end_date: str,
    also_save_csv: Optional[str] = None,
) -> int:
    """
    Pull from OpenAlgo → upsert into TimescaleDB.

    If the symbol is an option (ends with PE or CE), automatically fetches
    both PE and CE variants.

    Returns: total rows upserted across all symbols
    """
    ensure_schema()

    # Check if this is an option symbol
    if is_option_symbol(symbol):
        pe_symbol, ce_symbol = get_option_pair(symbol)
        print(f"📊 Detected option symbol. Will fetch both {pe_symbol} and {ce_symbol}")

        total_rows = 0

        # Fetch PE
        if pe_symbol:
            print(f"\n🔵 Fetching PE: {pe_symbol}")
            csv_pe = f"{pe_symbol}_{also_save_csv}" if also_save_csv else None
            rows_pe = _fetch_single_symbol(
                pe_symbol, exchange, interval, start_date, end_date, csv_pe
            )
            total_rows += rows_pe

        # Fetch CE
        if ce_symbol:
            print(f"\n🔴 Fetching CE: {ce_symbol}")
            csv_ce = f"{ce_symbol}_{also_save_csv}" if also_save_csv else None
            rows_ce = _fetch_single_symbol(
                ce_symbol, exchange, interval, start_date, end_date, csv_ce
            )
            total_rows += rows_ce

        print(f"\n✅ Total upserted: {total_rows} rows ({pe_symbol} + {ce_symbol})")
        return total_rows
    else:
        # Regular symbol, fetch as usual
        return _fetch_single_symbol(symbol, exchange, interval, start_date, end_date, also_save_csv)


def read_ohlcv_from_tsdb(
    symbol: str,
    exchange: str,
    interval: str,
    start_ts: Optional[str] = None,
    end_ts: Optional[str] = None,
    target_tz: Optional[str] = "Asia/Kolkata",
) -> pd.DataFrame:
    """Read a sliced window into a pandas DataFrame (sorted ascending)"""
    with get_conn() as conn:
        if target_tz:
            with conn.cursor() as cur:
                cur.execute("SET TIME ZONE %s", (target_tz,))

        where = ["symbol = %(symbol)s", "exchange = %(exchange)s", "interval = %(interval)s"]
        params = {"symbol": symbol, "exchange": exchange, "interval": interval}
        if start_ts:
            where.append("ts >= %(start_ts)s")
            params["start_ts"] = start_ts
        if end_ts:
            where.append("ts <= %(end_ts)s")
            params["end_ts"] = end_ts

        sql = f"""
            SELECT ts, open, high, low, close, volume, oi
            FROM ohlcv
            WHERE {' AND '.join(where)}
            ORDER BY ts ASC
        """
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame.from_records(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)

    df = df.set_index("ts")
    idx = pd.to_datetime(df.index)
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    if target_tz:
        idx = idx.tz_convert(target_tz)
    df.index = idx
    return df


if __name__ == "__main__":  # pragma: no cover
    if len(sys.argv) < 6:
        print(
            "Usage: tsdb_pipeline.py SYMBOL EXCHANGE INTERVAL START_DATE END_DATE [CSV]",
            file=sys.stderr,
        )
        raise SystemExit(1)

    symbol, exchange, interval, start_date, end_date = sys.argv[1:6]
    csv_path = sys.argv[6] if len(sys.argv) > 6 else None
    try:
        fetch_history_to_tsdb(symbol, exchange, interval, start_date, end_date, csv_path)
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc
