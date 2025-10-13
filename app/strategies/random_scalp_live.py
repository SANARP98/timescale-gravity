#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Random Scalp Strategy - Live-Aligned Version
---------------------------------------------
This version more closely mirrors the live trading bot behavior:
- Signals on bar close, enters on next bar open
- Positions stay open until TP/SL hit (no forced close at bar close by default)
- Only one position at a time (waits for exit before new entry by default)
- More realistic fill simulation

Key differences from original random_scalp.py:
1. Entry timing: signal generation vs execution separated
2. No close_at_bar_close by default (mimics live TP/SL behavior)
3. wait_for_exit=True by default (mimics live single-position logic)
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
        le=1000,
        title="Trade Every N Bars",
        description="Generate signal once every N bars at bar close.",
    )
    profit_target_rupees: float = Field(
        2.0,
        gt=0,
        title="Profit Target (₹)",
        description="Exit price = entry price + this many rupees.",
    )
    stop_loss_rupees: float = Field(
        1.0,
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
    close_at_bar_close: bool = Field(
        False,
        title="Close at Bar Close",
        description="If enabled, closes position at bar close if target/SL not hit. Disabled by default to match live behavior.",
    )
    wait_for_exit: bool = Field(
        True,
        title="Wait for Position Exit",
        description="If enabled, waits for current position to exit before opening new position. Enabled by default to match live behavior.",
    )
    ignore_entry_delta: bool = Field(
        True,
        title="Ignore Entry Timing Delta",
        description="If enabled, entries execute regardless of timing delta. Matches live behavior where timing validation can be relaxed.",
    )


def get_info() -> Dict[str, Any]:
    """
    Metadata consumed by the API/UI layer.
    """
    return {
        "name": "random_scalp_live",
        "title": "Random Scalp (Live-Aligned)",
        "description": (
            "Live-aligned version: signals on bar close, enters on next bar open, "
            "waits for TP/SL exit. Better matches live trading bot behavior."
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


class RandomScalpLiveRunner:
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
        """Load OHLCV data from DB, auto-fetching if missing."""
        import logging
        logger = logging.getLogger(__name__)

        df = read_ohlcv_from_tsdb(
            symbol=symbol,
            exchange=self.exchange,
            interval=self.interval,
            start_ts=self.start,
            end_ts=self.end,
        )

        # If data is empty, try to fetch it automatically
        if df.empty:
            logger.info(f"RandomScalpLive: No data found for {symbol}. Attempting auto-fetch...")
            try:
                from tsdb_pipeline import fetch_history_to_tsdb

                rows = fetch_history_to_tsdb(
                    symbol=symbol,
                    exchange=self.exchange,
                    interval=self.interval,
                    start_date=self.start,
                    end_date=self.end,
                )
                logger.info(f"RandomScalpLive: Auto-fetched {rows} rows for {symbol}")

                # Try reading again
                df = read_ohlcv_from_tsdb(
                    symbol=symbol,
                    exchange=self.exchange,
                    interval=self.interval,
                    start_ts=self.start,
                    end_ts=self.end,
                )
            except Exception as exc:
                logger.error(f"RandomScalpLive: Auto-fetch failed for {symbol}: {exc}")
                return pd.DataFrame()

        if df.empty:
            return df
        return df[["open", "high", "low", "close", "volume", "oi"]].copy()

    # ---------- Trade Simulation ----------

    def _simulate_symbol(self, symbol: str, df: pd.DataFrame) -> List[TradeResult]:
        """
        Live-aligned simulation:
        - Signal generated at bar N close
        - Entry executed at bar N+1 open
        - Position held until TP/SL hit (across multiple bars if needed)
        - Only one position at a time (if wait_for_exit=True)
        """
        trades: List[TradeResult] = []
        equity = float(self.starting_capital)

        profit_target = float(self.params.profit_target_rupees)
        stop_loss = float(self.params.stop_loss_rupees)
        trade_gap = max(int(self.params.trade_every_n_bars), 1)
        qty_multiplier = float(self.params.quantity_multiplier)
        qty_rupees = float(self.qty_per_point) * qty_multiplier

        # Cost structure matches live: brokerage per leg
        entry_costs = float(self.params.brokerage_per_trade) + (float(self.params.slippage_rupees) / 2.0)
        exit_costs = float(self.params.brokerage_per_trade) + (float(self.params.slippage_rupees) / 2.0)
        total_costs_per_trade = (entry_costs + exit_costs) * qty_multiplier

        close_at_bar_close = bool(self.params.close_at_bar_close)
        wait_for_exit = bool(self.params.wait_for_exit)

        if df.empty:
            import logging
            logging.warning(f"RandomScalpLive: No data loaded for {symbol}")
            return trades

        import logging
        logging.info(f"RandomScalpLive: Simulating {symbol} with {len(df)} bars, trade_gap={trade_gap}")

        # State tracking
        bar_counter = 0
        pending_signal = False
        next_entry_bar_idx = None
        open_position = None

        for idx, (ts, row) in enumerate(df.iterrows()):
            # Check if we have an open position that needs to be checked for exit
            if open_position is not None:
                entry_price = open_position["entry_price"]
                entry_time = open_position["entry_time"]
                target_price = entry_price + profit_target
                stop_price = entry_price - stop_loss if stop_loss > 0 else None

                high = float(row["high"])
                low = float(row["low"])

                exit_price = None
                exit_reason = None

                # Check if target or stoploss hit during this bar
                # Assumption: if both hit in same bar, target takes precedence (more favorable)
                if high >= target_price:
                    exit_price = target_price
                    exit_reason = "Target Hit"
                elif stop_price is not None and low <= stop_price:
                    exit_price = stop_price
                    exit_reason = "Stoploss Hit"
                elif close_at_bar_close:
                    # Close at bar close if option is enabled
                    exit_price = float(row["close"])
                    exit_reason = "Close @ Bar End"

                # If we have an exit, record the trade
                if exit_price is not None:
                    pnl_points = exit_price - entry_price
                    gross = pnl_points * qty_rupees
                    costs = total_costs_per_trade
                    pnl = gross - costs
                    equity += pnl

                    trades.append(
                        TradeResult(
                            entry_time=entry_time,
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
                    open_position = None
                    pending_signal = False
                    next_entry_bar_idx = None

            # Live behavior: signal generation at bar close
            # This happens BEFORE entry execution (which is at next bar open)
            bar_counter += 1

            # Check if we should generate a signal at this bar's close
            should_generate_signal = False
            if bar_counter % trade_gap == 0:
                # Signal condition met
                if wait_for_exit:
                    # Only generate signal if no open position
                    if open_position is None:
                        should_generate_signal = True
                else:
                    # Generate signal regardless of position (original behavior)
                    should_generate_signal = True

            if should_generate_signal:
                # Signal generated at bar close, schedule entry for next bar
                if idx + 1 < len(df):
                    pending_signal = True
                    next_entry_bar_idx = idx + 1
                    # In live, this logs: "⚡ [SIGNAL] LONG queued for next bar open"

            # Execute pending entry at bar open (if this is the scheduled entry bar)
            if pending_signal and next_entry_bar_idx == idx:
                # If wait_for_exit is False and we have an open position, close it first
                if open_position is not None and not wait_for_exit:
                    entry_price = open_position["entry_price"]
                    entry_time = open_position["entry_time"]
                    exit_price = float(row["open"])
                    exit_reason = "Forced Exit (New Entry)"

                    pnl_points = exit_price - entry_price
                    gross = pnl_points * qty_rupees
                    costs = total_costs_per_trade
                    pnl = gross - costs
                    equity += pnl

                    trades.append(
                        TradeResult(
                            entry_time=entry_time,
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

                # Execute entry at bar open
                entry_price = float(row["open"])
                open_position = {
                    "entry_price": entry_price,
                    "entry_time": ts,
                }
                pending_signal = False
                next_entry_bar_idx = None
                # In live, this logs: "🚀 [ENTRY] BUY {symbol} x {qty}"

        # Close any remaining open position at the end
        if open_position is not None:
            last_row = df.iloc[-1]
            entry_price = open_position["entry_price"]
            entry_time = open_position["entry_time"]
            exit_price = float(last_row["close"])
            exit_reason = "End of Data"

            pnl_points = exit_price - entry_price
            gross = pnl_points * qty_rupees
            costs = total_costs_per_trade
            pnl = gross - costs
            equity += pnl

            trades.append(
                TradeResult(
                    entry_time=entry_time,
                    exit_time=df.index[-1],
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
        import logging
        logger = logging.getLogger(__name__)

        symbols = self._determine_symbols()
        logger.info(f"RandomScalpLive: Resolved symbols: {symbols}")

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
            logger.info(f"RandomScalpLive: Loading data for {sym}")
            df = self._load_ohlcv(sym)
            logger.info(f"RandomScalpLive: Loaded {len(df) if not df.empty else 0} bars for {sym}")

            if df.empty:
                logger.warning(f"RandomScalpLive: No data found for {sym}")
                continue

            combined_data[sym] = df
            trades = self._simulate_symbol(sym, df)
            logger.info(f"RandomScalpLive: Generated {len(trades)} trades for {sym}")

            if trades:
                trades_df = pd.DataFrame([t.__dict__ for t in trades])
                all_trades.append(trades_df)

        if not all_trades:
            msg = f"⚠️ No trades generated. Loaded data for {len(combined_data)} symbols, but no trades occurred. Check parameters."
            logger.warning(f"RandomScalpLive: {msg}")
            return {
                "data": combined_data,
                "trades": pd.DataFrame(),
                "summary": None,
                "daily_stats": [],
                "output_csv": None,
                "message": msg,
            }

        trades_df = pd.concat(all_trades, ignore_index=True)
        trades_df.sort_values("entry_time", inplace=True)
        trades_df.reset_index(drop=True, inplace=True)

        summary = summarize_trades(trades_df.copy(), starting_capital=self.starting_capital)
        daily_stats = daily_breakdown(trades_df.copy())

        out_csv = None
        if write_csv:
            symbol_suffix = "_".join(symbols) if len(symbols) > 1 else symbols[0]
            out_csv = f"random_scalp_live_results_{symbol_suffix}_{self.interval}.csv"
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
    runner = RandomScalpLiveRunner(config, params)
    return runner.run(write_csv=write_csv)
