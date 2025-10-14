# Multi-Leg Trading Implementation Guide for randomScalp_TPSL.py

## Overview
This guide provides complete step-by-step instructions to add multi-leg support (simultaneous CE + PE trading) to `randomScalp_TPSL.py`.

**Status**: Version 3.0 - Multi-Leg Support with Trailing Stop Loss
**Date**: 2025-10-14
**Strategy**: Random Scalp with Trailing SL + Straddle Support

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step-by-Step Implementation](#step-by-step-implementation)
3. [Helper Functions](#helper-functions)
4. [Testing Guide](#testing-guide)
5. [Configuration Examples](#configuration-examples)

---

## Prerequisites

- ✅ Backup original `randomScalp_TPSL.py` before making changes
- ✅ Ensure Python 3.8+ with all dependencies installed
- ✅ Test environment available for validation

---

## Step-by-Step Implementation

### STEP 1: Update Imports (Line 22-27)

**Replace:**
```python
from __future__ import annotations
import os, sys, time, json, logging, signal, threading
from dataclasses import dataclass, asdict
from typing import Optional, Tuple, Dict, Any
from datetime import datetime, time as dtime, timedelta
from threading import Lock
```

**With:**
```python
from __future__ import annotations
import os, sys, time, json, logging, signal, threading, re
from dataclasses import dataclass, asdict, field
from typing import Optional, Tuple, Dict, Any, List
from datetime import datetime, time as dtime, timedelta
from threading import Lock
```

---

### STEP 2: Add OptionLeg Dataclass (After line 40)

**Insert after `STRATEGY_NAME = "random_scalp_live"`:**

```python
# Option symbol regex pattern (e.g., NIFTY28OCT2525200CE)
OPTION_SYMBOL_RE = re.compile(r"^([A-Z]+)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$")

@dataclass
class OptionLeg:
    """Track a single option leg (CE or PE)"""
    option_type: str  # "CE" or "PE"
    symbol: str
    in_position: bool = False
    side: str = "LONG"  # Always LONG for random scalp
    entry_price: Optional[float] = None
    qty: int = 0
    actual_filled_qty: int = 0
    entry_order_id: Optional[str] = None
    tp_order_id: Optional[str] = None
    sl_order_id: Optional[str] = None
    tp_level: Optional[float] = None
    sl_level: Optional[float] = None
    tp_filled_qty: int = 0
    sl_filled_qty: int = 0
    # Trailing SL state (per leg)
    highest_favorable_price: Optional[float] = None
    sl_trail_active: bool = False
    original_sl_level: Optional[float] = None

    def to_dict(self) -> Dict:
        """Serialize for state persistence"""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'OptionLeg':
        """Deserialize from state"""
        return cls(**data)
```

---

### STEP 3: Update STRATEGY_METADATA

**Replace the features list:**
```python
STRATEGY_METADATA = {
    "name": "Random Scalp with Trailing SL + Multi-Leg (Live)",
    "description": "Production-hardened random scalp bot with multi-leg support (CE+PE straddles), intelligent trailing stop loss, and enhanced safety rails.",
    "version": "3.0",
    "features": [
        "Fixed-interval entries",
        "Multi-leg support: Trade CE, PE, or both simultaneously (straddle)",
        "ATM option auto-selection for indices",
        "Intelligent trailing stop loss (locks in profits as price moves per leg)",
        "Configurable trail activation and lock percentages",
        "Static rupee profit target and stop loss",
        "Partial fill handling on entry and exits with quantity sync",
        "SL-M trigger validation with automatic SL fallback",
        "Idempotent order placement with timeout handling",
        "OCO race condition protection with thread locks",
        "Exit legs retry mechanism with progressive backoff",
        "Three-axis position reconciliation (direction, qty, price)",
        "Enhanced graceful shutdown with escalation protocol",
        "Market-on-target conversion for gap scenarios",
        "Intraday square-off with APScheduler",
        "TimescaleDB-aware history fetching with smart caching",
        "OpenAlgo order execution with quote validation"
    ],
    "has_trade_direction": False,
    "author": "Random Scalp Multi-Leg with Trailing SL"
}
```

---

### STEP 4: Add Config Parameters

**In Config dataclass (after `slippage_rupees` around line 164), add:**

```python
# Multi-leg trading options
position_mode: str = os.getenv("POSITION_MODE", "single").lower()  # "single" or "straddle"
option_legs: str = os.getenv("OPTION_LEGS", "both").lower()  # "ce", "pe", or "both"
option_auto: bool = os.getenv("OPTION_AUTO", "false").lower() == "true"  # Auto ATM selection
```

---

### STEP 5: Update CONFIG_FIELD_ORDER

**Add after `"trail_lock_percent"` (around line 78):**

```python
"position_mode",
"option_legs",
"option_auto",
```

---

### STEP 6: Update CONFIG_FIELD_DEFS

**Add after trailing SL definitions (around line 98):**

```python
"position_mode": {
    "group": "Multi-Leg Options",
    "label": "Position Mode",
    "type": "select",
    "options": ["single", "straddle"],
    "help": "Single: One option per trade | Straddle: Both CE and PE simultaneously"
},
"option_legs": {
    "group": "Multi-Leg Options",
    "label": "Option Legs to Trade",
    "type": "select",
    "options": ["both", "ce", "pe"],
    "help": "Which options to trade when in straddle mode"
},
"option_auto": {
    "group": "Multi-Leg Options",
    "label": "Auto ATM Selection",
    "type": "boolean",
    "help": "Automatically select At-The-Money options based on spot price"
},
```

---

### STEP 7: Add Helper Functions (After INDEX_LOT_SIZES, before RandomScalpBot class)

```python
# Fallback lot sizes for common indices
INDEX_LOT_SIZES = {
    "NIFTY": 75,
    "BANKNIFTY": 35,
    "FINNIFTY": 65,
    "MIDCPNIFTY": 140,
    "NIFTYNXT50": 25,
    "SENSEX": 20,
    "BANKEX": 30,
    "SENSEX50": 60,
}

def is_index_symbol(symbol: str) -> bool:
    """Check if symbol is an index (for ATM option selection)"""
    return symbol.upper() in INDEX_LOT_SIZES

def get_atm_option_symbol(client, underlying_symbol: str, exchange: str, option_type: str) -> Optional[str]:
    """
    Pick ATM CE/PE from option chain for the given underlying.

    Args:
        client: OpenAlgo client instance
        underlying_symbol: Index symbol (e.g., "NIFTY", "BANKNIFTY")
        exchange: Exchange code (e.g., "NFO")
        option_type: "CE" or "PE"

    Returns:
        Option symbol string or None if not found
    """
    try:
        # Get spot price
        log(f"[{STRATEGY_NAME}] [ATM] Fetching spot price for {underlying_symbol}")
        spot_resp = client.quotes(symbol=underlying_symbol, exchange="NSE")
        if spot_resp.get('status') != 'success':
            log(f"[{STRATEGY_NAME}] [ERROR] Failed to get spot price: {spot_resp}")
            return None

        spot_price = float(spot_resp.get('data', {}).get('ltp', 0))
        if not spot_price:
            log(f"[{STRATEGY_NAME}] [ERROR] Invalid spot price")
            return None

        log(f"[{STRATEGY_NAME}] [ATM] Spot LTP: ₹{spot_price:.2f}")

        # Get option chain
        log(f"[{STRATEGY_NAME}] [ATM] Fetching option chain...")
        chain_resp = client.optionchain(symbol=underlying_symbol, exchange=exchange)
        if chain_resp.get('status') != 'success':
            log(f"[{STRATEGY_NAME}] [ERROR] Failed to get option chain: {chain_resp}")
            return None

        data = chain_resp.get('data', [])
        if not data:
            log(f"[{STRATEGY_NAME}] [ERROR] Empty option chain")
            return None

        # Determine strike rounding (based on index)
        if "BANK" in underlying_symbol.upper():
            strike_step = 100
        elif underlying_symbol.upper() in ["FINNIFTY", "MIDCPNIFTY"]:
            strike_step = 50
        else:
            strike_step = 50

        # Calculate ATM strike
        atm_strike = round(spot_price / strike_step) * strike_step
        log(f"[{STRATEGY_NAME}] [ATM] Calculated ATM strike: {atm_strike:.0f}")

        # Find matching option
        matches = [opt for opt in data
                   if opt.get('strike') == atm_strike
                   and opt.get('option_type') == option_type]

        if matches:
            symbol = matches[0].get('symbol')
            log(f"[{STRATEGY_NAME}] [ATM] ✅ Selected {option_type} @ {atm_strike:.0f} = {symbol}")
            return symbol

        # Try nearby strikes if exact ATM not found
        log(f"[{STRATEGY_NAME}] [ATM] Exact ATM not found, searching nearby...")
        for offset in [strike_step, -strike_step, 2*strike_step, -2*strike_step]:
            adj_strike = atm_strike + offset
            matches = [opt for opt in data
                       if opt.get('strike') == adj_strike
                       and opt.get('option_type') == option_type]
            if matches:
                symbol = matches[0].get('symbol')
                log(f"[{STRATEGY_NAME}] [ATM] ✅ Selected {option_type} @ {adj_strike:.0f} = {symbol}")
                return symbol

        log(f"[{STRATEGY_NAME}] [ERROR] No {option_type} option found near ATM")
        return None

    except Exception as e:
        log(f"[{STRATEGY_NAME}] [ERROR] get_atm_option_symbol: {e}")
        return None
```

---

### STEP 8: Refactor RandomScalpBot.__init__

**Find the __init__ method (around line 335-397). Replace position tracking variables:**

**OLD (Remove these lines):**
```python
# Position state
self.in_position: bool = False
self.side: Optional[str] = None
self.entry_price: Optional[float] = None
self.actual_filled_qty: int = 0
self.tp_level: Optional[float] = None
self.sl_level: Optional[float] = None
self.entry_order_id: Optional[str] = None
self.tp_order_id: Optional[str] = None
self.sl_order_id: Optional[str] = None
self.tp_filled_qty: int = 0
self.sl_filled_qty: int = 0

# ... (and the trailing SL state variables)
self.highest_favorable_price: Optional[float] = None
self.sl_trail_active: bool = False
self.original_sl_level: Optional[float] = None
```

**NEW (Replace with):**
```python
# Multi-leg position tracking
self.legs: Dict[str, OptionLeg] = {}  # {"CE": OptionLeg(...), "PE": OptionLeg(...)}
self.symbol_in_use: str = cfg.symbol  # Current symbol for logging

# Backward-compatible properties
@property
def in_position(self) -> bool:
    """True if ANY leg is in position"""
    return any(leg.in_position for leg in self.legs.values())

@property
def side(self) -> Optional[str]:
    """Return primary leg's side (always LONG for random scalp)"""
    if self.legs:
        return next((leg.side for leg in self.legs.values() if leg.in_position), None)
    return None

@property
def entry_price(self) -> Optional[float]:
    """Return first leg's entry price for backward compatibility"""
    if self.legs:
        return next((leg.entry_price for leg in self.legs.values() if leg.in_position), None)
    return None

@property
def actual_filled_qty(self) -> int:
    """Return first leg's filled qty for backward compatibility"""
    if self.legs:
        return next((leg.actual_filled_qty for leg in self.legs.values() if leg.in_position), 0)
    return 0

@property
def tp_level(self) -> Optional[float]:
    """Return first leg's TP level"""
    if self.legs:
        return next((leg.tp_level for leg in self.legs.values() if leg.in_position), None)
    return None

@property
def sl_level(self) -> Optional[float]:
    """Return first leg's SL level"""
    if self.legs:
        return next((leg.sl_level for leg in self.legs.values() if leg.in_position), None)
    return None
```

**Add these properties right after the __init__ method:**

```python
# Add these as methods of RandomScalpBot class (after __init__)
@property
def in_position(self) -> bool:
    """True if ANY leg is in position"""
    return any(leg.in_position for leg in self.legs.values())

@property
def side(self) -> Optional[str]:
    """Return primary leg's side (always LONG for random scalp)"""
    if self.legs:
        return next((leg.side for leg in self.legs.values() if leg.in_position), None)
    return None

@property
def entry_price(self) -> Optional[float]:
    """Return first leg's entry price for backward compatibility"""
    if self.legs:
        return next((leg.entry_price for leg in self.legs.values() if leg.in_position), None)
    return None

@property
def actual_filled_qty(self) -> int:
    """Return first leg's filled qty for backward compatibility"""
    if self.legs:
        return next((leg.actual_filled_qty for leg in self.legs.values() if leg.in_position), 0)
    return 0

@property
def tp_level(self) -> Optional[float]:
    """Return first leg's TP level"""
    if self.legs:
        return next((leg.tp_level for leg in self.legs.values() if leg.in_position), None)
    return None

@property
def sl_level(self) -> Optional[float]:
    """Return first leg's SL level"""
    if self.legs:
        return next((leg.sl_level for leg in self.legs.values() if leg.in_position), None)
    return None
```

---

### STEP 9: Add Multi-Leg Entry Methods (Add after _round_to_tick method)

```python
def _get_legs_to_trade(self) -> List[str]:
    """Determine which option types to trade based on config"""
    if self.cfg.position_mode == "single":
        # Single leg mode: Only CE for LONG (random scalp is long-only)
        if self.cfg.option_auto and is_index_symbol(self.cfg.symbol):
            return ["CE"]  # Will select ATM CE
        else:
            # Use configured symbol as-is, try to detect type
            match = OPTION_SYMBOL_RE.match(self.cfg.symbol.upper())
            if match:
                return [match.group(6)]  # Extract CE or PE
            return ["CE"]  # Default to CE

    elif self.cfg.position_mode == "straddle":
        # Straddle mode: trade according to option_legs setting
        if self.cfg.option_legs == "both":
            return ["CE", "PE"]
        elif self.cfg.option_legs == "ce":
            return ["CE"]
        elif self.cfg.option_legs == "pe":
            return ["PE"]
        else:
            log(f"[{STRATEGY_NAME}] [WARN] Invalid option_legs: {self.cfg.option_legs}, defaulting to both")
            return ["CE", "PE"]

    else:
        log(f"[{STRATEGY_NAME}] [ERROR] Invalid position_mode: {self.cfg.position_mode}")
        return []

def _place_leg_entry(self, option_type: str) -> bool:
    """
    Place market entry order for a single leg.

    Returns:
        True if successful, False otherwise
    """
    try:
        # Determine symbol
        if self.cfg.option_auto and is_index_symbol(self.cfg.symbol):
            symbol = get_atm_option_symbol(self.client, self.cfg.symbol, self.cfg.exchange, option_type)
            if not symbol:
                log(f"[{STRATEGY_NAME}] [ERROR] Could not get ATM {option_type} symbol")
                return False
        else:
            # Use configured symbol
            symbol = self.cfg.symbol
            # Validate it matches the option type if it's an option symbol
            match = OPTION_SYMBOL_RE.match(symbol.upper())
            if match and match.group(6) != option_type:
                log(f"[{STRATEGY_NAME}] [WARN] Symbol {symbol} is {match.group(6)}, but trying to trade {option_type}")

        log(f"[{STRATEGY_NAME}] 🚀 [{option_type}] Placing entry for {symbol}")

        # Place market order
        resp = self._safe_placeorder(
            strategy=STRATEGY_NAME,
            symbol=symbol,
            exchange=self.cfg.exchange,
            product=self.cfg.product,
            action="BUY",  # Always BUY for LONG
            price_type="MARKET",
            quantity=self.qty,
        )

        if not resp or resp.get('status') != 'success':
            log(f"[{STRATEGY_NAME}] ❌ [{option_type}] Entry order failed: {resp}")
            return False

        order_id = resp.get('orderid')
        log(f"[{STRATEGY_NAME}] [ORDER] [{option_type}] Entry placed: oid={order_id}")

        # Poll for fill with retry logic
        max_retries = 5
        entry_price = None
        filled_qty = 0

        for attempt in range(max_retries):
            time.sleep(0.3 * (attempt + 1))
            st = self.client.orderstatus(order_id=order_id, strategy=STRATEGY_NAME)
            data = st.get('data', {})
            entry_price = float(data.get('average_price') or 0)
            filled_qty = self._get_filled_qty(st)

            if self._is_complete(st) and entry_price and filled_qty > 0:
                break

            log(f"[{STRATEGY_NAME}] [{option_type}] Waiting for fill... ({attempt+1}/{max_retries})")

        if not entry_price or filled_qty == 0:
            log(f"[{STRATEGY_NAME}] [ERROR] [{option_type}] Entry not filled after {max_retries} retries")
            return False

        # Create leg tracking object
        leg = OptionLeg(
            option_type=option_type,
            symbol=symbol,
            in_position=True,
            side="LONG",
            entry_price=entry_price,
            qty=self.qty,
            actual_filled_qty=filled_qty,
            entry_order_id=order_id,
        )

        # Compute exit levels
        leg.tp_level = self._round_to_tick(entry_price + self.cfg.profit_target_rupees)
        leg.sl_level = self._round_to_tick(entry_price - self.cfg.stop_loss_rupees)

        # Initialize trailing SL state
        leg.highest_favorable_price = entry_price
        leg.sl_trail_active = False
        leg.original_sl_level = leg.sl_level

        self.legs[option_type] = leg

        log(f"[{STRATEGY_NAME}] ✅ [{option_type}] ENTRY @ ₹{entry_price:.2f} qty {filled_qty} | TP ₹{leg.tp_level:.2f} | SL ₹{leg.sl_level:.2f}")

        # Place exit orders for this leg
        self._place_exit_legs_for_option(leg)

        return True

    except Exception as e:
        log(f"[{STRATEGY_NAME}] [ERROR] _place_leg_entry ({option_type}): {e}")
        return False

def _place_exit_legs_for_option(self, leg: OptionLeg):
    """Place TP and SL orders for a specific option leg"""
    try:
        tp_success = False
        sl_success = False

        # Place TP (SELL LIMIT)
        try:
            tp_resp = self._safe_placeorder(
                strategy=STRATEGY_NAME,
                symbol=leg.symbol,
                exchange=self.cfg.exchange,
                product=self.cfg.product,
                action="SELL",
                price_type="LIMIT",
                price=leg.tp_level,
                quantity=leg.actual_filled_qty,
            )
            if tp_resp and tp_resp.get('status') == 'success':
                leg.tp_order_id = tp_resp.get('orderid')
                tp_success = True
                log(f"[{STRATEGY_NAME}] [{leg.option_type}] TP order placed: oid={leg.tp_order_id} @ ₹{leg.tp_level:.2f}")
            else:
                log(f"[{STRATEGY_NAME}] [ERROR] [{leg.option_type}] TP order failed: {tp_resp}")
        except Exception as e:
            log(f"[{STRATEGY_NAME}] [ERROR] [{leg.option_type}] TP order exception: {e}")

        # Place SL (SL-M)
        sl_resp = self._place_stop_order(leg.actual_filled_qty, leg.sl_level, action="SELL")
        if sl_resp and sl_resp.get('status') == 'success':
            leg.sl_order_id = sl_resp.get('orderid')
            sl_success = True
            log(f"[{STRATEGY_NAME}] [{leg.option_type}] SL order placed: oid={leg.sl_order_id} @ ₹{leg.sl_level:.2f}")
        else:
            log(f"[{STRATEGY_NAME}] [ERROR] [{leg.option_type}] SL order failed")

        if not tp_success or not sl_success:
            log(f"[{STRATEGY_NAME}] [WARN] [{leg.option_type}] Exit legs placement incomplete (TP={tp_success}, SL={sl_success})")

    except Exception as e:
        log(f"[{STRATEGY_NAME}] [ERROR] _place_exit_legs_for_option ({leg.option_type}): {e}")
```

---

### STEP 10: Refactor place_entry() Method

**Find the existing `place_entry()` method (around line 871-943) and replace it completely with:**

```python
def place_entry(self):
    """Place entry orders for configured option legs"""
    try:
        if self.in_position:
            log(f"[{STRATEGY_NAME}] Already in position, skipping entry")
            return

        action = "BUY"  # Long-only
        log(f"[{STRATEGY_NAME}] 🚀 [ENTRY] {action} {self.cfg.symbol} x {self.qty}")

        # Determine which legs to trade
        legs_to_trade = self._get_legs_to_trade()

        if not legs_to_trade:
            log(f"[{STRATEGY_NAME}] [ERROR] No legs to trade")
            self.pending_signal = False
            return

        log(f"[{STRATEGY_NAME}] [ENTRY] Trading legs: {', '.join(legs_to_trade)}")

        # Place orders for each leg
        success_count = 0
        for option_type in legs_to_trade:
            if self._place_leg_entry(option_type):
                success_count += 1

        if success_count == 0:
            log(f"[{STRATEGY_NAME}] [ERROR] All leg entries failed")
        elif success_count < len(legs_to_trade):
            log(f"[{STRATEGY_NAME}] [WARN] Partial leg entry: {success_count}/{len(legs_to_trade)} legs filled")
        else:
            log(f"[{STRATEGY_NAME}] ✅ All {success_count} legs entered successfully")

        self.pending_signal = False
        self._persist()

    except Exception as e:
        log(f"[{STRATEGY_NAME}] [ERROR] place_entry: {e}")
```

---

### STEP 11: Refactor check_order_status() for Multi-Leg

**Find `check_order_status()` method (around line 758-869) and replace with:**

```python
def check_order_status(self):
    """Poll ALL legs for order status with OCO safety and race condition protection"""
    if not self.in_position:
        return

    # Use lock to prevent race condition
    if not self.exit_lock.acquire(blocking=False):
        return

    try:
        for option_type, leg in list(self.legs.items()):  # list() to avoid dict size change during iteration
            if not leg.in_position:
                continue

            self._check_leg_status(leg)
    finally:
        self.exit_lock.release()

def _check_leg_status(self, leg: OptionLeg):
    """Check TP/SL status for a single leg and handle exits"""
    tp_complete = False
    sl_complete = False
    tp_partial = False
    sl_partial = False
    tp_price = None
    sl_price = None
    tp_filled = 0
    sl_filled = 0

    # Check TP status
    if leg.tp_order_id:
        try:
            resp = self.client.orderstatus(order_id=leg.tp_order_id, strategy=STRATEGY_NAME)
            if resp.get('status') == 'success':
                if self._is_complete(resp):
                    tp_complete = True
                    tp_price = float(resp.get('data', {}).get('average_price', 0) or 0)
                    tp_filled = self._get_filled_qty(resp)
                elif self._is_partial(resp):
                    tp_partial = True
                    tp_filled = self._get_filled_qty(resp)
                    if tp_filled > leg.tp_filled_qty:
                        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [PARTIAL] TP partially filled: {tp_filled}/{leg.actual_filled_qty}")
                        leg.tp_filled_qty = tp_filled
                elif self._is_rejected(resp):
                    log(f"[{STRATEGY_NAME}] [{leg.option_type}] [CRITICAL] TP rejected!")
                    leg.tp_order_id = None
        except Exception as e:
            log(f"[{STRATEGY_NAME}] [{leg.option_type}] [WARN] TP status check failed: {e}")

    # Check SL status
    if leg.sl_order_id:
        try:
            resp = self.client.orderstatus(order_id=leg.sl_order_id, strategy=STRATEGY_NAME)
            if resp.get('status') == 'success':
                if self._is_complete(resp):
                    sl_complete = True
                    sl_price = float(resp.get('data', {}).get('average_price', 0) or 0)
                    sl_filled = self._get_filled_qty(resp)
                elif self._is_partial(resp):
                    sl_partial = True
                    sl_filled = self._get_filled_qty(resp)
                    if sl_filled > leg.sl_filled_qty:
                        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [PARTIAL] SL partially filled: {sl_filled}/{leg.actual_filled_qty}")
                        leg.sl_filled_qty = sl_filled
                elif self._is_rejected(resp):
                    log(f"[{STRATEGY_NAME}] [{leg.option_type}] [CRITICAL] SL rejected!")
                    leg.sl_order_id = None
        except Exception as e:
            log(f"[{STRATEGY_NAME}] [{leg.option_type}] [WARN] SL status check failed: {e}")

    # Handle partial fills - sync exit quantities
    total_exits = leg.tp_filled_qty + leg.sl_filled_qty
    if total_exits > 0 and total_exits < leg.actual_filled_qty:
        remaining_qty = leg.actual_filled_qty - total_exits
        if not tp_complete and not sl_complete:
            log(f"[{STRATEGY_NAME}] [{leg.option_type}] [SYNC_NEEDED] Total exits {total_exits}, remaining {remaining_qty}")
            self._sync_leg_exit_quantities(leg, remaining_qty)
            return

    # Update trailing stop (if enabled)
    if self.cfg.enable_trailing_sl:
        try:
            self._update_trailing_stop_for_leg(leg)
        except Exception as e:
            log(f"[{STRATEGY_NAME}] [{leg.option_type}] [ERROR] Trailing SL update failed: {e}")

    # Process complete fills
    if tp_complete and sl_complete:
        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [CRITICAL] Both TP and SL filled! OCO failure.")
        self._realize_leg_exit(leg, tp_price or leg.entry_price, "Target Hit (OCO Race)")
    elif tp_complete:
        self.cancel_order_silent(leg.sl_order_id)
        self._realize_leg_exit(leg, tp_price or leg.entry_price, "Target Hit")
    elif sl_complete:
        self.cancel_order_silent(leg.tp_order_id)
        self._realize_leg_exit(leg, sl_price or leg.entry_price, "Stop Loss Hit")

def _sync_leg_exit_quantities(self, leg: OptionLeg, remaining_qty: int):
    """Sync exit order quantities for a leg when partial fills occur"""
    if remaining_qty <= 0:
        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [SYNC] No remaining quantity")
        self.cancel_order_silent(leg.tp_order_id)
        self.cancel_order_silent(leg.sl_order_id)
        leg.tp_order_id = None
        leg.sl_order_id = None
        return

    log(f"[{STRATEGY_NAME}] [{leg.option_type}] [SYNC] Adjusting exits for remaining qty {remaining_qty}")

    # Cancel existing
    self.cancel_order_silent(leg.tp_order_id)
    self.cancel_order_silent(leg.sl_order_id)

    # Re-place TP
    try:
        tp_resp = self._safe_placeorder(
            strategy=STRATEGY_NAME,
            symbol=leg.symbol,
            exchange=self.cfg.exchange,
            product=self.cfg.product,
            action="SELL",
            price_type="LIMIT",
            price=leg.tp_level,
            quantity=remaining_qty,
        )
        if tp_resp and tp_resp.get('status') == 'success':
            leg.tp_order_id = tp_resp.get('orderid')
            log(f"[{STRATEGY_NAME}] [{leg.option_type}] [SYNC] Re-placed TP for qty {remaining_qty}")
    except Exception as e:
        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [ERROR] Failed to re-place TP: {e}")

    # Re-place SL
    sl_resp = self._place_stop_order(remaining_qty, leg.sl_level, action="SELL")
    if sl_resp and sl_resp.get('status') == 'success':
        leg.sl_order_id = sl_resp.get('orderid')
        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [SYNC] Re-placed SL for qty {remaining_qty}")

    self._persist()
```

---

### STEP 12: Update Trailing Stop Logic for Multi-Leg

**Find `_update_trailing_stop()` method (around line 889-951) and replace with:**

```python
def _update_trailing_stop_for_leg(self, leg: OptionLeg):
    """
    Intelligent trailing stop loss logic for a single leg.
    """
    if not self.cfg.enable_trailing_sl or not leg.in_position:
        return

    # Get current LTP for this leg's symbol
    try:
        q = self.client.quotes(symbol=leg.symbol, exchange=self.cfg.exchange)
        ltp = float(q.get('data', {}).get('ltp', 0))
        if not ltp:
            return
    except Exception as e:
        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [TRAIL] Failed to fetch LTP: {e}")
        return

    # Update highest favorable price
    if leg.highest_favorable_price is None or ltp > leg.highest_favorable_price:
        leg.highest_favorable_price = ltp

    current_profit = ltp - leg.entry_price
    target_range = self.cfg.profit_target_rupees
    activation_threshold = target_range * (self.cfg.trail_activation_percent / 100.0)

    # Check if trailing should activate
    if not leg.sl_trail_active and current_profit >= activation_threshold:
        leg.sl_trail_active = True
        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [TRAIL] ✅ ACTIVATED! Profit ₹{current_profit:.2f} >= ₹{activation_threshold:.2f}")

    if not leg.sl_trail_active:
        return  # Not yet activated

    # Calculate new trailing SL
    locked_profit = leg.highest_favorable_price - leg.entry_price
    trail_amount = locked_profit * (self.cfg.trail_lock_percent / 100.0)
    new_sl = self._round_to_tick(leg.entry_price + trail_amount)

    # Only update if new SL is better (higher for LONG)
    if new_sl > leg.sl_level:
        log(f"[{STRATEGY_NAME}] [{leg.option_type}] [TRAIL] 📈 Moving SL: ₹{leg.sl_level:.2f} → ₹{new_sl:.2f} (locking ₹{trail_amount:.2f})")

        # Cancel existing SL order
        self.cancel_order_silent(leg.sl_order_id)

        # Place new SL order
        remaining_qty = leg.actual_filled_qty - leg.tp_filled_qty - leg.sl_filled_qty
        if remaining_qty > 0:
            sl_resp = self._place_stop_order(remaining_qty, new_sl, action="SELL")
            if sl_resp and sl_resp.get('status') == 'success':
                leg.sl_order_id = sl_resp.get('orderid')
                leg.sl_level = new_sl
                self._persist()
                log(f"[{STRATEGY_NAME}] [{leg.option_type}] [TRAIL] ✅ New SL placed: oid={leg.sl_order_id} @₹{new_sl:.2f}")
            else:
                log(f"[{STRATEGY_NAME}] [{leg.option_type}] [TRAIL] ❌ Failed to place new SL order")
```

---

### STEP 13: Update Exit Realization for Multi-Leg

**Find `_realize_exit()` method and replace with:**

```python
def _realize_leg_exit(self, leg: OptionLeg, exit_price: float, reason: str):
    """Close a single leg and calculate P&L"""
    if not leg.in_position or leg.entry_price is None:
        return

    points = exit_price - leg.entry_price
    entry_costs = self.cfg.brokerage_per_trade + (self.cfg.slippage_rupees / 2.0)
    exit_costs = self.cfg.brokerage_per_trade + (self.cfg.slippage_rupees / 2.0)
    total_costs = entry_costs + exit_costs
    gross = points * leg.qty
    net = gross - total_costs

    self.realized_pnl_today += net

    emoji = "💰" if net > 0 else "💸"
    log(f"[{STRATEGY_NAME}] {emoji} [{leg.option_type}] [EXIT] {reason} | Entry ₹{leg.entry_price:.2f} → Exit ₹{exit_price:.2f} | Gross ₹{gross:+.2f} | Costs ₹{total_costs:.2f} | Net ₹{net:+.2f} | Day ₹{self.realized_pnl_today:+.2f}")

    # Clear leg state
    leg.in_position = False
    self.cancel_order_silent(leg.tp_order_id)
    self.cancel_order_silent(leg.sl_order_id)

    # Remove leg from tracking
    if leg.option_type in self.legs:
        del self.legs[leg.option_type]

    # If all legs closed, reset state
    if not self.in_position:
        self._flat_state()

    self._persist()
    self._ensure_flat_position(reason)
```

---

### STEP 14: Update State Persistence

**Find `_persist()` method (around line 1248-1268) and replace with:**

```python
def _persist(self):
    if not self.cfg.persist_state:
        return
    try:
        state = {
            "position_mode": self.cfg.position_mode,
            "legs": {
                option_type: leg.to_dict()
                for option_type, leg in self.legs.items()
            },
            "realized_pnl_today": self.realized_pnl_today,
        }

        with open(f"{STRATEGY_NAME}_state.json","w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        log(f"[{STRATEGY_NAME}] [WARN] persist failed: {e}")
```

**Find `_load_state()` method (around line 1178-1246) and replace with:**

```python
def _load_state(self):
    if not self.cfg.persist_state:
        return
    try:
        with open(f"{STRATEGY_NAME}_state.json") as f:
            state = json.load(f)
    except FileNotFoundError:
        return
    except Exception as e:
        log(f"[{STRATEGY_NAME}] [WARN] load_state failed: {e}")
        return

    # Restore legs
    legs_data = state.get("legs", {})
    for option_type, leg_data in legs_data.items():
        leg = OptionLeg.from_dict(leg_data)
        self.legs[option_type] = leg

    self.realized_pnl_today = state.get("realized_pnl_today", 0.0)
    self.pending_signal = False

    if self.in_position:
        # Check both exit orders for each leg
        for option_type, leg in self.legs.items():
            tp_filled = False
            sl_filled = False
            tp_price = None
            sl_price = None

            if leg.tp_order_id:
                try:
                    resp = self.client.orderstatus(order_id=leg.tp_order_id, strategy=STRATEGY_NAME)
                    if resp.get('status') == 'success':
                        if self._is_complete(resp):
                            tp_filled = True
                            tp_price = float(resp.get('data', {}).get('average_price', 0) or 0)
                        elif self._is_rejected(resp):
                            log(f"[{STRATEGY_NAME}] [{option_type}] [WARN] TP order rejected during recovery")
                except Exception as e:
                    log(f"[{STRATEGY_NAME}] [{option_type}] [WARN] TP status recovery failed: {e}")

            if leg.sl_order_id:
                try:
                    resp = self.client.orderstatus(order_id=leg.sl_order_id, strategy=STRATEGY_NAME)
                    if resp.get('status') == 'success':
                        if self._is_complete(resp):
                            sl_filled = True
                            sl_price = float(resp.get('data', {}).get('average_price', 0) or 0)
                        elif self._is_rejected(resp):
                            log(f"[{STRATEGY_NAME}] [{option_type}] [WARN] SL order rejected during recovery")
                except Exception as e:
                    log(f"[{STRATEGY_NAME}] [{option_type}] [WARN] SL status recovery failed: {e}")

            # Process exits
            if tp_filled and sl_filled:
                log(f"[{STRATEGY_NAME}] [{option_type}] [CRITICAL] Both TP and SL filled during downtime")
                self._realize_leg_exit(leg, tp_price or leg.entry_price, "Target Hit (recovered - OCO race)")
            elif tp_filled:
                self.cancel_order_silent(leg.sl_order_id)
                self._realize_leg_exit(leg, tp_price or leg.entry_price, "Target Hit (recovered)")
            elif sl_filled:
                self.cancel_order_silent(leg.tp_order_id)
                self._realize_leg_exit(leg, sl_price or leg.entry_price, "Stoploss Hit (recovered)")
    else:
        self._ensure_flat_position("startup")
```

**Find `_flat_state()` method (around line 1267-1286) and replace with:**

```python
def _flat_state(self):
    """Reset to flat state"""
    self.legs = {}
    self.pending_signal = False
    self.next_entry_time = None
    self.exit_legs_placed = False
    self.exit_legs_retry_count = 0
```

---

### STEP 15: Update square_off() for Multi-Leg

**Find `square_off()` method (around line 1029-1083) and update to close all legs:**

```python
def square_off(self):
    now = now_ist()
    if not self.in_position:
        # Clean up any stale exit orders
        for leg in self.legs.values():
            if leg.tp_order_id or leg.sl_order_id:
                log(f"[{STRATEGY_NAME}] [{leg.option_type}] [SQUARE_OFF] Cleaning up stale orders")
                self.cancel_order_silent(leg.tp_order_id)
                self.cancel_order_silent(leg.sl_order_id)
        self.legs = {}
        self._persist()
        return

    try:
        log(f"[{STRATEGY_NAME}] [EOD] Squaring off all positions")

        # Close each leg
        for option_type, leg in list(self.legs.items()):
            if not leg.in_position:
                continue

            log(f"[{STRATEGY_NAME}] [{option_type}] [EOD] Closing leg: {leg.symbol}")

            # Cancel exit legs first
            self.cancel_order_silent(leg.tp_order_id)
            self.cancel_order_silent(leg.sl_order_id)

            # Place market close order
            resp = self.client.placeorder(
                strategy=STRATEGY_NAME,
                symbol=leg.symbol,
                exchange=self.cfg.exchange,
                product=self.cfg.product,
                action="SELL",
                price_type="MARKET",
                quantity=leg.qty,
            )

            if resp.get('status') == 'success':
                time.sleep(0.5)
                exit_price = None
                try:
                    oid = resp.get('orderid')
                    st = self.client.orderstatus(order_id=oid, strategy=STRATEGY_NAME)
                    exit_price = float(st.get('data', {}).get('average_price', 0) or 0)
                except Exception as e:
                    log(f"[{STRATEGY_NAME}] [{option_type}] [WARN] Could not get exit price: {e}")

                # Fallback to LTP
                if not exit_price:
                    try:
                        q = self.client.quotes(symbol=leg.symbol, exchange=self.cfg.exchange)
                        exit_price = float(q.get('data',{}).get('ltp') or 0)
                    except Exception:
                        exit_price = leg.entry_price or 0

                self._realize_leg_exit(leg, exit_price, reason="EOD Square-Off")
            else:
                log(f"[{STRATEGY_NAME}] [{option_type}] [EOD] close failed: {resp}")

    except Exception as e:
        log(f"[{STRATEGY_NAME}] [EOD] Exception: {e}")
```

---

## Testing Guide

### Test Case 1: Single Mode (Backward Compatibility)
```bash
POSITION_MODE=single
OPTION_AUTO=false
SYMBOL=NIFTY24NOV2525000CE
```
**Expected**: Should work exactly as before (one position)

### Test Case 2: Single Mode with Auto ATM
```bash
POSITION_MODE=single
OPTION_AUTO=true
OPTION_LEGS=ce
SYMBOL=NIFTY
```
**Expected**: Selects ATM CE automatically

### Test Case 3: Straddle Mode - Both Legs
```bash
POSITION_MODE=straddle
OPTION_AUTO=true
OPTION_LEGS=both
SYMBOL=NIFTY
```
**Expected**: Buys both ATM CE and ATM PE simultaneously

### Test Case 4: Straddle Mode - CE Only
```bash
POSITION_MODE=straddle
OPTION_AUTO=true
OPTION_LEGS=ce
SYMBOL=BANKNIFTY
```
**Expected**: Only CE option traded (even in straddle mode)

### Test Case 5: Trailing SL with Multi-Leg
```bash
POSITION_MODE=straddle
OPTION_LEGS=both
ENABLE_TRAILING_SL=true
TRAIL_ACTIVATION_PERCENT=50
TRAIL_LOCK_PERCENT=75
```
**Expected**: Each leg trails independently

---

## Configuration Examples

### Example 1: Conservative Single-Leg Call Buyer
```bash
POSITION_MODE=single
OPTION_AUTO=true
OPTION_LEGS=ce
SYMBOL=NIFTY
PROFIT_TARGET_RUPEES=4.0
STOP_LOSS_RUPEES=2.0
ENABLE_TRAILING_SL=true
```

### Example 2: Aggressive Straddle Scalper
```bash
POSITION_MODE=straddle
OPTION_AUTO=true
OPTION_LEGS=both
SYMBOL=BANKNIFTY
PROFIT_TARGET_RUPEES=10.0
STOP_LOSS_RUPEES=5.0
TRADE_EVERY_N_BARS=3
ENABLE_TRAILING_SL=true
TRAIL_ACTIVATION_PERCENT=40
TRAIL_LOCK_PERCENT=80
```

### Example 3: Put-Only Strategy
```bash
POSITION_MODE=straddle
OPTION_AUTO=true
OPTION_LEGS=pe
SYMBOL=FINNIFTY
PROFIT_TARGET_RUPEES=3.0
STOP_LOSS_RUPEES=1.5
```

---

## Validation Checklist

- [ ] Imports updated (re, List added)
- [ ] OptionLeg dataclass added
- [ ] Config parameters added (position_mode, option_legs, option_auto)
- [ ] CONFIG_FIELD_ORDER updated
- [ ] CONFIG_FIELD_DEFS updated
- [ ] Helper functions added (is_index_symbol, get_atm_option_symbol)
- [ ] RandomScalpBot.__init__ refactored (legs dict instead of single position)
- [ ] Properties added (@property decorators for backward compatibility)
- [ ] Entry methods added (_get_legs_to_trade, _place_leg_entry, _place_exit_legs_for_option)
- [ ] place_entry() refactored for multi-leg
- [ ] check_order_status() refactored for multi-leg
- [ ] _check_leg_status() method added
- [ ] _sync_leg_exit_quantities() method added
- [ ] _update_trailing_stop_for_leg() method updated
- [ ] _realize_leg_exit() method updated
- [ ] _persist() method updated
- [ ] _load_state() method updated
- [ ] _flat_state() method updated
- [ ] square_off() method updated for multi-leg
- [ ] Test single mode (backward compatibility)
- [ ] Test straddle mode with both legs
- [ ] Test straddle mode with CE only
- [ ] Test straddle mode with PE only
- [ ] Test trailing SL with multi-leg
- [ ] Test state persistence/recovery
- [ ] Test EOD square-off with multiple legs
- [ ] Test partial fills on individual legs
- [ ] Verify P&L calculation across all legs

---

## Troubleshooting

### Issue: "AttributeError: 'RandomScalpBot' object has no attribute 'in_position'"
**Solution**: Make sure the @property decorators were added after __init__

### Issue: "KeyError: 'CE' in self.legs"
**Solution**: Check that legs are being created properly in _place_leg_entry()

### Issue: "Margin shortage error when placing both legs"
**Solution**: Ensure sufficient margin for 2x positions in straddle mode

### Issue: "ATM selection failing"
**Solution**: Check get_atm_option_symbol() - ensure NSE quotes API working for spot price

### Issue: "One leg exits but other doesn't"
**Solution**: This is normal - each leg exits independently based on its own TP/SL

### Issue: "State persistence not working"
**Solution**: Verify _persist() includes all legs in state dict

---

## Summary

This implementation adds full multi-leg support to randomScalp_TPSL.py while preserving:
- ✅ All existing trailing stop loss functionality (per leg)
- ✅ Backward compatibility (single mode = current behavior)
- ✅ All safety features (OCO, partial fills, reconciliation)
- ✅ State persistence across restarts

New capabilities:
- ✅ Simultaneous CE + PE trading (true straddle)
- ✅ Independent exit management per leg
- ✅ Per-leg trailing stop loss
- ✅ ATM option auto-selection
- ✅ Flexible configuration (single/straddle, ce/pe/both)

**Total Changes**: ~500 lines of code across 15 major steps
**Estimated Implementation Time**: 2-3 hours
**Testing Time**: 1-2 hours

---

## Next Steps

1. Apply all changes from this document
2. Run syntax check: `python randomScalp_TPSL.py --help` (should show no errors)
3. Test in paper trading mode with single leg first
4. Test straddle mode with small lot size
5. Verify state persistence by restarting bot mid-position
6. Test EOD square-off with multiple legs
7. Monitor logs for any unexpected behavior

Good luck with the implementation! 🚀
