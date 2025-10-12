# Tester App Architecture

## Overview
The tester app now has a modular, extensible architecture that supports multiple strategies dynamically.

## Current Status (Completed)

### 1. **Modular Folder Structure**
```
tester_app/
├── strategies/          # Strategy discovery and registry
│   └── __init__.py     # StrategyRegistry class for auto-discovery
├── core/               # Core business logic
│   ├── runner.py       # PermutationRunner and JobGenerator
│   └── database.py     # Database operations
├── api/                # (Future: API routes)
├── templates/          # HTML templates
├── static/             # CSS and JavaScript
├── main.py             # FastAPI app (to be refactored)
├── export_results.py   # Export functionality
└── ARCHITECTURE.md     # This file
```

### 2. **Strategy Registry System** (`strategies/__init__.py`)
- **Auto-discovery**: Automatically finds strategies in `../app/strategies/`
- **Requirements**: Each strategy must have:
  - `get_info()` → Returns metadata (name, title, description, parameters schema)
  - `run(config, write_csv)` → Executes the strategy
- **Current strategies supported**:
  - `scalp_with_trend` (already working)
  - `random_scalp` (ready to integrate)

### 3. **Permutation Runner** (`core/runner.py`)
- **Dynamic job generation**: `JobGenerator` creates jobs based on parameter ranges
- **Strategy-agnostic**: Works with any strategy that follows the interface
- **Features**:
  - Pause/resume support
  - Parallel execution (configurable workers)
  - Progress tracking
  - Callback system for result handling

### 4. **Database Layer** (`core/database.py`)
- Separated database operations
- Functions: `insert_result()`, `clear_results_table()`, `db_stats()`
- Clean interface for storing backtest results

### 5. **UI Improvements**
- ✅ **Sortable columns**: Click headers to sort (ascending/descending/reset)
- ✅ **Fixed spacing issues**: Better margins and overflow handling
- ✅ **Parameter configuration panel**: Dynamic form for testing parameters
- ✅ **No-trade handling**: Gracefully stores zero-result runs

## Next Steps (To Implement)

### Step 1: Add Strategy Selection to UI
**File**: `templates/index.html`

Add a strategy selector before the config panel:
```html
<section class="strategy-selector">
  <h2>Select Strategy</h2>
  <select id="strategy-select" class="strategy-dropdown">
    <option value="scalp_with_trend">Scalp with Trend</option>
    <option value="random_scalp">Random Scalp</option>
  </select>
  <div id="strategy-description"></div>
</section>
```

### Step 2: Update main.py to Use New Modules
**File**: `main.py`

Replace old imports with:
```python
from tester_app.strategies import get_registry
from tester_app.core.runner import PermutationRunner
from tester_app.core.database import (
    ensure_results_table,
    insert_result,
    clear_results_table,
    db_stats,
)
```

Initialize registry:
```python
registry = get_registry()  # Auto-discovers strategies
```

### Step 3: Add API Endpoint for Strategy List
**File**: `main.py`

```python
@app.get("/strategies")
def list_strategies():
    """Return all available strategies with their parameter schemas."""
    return registry.list_strategies()
```

### Step 4: Dynamic UI Generation (JavaScript)
**File**: `static/app.js`

Add function to fetch strategies and rebuild parameter form:
```javascript
async function loadStrategies() {
  const response = await fetch("/strategies");
  const strategies = await response.json();

  // Populate dropdown
  // Update parameter form based on selected strategy's schema
}
```

### Step 5: Update Runner Initialization
**File**: `main.py`

Replace hardcoded runner with dynamic one:
```python
# Old:
runner = PermutationRunner("scalp_with_trend", BASE_CONFIG, ...)

# New:
current_strategy = "scalp_with_trend"  # Default
runner = PermutationRunner(
    strategy_name=current_strategy,
    base_config=BASE_CONFIG,
    param_ranges=DEFAULT_PARAM_RANGES,
    max_workers=MAX_WORKERS,
    on_result_callback=lambda result: insert_result(...),
)
```

### Step 6: Add /configure Endpoint Enhancement
Allow changing strategy:
```python
class ConfigRequest(BaseModel):
    strategy: str  # Add this field
    symbols: List[str]
    # ... rest of fields
```

## Benefits of New Architecture

### For random_scalp Integration:
1. **Copy file**: `cp app/strategies/random_scalp.py app/strategies/` (already exists)
2. **Restart app**: Registry auto-discovers it
3. **UI updates**: Dropdown shows both strategies
4. **Parameters adapt**: Form changes based on strategy's schema

### For Future Strategies:
- Just add a `.py` file with `get_info()` and `run()` in `app/strategies/`
- No UI changes needed
- No main.py changes needed
- Fully automatic discovery

### Maintainability:
- ✅ Separation of concerns
- ✅ Testable modules
- ✅ Easy to add features
- ✅ No tight coupling

## Key Design Patterns

1. **Strategy Pattern**: Each strategy is self-contained
2. **Registry Pattern**: Central discovery and management
3. **Observer Pattern**: Callback system for results
4. **Repository Pattern**: Database layer abstraction

## Testing Checklist

- [ ] Load tester app and verify strategies are discovered
- [ ] Select "scalp_with_trend" and run backtest
- [ ] Select "random_scalp" and run backtest
- [ ] Verify parameter forms change based on strategy
- [ ] Test sorting on results table
- [ ] Test parameter configuration
- [ ] Verify "no trades" results are stored correctly
- [ ] Test pause/resume functionality
- [ ] Test parallel execution with multiple workers

## Migration Path (Gradual Refactor)

Since the full refactor is complex, here's a gradual approach:

### Phase 1 (Immediate - Can do now):
1. Keep current `main.py` working
2. Add strategy registry alongside
3. Add `/strategies` endpoint
4. Add strategy dropdown to UI
5. Test with existing `scalp_with_trend`

### Phase 2 (Next):
1. Switch runner to use registry
2. Make parameter form dynamic
3. Add `random_scalp` to dropdown

### Phase 3 (Polish):
1. Fully refactor `main.py` to use new modules
2. Move API routes to `api/` folder
3. Add strategy-specific visualizations
4. Add preset configurations

## Files Created

- ✅ `strategies/__init__.py` - Strategy registry
- ✅ `core/runner.py` - Permutation runner
- ✅ `core/database.py` - Database operations
- ✅ `main.py.backup` - Backup of original
- ✅ `ARCHITECTURE.md` - This document

## Quick Start for Adding random_scalp

Run these commands:
```bash
# Strategy file is already in app/strategies/random_scalp.py
# Just need to update the tester app to use the registry

# 1. Update main.py imports (top of file)
from tester_app.strategies import get_registry

# 2. Initialize registry (after app creation)
registry = get_registry()

# 3. Add endpoint
@app.get("/strategies")
def list_strategies():
    return registry.list_strategies()

# 4. Test it
curl http://localhost:8000/strategies
```

This should return both `scalp_with_trend` and `random_scalp` with their parameter schemas.
