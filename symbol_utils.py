#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Symbol utility functions for handling option symbols (PE/CE pairs)
"""

import re
from typing import Optional, Tuple


def parse_option_symbol(symbol: str) -> Optional[dict]:
    """
    Parse an option symbol to extract components.

    Example: NIFTY14OCT2525000PE -> {
        'base': 'NIFTY14OCT25',
        'strike': '25000',
        'option_type': 'PE'
    }

    Returns None if the symbol doesn't match the expected pattern.
    """
    # Pattern: <BASE><STRIKE><PE|CE>
    # Strike is typically 4-6 digits before PE/CE
    pattern = r'^(.+?)(\d{4,6})(PE|CE)$'
    match = re.match(pattern, symbol, re.IGNORECASE)

    if not match:
        return None

    base = match.group(1)
    strike = match.group(2)
    option_type = match.group(3).upper()

    return {
        'base': base,
        'strike': strike,
        'option_type': option_type,
        'full_symbol': symbol
    }


def get_opposite_option(symbol: str) -> Optional[str]:
    """
    Get the opposite option type for a given symbol.

    Examples:
        NIFTY14OCT2525000PE -> NIFTY14OCT2525000CE
        NIFTY14OCT2525000CE -> NIFTY14OCT2525000PE

    Returns None if the symbol doesn't match the expected pattern.
    """
    parsed = parse_option_symbol(symbol)
    if not parsed:
        return None

    opposite_type = 'CE' if parsed['option_type'] == 'PE' else 'PE'
    return f"{parsed['base']}{parsed['strike']}{opposite_type}"


def get_option_pair(symbol: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Get both PE and CE symbols for a given option symbol.

    Returns: (pe_symbol, ce_symbol) or (None, None) if invalid

    Examples:
        NIFTY14OCT2525000PE -> ('NIFTY14OCT2525000PE', 'NIFTY14OCT2525000CE')
        NIFTY14OCT2525000CE -> ('NIFTY14OCT2525000PE', 'NIFTY14OCT2525000CE')
    """
    parsed = parse_option_symbol(symbol)
    if not parsed:
        return (None, None)

    base_symbol = f"{parsed['base']}{parsed['strike']}"
    return (f"{base_symbol}PE", f"{base_symbol}CE")


def is_option_symbol(symbol: str) -> bool:
    """Check if a symbol is a valid option symbol (ends with PE or CE)"""
    return parse_option_symbol(symbol) is not None
