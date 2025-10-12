#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Random Scalp Strategy
---------------------
A toy strategy that simply buys every N bars, aiming for a fixed rupee
profit (or taking a fixed rupee loss). Useful for UI demonstrations,
parameter toggles, and plumbing tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, ConfigDict

from tsdb_pipeline import read_ohlcv_from_tsdb
from symbol_utils import get_option_pair, is_option_symbol


# ==================== STRATEGY METADATA ====================

class StrategyParams(BaseModel):
    model_config = ConfigDict(extra="ignore")

    trade_every_n_bars: int = Field(
        1,
        ge=1,
        title="Trade Every N Bars",
        description="Take a new position once every N bars.",
    )
    profit_target_rupees: float = Field(
        1.0,
        gt=0,
        title="Profit Target (₹)",
        description="Exit price = entry price + this many rupees.",
    )
    stop_loss_rupees: float = Field(
        0.5,
        ge=0,
        title="Stop Loss (₹)",
        description="Exit price = entry price - this many rupees if hit.",
    )
    quantity_multiplier: float = Field(
        1.0,
        gt=0,
        title="Quantity Multiplier",
        description="Multiplier applied to qty-per-point when computing P&L.",
    )
    brokerage_per_trade: float = Field(
        0.0,
        ge=0,
        title="Brokerage / Leg (₹)",
        description="Brokerage per leg (applied twice per round-trip).",
    )
    slippage_rupees: float = Field(
        0.0,
        ge=0,
        title="Slippage (₹)",
        description="Additional slippage applied per round-trip.",
    )


def get_info() -> Dict[str, Any]:
    """
    Metadata consumed by the API/UI layer.
    """
    return {
        "name": "random_scalp",
        "title": "Random Scalp",
        "description": (
            "Buys on a fixed cadence and targets a flat ₹ profit per trade. "
            "Great for verifying UI parameter binding and backtest plumbing."
        ),
        "parameters": StrategyParams.model_json_schema(),
    }


# ==================== CORE STRATEGY ====================

@dataclass
class TradeResult:
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    symbol: str
    side: str
    entry: float
    exit: float
    gross_rupees: float
    costs_rupees: float
    pnl_rupees: float
    exit_reason: str
    cumulative_equity: float


class RandomScalpRunner:
    def __init__(self, config: Dict[str, Any], params: StrategyParams):
        self.symbol = config["symbol"]
        self.exchange = config["exchange"]
        self.interval = config["interval"]
        self.start = config["start_date"]
        self.end = config["end_date"]
        self.starting_capital = config.get("starting_capital", 100_000.0)
        self.qty_per_point = config.get("qty_per_point", 1.0)
        self.option_selection = config.get("option_selection", "both").lower()

        self.params = params

    # ---------- Helpers ----------

    def _determine_symbols(self) -> List[str]:
        if not is_option_symbol(self.symbol):
            return [self.symbol]

        pe_symbol, ce_symbol = get_option_pair(self.symbol)
        if self.option_selection == "pe":
            return [pe_symbol] if pe_symbol else []
        if self.option_selection == "ce":
            return [ce_symbol] if ce_symbol else []
        return [sym for sym in (pe_symbol, ce_symbol) if sym]

    def _load_ohlcv(self, symbol: str) -> pd.DataFrame:
        df = read_ohlcv_from_tsdb(
            symbol=symbol,
            exchange=self.exchange,
            interval=self.interval,
            start_ts=self.start,
            end_ts=self.end,
        )
        if df.empty:
            return df
        return df[["open", "high", "low", "close", "volume", "oi"]].copy()

    # ---------- Trade Simulation ----------

    def _simulate_symbol(self, symbol: str, df: pd.DataFrame) -> List[TradeResult]:
        trades: List[TradeResult] = []
        equity = float(self.starting_capital)

        profit_target = float(self.params.profit_target_rupees)
        stop_loss = float(self.params.stop_loss_rupees)
        trade_gap = max(int(self.params.trade_every_n_bars), 1)
        qty_multiplier = float(self.params.quantity_multiplier)
        qty_rupees = float(self.qty_per_point) * qty_multiplier
        broker_fee = float(self.params.brokerage_per_trade) * 2 * qty_multiplier
        slippage = float(self.params.slippage_rupees) * qty_multiplier

        if df.empty:
            return trades

        for idx, (ts, row) in enumerate(df.iterrows()):
            if idx % trade_gap != 0:
                continue

            entry_price = float(row["open"])
            target_price = entry_price + profit_target
            stop_price = entry_price - stop_loss if stop_loss > 0 else None

            high = float(row["high"])
            low = float(row["low"])

            exit_price = float(row["close"])
            exit_reason = "Close @ Bar End"

            if high >= target_price:
                exit_price = target_price
                exit_reason = "Target Hit"
            elif stop_price is not None and low <= stop_price:
                exit_price = stop_price
                exit_reason = "Stoploss Hit"

            pnl_points = exit_price - entry_price
            gross = pnl_points * qty_rupees
            costs = broker_fee + slippage
            pnl = gross - costs
            equity += pnl

            trades.append(
                TradeResult(
                    entry_time=ts,
                    exit_time=ts,
                    symbol=symbol,
                    side="LONG",
                    entry=entry_price,
                    exit=exit_price,
                    gross_rupees=gross,
                    costs_rupees=costs,
                    pnl_rupees=pnl,
                    exit_reason=exit_reason,
                    cumulative_equity=equity,
                )
            )

        return trades

    # ---------- Public API ----------

    def run(self, write_csv: bool = False) -> Dict[str, Any]:
        symbols = self._determine_symbols()
        if not symbols:
            return {
                "data": {},
                "trades": pd.DataFrame(),
                "summary": None,
                "daily_stats": [],
                "output_csv": None,
                "message": "⚠️ No valid symbols resolved for this configuration.",
            }

        all_trades: List[pd.DataFrame] = []
        combined_data: Dict[str, pd.DataFrame] = {}

        for sym in symbols:
            df = self._load_ohlcv(sym)
            if df.empty:
                continue

            combined_data[sym] = df
            trades = self._simulate_symbol(sym, df)
            if trades:
                trades_df = pd.DataFrame([t.__dict__ for t in trades])
                all_trades.append(trades_df)

        if not all_trades:
            return {
                "data": combined_data,
                "trades": pd.DataFrame(),
                "summary": None,
                "daily_stats": [],
                "output_csv": None,
                "message": "⚠️ No trades generated for the selected window.",
            }

        trades_df = pd.concat(all_trades, ignore_index=True)
        trades_df.sort_values("entry_time", inplace=True)
        trades_df.reset_index(drop=True, inplace=True)

        summary = summarize_trades(trades_df.copy(), starting_capital=self.starting_capital)
        daily_stats = daily_breakdown(trades_df.copy())

        out_csv = None
        if write_csv:
            symbol_suffix = "_".join(symbols) if len(symbols) > 1 else symbols[0]
            out_csv = f"random_scalp_results_{symbol_suffix}_{self.interval}.csv"
            trades_df.to_csv(out_csv, index=False)

        return {
            "data": combined_data,
            "trades": trades_df,
            "summary": summary,
            "daily_stats": daily_stats,
            "output_csv": out_csv,
        }


# ==================== SUMMARY HELPERS ====================

def summarize_trades(trades: pd.DataFrame, starting_capital: float) -> Dict[str, Any]:
    if trades.empty:
        return {}

    total = len(trades)
    wins = int((trades["pnl_rupees"] > 0).sum())
    losses = int((trades["pnl_rupees"] < 0).sum())
    flats = int((trades["pnl_rupees"] == 0).sum())
    winrate = wins / total * 100 if total else 0.0

    total_gross = float(trades["gross_rupees"].sum())
    total_costs = float(trades["costs_rupees"].sum())
    net_pnl = float(trades["pnl_rupees"].sum())
    final_eq = starting_capital + net_pnl
    roi = net_pnl / starting_capital * 100 if starting_capital else 0.0

    trades["cum"] = trades["pnl_rupees"].cumsum()
    trades["peak"] = trades["cum"].cummax()
    trades["dd"] = trades["cum"] - trades["peak"]
    max_dd = float(trades["dd"].min()) if not trades["dd"].empty else 0.0

    avg_win = float(trades.loc[trades["pnl_rupees"] > 0, "pnl_rupees"].mean() or 0.0) if wins else 0.0
    avg_loss = float(trades.loc[trades["pnl_rupees"] < 0, "pnl_rupees"].mean() or 0.0) if losses else 0.0
    rr = abs(avg_win / avg_loss) if avg_loss else 0.0

    exit_counts = trades["exit_reason"].value_counts().to_dict()

    return {
        "total_trades": total,
        "wins": wins,
        "losses": losses,
        "flats": flats,
        "winrate_percent": winrate,
        "gross_rupees": total_gross,
        "costs_rupees": total_costs,
        "net_rupees": net_pnl,
        "final_equity": final_eq,
        "roi_percent": roi,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "risk_reward": rr,
        "max_drawdown": max_dd,
        "exit_reason_counts": exit_counts,
    }


def daily_breakdown(trades: pd.DataFrame) -> List[Dict[str, Any]]:
    if trades.empty:
        return []

    trades["exit_time"] = pd.to_datetime(trades["exit_time"])
    if trades["exit_time"].dt.tz is None:
        trades["exit_time"] = trades["exit_time"].dt.tz_localize("Asia/Kolkata")
    else:
        trades["exit_time"] = trades["exit_time"].dt.tz_convert("Asia/Kolkata")

    trades["exit_date"] = trades["exit_time"].dt.date

    breakdown: List[Dict[str, Any]] = []
    for exit_date, group in trades.groupby("exit_date", sort=True):
        total_pnl = float(group["pnl_rupees"].sum())
        profit_sum = float(group.loc[group["pnl_rupees"] > 0, "pnl_rupees"].sum())
        loss_sum = float(group.loc[group["pnl_rupees"] < 0, "pnl_rupees"].sum())

        breakdown.append(
            {
                "date": exit_date.isoformat(),
                "date_label": pd.Timestamp(exit_date).strftime("%d %b %Y"),
                "net_pnl": total_pnl,
                "profit": profit_sum,
                "loss": loss_sum,
                "wins": int((group["pnl_rupees"] > 0).sum()),
                "losses": int((group["pnl_rupees"] < 0).sum()),
                "trades": int(len(group)),
            }
        )

    breakdown.sort(key=lambda x: x["date"])
    return breakdown


# ==================== PUBLIC ENTRY POINT ====================

def run(config: Dict[str, Any], write_csv: bool = False) -> Dict[str, Any]:
    """
    Entry point consumed by the FastAPI layer.
    """
    params = StrategyParams(**config)
    runner = RandomScalpRunner(config, params)
    return runner.run(write_csv=write_csv)
