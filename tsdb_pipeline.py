#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TimescaleDB ingest + reader for OpenAlgo OHLCV bars
- Creates schema if missing
- Fetches history from OpenAlgo
- Upserts into TimescaleDB (hypertable ohlcv)
- Exposes a reader to get a pandas DataFrame for backtests
"""

import os
import sys
from typing import Optional

import pandas as pd
from dotenv import load_dotenv

import psycopg2
import psycopg2.extras as extras


# ---------- ENV ----------
load_dotenv()
PGHOST = os.getenv("PGHOST", "localhost")
PGPORT = int(os.getenv("PGPORT", "5432"))
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "postgres")
PGDATABASE = os.getenv("PGDATABASE", "trading")

API_KEY = os.getenv("API_KEY")
API_HOST = os.getenv("OPENALGO_API_HOST")


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


def list_available_series(target_tz: Optional[str] = "Asia/Kolkata") -> list[dict]:
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


def fetch_history_to_tsdb(
    symbol: str,
    exchange: str,
    interval: str,
    start_date: str,
    end_date: str,
    also_save_csv: Optional[str] = None,
):
    """Pull from OpenAlgo → upsert into TimescaleDB"""
    ensure_schema()

    try:
        from openalgo import api as openalgo_api  # pylint: disable=import-error
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "Missing dependency `openalgo`. Install within the container image or virtualenv."
        ) from exc

    client = openalgo_api(api_key=API_KEY, host=API_HOST)

    raw = client.history(
        symbol=symbol,
        exchange=exchange,
        interval=interval,
        start_date=start_date,
        end_date=end_date,
    )
    df = _to_dataframe(raw)
    if df.empty:
        print(f"⚠️ OpenAlgo returned no rows for {symbol} {exchange} {interval}.")
        return 0

    # Normalize DataFrame columns
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

    if also_save_csv:
        df.to_csv(also_save_csv)

    n = upsert_ohlcv(df, symbol, exchange, interval)
    print(f"✅ Upserted {n} rows into TimescaleDB for {symbol} {exchange} {interval}")
    return n


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
        df = pd.read_sql(sql, conn, params=params, parse_dates=["ts"])

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
