from typing import Any, Dict, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from backtest_tsdb import run_backtest_from_config
from tsdb_pipeline import fetch_history_to_tsdb


def _tail_records(trades: pd.DataFrame, limit: int) -> list[Dict[str, Any]]:
    if trades.empty:
        return []
    cols = [
        "entry_time",
        "exit_time",
        "side",
        "entry",
        "exit",
        "gross_rupees",
        "costs_rupees",
        "pnl_rupees",
        "exit_reason",
    ]
    available = [c for c in cols if c in trades.columns]
    return trades[available].tail(limit).to_dict(orient="records")


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
    exit_bar_path: Optional[str] = Field(default=None, regex="^(color|bull|bear|worst)$")
    brokerage_per_trade: Optional[float] = None
    slippage_points: Optional[float] = None
    confirm_trend_at_entry: Optional[bool] = None
    enable_eod_square_off: Optional[bool] = None
    square_off_time: Optional[str] = Field(default=None, description="HH:MM (IST)")
    trade_direction: Optional[str] = Field(
        default=None, regex="^(both|long_only|short_only)$"
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
    trades_tail: list[Dict[str, Any]]
    output_csv: Optional[str] = None


app = FastAPI(title="Timescale Gravity API", version="1.0.0")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


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

    trades_tail = _tail_records(result["trades"], last_n)
    return BacktestResponse(
        summary=summary,
        trades_tail=trades_tail,
        output_csv=result.get("output_csv"),
    )
