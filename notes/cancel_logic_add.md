# Cancel Logic Enhancements

- Added serialization-friendly cancel confirmation that polls `orderstatus` until the broker marks the order inactive, preventing premature state transitions.
- Introduced an orderbook sweep fallback that force-cancels any lingering TP/SL legs for the configured symbol while respecting API cadence.
- Wired the new cancel helper into every exit-management path (flat cleanup, trailing stop adjustments, square-off, pause), so all broker writes now follow the same guarded workflow.
