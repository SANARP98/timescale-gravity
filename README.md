# timescale-gravity

End-to-end TimescaleDB ingestion + backtesting stack, wrapped in a Docker Compose
environment. The stack includes:

- TimescaleDB (Postgres) with automatically bootstrapped schema and compression policy.
- Python service exposing REST endpoints to ingest OHLCV history from OpenAlgo and
  run the Scalp-with-Trend backtest directly against the database.

## Getting Started

1. **Create your `.env` file**

   ```bash
   cp .env.example .env
   ```

   Fill in your OpenAlgo API key and tweak DB connection values if required. The
   dockerised app overrides `PGHOST` to the internal `db` hostname automatically.

2. **Launch the stack**

   ```bash
   docker compose up --build
   ```

   - TimescaleDB listens on `localhost:5432`.
   - The Python API is available on `http://localhost:8000`.

   The first run applies `db_setup.sql`, creating the hypertable, indexes, and compression
   policy.

## API Overview

- `GET /health` – basic readiness probe.
- `POST /fetch` – calls `fetch_history_to_tsdb()` with the supplied symbol/exchange/interval
  window and upserts the results into TimescaleDB. Returns the number of rows inserted or
  updated. Optional `also_save_csv` writes the fetched slice to disk inside the container.
- `POST /backtest` – runs the Scalp-with-Trend backtest against TimescaleDB using the provided
  overrides. Responds with summary statistics, exit-reason breakdown, and the last N trades.
  Set `write_csv=true` to persist the full trade log as
  `scalp_with_trend_results_<SYMBOL>_<INTERVAL>.csv`.

Example payloads are available in `app/main.py` (see the Pydantic models for field names and
defaults).

## Direct CLI Usage

You can still interact with the modules without the API service:

```bash
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f db_setup.sql
python -c "from tsdb_pipeline import fetch_history_to_tsdb; fetch_history_to_tsdb('NIFTY28OCT2525200PE','NFO','5m','2025-09-01','2025-10-06')"
python backtest_tsdb.py --symbol NIFTY28OCT2525200PE --exchange NFO --interval 5m --start_date 2025-09-01 --end_date 2025-10-06
```

## Notes

- The ingestion pipeline batches upserts with conflict handling, so rerunning a fetch window
  is idempotent.
- The compression policy automatically compresses chunks older than 30 days; adjust the
  interval in `db_setup.sql` if desired.
- For heavy workloads you can move EMA/ATR calculations into TimescaleDB continuous aggregates;
  the current pandas implementation is optimal for a few months of intraday bars.
