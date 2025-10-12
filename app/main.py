from pathlib import Path
import numbers
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from backtest_tsdb import run_backtest_from_config
from tsdb_pipeline import fetch_history_to_tsdb, list_available_series, delete_series

TRADE_COLUMNS = [
    "entry_time",
    "exit_time",
    "symbol",
    "side",
    "entry",
    "exit",
    "gross_rupees",
    "costs_rupees",
    "pnl_rupees",
    "exit_reason",
]


def _to_ist_iso(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if not isinstance(value, pd.Timestamp):
        try:
            value = pd.to_datetime(value)
        except (TypeError, ValueError):
            return None
    if value.tzinfo is None:
        value = value.tz_localize("UTC")
    return value.tz_convert("Asia/Kolkata").isoformat()


def _serialize_trades(trades: pd.DataFrame, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    if trades.empty:
        return []

    available_cols = [c for c in TRADE_COLUMNS if c in trades.columns]
    frame = trades[available_cols].copy()
    if limit:
        frame = frame.tail(limit)

    records = frame.to_dict(orient="records")
    for record in records:
        for time_field in ("entry_time", "exit_time"):
            record[time_field] = _to_ist_iso(record.get(time_field))
        for key, value in list(record.items()):
            if value is None or value == "":
                record[key] = None
                continue
            if isinstance(value, numbers.Integral):
                record[key] = int(value)
            elif isinstance(value, numbers.Number):
                record[key] = float(value)
            elif pd.isna(value):
                record[key] = None
            else:
                record[key] = value
    return records


class FetchRequest(BaseModel):
    symbol: str = Field(..., description="Instrument symbol")
    exchange: str = Field(..., description="Exchange name (e.g., NFO)")
    interval: str = Field(..., description="Bar interval (e.g., 5m)")
    start_date: str = Field(..., description="Start date (YYYY-MM-DD)")
    end_date: str = Field(..., description="End date (YYYY-MM-DD)")
    also_save_csv: Optional[str] = Field(
        default=None, description="Optional path to dump fetched history as CSV"
    )


class FetchResponse(BaseModel):
    rows_upserted: int


class InventoryItem(BaseModel):
    symbol: str
    exchange: str
    interval: str
    start_ts: Optional[str] = None
    end_ts: Optional[str] = None
    rows_count: int


class BacktestRequest(BaseModel):
    symbol: Optional[str] = None
    exchange: Optional[str] = None
    interval: Optional[str] = None
    start_date: Optional[str] = Field(default=None, alias="start_date")
    end_date: Optional[str] = Field(default=None, alias="end_date")
    starting_capital: Optional[float] = None
    qty_per_point: Optional[int] = None
    target_points: Optional[float] = None
    stoploss_points: Optional[float] = None
    ema_fast: Optional[int] = None
    ema_slow: Optional[int] = None
    atr_window: Optional[int] = None
    atr_min_points: Optional[float] = None
    daily_loss_cap: Optional[float] = None
    exit_bar_path: Optional[str] = Field(default=None, pattern="^(color|bull|bear|worst)$")
    brokerage_per_trade: Optional[float] = None
    slippage_points: Optional[float] = None
    confirm_trend_at_entry: Optional[bool] = None
    enable_eod_square_off: Optional[bool] = None
    square_off_time: Optional[str] = Field(default=None, description="HH:MM (IST)")
    trade_direction: Optional[str] = Field(
        default=None, pattern="^(both|long_only|short_only)$"
    )
    option_selection: Optional[str] = Field(
        default="both", pattern="^(pe|ce|both)$", description="For option symbols: run PE, CE, or Both"
    )
    session_windows: Optional[list[Dict[str, str]]] = Field(
        default=None,
        description="List of {'start': 'HH:MM', 'end': 'HH:MM'} dicts",
    )
    write_csv: bool = Field(
        default=False,
        description="Persist trades CSV alongside JSON summary",
    )
    last_n_trades: int = Field(default=10, ge=1, le=200, description="Trades to include in response")

    class Config:
        allow_population_by_field_name = True


class BacktestResponse(BaseModel):
    summary: Dict[str, Any]
    trades_tail: List[Dict[str, Any]]
    trades_all: List[Dict[str, Any]]
    daily_stats: List[Dict[str, Any]]
    output_csv: Optional[str] = None


app = FastAPI(title="Timescale Gravity API", version="1.0.0")

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
        },
    )


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/inventory", response_model=list[InventoryItem])
def inventory(sort_order: str = "asc"):
    """
    Get inventory of available data series.

    Query params:
        sort_order: "asc" or "desc" (default: asc)
    """
    return list_available_series(sort_order=sort_order)


@app.delete("/inventory/{symbol}/{exchange}/{interval}")
def delete_inventory(symbol: str, exchange: str, interval: str):
    """
    Delete all data for a specific series.

    Path params:
        symbol: Symbol to delete
        exchange: Exchange
        interval: Interval
    """
    try:
        rows_deleted = delete_series(symbol, exchange, interval)
        return {"rows_deleted": rows_deleted, "message": f"Deleted {rows_deleted} rows for {symbol} {exchange} {interval}"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/fetch", response_model=FetchResponse)
def fetch_history(payload: FetchRequest):
    try:
        rows = fetch_history_to_tsdb(
            payload.symbol,
            payload.exchange,
            payload.interval,
            payload.start_date,
            payload.end_date,
            payload.also_save_csv,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FetchResponse(rows_upserted=rows)


@app.post("/backtest", response_model=BacktestResponse)
def run_backtest_api(payload: BacktestRequest):
    cfg = payload.dict(by_alias=True, exclude_none=True)
    write_csv = cfg.pop("write_csv", False)
    last_n = cfg.pop("last_n_trades", 10)

    result = run_backtest_from_config(cfg, write_csv=write_csv)
    summary = result.get("summary")
    if summary is None:
        message = result.get("message", "Backtest could not be completed.")
        raise HTTPException(status_code=404, detail=message)

    trades_all = _serialize_trades(result["trades"])
    trades_tail = trades_all[-last_n:] if last_n else trades_all

    daily_stats_raw = result.get("daily_stats", [])
    daily_stats: List[Dict[str, Any]] = []
    for item in daily_stats_raw:
        normalized: Dict[str, Any] = {}
        for key, value in item.items():
            if value is None:
                normalized[key] = None
            elif isinstance(value, numbers.Integral):
                normalized[key] = int(value)
            elif isinstance(value, numbers.Number):
                normalized[key] = float(value)
            else:
                normalized[key] = value
        daily_stats.append(normalized)

    return BacktestResponse(
        summary=summary,
        trades_tail=trades_tail,
        trades_all=trades_all,
        daily_stats=daily_stats,
        output_csv=result.get("output_csv"),
    )
