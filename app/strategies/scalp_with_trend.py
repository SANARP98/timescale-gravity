#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Scalp-with-Trend Backtest (multi-bar hold; intraday square-off)
"""

from datetime import time
from typing import Any, Dict, List, Optional
from enum import Enum

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from tsdb_pipeline import read_ohlcv_from_tsdb
from symbol_utils import get_option_pair, is_option_symbol

# ==================== STRATEGY DEFINITION ====================

class ExitBarPath(str, Enum):
    color = "color"
    bull = "bull"
    bear = "bear"
    worst = "worst"

class TradeDirection(str, Enum):
    both = "both"
    long_only = "long_only"
    short_only = "short_only"

class StrategyParams(BaseModel):
    target_points: float = Field(10.0, title="Target (pts)", gt=0)
    stoploss_points: float = Field(2.0, title="Stoploss (pts)", gt=0)
    ema_fast: int = Field(5, title="EMA Fast", ge=1, le=200)
    ema_slow: int = Field(20, title="EMA Slow", ge=1, le=200)
    atr_window: int = Field(14, title="ATR Window", ge=1, le=100)
    atr_min_points: float = Field(2.0, title="ATR Min (pts)", ge=0)
    daily_loss_cap: float = Field(-1000.0, title="Daily Loss Cap (₹)", le=0)
    exit_bar_path: ExitBarPath = Field(ExitBarPath.color, title="Exit Bar Path")
    trade_direction: TradeDirection = Field(TradeDirection.both, title="Trade Direction")
    confirm_trend_at_entry: bool = Field(True, title="Confirm Trend at Entry")
    enable_eod_square_off: bool = Field(True, title="Enable EOD Square-off")

def get_info() -> Dict[str, Any]:
    """
    Provides strategy metadata for the UI.
    """
    return {
        "name": "scalp_with_trend",
        "title": "Scalp with Trend",
        "description": "A multi-bar hold intraday strategy with EMA crossovers and ATR filters.",
        "parameters": StrategyParams.model_json_schema(),
    }


# ==================== STRATEGY IMPLEMENTATION ====================

class BacktestRunner:
    def __init__(self, config: Dict[str, Any]):
        # Core config
        self.symbol = config["symbol"]
        self.exchange = config["exchange"]
        self.interval = config["interval"]
        self.date_from = config["start_date"]
        self.date_to = config["end_date"]
        self.starting_capital = config.get("starting_capital", 100_000)
        self.qty_per_point = config.get("qty_per_point", 150)
        self.option_selection = config.get("option_selection", "both")
        self.brokerage_per_trade = config.get("brokerage_per_trade", 20.0)
        self.slippage_points = config.get("slippage_points", 0.10)

        # Strategy-specific params
        params = StrategyParams(**config)
        self.target_points = params.target_points
        self.stoploss_points = params.stoploss_points
        self.ema_fast = params.ema_fast
        self.ema_slow = params.ema_slow
        self.atr_window = params.atr_window
        self.atr_min_points = params.atr_min_points
        self.daily_loss_cap = params.daily_loss_cap
        self.exit_bar_path = params.exit_bar_path.value
        self.trade_direction = params.trade_direction.value
        self.confirm_trend_at_entry = params.confirm_trend_at_entry
        self.enable_eod_square_off = params.enable_eod_square_off

        # Other params
        self.square_off_time = time(15, 25)
        if "square_off_time" in config and config["square_off_time"]:
            hh, mm = map(int, str(config["square_off_time"]).split(":"))
            self.square_off_time = time(hh, mm)

        self.session_windows = [(time(9, 20), time(15, 5))] # Simplified default
        if "session_windows" in config and config["session_windows"]:
            self.session_windows = []
            for sw in config["session_windows"]:
                h1, m1 = map(int, sw["start"].split(":"))
                h2, m2 = map(int, sw["end"].split(":"))
                self.session_windows.append((time(h1, m1), time(h2, m2)))

        self.df = pd.DataFrame()

    def load_data_from_db(self, symbol: str) -> pd.DataFrame:
        data = read_ohlcv_from_tsdb(symbol, self.exchange, self.interval, self.date_from, self.date_to)
        if data.empty:
            return data
        return data[["close", "high", "low", "oi", "open", "volume"]].copy()

    def compute_indicators(self, _df: pd.DataFrame):
        _df["ema_fast"] = _df["close"].ewm(span=self.ema_fast, adjust=False).mean()
        _df["ema_slow"] = _df["close"].ewm(span=self.ema_slow, adjust=False).mean()
        tr1 = _df["high"] - _df["low"]
        tr2 = (_df["high"] - _df["close"].shift(1)).abs()
        tr3 = (_df["low"] - _df["close"].shift(1)).abs()
        _df["tr"] = np.maximum(tr1, np.maximum(tr2, tr3))
        _df["atr"] = _df["tr"].rolling(window=self.atr_window).mean()
        return _df

    def in_session(self, ts) -> bool:
        t = ts.time()
        for start, end in self.session_windows:
            if start <= t <= end:
                return True
        return False

    def trend_up(self, i: int) -> bool:
        return self.df.iloc[i]["ema_fast"] > self.df.iloc[i]["ema_slow"]

    def trend_down(self, i: int) -> bool:
        return self.df.iloc[i]["ema_fast"] < self.df.iloc[i]["ema_slow"]

    def atr_ok(self, i: int) -> bool:
        return self.df.iloc[i]["atr"] >= self.atr_min_points

    def is_last_bar_of_day(self, i: int) -> bool:
        if i + 1 >= len(self.df):
            return True
        return self.df.index[i + 1].date() != self.df.index[i].date()

    def past_square_off_time(self, ts) -> bool:
        return ts.time() >= self.square_off_time

    def scalp_signal(self, i: int) -> str | None:
        if i < 1: return None
        prev, curr = self.df.iloc[i - 1], self.df.iloc[i]
        if not self.in_session(curr.name) or not self.atr_ok(i): return None

        if (curr["high"] > prev["high"]) and self.trend_up(i):
            if self.trade_direction in ("both", "long_only"): return "LONG"
        if (curr["low"] < prev["low"]) and self.trend_down(i):
            if self.trade_direction in ("both", "short_only"): return "SHORT"
        return None

    def bar_path_tuple(self, bar: pd.Series):
        o, c = float(bar.get("open", np.nan)), float(bar.get("close", np.nan))
        if self.exit_bar_path == "bull": return ("open", "low", "high", "close")
        if self.exit_bar_path == "bear": return ("open", "high", "low", "close")
        if self.exit_bar_path == "color":
            return ("open", "low", "high", "close") if not np.isnan(o) and not np.isnan(c) and c >= o else ("open", "high", "low", "close")
        return ("worst",)

    def decide_exit_this_bar(self, position: str, bar: pd.Series, tp: float, sl: float):
        high, low = float(bar["high"]), float(bar["low"])
        hit_tp = high >= tp if position == "LONG" else low <= tp
        hit_sl = low <= sl if position == "LONG" else high >= sl
        if not hit_tp and not hit_sl: return False, None, None

        path = self.bar_path_tuple(bar)
        if path == ("worst",):
            return (True, sl, "Stoploss Hit") if hit_sl else (True, tp, "Target Hit")

        if position == "LONG":
            if path == ("open", "low", "high", "close"):
                if low <= sl: return True, sl, "Stoploss Hit"
                if high >= tp: return True, tp, "Target Hit"
            else:
                if high >= tp: return True, tp, "Target Hit"
                if low <= sl: return True, sl, "Stoploss Hit"
        else: # SHORT
            if path == ("open", "low", "high", "close"):
                if low <= tp: return True, tp, "Target Hit"
                if high >= sl: return True, sl, "Stoploss Hit"
            else:
                if high >= sl: return True, sl, "Stoploss Hit"
                if low <= tp: return True, tp, "Target Hit"

        return (True, sl, "Stoploss Hit") if hit_sl else (True, tp, "Target Hit")

    def _run_backtest_on_df(self) -> pd.DataFrame:
        results = []
        equity = self.starting_capital
        in_position, side, entry_price, entry_time, tp_level, sl_level = False, None, None, None, None, None
        daily_pnl, loss_stopped_days = {}, set()

        i = 1
        while i < len(self.df):
            row = self.df.iloc[i]
            ts, d = row.name, row.name.date()
            daily_pnl.setdefault(d, 0.0)
            day_stopped = d in loss_stopped_days

            if in_position:
                exited, exit_px, reason = self.decide_exit_this_bar(side, row, tp_level, sl_level)
                if not exited and self.enable_eod_square_off and (self.is_last_bar_of_day(i) or self.past_square_off_time(ts)):
                    exited, exit_px, reason = True, float(row["close"]), "Square-off EOD"

                if exited:
                    pnl_points = (exit_px - entry_price) if side == "LONG" else (entry_price - exit_px)
                    gross_rupees = pnl_points * self.qty_per_point
                    costs_rupees = (self.slippage_points * self.qty_per_point * 2) + (2 * self.brokerage_per_trade)
                    pnl_rupees = gross_rupees - costs_rupees
                    equity += pnl_rupees

                    ed = row.name.date()
                    daily_pnl.setdefault(ed, 0.0)
                    daily_pnl[ed] += pnl_rupees
                    if daily_pnl[ed] <= self.daily_loss_cap:
                        loss_stopped_days.add(ed)

                    results.append({
                        "entry_time": entry_time, "exit_time": row.name, "side": side,
                        "entry": entry_price, "exit": exit_px, "pnl_points": pnl_points,
                        "gross_rupees": gross_rupees, "costs_rupees": costs_rupees,
                        "pnl_rupees": pnl_rupees, "equity": equity, "exit_reason": reason,
                    })
                    in_position, side, entry_price, entry_time, tp_level, sl_level = False, None, None, None, None, None
                    i += 1
                    continue

                i += 1
                continue

            if not in_position and not day_stopped:
                sig = self.scalp_signal(i)
                if sig:
                    if self.confirm_trend_at_entry:
                        if (sig == "LONG" and not self.trend_up(i)) or (sig == "SHORT" and not self.trend_down(i)):
                            i += 1
                            continue

                    if i + 1 < len(self.df):
                        nb = self.df.iloc[i + 1]
                        in_position, side, entry_price, entry_time = True, sig, float(nb["open"]), nb.name
                        if side == "LONG":
                            tp_level, sl_level = entry_price + self.target_points, entry_price - self.stoploss_points
                        else:
                            tp_level, sl_level = entry_price - self.target_points, entry_price + self.stoploss_points
                        i += 2
                        continue
            i += 1

        return pd.DataFrame(results)

    def execute(self, write_csv: bool = False) -> Dict[str, Any]:
        symbols_to_test = []
        if is_option_symbol(self.symbol):
            pe_symbol, ce_symbol = get_option_pair(self.symbol)
            if self.option_selection == "pe": symbols_to_test = [pe_symbol]
            elif self.option_selection == "ce": symbols_to_test = [ce_symbol]
            else: symbols_to_test = [pe_symbol, ce_symbol]
        else:
            symbols_to_test = [self.symbol]

        all_trades = []
        for sym in symbols_to_test:
            if not sym: continue
            data_slice = self.load_data_from_db(sym)
            if data_slice.empty:
                print(f"⚠️ No data for {sym}")
                continue

            self.df = self.compute_indicators(data_slice)
            trades = self._run_backtest_on_df()
            if not trades.empty:
                trades["symbol"] = sym
                all_trades.append(trades)

        if not all_trades:
            return {
                "trades": pd.DataFrame(), "summary": None, "daily_stats": [],
                "output_csv": None, "message": "⚠️ No trades generated for any symbol.",
            }

        combined_trades = pd.concat(all_trades, ignore_index=True).sort_values("entry_time").reset_index(drop=True)
        summary = self.summarize_trades(combined_trades.copy())
        daily_stats = self.daily_breakdown(combined_trades.copy())

        out_csv = None
        if write_csv:
            symbol_suffix = "_".join(symbols_to_test) if len(symbols_to_test) > 1 else symbols_to_test[0]
            out_csv = f"scalp_with_trend_results_{symbol_suffix}_{self.interval}.csv"
            combined_trades.to_csv(out_csv, index=False)

        return {
            "trades": combined_trades, "summary": summary,
            "daily_stats": daily_stats, "output_csv": out_csv,
        }

    def summarize_trades(self, trades: pd.DataFrame) -> Dict[str, Any]:
        if trades.empty: return {}
        total = len(trades)
        wins = int((trades["pnl_rupees"] > 0).sum())
        losses = int((trades["pnl_rupees"] < 0).sum())
        flats = total - wins - losses
        winrate = wins / total * 100 if total else 0.0

        net_pnl = float(trades["pnl_rupees"].sum())
        roi = net_pnl / self.starting_capital * 100 if self.starting_capital else 0.0

        trades["cum"] = trades["pnl_rupees"].cumsum()
        trades["peak"] = trades["cum"].cummax()
        trades["dd"] = trades["cum"] - trades["peak"]
        max_dd = float(trades["dd"].min())

        avg_win = float(trades.loc[trades["pnl_rupees"] > 0, "pnl_rupees"].mean() if wins else 0.0)
        avg_loss = float(trades.loc[trades["pnl_rupees"] < 0, "pnl_rupees"].mean() if losses else 0.0)
        rr = abs(avg_win / avg_loss) if avg_loss else 0.0

        return {
            "total_trades": total, "wins": wins, "losses": losses, "flats": flats,
            "winrate_percent": winrate,
            "gross_rupees": float(trades["gross_rupees"].sum()),
            "costs_rupees": float(trades["costs_rupees"].sum()),
            "net_rupees": net_pnl,
            "final_equity": self.starting_capital + net_pnl,
            "roi_percent": roi, "avg_win": avg_win, "avg_loss": avg_loss,
            "risk_reward": rr, "max_drawdown": max_dd,
            "exit_reason_counts": trades["exit_reason"].value_counts().to_dict(),
        }

    def daily_breakdown(self, trades: pd.DataFrame) -> List[Dict[str, Any]]:
        if trades.empty: return []
        df_local = trades.copy()
        df_local["exit_time"] = pd.to_datetime(df_local["exit_time"])

        if df_local["exit_time"].dt.tz is None:
            df_local["exit_time"] = df_local["exit_time"].dt.tz_localize("Asia/Kolkata")
        else:
            df_local["exit_time"] = df_local["exit_time"].dt.tz_convert("Asia/Kolkata")

        df_local["exit_date"] = df_local["exit_time"].dt.date

        breakdown: List[Dict[str, Any]] = []
        for exit_date, group in df_local.groupby("exit_date", sort=True):
            breakdown.append({
                "date": exit_date.isoformat(),
                "date_label": pd.Timestamp(exit_date).strftime("%d %b %Y"),
                "net_pnl": float(group["pnl_rupees"].sum()),
                "profit": float(group.loc[group["pnl_rupees"] > 0, "pnl_rupees"].sum()),
                "loss": float(group.loc[group["pnl_rupees"] < 0, "pnl_rupees"].sum()),
                "wins": int((group["pnl_rupees"] > 0).sum()),
                "losses": int((group["pnl_rupees"] < 0).sum()),
                "trades": int(len(group)),
            })
        breakdown.sort(key=lambda x: x["date"])
        return breakdown

def run(config: Dict[str, Any], write_csv: bool = False) -> Dict[str, Any]:
    """
    Main entry point for running the backtest.
    """
    runner = BacktestRunner(config)
    return runner.execute(write_csv=write_csv)