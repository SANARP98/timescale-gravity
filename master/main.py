"""
Unified FastAPI application that merges the single-instrument backtesting UI
with the permutation tester workflow into a single surface.
"""

from __future__ import annotations

import csv
import importlib
import io
import logging
import numbers
import pkgutil
from datetime import datetime, timezone
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from symbol_utils import get_option_pair, is_option_symbol
from tester_app.core.database import (
    clear_results_table,
    db_stats,
    ensure_results_table,
    insert_result,
)
from tester_app.core.runner import PermutationRunner
from tester_app.strategies import get_registry
from tester_app.core.runner import JobGenerator  # noqa: F401  # re-export
from tsdb_pipeline import (
    delete_series,
    fetch_history_to_tsdb,
    get_series_coverage,
    list_available_series,
    read_ohlcv_from_tsdb,
)

logger = logging.getLogger("master")

# Ensure Numba has a writable cache directory (fixes in-container caching errors)
NUMBA_CACHE_DIR = Path(os.environ.get("NUMBA_CACHE_DIR", "/tmp/numba_cache"))
try:
    NUMBA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception as exc:  # noqa: BLE001
    logger.warning("Unable to create NUMBA_CACHE_DIR at %s: %s", NUMBA_CACHE_DIR, exc)
else:
    os.environ["NUMBA_CACHE_DIR"] = str(NUMBA_CACHE_DIR)

# --- Single-run strategy loader ------------------------------------------------

STRATEGIES: Dict[str, Dict[str, Any]] = {}


def load_single_strategies() -> None:
    """Discover strategies from the legacy single-run app."""
    STRATEGIES.clear()
    root_dir = Path(__file__).resolve().parent.parent
    strategies_path = root_dir / "app" / "strategies"

    if not strategies_path.exists():
        logger.warning("Strategies directory not found at %s", strategies_path)
        return

    for finder, name, ispkg in pkgutil.iter_modules([str(strategies_path)]):
        if ispkg:
            continue
        try:
            module = importlib.import_module(f"app.strategies.{name}")
            if hasattr(module, "get_info") and hasattr(module, "run"):
                info = module.get_info()
                strategy_name = info.get("name")
                if strategy_name:
                    STRATEGIES[strategy_name] = {
                        "info": info,
                        "run": module.run,
                    }
                    logger.info("Loaded single strategy: %s", info.get("title", strategy_name))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to load strategy from %s: %s", name, exc)


# --- Shared helpers -----------------------------------------------------------

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
        except (TypeError, ValueError):  # noqa: PERF203
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


# --- Pydantic models (single-run) ---------------------------------------------


class FetchRequest(BaseModel):
    symbol: str = Field(..., description="Instrument symbol")
    exchange: str = Field(..., description="Exchange name (e.g., NFO)")
    interval: str = Field(..., description="Bar interval (e.g., 5m)")
    start_date: str = Field(..., description="Start date (YYYY-MM-DD)")
    end_date: str = Field(..., description="End date (YYYY-MM-DD)")
    also_save_csv: Optional[str] = Field(
        default=None,
        description="Optional path to dump fetched history as CSV",
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


class FetchEvent(BaseModel):
    symbol: str
    start_date: str
    end_date: str
    rows_upserted: int
    reason: Optional[str] = None


class BacktestRequest(BaseModel):
    strategy_name: str = Field(..., description="The name of the strategy to run")
    symbol: Optional[str] = None
    exchange: Optional[str] = None
    interval: Optional[str] = None
    start_date: Optional[str] = Field(default=None, alias="start_date")
    end_date: Optional[str] = Field(default=None, alias="end_date")
    starting_capital: Optional[float] = None
    qty_per_point: Optional[int] = None
    option_selection: Optional[str] = Field(
        default="both",
        pattern="^(pe|ce|both)$",
        description="For option symbols: run PE, CE, or Both",
    )
    write_csv: bool = Field(
        default=False,
        description="Persist trades CSV alongside JSON summary",
    )
    last_n_trades: int = Field(default=10, ge=1, le=200, description="Trades to include in response")
    strategy_params: Dict[str, Any] = Field(
        default_factory=dict,
        description="Dynamic parameters for the selected strategy",
    )

    class Config:
        allow_population_by_field_name = True


class BacktestResponse(BaseModel):
    summary: Dict[str, Any]
    trades_tail: List[Dict[str, Any]]
    trades_all: List[Dict[str, Any]]
    daily_stats: List[Dict[str, Any]]
    output_csv: Optional[str] = None
    fetch_events: List[FetchEvent] = Field(default_factory=list)


# --- Pydantic models (permutation runner) -------------------------------------


class ControlResponse(BaseModel):
    status: Dict[str, Any]


class ConfigRequest(BaseModel):
    strategy: str
    symbols: List[str]
    start_date: str
    end_date: str
    starting_capital: float
    qty_per_point: float
    max_workers: int
    param_ranges: Dict[str, Any]


class ExportResponse(BaseModel):
    exported_path: str
    format: str
    status: Dict[str, Any]


class HistoryItem(BaseModel):
    id: str
    created_at: datetime
    strategy: str
    symbol: str
    exchange: str
    interval: str
    params: Dict[str, Any]
    summary: Dict[str, Any]


# --- FastAPI application ------------------------------------------------------

app = FastAPI(title="Timescale Gravity Master", version="1.0.0")

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# --- Permutation state --------------------------------------------------------

registry = get_registry()
current_runner: Optional[PermutationRunner] = None
current_strategy: Optional[str] = None
current_base_config: Dict[str, Any] = {}


def result_callback(result: Dict[str, Any]) -> None:
    """Store permutation results in the tester database."""
    try:
        insert_result(
            strategy=result["strategy"],
            symbol=result["symbol"],
            exchange=current_base_config.get("exchange", "NFO"),
            interval=current_base_config.get("interval", "5m"),
            params=result["params"],
            summary=result["summary"],
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to persist permutation result: %s", exc)


def get_or_create_runner(strategy_name: Optional[str] = None) -> PermutationRunner:
    """Eagerly create the permutation runner when needed."""
    global current_runner, current_strategy, current_base_config

    if current_runner and strategy_name and strategy_name != current_strategy:
        logger.info("Switching runner strategy from %s to %s", current_strategy, strategy_name)
        current_runner.reset()
        current_runner = None

    if current_runner is None:
        available = registry.get_all_strategies()
        if not available:
            raise HTTPException(status_code=400, detail="No permutation strategies available.")

        chosen_strategy = strategy_name or current_strategy or next(iter(available.keys()))

        # Use registry metadata for sensible defaults if available
        strat_meta = registry.get_strategy(chosen_strategy)
        default_symbols = strat_meta.get("defaults", {}).get("symbols", []) if strat_meta else []
        current_strategy = chosen_strategy
        current_base_config = {
            "exchange": "NFO",
            "interval": "5m",
            "start_date": "2025-09-01",
            "end_date": "2025-10-06",
            "starting_capital": 100_000.0,
            "qty_per_point": 150.0,
            "brokerage_per_trade": 0.0,
            "slippage_points": 0.0,
        }
        default_ranges = {
            "symbols": default_symbols or [
                "NIFTY28OCT2525200CE",
                "NIFTY28OCT2525200PE",
            ],
        }
        max_workers = 2
        current_runner = PermutationRunner(
            strategy_name=current_strategy,
            base_config=current_base_config,
            param_ranges=default_ranges,
            max_workers=max_workers,
            on_result_callback=result_callback,
        )
    return current_runner


# --- Single-run utilities -----------------------------------------------------

IST_TZ = "Asia/Kolkata"


def _to_ist_timestamp(value: str) -> pd.Timestamp:
    ts = pd.to_datetime(value)
    if ts.tzinfo is None:
        ts = ts.tz_localize(IST_TZ)
    else:
        ts = ts.tz_convert(IST_TZ)
    return ts


def ensure_option_data(cfg: Dict[str, Any]) -> List[FetchEvent]:
    symbol = cfg.get("symbol")
    exchange = cfg.get("exchange")
    interval = cfg.get("interval")
    start_date = cfg.get("start_date")
    end_date = cfg.get("end_date")
    option_selection = (cfg.get("option_selection") or "both").lower()

    if not symbol or not start_date or not end_date or not is_option_symbol(symbol):
        return []

    pe_symbol, ce_symbol = get_option_pair(symbol)
    if not pe_symbol or not ce_symbol:
        return []

    if option_selection == "pe":
        desired_symbols = [pe_symbol]
    elif option_selection == "ce":
        desired_symbols = [ce_symbol]
    else:
        desired_symbols = [pe_symbol, ce_symbol]

    requested_start = _to_ist_timestamp(start_date)
    requested_end = _to_ist_timestamp(end_date)

    fetch_events: List[FetchEvent] = []

    for sym in desired_symbols:
        coverage = get_series_coverage(sym, exchange, interval)
        needs_fetch = True

        if coverage and coverage.get("first_ts") and coverage.get("last_ts"):
            coverage_start = coverage["first_ts"].tz_convert(IST_TZ)
            coverage_end = coverage["last_ts"].tz_convert(IST_TZ)
            if coverage_start <= requested_start and coverage_end >= requested_end:
                needs_fetch = False

        if needs_fetch:
            try:
                rows = fetch_history_to_tsdb(
                    symbol=sym,
                    exchange=exchange,
                    interval=interval,
                    start_date=start_date,
                    end_date=end_date,
                )
            except RuntimeError as exc:  # noqa: PERF203
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            if rows > 0:
                fetch_events.append(
                    FetchEvent(
                        symbol=sym,
                        start_date=start_date,
                        end_date=end_date,
                        rows_upserted=rows,
                        reason="auto_fetch_missing_option",
                    )
                )

    return fetch_events


# --- Routes: core -------------------------------------------------------------


@app.on_event("startup")
def on_startup() -> None:
    logging.basicConfig(level=logging.INFO)
    load_single_strategies()
    ensure_results_table()
    get_or_create_runner()
    logger.info("Master app startup complete")


@app.on_event("shutdown")
def on_shutdown() -> None:
    global current_runner
    if current_runner:
        current_runner.reset()
        current_runner = None
    logger.info("Master app shutdown complete")


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


# --- Routes: single backtest namespace ---------------------------------------


@app.get("/api/single/strategies", response_model=List[Dict[str, Any]])
def single_strategies() -> List[Dict[str, Any]]:
    return [entry["info"] for entry in STRATEGIES.values()]


@app.get("/api/single/inventory", response_model=List[InventoryItem])
def single_inventory(sort_order: str = "asc") -> List[InventoryItem]:
    order = sort_order.lower()
    if order not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="sort_order must be 'asc' or 'desc'")
    entries = list_available_series(sort_order=order)
    return [InventoryItem(**entry) for entry in entries]


@app.delete("/api/single/inventory/{symbol}/{exchange}/{interval}")
def single_inventory_delete(symbol: str, exchange: str, interval: str) -> Dict[str, Any]:
    try:
        rows_deleted = delete_series(symbol, exchange, interval)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {
        "rows_deleted": rows_deleted,
        "message": f"Deleted {rows_deleted} rows for {symbol} {exchange} {interval}",
    }


@app.get("/api/single/data/{symbol}/{exchange}/{interval}")
def single_series_data(symbol: str, exchange: str, interval: str) -> List[Dict[str, Any]]:
    try:
        df = read_ohlcv_from_tsdb(symbol, exchange, interval)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if df.empty:
        raise HTTPException(status_code=404, detail="No data found for the specified series.")

    df.reset_index(inplace=True)
    df["ts"] = df["ts"].apply(lambda x: x.isoformat())
    for col in ["open", "high", "low", "close", "volume", "oi"]:
        if col in df.columns:
            df[col] = df[col].apply(lambda x: round(x, 2) if pd.notna(x) else None)
    return df.to_dict(orient="records")


@app.post("/api/single/fetch", response_model=FetchResponse)
def single_fetch(payload: FetchRequest) -> FetchResponse:
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
    except RuntimeError as exc:  # noqa: PERF203
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FetchResponse(rows_upserted=rows)


@app.post("/api/single/backtest", response_model=BacktestResponse)
def single_backtest(payload: BacktestRequest) -> BacktestResponse:
    cfg = payload.dict(by_alias=True, exclude_none=True)
    strategy_name = cfg.pop("strategy_name")
    strategy_params = cfg.pop("strategy_params", {})
    write_csv = cfg.pop("write_csv", False)
    last_n = cfg.pop("last_n_trades", 10)

    if strategy_name not in STRATEGIES:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_name}' not found.")

    run_config = {**cfg, **strategy_params}
    fetch_events = ensure_option_data(cfg)

    strategy_runner = STRATEGIES[strategy_name]["run"]
    result = strategy_runner(run_config, write_csv=write_csv)

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
        fetch_events=fetch_events,
    )


# --- Routes: permutation namespace -------------------------------------------


@app.get("/api/multi/strategies")
def multi_strategies() -> Dict[str, Any]:
    return {"strategies": registry.list_strategies()}


@app.get("/api/multi/status")
def multi_status() -> Dict[str, Any]:
    runner = get_or_create_runner()
    status = runner.status()
    status["database"] = db_stats()
    return status


@app.post("/api/multi/start", response_model=ControlResponse)
def multi_start() -> ControlResponse:
    runner = get_or_create_runner()
    runner.start()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.post("/api/multi/pause", response_model=ControlResponse)
def multi_pause() -> ControlResponse:
    runner = get_or_create_runner()
    runner.pause()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.post("/api/multi/reset", response_model=ControlResponse)
def multi_reset() -> ControlResponse:
    runner = get_or_create_runner()
    runner.reset()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.post("/api/multi/configure", response_model=ControlResponse)
def multi_configure(config: ConfigRequest) -> ControlResponse:
    global current_runner, current_strategy, current_base_config

    try:
        strategy = registry.get_strategy(config.strategy)
        if strategy is None:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy '{config.strategy}' not found. Available: {list(registry.get_all_strategies().keys())}",
            )

        new_base_config = {
            "exchange": "NFO",
            "interval": "5m",
            "start_date": config.start_date,
            "end_date": config.end_date,
            "starting_capital": config.starting_capital,
            "qty_per_point": config.qty_per_point,
            "brokerage_per_trade": 0.0,
            "slippage_points": 0.0,
        }

        param_ranges = config.param_ranges.copy()
        param_ranges["symbols"] = config.symbols

        if current_runner is None or current_strategy != config.strategy:
            if current_runner is not None:
                logger.info("Switching strategy from %s to %s", current_strategy, config.strategy)
                current_runner.reset()

            current_strategy = config.strategy
            current_base_config = new_base_config
            current_runner = PermutationRunner(
                strategy_name=current_strategy,
                base_config=current_base_config,
                param_ranges=param_ranges,
                max_workers=config.max_workers,
                on_result_callback=result_callback,
            )
        else:
            current_base_config = new_base_config
            current_runner.reconfigure(
                base_config=new_base_config,
                param_ranges=param_ranges,
                max_workers=config.max_workers,
            )

        status = current_runner.status()
        status["database"] = db_stats()
        return ControlResponse(status=status)

    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Configuration failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Configuration failed: {exc}") from exc


@app.post("/api/multi/clear-results", response_model=ControlResponse)
def multi_clear_results() -> ControlResponse:
    clear_results_table()
    runner = get_or_create_runner()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.get("/api/multi/history", response_model=List[HistoryItem])
def multi_history() -> List[HistoryItem]:
    try:
        from tester_app.export_results import fetch_results
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"History module unavailable: {exc}") from exc

    rows = fetch_results()
    history: List[HistoryItem] = []
    for row in rows:
        params = row.get("params") or {}
        summary = row.get("summary") or {}
        history.append(
            HistoryItem(
                id=str(row.get("id")),
                created_at=row.get("created_at"),
                strategy=row.get("strategy"),
                symbol=row.get("symbol"),
                exchange=row.get("exchange"),
                interval=row.get("interval"),
                params=params,
                summary=summary,
            )
        )
    return history


@app.get("/api/multi/history/export")
def multi_history_export(ids: Optional[str] = None) -> StreamingResponse:
    try:
        from tester_app.export_results import fetch_results, flatten_row
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Export module unavailable: {exc}") from exc

    id_list: Optional[List[str]] = None
    if ids:
        id_list = [candidate.strip() for candidate in ids.split(",") if candidate.strip()]

    rows = fetch_results(ids=id_list)
    if not rows:
        raise HTTPException(status_code=404, detail="No tester results available for export.")

    flattened: List[Dict[str, Any]] = [flatten_row(row) for row in rows]
    if not flattened:
        raise HTTPException(status_code=404, detail="No tester results available for export.")

    field_order: List[str] = list(flattened[0].keys())
    for entry in flattened[1:]:
        for key in entry.keys():
            if key not in field_order:
                field_order.append(key)

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=field_order, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(flattened)
    buffer.seek(0)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    suffix = "subset" if id_list else "all"
    filename = f"tester_results_{suffix}_{timestamp}.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers=headers)


__all__ = [
    "app",
    "load_single_strategies",
]
