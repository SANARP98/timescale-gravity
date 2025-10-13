import pandas as pd
from openalgo import api
from datetime import datetime
from dotenv import load_dotenv
import os
import argparse

# Import intelligent DB-aware fetching
from db_aware_history import fetch_history_smart

# 🔁 OpenAlgo Python Bot is running.

def fetch_history(symbol, exchange, interval, start_date, end_date, output_csv=None):
    """
    Fetch historical data intelligently (checks DB first, then API if needed).

    This now uses TimescaleDB caching for faster repeated fetches.
    Only fetches missing data from OpenAlgo API.
    """
    # Load environment variables
    load_dotenv()
    API_KEY = os.getenv("API_KEY")
    API_HOST = os.getenv("OPENALGO_API_HOST")

    # Initialize OpenAlgo client
    client = api(api_key=API_KEY, host=API_HOST)

    if output_csv is None:
        output_csv = f"{symbol}_history.csv"

    # Use smart DB-aware fetching
    print(f"📊 Fetching {symbol} {exchange} {interval} | {start_date} → {end_date}")
    print(f"🔍 Checking TimescaleDB cache first...")

    output_file = fetch_history_smart(
        client=client,
        symbol=symbol,
        exchange=exchange,
        interval=interval,
        start_date=start_date,
        end_date=end_date,
        output_csv=output_csv
    )

    return output_file

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Fetch historical data from OpenAlgo')
    parser.add_argument('--symbol', type=str, default="NIFTY28OCT2525200PE", help='Trading symbol')
    parser.add_argument('--exchange', type=str, default="NFO", help='Exchange (NFO, NSE, etc.)')
    parser.add_argument('--interval', type=str, default="5m", help='Time interval (1m, 5m, 15m, 1h, D)')
    parser.add_argument('--start_date', type=str, default="2025-09-01", help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end_date', type=str, default="2025-10-06", help='End date (YYYY-MM-DD)')
    parser.add_argument('--output_csv', type=str, default=None, help='Output CSV filename')

    args = parser.parse_args()

    fetch_history(
        symbol=args.symbol,
        exchange=args.exchange,
        interval=args.interval,
        start_date=args.start_date,
        end_date=args.end_date,
        output_csv=args.output_csv
    )
