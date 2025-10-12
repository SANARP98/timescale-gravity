#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Scalp-with-Trend Backtest (multi-bar hold; intraday square-off)
— TimescaleDB-powered data reader —
— Supports running PE, CE, or Both option types simultaneously —
"""

import argparse
from datetime import time
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from tsdb_pipeline import read_ohlcv_from_tsdb  # <<<< read from DB
from symbol_utils import get_option_pair, is_option_symbol

# ==================== CONFIGURATION (defaults; can be overridden via CLI) ====================

SYMBOL = "NIFTY28OCT2525000CE"
EXCHANGE = "NFO"
INTERVAL = "5m"
DATE_FROM = "2025-09-01"
DATE_TO = "2025-10-06"

STARTING_CAPITAL = 100_000
QTY_PER_POINT = 150

TARGET_POINTS = 10.0
STOPLOSS_POINTS = 2.0

EMA_FAST = 5
EMA_SLOW = 20

ATR_WINDOW = 14
ATR_MIN_POINTS = 2.0

SESSION_WINDOWS = [(time(9, 20), time(11, 0)), (time(11, 15), time(15, 5))]

DAILY_LOSS_CAP = -1000.0
EXIT_BAR_PATH = "color"  # "color" | "bull" | "bear" | "worst"
BROKERAGE_PER_TRADE = 20.0
SLIPPAGE_POINTS = 0.10
CONFIRM_TREND_AT_ENTRY = True
TRADE_DIRECTION = "both"
ENABLE_EOD_SQUARE_OFF = True
SQUARE_OFF_TIME = time(15, 25)
OPTION_SELECTION = "both"  # "pe" | "ce" | "both"

# ====== Globals (populated after load) ======
df = pd.DataFrame()


# ==================== DATA & INDICATORS ====================

def load_data_from_db(symbol: str, exchange: str, interval: str, start_ts: str, end_ts: str) -> pd.DataFrame:
    data = read_ohlcv_from_tsdb(symbol, exchange, interval, start_ts, end_ts)
    if data.empty:
        return data
    # Keep the same column order as the CSV-based backtest expected
    return data[["close", "high", "low", "oi", "open", "volume"]].copy()


def compute_indicators(_df: pd.DataFrame):
    _df["ema_fast"] = _df["close"].ewm(span=EMA_FAST, adjust=False).mean()
    _df["ema_slow"] = _df["close"].ewm(span=EMA_SLOW, adjust=False).mean()
    tr1 = _df["high"] - _df["low"]
    tr2 = (_df["high"] - _df["close"].shift(1)).abs()
    tr3 = (_df["low"] - _df["close"].shift(1)).abs()
    _df["tr"] = np.maximum(tr1, np.maximum(tr2, tr3))
    _df["atr"] = _df["tr"].rolling(window=ATR_WINDOW).mean()
    return _df


# ==================== HELPERS (unchanged from your version) ====================

def in_session(ts) -> bool:
    t = ts.time()
    for start, end in SESSION_WINDOWS:
        if start <= t <= end:
            return True
    return False


def trend_up(i: int) -> bool:
    r = df.iloc[i]
    return r["ema_fast"] > r["ema_slow"]


def trend_down(i: int) -> bool:
    r = df.iloc[i]
    return r["ema_fast"] < r["ema_slow"]


def atr_ok(i: int) -> bool:
    return df.iloc[i]["atr"] >= ATR_MIN_POINTS


def is_last_bar_of_day(i: int) -> bool:
    if i + 1 >= len(df):
        return True
    return df.index[i + 1].date() != df.index[i].date()


def past_square_off_time(ts) -> bool:
    return ts.time() >= SQUARE_OFF_TIME


def scalp_signal(i: int) -> str | None:
    if i < 1:
        return None
    prev = df.iloc[i - 1]
    curr = df.iloc[i]
    if not in_session(curr.name):
        return None
    if not atr_ok(i):
        return None
    if (curr["high"] > prev["high"]) and trend_up(i):
        if TRADE_DIRECTION in ("both", "long_only"):
            return "LONG"
    if (curr["low"] < prev["low"]) and trend_down(i):
        if TRADE_DIRECTION in ("both", "short_only"):
            return "SHORT"
    return None


def bar_path_tuple(bar: pd.Series):
    o = float(bar.get("open", np.nan))
    c = float(bar.get("close", np.nan))
    if EXIT_BAR_PATH == "bull":
        return ("open", "low", "high", "close")
    if EXIT_BAR_PATH == "bear":
        return ("open", "high", "low", "close")
    if EXIT_BAR_PATH == "color":
        if not np.isnan(o) and not np.isnan(c) and c >= o:
            return ("open", "low", "high", "close")
        return ("open", "high", "low", "close")
    return ("worst",)


def decide_exit_this_bar(position: str, entry_price: float, bar: pd.Series, tp: float, sl: float):
    high = float(bar["high"])
    low = float(bar["low"])
    hit_tp = hit_sl = False
    if position == "LONG":
        hit_tp = high >= tp
        hit_sl = low <= sl
    else:
        hit_tp = low <= tp
        hit_sl = high >= sl
    if not hit_tp and not hit_sl:
        return False, None, None
    path = bar_path_tuple(bar)
    if path == ("worst",):
        if hit_tp and hit_sl:
            return True, sl, "Stoploss Hit"
        if hit_tp:
            return True, tp, "Target Hit"
        return True, sl, "Stoploss Hit"
    if position == "LONG":
        if path == ("open", "low", "high", "close"):
            if low <= sl:
                return True, sl, "Stoploss Hit"
            if high >= tp:
                return True, tp, "Target Hit"
        else:
            if high >= tp:
                return True, tp, "Target Hit"
            if low <= sl:
                return True, sl, "Stoploss Hit"
    else:
        if path == ("open", "low", "high", "close"):
            if low <= tp:
                return True, tp, "Target Hit"
            if high >= sl:
                return True, sl, "Stoploss Hit"
        else:
            if high >= sl:
                return True, sl, "Stoploss Hit"
            if low <= tp:
                return True, tp, "Target Hit"
    if hit_tp and hit_sl:
        return True, sl, "Stoploss Hit"
    if hit_tp:
        return True, tp, "Target Hit"
    return True, sl, "Stoploss Hit"


# ==================== BACKTEST ENGINE (same logic) ====================

def run_backtest() -> pd.DataFrame:
    results = []
    equity = STARTING_CAPITAL
    in_position = False
    side = None
    entry_price = None
    entry_time = None
    tp_level = None
    sl_level = None

    daily_pnl = {}
    loss_stopped_days = set()

    i = 1
    n = len(df)

    while i < n:
        row = df.iloc[i]
        ts = row.name
        d = ts.date()

        daily_pnl.setdefault(d, 0.0)
        day_stopped = d in loss_stopped_days

        if in_position:
            exited, exit_px, reason = decide_exit_this_bar(side, entry_price, row, tp_level, sl_level)
            if exited:
                pnl_points = (exit_px - entry_price) if side == "LONG" else (entry_price - exit_px)
                gross_rupees = pnl_points * QTY_PER_POINT
                slippage_rupee = SLIPPAGE_POINTS * QTY_PER_POINT * 2
                fees_rupee = 2 * BROKERAGE_PER_TRADE
                costs_rupees = slippage_rupee + fees_rupee
                pnl_rupees = gross_rupees - costs_rupees
                equity += pnl_rupees

                ed = row.name.date()
                daily_pnl.setdefault(ed, 0.0)
                daily_pnl[ed] += pnl_rupees
                if daily_pnl[ed] <= DAILY_LOSS_CAP:
                    loss_stopped_days.add(ed)

                results.append(
                    {
                        "entry_time": entry_time,
                        "exit_time": row.name,
                        "side": side,
                        "entry": entry_price,
                        "exit": exit_px,
                        "pnl_points": pnl_points,
                        "gross_rupees": gross_rupees,
                        "costs_rupees": costs_rupees,
                        "pnl_rupees": pnl_rupees,
                        "equity": equity,
                        "exit_reason": reason,
                    }
                )

                in_position = False
                side = None
                entry_price = entry_time = None
                tp_level = sl_level = None
                i += 1
                continue
            if ENABLE_EOD_SQUARE_OFF and (is_last_bar_of_day(i) or past_square_off_time(row.name)):
                forced_exit_px = float(row["close"])
                pnl_points = (
                    (forced_exit_px - entry_price)
                    if side == "LONG"
                    else (entry_price - forced_exit_px)
                )

                gross_rupees = pnl_points * QTY_PER_POINT
                slippage_rupee = SLIPPAGE_POINTS * QTY_PER_POINT * 2
                fees_rupee = 2 * BROKERAGE_PER_TRADE
                costs_rupees = slippage_rupee + fees_rupee
                pnl_rupees = gross_rupees - costs_rupees
                equity += pnl_rupees

                ed = row.name.date()
                daily_pnl.setdefault(ed, 0.0)
                daily_pnl[ed] += pnl_rupees
                if daily_pnl[ed] <= DAILY_LOSS_CAP:
                    loss_stopped_days.add(ed)

                results.append(
                    {
                        "entry_time": entry_time,
                        "exit_time": row.name,
                        "side": side,
                        "entry": entry_price,
                        "exit": forced_exit_px,
                        "pnl_points": pnl_points,
                        "gross_rupees": gross_rupees,
                        "costs_rupees": costs_rupees,
                        "pnl_rupees": pnl_rupees,
                        "equity": equity,
                        "exit_reason": "Square-off EOD",
                    }
                )

                in_position = False
                side = None
                entry_price = entry_time = None
                tp_level = sl_level = None

                i += 1
                continue

            i += 1
            continue

        if not in_position and not day_stopped:
            sig = scalp_signal(i)
            if sig:
                if CONFIRM_TREND_AT_ENTRY:
                    if sig == "LONG" and not trend_up(i):
                        i += 1
                        continue
                    if sig == "SHORT" and not trend_down(i):
                        i += 1
                        continue

                if i + 1 < n:
                    nb = df.iloc[i + 1]
                    in_position = True
                    side = sig
                    entry_price = float(nb["open"])
                    entry_time = nb.name

                    if side == "LONG":
                        tp_level = entry_price + TARGET_POINTS
                        sl_level = entry_price - STOPLOSS_POINTS
                    else:
                        tp_level = entry_price - TARGET_POINTS
                        sl_level = entry_price + STOPLOSS_POINTS

                    i += 2
                    continue
        i += 1

    return pd.DataFrame(results)


# ==================== CONFIG APPLICATION & SUMMARY HELPERS ====================

def apply_config(cfg: Optional[Dict[str, Any]]) -> None:
    global SYMBOL, EXCHANGE, INTERVAL, DATE_FROM, DATE_TO
    global STARTING_CAPITAL, QTY_PER_POINT
    global TARGET_POINTS, STOPLOSS_POINTS, EMA_FAST, EMA_SLOW
    global ATR_WINDOW, ATR_MIN_POINTS, SESSION_WINDOWS, DAILY_LOSS_CAP
    global EXIT_BAR_PATH, BROKERAGE_PER_TRADE, SLIPPAGE_POINTS, CONFIRM_TREND_AT_ENTRY, df
    global ENABLE_EOD_SQUARE_OFF, SQUARE_OFF_TIME, TRADE_DIRECTION, OPTION_SELECTION

    if not cfg:
        return

    SYMBOL = cfg.get("symbol", SYMBOL)
    EXCHANGE = cfg.get("exchange", EXCHANGE)
    INTERVAL = cfg.get("interval", INTERVAL)
    DATE_FROM = cfg.get("start_date", DATE_FROM)
    DATE_TO = cfg.get("end_date", DATE_TO)

    STARTING_CAPITAL = cfg.get("starting_capital", STARTING_CAPITAL)
    QTY_PER_POINT = cfg.get("qty_per_point", QTY_PER_POINT)
    TARGET_POINTS = cfg.get("target_points", TARGET_POINTS)
    STOPLOSS_POINTS = cfg.get("stoploss_points", STOPLOSS_POINTS)
    EMA_FAST = cfg.get("ema_fast", EMA_FAST)
    EMA_SLOW = cfg.get("ema_slow", EMA_SLOW)
    ATR_WINDOW = cfg.get("atr_window", ATR_WINDOW)
    ATR_MIN_POINTS = cfg.get("atr_min_points", ATR_MIN_POINTS)
    DAILY_LOSS_CAP = cfg.get("daily_loss_cap", DAILY_LOSS_CAP)
    EXIT_BAR_PATH = cfg.get("exit_bar_path", EXIT_BAR_PATH)
    BROKERAGE_PER_TRADE = cfg.get("brokerage_per_trade", BROKERAGE_PER_TRADE)
    SLIPPAGE_POINTS = cfg.get("slippage_points", SLIPPAGE_POINTS)
    CONFIRM_TREND_AT_ENTRY = cfg.get("confirm_trend_at_entry", CONFIRM_TREND_AT_ENTRY)
    ENABLE_EOD_SQUARE_OFF = cfg.get("enable_eod_square_off", ENABLE_EOD_SQUARE_OFF)
    TRADE_DIRECTION = cfg.get("trade_direction", TRADE_DIRECTION)
    OPTION_SELECTION = cfg.get("option_selection", OPTION_SELECTION)

    if "square_off_time" in cfg and cfg["square_off_time"]:
        hh, mm = map(int, str(cfg["square_off_time"]).split(":"))
        SQUARE_OFF_TIME = time(hh, mm)

    if "session_windows" in cfg and cfg["session_windows"]:
        SESSION_WINDOWS = []
        for sw in cfg["session_windows"]:
            h1, m1 = map(int, sw["start"].split(":"))
            h2, m2 = map(int, sw["end"].split(":"))
            SESSION_WINDOWS.append((time(h1, m1), time(h2, m2)))


def summarize_trades(trades: pd.DataFrame) -> Dict[str, Any]:
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
    final_eq = STARTING_CAPITAL + net_pnl
    roi = net_pnl / STARTING_CAPITAL * 100 if STARTING_CAPITAL else 0.0

    trades["cum"] = trades["pnl_rupees"].cumsum()
    trades["peak"] = trades["cum"].cummax()
    trades["dd"] = trades["cum"] - trades["peak"]
    max_dd = float(trades["dd"].min())

    avg_win = float(
        trades.loc[trades["pnl_rupees"] > 0, "pnl_rupees"].mean() if wins else 0.0
    )
    avg_loss = float(
        trades.loc[trades["pnl_rupees"] < 0, "pnl_rupees"].mean() if losses else 0.0
    )
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

    df_local = trades.copy()
    df_local["exit_time"] = pd.to_datetime(df_local["exit_time"])

    if df_local["exit_time"].dt.tz is None:
        df_local["exit_time"] = df_local["exit_time"].dt.tz_localize("Asia/Kolkata")
    else:
        df_local["exit_time"] = df_local["exit_time"].dt.tz_convert("Asia/Kolkata")

    df_local["exit_date"] = df_local["exit_time"].dt.date

    breakdown: List[Dict[str, Any]] = []
    for exit_date, group in df_local.groupby("exit_date", sort=True):
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


def run_backtest_from_config(cfg: Optional[Dict[str, Any]] = None, write_csv: bool = False) -> Dict[str, Any]:
    apply_config(cfg)

    # Determine which symbols to backtest
    symbols_to_test = []
    if is_option_symbol(SYMBOL):
        pe_symbol, ce_symbol = get_option_pair(SYMBOL)
        if OPTION_SELECTION == "pe":
            symbols_to_test = [pe_symbol]
        elif OPTION_SELECTION == "ce":
            symbols_to_test = [ce_symbol]
        else:  # "both"
            symbols_to_test = [pe_symbol, ce_symbol]
    else:
        # Not an option symbol, run as single symbol
        symbols_to_test = [SYMBOL]

    # Run backtest for each symbol
    all_trades = []
    combined_data = {}

    for sym in symbols_to_test:
        data_slice = load_data_from_db(sym, EXCHANGE, INTERVAL, DATE_FROM, DATE_TO)
        if data_slice.empty:
            print(f"⚠️ No data for {sym}")
            continue

        data_slice = compute_indicators(data_slice)
        globals()["df"] = data_slice
        combined_data[sym] = data_slice

        trades = run_backtest()
        if not trades.empty:
            trades["symbol"] = sym  # Tag trades with symbol
            all_trades.append(trades)

    # Combine all trades
    if not all_trades:
        return {
            "data": combined_data,
            "trades": pd.DataFrame(),
            "summary": None,
            "output_csv": None,
            "daily_stats": [],
            "message": "⚠️  No trades generated for any symbol.",
        }

    combined_trades = pd.concat(all_trades, ignore_index=True)
    combined_trades = combined_trades.sort_values("entry_time").reset_index(drop=True)

    summary = summarize_trades(combined_trades.copy())
    daily_stats = daily_breakdown(combined_trades.copy())

    out_csv = None
    if write_csv:
        symbol_suffix = "_".join(symbols_to_test) if len(symbols_to_test) > 1 else symbols_to_test[0]
        out_csv = f"scalp_with_trend_results_{symbol_suffix}_{INTERVAL}.csv"
        combined_trades.to_csv(out_csv, index=False)

    return {
        "data": combined_data,
        "trades": combined_trades,
        "summary": summary,
        "output_csv": out_csv,
        "daily_stats": daily_stats,
    }


# ==================== REPORT ====================

def main(cfg=None):
    result = run_backtest_from_config(cfg, write_csv=True)
    summary = result["summary"]
    if summary is None:
        print(result.get("message", ""))
        return

    data_slice = result["data"]
    trades = result["trades"]

    print("🚀 Running Scalp-with-Trend (multi-bar hold; intraday square-off) from TimescaleDB ...\n")
    print("=" * 96)
    print(f"SYMBOL={SYMBOL} {EXCHANGE} {INTERVAL}  RANGE={DATE_FROM} → {DATE_TO}")
    print(f"TP={TARGET_POINTS} | SL={STOPLOSS_POINTS} (R:R={TARGET_POINTS/STOPLOSS_POINTS:.2f}) | Qty/pt={QTY_PER_POINT}")
    print(
        f"ATR≥{ATR_MIN_POINTS}, EMA{EMA_FAST}/{EMA_SLOW}, Sessions="
        f"{[(s.strftime('%H:%M'), e.strftime('%H:%M')) for s, e in SESSION_WINDOWS]}"
    )
    print(f"Trade Direction: {TRADE_DIRECTION.upper()}")
    print(f"Exit bar path: {EXIT_BAR_PATH} | Confirm trend at entry: {CONFIRM_TREND_AT_ENTRY}")
    print(f"Costs -> Brokerage/leg: ₹{BROKERAGE_PER_TRADE}, Slippage/leg: {SLIPPAGE_POINTS} pts")
    print(f"EOD Square-off: {ENABLE_EOD_SQUARE_OFF} at {SQUARE_OFF_TIME.strftime('%H:%M')} | Daily loss cap: ₹{DAILY_LOSS_CAP}")
    print("=" * 96)

    print("\n📋 Last 10 Trades:")
    cols = [
        "entry_time",
        "side",
        "entry",
        "exit",
        "gross_rupees",
        "costs_rupees",
        "pnl_rupees",
        "exit_reason",
    ]
    print(trades[cols].tail(10))

    print("\n" + "=" * 96)
    print("📊 BACKTEST SUMMARY")
    print("=" * 96)
    print(f"Initial Capital : ₹{STARTING_CAPITAL:,.2f}")
    print(f"Final Capital   : ₹{summary['final_equity']:,.2f}")
    print(f"Gross P&L       : ₹{summary['gross_rupees']:,.2f}")
    print(
        f"Total Costs     : ₹{summary['costs_rupees']:,.2f}  "
        f"(avg/trade: ₹{(summary['costs_rupees']/summary['total_trades']):.2f})"
    )
    print(f"Net P&L         : ₹{summary['net_rupees']:,.2f}")
    print(f"ROI             : {summary['roi_percent']:.2f}%")

    print(f"\nTotal Trades    : {summary['total_trades']}")
    print(f"Wins            : {summary['wins']} ({summary['winrate_percent']:.2f}%)")
    print(f"Losses          : {summary['losses']}")
    print(f"Breakeven       : {summary['flats']}")

    print(f"\nAvg Win         : ₹{summary['avg_win']:,.2f}")
    print(f"Avg Loss        : ₹{summary['avg_loss']:,.2f}")
    print(f"Actual R:R      : {summary['risk_reward']:.2f}")
    print(f"Max Drawdown    : ₹{summary['max_drawdown']:,.2f}")

    print("\n📈 Exit Reason Breakdown:")
    for reason, count in summary["exit_reason_counts"].items():
        pct = count / summary["total_trades"] * 100 if summary["total_trades"] else 0.0
        print(f"  {reason}: {count} ({pct:.1f}%)")

    if result["output_csv"]:
        print("\n✅ Saved:", result["output_csv"])

    be_wr = STOPLOSS_POINTS / (TARGET_POINTS + STOPLOSS_POINTS) * 100
    print(f"\nℹ️  Math: With TP={TARGET_POINTS}, SL={STOPLOSS_POINTS}, breakeven win-rate ≈ {be_wr:.1f}%")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backtest (multi-bar hold) from TimescaleDB")
    parser.add_argument("--symbol", type=str, default=SYMBOL)
    parser.add_argument("--exchange", type=str, default=EXCHANGE)
    parser.add_argument("--interval", type=str, default=INTERVAL)
    parser.add_argument("--start_date", type=str, default=DATE_FROM)
    parser.add_argument("--end_date", type=str, default=DATE_TO)
    parser.add_argument("--starting_capital", type=float)
    parser.add_argument("--qty_per_point", type=int)
    parser.add_argument("--target_points", type=float)
    parser.add_argument("--stoploss_points", type=float)
    parser.add_argument("--ema_fast", type=int)
    parser.add_argument("--ema_slow", type=int)
    parser.add_argument("--atr_window", type=int)
    parser.add_argument("--atr_min_points", type=float)
    parser.add_argument("--daily_loss_cap", type=float)
    parser.add_argument("--exit_bar_path", type=str, choices=["color", "bull", "bear", "worst"])
    parser.add_argument("--brokerage_per_trade", type=float)
    parser.add_argument("--slippage_points", type=float)
    parser.add_argument("--confirm_trend_at_entry", type=lambda x: x.lower() == "true")
    parser.add_argument("--enable_eod_square_off", type=lambda x: x.lower() == "true")
    parser.add_argument("--square_off_time", type=str, help="HH:MM (IST)")
    parser.add_argument("--trade_direction", type=str, choices=["both", "long_only", "short_only"])
    args = parser.parse_args()

    cfg = {k: v for k, v in vars(args).items() if v is not None}
    if "square_off_time" in cfg and cfg["square_off_time"]:
        # parsed inside main()
        pass
    main(cfg if cfg else None)
