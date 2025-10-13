#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Demo script to test cache enhancements
---------------------------------------
Demonstrates TTL, metrics, validation, and admin functions.
"""

import os
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

# Mock client for testing (replace with actual OpenAlgo client in production)
class MockClient:
    """Mock OpenAlgo client for testing"""
    def history(self, **kwargs):
        import pandas as pd
        # Return empty DataFrame (in real usage, this would call API)
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"])

def demo_basic_usage():
    """Demonstrate basic smart caching usage"""
    print("\n" + "="*60)
    print("DEMO 1: Basic Smart Caching")
    print("="*60 + "\n")

    from db_aware_history import get_history_smart

    client = MockClient()

    # First fetch (will be a cache miss)
    print("🔍 First fetch (expect cache miss)...")
    df1 = get_history_smart(
        client,
        symbol="NIFTY24OCT2525000CE",
        exchange="NFO",
        interval="5m",
        start_date="2025-10-01",
        end_date="2025-10-14"
    )
    print(f"✅ Retrieved {len(df1)} rows\n")

    # Second fetch (should be cache hit if data exists)
    print("🔍 Second fetch (expect cache hit if data exists)...")
    df2 = get_history_smart(
        client,
        symbol="NIFTY24OCT2525000CE",
        exchange="NFO",
        interval="5m",
        start_date="2025-10-01",
        end_date="2025-10-14"
    )
    print(f"✅ Retrieved {len(df2)} rows\n")


def demo_metrics():
    """Demonstrate metrics tracking"""
    print("\n" + "="*60)
    print("DEMO 2: Performance Metrics")
    print("="*60 + "\n")

    from db_aware_history import get_cache_stats, get_all_series_stats

    # Get overall stats
    stats = get_cache_stats()

    if "error" in stats:
        print(f"⚠️  {stats['error']}")
        print("💡 Enable metrics by setting ENABLE_CACHE_METRICS=true in .env\n")
        return

    print("📊 Overall Cache Performance:")
    print(f"   Series Count:    {stats.get('series_count', 0)}")
    print(f"   Cache Hits:      {stats.get('hits', 0)}")
    print(f"   Cache Misses:    {stats.get('misses', 0)}")
    print(f"   Partial Hits:    {stats.get('partial_hits', 0)}")
    print(f"   Errors:          {stats.get('errors', 0)}")
    print(f"   TTL Refreshes:   {stats.get('ttl_refreshes', 0)}")
    print(f"   Hit Rate:        {stats.get('hit_rate', 0)}%\n")

    # Get per-series stats
    series_stats = get_all_series_stats()
    if series_stats:
        print("📈 Per-Series Stats:")
        for series_key, data in list(series_stats.items())[:3]:  # Show first 3
            print(f"   {series_key}")
            print(f"      Hits: {data['hits']}, Misses: {data['misses']}, "
                  f"Partial: {data['partial_hits']}, Errors: {data['errors']}")
        if len(series_stats) > 3:
            print(f"   ... and {len(series_stats) - 3} more series")
    print()


def demo_list_cached():
    """Demonstrate listing cached series"""
    print("\n" + "="*60)
    print("DEMO 3: List Cached Series")
    print("="*60 + "\n")

    from db_aware_history import list_cached_series

    df = list_cached_series()

    if df.empty:
        print("⚠️  No cached series found")
        print("💡 Run some strategies first to populate the cache\n")
        return

    print(f"📦 Found {len(df)} cached series:\n")

    # Show first few series
    for _, row in df.head(5).iterrows():
        stale_marker = "⚠️ STALE" if row['stale'] else "✓ Fresh"
        print(f"   {row['symbol']}@{row['exchange']}:{row['interval']}")
        print(f"      Range: {row['first_ts'].date()} → {row['last_ts'].date()}")
        print(f"      Rows: {row['rows_count']:,} | Age: {row['age_hours']:.1f}h | {stale_marker}")

    stale_count = df['stale'].sum()
    if stale_count > 0:
        print(f"\n⚠️  {stale_count} series are stale and will auto-refresh on next use")
    print()


def demo_health_check():
    """Demonstrate health check"""
    print("\n" + "="*60)
    print("DEMO 4: System Health Check")
    print("="*60 + "\n")

    from db_aware_history import health_check

    health = health_check()

    status_icon = "✅" if health['status'] == 'healthy' else "❌"
    print(f"{status_icon} Status: {health['status'].upper()}")
    print(f"   Timestamp: {health['timestamp']}\n")

    print("🗄️  Database:")
    print(f"   Connected: {'✅' if health.get('database_connected') else '❌'}")
    print(f"   Table exists: {'✅' if health.get('table_exists') else '❌'}")

    if health.get('table_exists'):
        print(f"   Total rows: {health.get('total_rows', 0):,}")
        print(f"   Series count: {health.get('series_count', 0)}")

    print(f"\n📊 Metrics:")
    print(f"   Enabled: {'✅' if health.get('metrics_enabled') else '⚠️'}")

    if health.get('cache_stats'):
        stats = health['cache_stats']
        print(f"   Hit rate: {stats.get('hit_rate', 0)}%")

    if health.get('issues'):
        print(f"\n❌ Issues:")
        for issue in health['issues']:
            print(f"   • {issue}")

    if health.get('warnings'):
        print(f"\n⚠️  Warnings:")
        for warning in health['warnings']:
            print(f"   • {warning}")

    print()


def demo_validation():
    """Demonstrate data validation"""
    print("\n" + "="*60)
    print("DEMO 5: Data Validation")
    print("="*60 + "\n")

    from db_aware_history import validate_data
    import pandas as pd
    import numpy as np

    # Create sample data with some issues
    dates = pd.date_range('2025-10-01', periods=100, freq='5min', tz='Asia/Kolkata')
    df = pd.DataFrame({
        'timestamp': dates,
        'open': np.random.uniform(25000, 25100, 100),
        'high': np.random.uniform(25050, 25150, 100),
        'low': np.random.uniform(24950, 25050, 100),
        'close': np.random.uniform(25000, 25100, 100),
        'volume': np.random.randint(1000, 10000, 100),
    })

    # Introduce some issues for demonstration
    df.loc[5, 'close'] = np.nan  # Null value
    df.loc[10, 'high'] = df.loc[10, 'low'] - 10  # Invalid OHLC
    df = pd.concat([df, df.iloc[[20]]])  # Duplicate timestamp

    print("🔍 Validating sample OHLCV data...\n")

    validation = validate_data(df, "NIFTY", "NFO", "5m")

    print(f"Valid: {'✅' if validation['valid'] else '❌'}")
    print(f"Rows: {validation['row_count']}")
    print(f"Date Range: {validation['date_range']}")

    if validation['issues']:
        print(f"\n❌ Issues found:")
        for issue in validation['issues']:
            print(f"   • {issue}")

    if validation['warnings']:
        print(f"\n⚠️  Warnings:")
        for warning in validation['warnings']:
            print(f"   • {warning}")

    print()


def demo_cli_commands():
    """Show CLI command examples"""
    print("\n" + "="*60)
    print("DEMO 6: Admin CLI Commands")
    print("="*60 + "\n")

    print("📋 Available CLI commands:\n")

    commands = [
        ("View cache stats", "python cache_admin.py stats"),
        ("Detailed stats", "python cache_admin.py stats --verbose"),
        ("List all series", "python cache_admin.py list"),
        ("List stale only", "python cache_admin.py list --stale-only"),
        ("Clear cache", "python cache_admin.py clear NIFTY NFO 5m"),
        ("Health check", "python cache_admin.py health --verbose"),
        ("Reset metrics", "python cache_admin.py reset-stats"),
        ("Export data", "python cache_admin.py export -o backup.json"),
    ]

    for desc, cmd in commands:
        print(f"   {desc:20} → {cmd}")

    print(f"\n💡 Run 'python cache_admin.py --help' for full documentation\n")


def main():
    """Run all demos"""
    print("\n" + "🚀"*30)
    print("Cache Enhancement Demos")
    print("🚀"*30)

    try:
        demo_basic_usage()
        demo_metrics()
        demo_list_cached()
        demo_health_check()
        demo_validation()
        demo_cli_commands()

        print("\n" + "="*60)
        print("✅ All demos completed!")
        print("="*60)
        print("\n💡 Next steps:")
        print("   1. Check CACHE_README.md for full documentation")
        print("   2. Configure .env with CACHE_TTL_HOURS and other settings")
        print("   3. Run 'python cache_admin.py health' to verify setup")
        print("   4. Use get_history_smart() in your strategies\n")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
