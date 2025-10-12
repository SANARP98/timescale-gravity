"""
Strategy Tester App - Refactored with Multi-Strategy Support
"""

from __future__ import annotations

import csv
import io
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from tester_app.strategies import get_registry
from tester_app.core.runner import PermutationRunner, JobGenerator
from tester_app.core.database import (
    ensure_results_table,
    insert_result,
    clear_results_table,
    db_stats,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tester_app")

BASE_DIR = Path(__file__).resolve().parent

# Initialize FastAPI app
app = FastAPI(title="Strategy Tester App", version="2.0.0")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# Initialize strategy registry
registry = get_registry()

# Global state
current_runner: Optional[PermutationRunner] = None
current_strategy: str = "scalp_with_trend"  # Default strategy
current_base_config: Dict[str, Any] = {
    "exchange": "NFO",
    "interval": "5m",
    "start_date": "2025-09-01",
    "end_date": "2025-10-06",
    "starting_capital": 100_000.0,
    "qty_per_point": 150.0,
    "brokerage_per_trade": 0.0,
    "slippage_points": 0.0,
}


# ------------ Helper Functions ------------

def result_callback(result: Dict[str, Any]) -> None:
    """Callback to store results in database."""
    try:
        insert_result(
            strategy=result["strategy"],
            symbol=result["symbol"],
            exchange=current_base_config["exchange"],
            interval=current_base_config["interval"],
            params=result["params"],
            summary=result["summary"],
        )
    except Exception as exc:
        logger.exception(f"Failed to store result: {exc}")


def get_or_create_runner() -> PermutationRunner:
    """Get or create the global runner instance."""
    global current_runner
    if current_runner is None:
        # Default param ranges for scalp_with_trend
        default_ranges = {
            "symbols": ["NIFTY28OCT2525200CE", "NIFTY28OCT2525200PE"],
            "target_points": list(range(2, 11)),
            "stoploss_points": list(range(2, 11)),
            "ema_fast": [3, 5],
            "ema_slow": [10, 20],
            "atr_min_points": [1.0, 2.0, 3.0],
            "daily_loss_cap": [-1000.0, -1500.0, -2000.0, -2500.0, -3000.0],
            "trade_direction": ["long_only"],
            "confirm_trend_at_entry": [True],
            "enable_eod_square_off": [True],
        }

        max_workers = int(os.getenv("TESTER_MAX_WORKERS", "2"))
        current_runner = PermutationRunner(
            strategy_name=current_strategy,
            base_config=current_base_config,
            param_ranges=default_ranges,
            max_workers=max_workers,
            on_result_callback=result_callback,
        )
    return current_runner


# ------------ Pydantic Models ------------

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
    param_ranges: Dict[str, Any]  # Dynamic parameter ranges


class ExportRequest(BaseModel):
    output_path: Optional[str] = None
    format: str = "csv"
    record_ids: Optional[List[str]] = None


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


# ------------ API Routes ------------

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    """Render the main UI."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/strategies")
def list_strategies():
    """List all available strategies with their parameter schemas."""
    strategies = registry.list_strategies()
    return {"strategies": strategies}


@app.get("/status")
def get_status():
    """Get the current runner status."""
    runner = get_or_create_runner()
    status = runner.status()
    status["database"] = db_stats()
    return status


@app.post("/start", response_model=ControlResponse)
def start_runner():
    """Start or resume the runner."""
    runner = get_or_create_runner()
    runner.start()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.post("/pause", response_model=ControlResponse)
def pause_runner():
    """Pause the runner."""
    runner = get_or_create_runner()
    runner.pause()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.post("/reset", response_model=ControlResponse)
def reset_runner():
    """Reset the runner."""
    runner = get_or_create_runner()
    runner.reset()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.post("/configure", response_model=ControlResponse)
def configure_runner(config: ConfigRequest):
    """Apply new configuration to the runner."""
    global current_runner, current_strategy, current_base_config

    try:
        # Validate strategy exists
        strategy = registry.get_strategy(config.strategy)
        if strategy is None:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy '{config.strategy}' not found. Available: {list(registry.get_all_strategies().keys())}"
            )

        # Update base config
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

        # Prepare param ranges - ensure symbols are included
        param_ranges = config.param_ranges.copy()
        param_ranges["symbols"] = config.symbols

        # Check if we need to create a new runner (strategy changed)
        if current_runner is None or current_strategy != config.strategy:
            logger.info(f"Switching strategy from {current_strategy} to {config.strategy}")

            # Stop old runner if exists
            if current_runner is not None:
                current_runner.reset()

            # Create new runner
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
            # Reconfigure existing runner
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
    except Exception as exc:
        logger.exception(f"Configuration failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Configuration failed: {exc}") from exc


@app.post("/clear-results", response_model=ControlResponse)
def clear_results():
    """Clear all results from the database."""
    clear_results_table()
    runner = get_or_create_runner()
    status = runner.status()
    status["database"] = db_stats()
    return ControlResponse(status=status)


@app.get("/history", response_model=List[HistoryItem])
def list_history():
    """List all stored backtest results."""
    try:
        from tester_app.export_results import fetch_results
    except Exception as exc:
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


@app.get("/history/export-file")
def history_export_csv(ids: Optional[str] = None):
    """Export history as CSV file."""
    try:
        from tester_app.export_results import fetch_results, flatten_row
    except Exception as exc:
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


# ------------ Startup/Shutdown ------------

@app.on_event("startup")
async def startup_event():
    """Initialize app on startup."""
    logger.info("Starting Strategy Tester App...")
    ensure_results_table()

    # Discover strategies
    strategies = registry.list_strategies()
    logger.info(f"Discovered {len(strategies)} strategies:")
    for strat in strategies:
        logger.info(f"  - {strat['name']}: {strat['title']}")

    # Initialize runner
    get_or_create_runner()
    logger.info("App startup complete")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on shutdown."""
    global current_runner
    if current_runner is not None:
        logger.info("Shutting down runner...")
        current_runner.reset()
    logger.info("App shutdown complete")
