# Quick Start Guide - Refactored Tester App

## What Changed?

Your tester app now supports **multiple strategies** automatically! You have:

1. ✅ **scalp_with_trend** - EMA crossover with trend (your existing strategy)
2. ✅ **random_scalp** - Simple buy-every-N-bars (newly integrated)

## How to Run

```bash
# From the project root
cd tester_app
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Or if running in Docker:
```bash
docker-compose up tester
```

## What You'll See

### 1. **Strategy Selector** (NEW!)
At the top of the page, you'll see a dropdown to choose your strategy.

### 2. **Configuration Panel**
Click "Show" to configure:
- Symbols to test
- Date ranges
- Parameter ranges (targets, stoploss, EMAs, etc.)
- Number of parallel workers

### 3. **Control Buttons**
- **Start/Resume** - Begin or continue testing
- **Pause** - Pause execution
- **Reset Queue** - Start over from the beginning
- **Clear Results** - Delete all stored results

### 4. **Results Table**
Now includes a **Strategy** column showing which strategy was used for each run.

## Testing Both Strategies

### Test Scalp with Trend:
1. Select "Scalp with Trend" from dropdown
2. Click "Show" on Configuration
3. Set parameters (or keep defaults)
4. Click "Apply Configuration"
5. Click "Start / Resume"

### Test Random Scalp:
1. Select "Random Scalp" from dropdown
2. Configuration form shows (currently uses same form - will adapt in future)
3. Click "Apply Configuration"
4. Click "Start / Resume"

## Finding Best Configurations

1. Let tests run (watch progress percentage)
2. Scroll to "Previous Runs" table
3. **Click "Net ₹" header** to sort by profit
4. First click = ascending (lowest to highest)
5. Second click = descending (highest to lowest) ← **This shows best configs first!**
6. Third click = reset to chronological order

## New Features

### 1. **Sortable Columns**
Click any column header to sort:
- **Net ₹** - Find most/least profitable
- **Winrate %** - Find highest win rates
- **Trades** - Find most/least active configs
- **Strategy** - Group by strategy
- **Symbol** - Group by symbol

### 2. **Strategy Info**
When you select a strategy, you'll see its description below the dropdown.

### 3. **Zero-Trade Handling**
Configurations that don't generate trades are now stored with 0 values instead of crashing.

### 4. **Multi-Worker Support**
Set "Max Workers" to 2-8 for parallel execution (faster results).

## Verifying It Works

### Check Strategies Are Loaded:
```bash
curl http://localhost:8000/strategies
```

You should see:
```json
{
  "strategies": [
    {
      "name": "scalp_with_trend",
      "title": "Scalp with Trend",
      "description": "A multi-bar hold intraday strategy with EMA crossovers and ATR filters.",
      "parameters": {...}
    },
    {
      "name": "random_scalp",
      "title": "Random Scalp",
      "description": "Buys on a fixed cadence and targets a flat ₹ profit per trade.",
      "parameters": {...}
    }
  ]
}
```

### Check Logs for Discovery:
Look for these lines in the console:
```
INFO:     Starting Strategy Tester App...
INFO:     ✓ Registered strategy: scalp_with_trend (Scalp with Trend)
INFO:     ✓ Registered strategy: random_scalp (Random Scalp)
INFO:     Discovered 2 strategies:
INFO:       - scalp_with_trend: Scalp with Trend
INFO:       - random_scalp: Random Scalp
INFO:     App startup complete
```

## Common Issues & Solutions

### Issue: Strategies not loading
**Solution**: Check that files exist:
```bash
ls -la ../app/strategies/
# Should see: scalp_with_trend.py, random_scalp.py
```

### Issue: Import errors
**Solution**: Ensure you're in the right directory:
```bash
pwd  # Should end with: /timescale-gravity
python -c "from tester_app.strategies import get_registry; print(get_registry().list_strategies())"
```

### Issue: Old results show "Unknown" for strategy
**Solution**: This is normal - old results don't have strategy field. New results will show correctly.

### Issue: Configuration not applying
**Solution**: Make sure runner is not currently running. Pause or reset first, then reconfigure.

## Key Differences from Old Version

| Old | New |
|-----|-----|
| Single strategy hardcoded | Multiple strategies via dropdown |
| No strategy column in results | Strategy shown in results table |
| Fixed parameters | Dynamic strategy switching |
| Manual strategy integration | Auto-discovery system |
| ~700 lines main.py | ~400 lines, modular code |

## What's Next?

The app is now ready for:
1. **Adding more strategies** - Just drop a `.py` file in `app/strategies/`
2. **Dynamic forms** - Future: form adapts to strategy parameters
3. **Strategy comparison** - Compare results side-by-side
4. **Visualization** - Charts showing parameter impact

## Files Changed

- ✅ `main.py` - Completely refactored (backup saved as `main.py.old`)
- ✅ `strategies/__init__.py` - New strategy registry
- ✅ `core/runner.py` - New permutation runner
- ✅ `core/database.py` - New database module
- ✅ `templates/index.html` - Added strategy selector
- ✅ `static/style.css` - Added strategy selector styles
- ✅ `static/app.js` - Added strategy loading logic

## Rollback Instructions

If something goes wrong:
```bash
cd tester_app
mv main.py main_new.py
mv main.py.old main.py
# Restart the app
```

To restore the new version:
```bash
mv main.py main.py.old
mv main_new.py main.py
```

## Documentation

- `ARCHITECTURE.md` - Full architecture details
- `REFACTOR_SUMMARY.md` - Complete list of changes
- `QUICKSTART.md` - This file

## Success Indicators

When everything is working, you should see:
- ✅ Dropdown shows 2 strategies
- ✅ Description updates when you switch
- ✅ Configuration applies without errors
- ✅ Jobs run and complete successfully
- ✅ Results table has "Strategy" column
- ✅ Sorting works on all columns
- ✅ Console shows "Discovered 2 strategies"

## Need Help?

1. Check browser console for errors
2. Check server logs for strategy discovery
3. Verify database connection is working
4. Test `/strategies` endpoint directly
5. Review `ARCHITECTURE.md` for design details

---

**Happy Testing!** 🚀

You now have a fully modular, multi-strategy backtesting system that automatically discovers and integrates new strategies.
