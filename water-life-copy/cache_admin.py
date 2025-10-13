#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cache Administration CLI Tool
------------------------------
Command-line interface for managing the DB-aware history cache system.

Usage:
    python cache_admin.py stats              # View cache statistics
    python cache_admin.py list               # List all cached series
    python cache_admin.py clear SYMBOL EXCHANGE INTERVAL  # Clear specific series
    python cache_admin.py health             # Run health check
    python cache_admin.py reset-stats        # Reset metrics
    python cache_admin.py export             # Export cache data to JSON

Examples:
    python cache_admin.py stats
    python cache_admin.py list --stale-only
    python cache_admin.py clear NIFTY NFO 5m
    python cache_admin.py health --verbose
"""

import sys
import json
import argparse
from typing import Optional
from datetime import datetime
from pathlib import Path

# Add parent directory to path to import db_aware_history
sys.path.insert(0, str(Path(__file__).parent))

from db_aware_history import (
    get_cache_stats,
    get_all_series_stats,
    reset_cache_stats,
    clear_cache_for_series,
    list_cached_series,
    health_check,
    CACHE_TTL_HOURS,
    ENABLE_METRICS,
)

# ANSI color codes for pretty terminal output
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def print_header(text: str):
    """Print a formatted header"""
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text.center(60)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}\n")


def print_section(text: str):
    """Print a section divider"""
    print(f"\n{Colors.OKBLUE}{Colors.BOLD}{'─'*60}{Colors.ENDC}")
    print(f"{Colors.OKBLUE}{Colors.BOLD}{text}{Colors.ENDC}")
    print(f"{Colors.OKBLUE}{Colors.BOLD}{'─'*60}{Colors.ENDC}\n")


def cmd_stats(args):
    """Display cache statistics"""
    print_header("Cache Statistics")

    if not ENABLE_METRICS:
        print(f"{Colors.WARNING}⚠️  Metrics tracking is disabled{Colors.ENDC}")
        print(f"{Colors.WARNING}   Set ENABLE_CACHE_METRICS=true in .env to enable{Colors.ENDC}")
        return

    # Get overall stats
    stats = get_cache_stats()

    if "error" in stats:
        print(f"{Colors.FAIL}❌ {stats['error']}{Colors.ENDC}")
        return

    print(f"{Colors.OKGREEN}📊 Overall Cache Performance{Colors.ENDC}\n")
    print(f"  Series Count:    {stats.get('series_count', 0)}")
    print(f"  Cache Hits:      {Colors.OKGREEN}{stats.get('hits', 0)}{Colors.ENDC}")
    print(f"  Cache Misses:    {Colors.FAIL}{stats.get('misses', 0)}{Colors.ENDC}")
    print(f"  Partial Hits:    {Colors.WARNING}{stats.get('partial_hits', 0)}{Colors.ENDC}")
    print(f"  Errors:          {Colors.FAIL}{stats.get('errors', 0)}{Colors.ENDC}")
    print(f"  TTL Refreshes:   {Colors.OKCYAN}{stats.get('ttl_refreshes', 0)}{Colors.ENDC}")
    print(f"  Hit Rate:        {Colors.OKGREEN}{stats.get('hit_rate', 0)}%{Colors.ENDC}")

    # If verbose, show per-series stats
    if args.verbose:
        print_section("Per-Series Statistics")
        series_stats = get_all_series_stats()

        if not series_stats:
            print("  No series data available")
        else:
            for series_key, series_data in sorted(series_stats.items()):
                total_requests = series_data['hits'] + series_data['misses'] + series_data['partial_hits']
                hit_rate = 0
                if total_requests > 0:
                    hit_rate = round((series_data['hits'] + series_data['partial_hits']) / total_requests * 100, 1)

                print(f"\n  {Colors.BOLD}{series_key}{Colors.ENDC}")
                print(f"    Hits: {series_data['hits']} | Misses: {series_data['misses']} | "
                      f"Partial: {series_data['partial_hits']} | Errors: {series_data['errors']} | "
                      f"Hit Rate: {hit_rate}%")


def cmd_list(args):
    """List all cached series"""
    print_header("Cached Series")

    df = list_cached_series()

    if df.empty:
        print(f"{Colors.WARNING}⚠️  No cached series found{Colors.ENDC}")
        return

    # Filter stale only if requested
    if args.stale_only:
        df = df[df['stale'] == True]
        if df.empty:
            print(f"{Colors.OKGREEN}✅ No stale series found (all data is fresh){Colors.ENDC}")
            return
        print(f"{Colors.WARNING}⚠️  Showing only stale series (older than {CACHE_TTL_HOURS}h){Colors.ENDC}\n")

    # Print table
    print(f"{Colors.BOLD}{'Symbol':<20} {'Exchange':<10} {'Interval':<10} {'First Date':<12} "
          f"{'Last Date':<12} {'Rows':<8} {'Age (h)':<8} {'Stale'}{Colors.ENDC}")
    print("─" * 100)

    for _, row in df.iterrows():
        stale_marker = "⚠️" if row['stale'] else "✓"
        stale_color = Colors.WARNING if row['stale'] else Colors.OKGREEN

        first_date = row['first_ts'].strftime('%Y-%m-%d')
        last_date = row['last_ts'].strftime('%Y-%m-%d')

        print(f"{row['symbol']:<20} {row['exchange']:<10} {row['interval']:<10} "
              f"{first_date:<12} {last_date:<12} {row['rows_count']:<8} "
              f"{row['age_hours']:<8.1f} {stale_color}{stale_marker}{Colors.ENDC}")

    print(f"\n{Colors.BOLD}Total Series:{Colors.ENDC} {len(df)}")
    stale_count = df['stale'].sum()
    if stale_count > 0:
        print(f"{Colors.WARNING}⚠️  {stale_count} series are stale (older than {CACHE_TTL_HOURS}h){Colors.ENDC}")


def cmd_clear(args):
    """Clear cached data for a specific series"""
    symbol = args.symbol.upper()
    exchange = args.exchange.upper()
    interval = args.interval

    print_header("Clear Cache")
    print(f"Target: {Colors.BOLD}{symbol}@{exchange}:{interval}{Colors.ENDC}\n")

    if not args.yes:
        confirm = input(f"{Colors.WARNING}⚠️  This will permanently delete cached data. Continue? (y/N): {Colors.ENDC}")
        if confirm.lower() not in ['y', 'yes']:
            print(f"{Colors.FAIL}❌ Cancelled{Colors.ENDC}")
            return

    deleted = clear_cache_for_series(symbol, exchange, interval)

    if deleted > 0:
        print(f"\n{Colors.OKGREEN}✅ Successfully deleted {deleted} rows{Colors.ENDC}")
    else:
        print(f"\n{Colors.WARNING}⚠️  No data found for this series{Colors.ENDC}")


def cmd_health(args):
    """Run health check on the caching system"""
    print_header("System Health Check")

    health = health_check()

    # Overall status
    status_color = Colors.OKGREEN if health['status'] == 'healthy' else Colors.FAIL
    status_icon = "✅" if health['status'] == 'healthy' else "❌"
    print(f"{status_color}{status_icon} Status: {health['status'].upper()}{Colors.ENDC}")
    print(f"   Timestamp: {health['timestamp']}\n")

    # Database
    print_section("Database")
    db_icon = "✅" if health.get('database_connected') else "❌"
    db_color = Colors.OKGREEN if health.get('database_connected') else Colors.FAIL
    print(f"  {db_color}{db_icon} Database Connection{Colors.ENDC}")

    if health.get('table_exists'):
        print(f"  {Colors.OKGREEN}✅ Table 'ohlcv' exists{Colors.ENDC}")
        if args.verbose:
            print(f"     Total Rows: {health.get('total_rows', 0):,}")
            print(f"     Series Count: {health.get('series_count', 0)}")
    else:
        print(f"  {Colors.FAIL}❌ Table 'ohlcv' does not exist{Colors.ENDC}")

    # Metrics
    print_section("Metrics")
    if health.get('metrics_enabled'):
        print(f"  {Colors.OKGREEN}✅ Metrics Tracking Enabled{Colors.ENDC}")
        if 'cache_stats' in health and args.verbose:
            stats = health['cache_stats']
            print(f"     Hit Rate: {stats.get('hit_rate', 0)}%")
            print(f"     Total Hits: {stats.get('hits', 0)}")
            print(f"     Total Misses: {stats.get('misses', 0)}")
    else:
        print(f"  {Colors.WARNING}⚠️  Metrics Tracking Disabled{Colors.ENDC}")

    # Issues
    if health.get('issues'):
        print_section("Issues")
        for issue in health['issues']:
            print(f"  {Colors.FAIL}❌ {issue}{Colors.ENDC}")

    # Warnings
    if health.get('warnings'):
        print_section("Warnings")
        for warning in health['warnings']:
            print(f"  {Colors.WARNING}⚠️  {warning}{Colors.ENDC}")

    # Stale data info
    if health.get('stale_series_count', 0) > 0:
        print(f"\n{Colors.WARNING}💡 Tip: Use 'cache_admin.py list --stale-only' to see stale series{Colors.ENDC}")


def cmd_reset_stats(args):
    """Reset cache statistics"""
    print_header("Reset Statistics")

    if not ENABLE_METRICS:
        print(f"{Colors.WARNING}⚠️  Metrics tracking is disabled{Colors.ENDC}")
        return

    if not args.yes:
        confirm = input(f"{Colors.WARNING}⚠️  This will reset all cache statistics. Continue? (y/N): {Colors.ENDC}")
        if confirm.lower() not in ['y', 'yes']:
            print(f"{Colors.FAIL}❌ Cancelled{Colors.ENDC}")
            return

    reset_cache_stats()
    print(f"{Colors.OKGREEN}✅ Cache statistics have been reset{Colors.ENDC}")


def cmd_export(args):
    """Export cache information to JSON"""
    print_header("Export Cache Data")

    export_data = {
        "timestamp": datetime.now().isoformat(),
        "cache_ttl_hours": CACHE_TTL_HOURS,
        "metrics_enabled": ENABLE_METRICS,
    }

    # Get statistics
    if ENABLE_METRICS:
        export_data["stats"] = get_cache_stats()
        export_data["series_stats"] = get_all_series_stats()

    # Get cached series list
    df = list_cached_series()
    if not df.empty:
        # Convert to JSON-serializable format
        df_copy = df.copy()
        df_copy['first_ts'] = df_copy['first_ts'].dt.strftime('%Y-%m-%d %H:%M:%S')
        df_copy['last_ts'] = df_copy['last_ts'].dt.strftime('%Y-%m-%d %H:%M:%S')
        export_data["cached_series"] = df_copy.to_dict(orient='records')

    # Get health check
    export_data["health"] = health_check()

    # Save to file
    output_file = args.output or "cache_export.json"
    with open(output_file, 'w') as f:
        json.dump(export_data, f, indent=2)

    print(f"{Colors.OKGREEN}✅ Cache data exported to: {output_file}{Colors.ENDC}")
    print(f"   File size: {Path(output_file).stat().st_size:,} bytes")


def main():
    parser = argparse.ArgumentParser(
        description="Cache Administration CLI Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s stats                    # View cache statistics
  %(prog)s stats --verbose          # View detailed per-series stats
  %(prog)s list                     # List all cached series
  %(prog)s list --stale-only        # List only stale series
  %(prog)s clear NIFTY NFO 5m       # Clear specific series
  %(prog)s health --verbose         # Detailed health check
  %(prog)s reset-stats --yes        # Reset stats without confirmation
  %(prog)s export                   # Export to cache_export.json
  %(prog)s export -o backup.json    # Export to custom file
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # Stats command
    stats_parser = subparsers.add_parser('stats', help='View cache statistics')
    stats_parser.add_argument('-v', '--verbose', action='store_true', help='Show per-series statistics')

    # List command
    list_parser = subparsers.add_parser('list', help='List all cached series')
    list_parser.add_argument('--stale-only', action='store_true', help='Show only stale series')

    # Clear command
    clear_parser = subparsers.add_parser('clear', help='Clear cached data for a specific series')
    clear_parser.add_argument('symbol', help='Symbol to clear')
    clear_parser.add_argument('exchange', help='Exchange to clear')
    clear_parser.add_argument('interval', help='Interval to clear')
    clear_parser.add_argument('-y', '--yes', action='store_true', help='Skip confirmation')

    # Health command
    health_parser = subparsers.add_parser('health', help='Run system health check')
    health_parser.add_argument('-v', '--verbose', action='store_true', help='Show detailed information')

    # Reset stats command
    reset_parser = subparsers.add_parser('reset-stats', help='Reset cache statistics')
    reset_parser.add_argument('-y', '--yes', action='store_true', help='Skip confirmation')

    # Export command
    export_parser = subparsers.add_parser('export', help='Export cache data to JSON')
    export_parser.add_argument('-o', '--output', help='Output file path (default: cache_export.json)')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    # Route to appropriate command
    commands = {
        'stats': cmd_stats,
        'list': cmd_list,
        'clear': cmd_clear,
        'health': cmd_health,
        'reset-stats': cmd_reset_stats,
        'export': cmd_export,
    }

    try:
        commands[args.command](args)
    except KeyboardInterrupt:
        print(f"\n\n{Colors.WARNING}⚠️  Interrupted by user{Colors.ENDC}")
        sys.exit(1)
    except Exception as e:
        print(f"\n{Colors.FAIL}❌ Error: {e}{Colors.ENDC}")
        if args.command in ['health', 'stats'] and hasattr(args, 'verbose') and args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
