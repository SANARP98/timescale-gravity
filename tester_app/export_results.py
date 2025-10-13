#!/usr/bin/env python3
"""
Export tester_results table to CSV or Excel.

Usage:
    python tester_app/export_results.py --format csv --output results.csv
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
import psycopg2.extras as extras

from tsdb_pipeline import get_conn

SUMMARY_KEYS = [
    "trades",
    "wins",
    "losses",
    "winrate_percent",
    "net_rupees",
    "gross_rupees",
    "costs_rupees",
    "roi_percent",
    "risk_reward",
    "last_run_at",
]


def fetch_results(ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    sql = """
        SELECT id, created_at, strategy, symbol, exchange, interval, test_name, params, summary
        FROM tester_results
        {where_clause}
        ORDER BY created_at ASC;
    """
    where_clause = ""
    params: Dict[str, Any] = {}
    if ids:
        # Cast the array elements to UUID type to match the id column type
        where_clause = "WHERE id = ANY(%(ids)s::uuid[])"
        params["ids"] = ids

    query = sql.format(where_clause=where_clause)

    with get_conn() as conn, conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return rows or []


def flatten_row(row: Dict[str, Any]) -> Dict[str, Any]:
    params = row.get("params") or {}
    if isinstance(params, str):
        params = json.loads(params)

    summary = row.get("summary") or {}
    if isinstance(summary, str):
        summary = json.loads(summary)

    flat: Dict[str, Any] = {
        "id": row.get("id"),
        "created_at": row.get("created_at"),
        "strategy": row.get("strategy"),
        "symbol": row.get("symbol"),
        "exchange": row.get("exchange"),
        "interval": row.get("interval"),
    }

    if "test_name" in row:
        flat["test_name"] = row.get("test_name")

    for key, value in sorted(params.items()):
        flat[f"param_{key}"] = value

    for key in SUMMARY_KEYS:
        if key in summary:
            flat[f"summary_{key}"] = summary[key]

    extra_summary_keys = sorted(k for k in summary.keys() if k not in SUMMARY_KEYS)
    for key in extra_summary_keys:
        flat[f"summary_{key}"] = summary[key]

    return flat


def export_results(format: str, output_path: Path, ids: Optional[List[str]] = None) -> Path:
    rows = fetch_results(ids=ids)
    if not rows:
        raise RuntimeError("tester_results table is empty. Run the tester first.")

    flat_rows = [flatten_row(row) for row in rows]
    df = pd.DataFrame(flat_rows)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if format == "csv":
        df.to_csv(output_path, index=False)
    elif format in {"xlsx", "excel"}:
        df.to_excel(output_path, index=False)
    else:
        raise ValueError(f"Unsupported format: {format}")

    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export tester results to CSV or Excel.")
    parser.add_argument(
        "--format",
        "-f",
        choices=["csv", "xlsx"],
        default="csv",
        help="Output format (default: csv)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Output file path. Default: tester_results_<timestamp>.{format}",
    )
    parser.add_argument(
        "--ids",
        nargs="*",
        default=None,
        help="Optional list of tester_result UUIDs to export. Default exports all rows.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.output is None:
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        suffix = "csv" if args.format == "csv" else "xlsx"
        args.output = Path(f"/tmp/tester_results_{timestamp}.{suffix}")

    output_path = export_results(args.format, args.output, ids=args.ids)
    print(f"✅ Exported {args.format.upper()} to {output_path}")


if __name__ == "__main__":
    main()
