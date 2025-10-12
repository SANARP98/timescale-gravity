"""
Database operations for storing and retrieving backtest results.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from psycopg2.extras import Json
from tsdb_pipeline import get_conn

logger = logging.getLogger(__name__)


CREATE_RESULTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tester_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    strategy TEXT NOT NULL,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    interval TEXT NOT NULL,
    params JSONB NOT NULL,
    summary JSONB NOT NULL
);
"""


def ensure_results_table() -> None:
    """Ensure the results table exists."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(CREATE_RESULTS_TABLE_SQL)
        conn.commit()


def insert_result(
    strategy: str,
    symbol: str,
    exchange: str,
    interval: str,
    params: Dict[str, Any],
    summary: Dict[str, Any],
) -> None:
    """Insert a backtest result into the database."""
    ensure_results_table()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tester_results (strategy, symbol, exchange, interval, params, summary)
            VALUES (%(strategy)s, %(symbol)s, %(exchange)s, %(interval)s, %(params)s, %(summary)s);
            """,
            {
                "strategy": strategy,
                "symbol": symbol,
                "exchange": exchange,
                "interval": interval,
                "params": Json(params),
                "summary": Json(summary),
            },
        )
        conn.commit()
    logger.info(f"Stored result: {strategy} {symbol} {params}")


def clear_results_table() -> None:
    """Clear all results from the table."""
    ensure_results_table()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE tester_results;")
        conn.commit()
    logger.info("Cleared results table")


def db_stats() -> Dict[str, Any]:
    """Get database statistics."""
    ensure_results_table()
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*), COALESCE(SUM(pg_column_size(summary)), 0) FROM tester_results;")
        count_row = cur.fetchone() or (0, 0)

        cur.execute(
            "SELECT pg_database_size(current_database()), pg_size_pretty(pg_database_size(current_database()));"
        )
        db_row = cur.fetchone() or (0, "0 bytes")

        cur.execute("SELECT pg_total_relation_size('tester_results');")
        table_bytes = cur.fetchone()

    return {
        "results_rows": int(count_row[0]),
        "results_payload_bytes": int(count_row[1]),
        "database_bytes": int(db_row[0]),
        "database_pretty": str(db_row[1]),
        "results_table_bytes": int(table_bytes[0]) if table_bytes and table_bytes[0] is not None else 0,
    }
