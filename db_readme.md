DB Overview
-----------
- Engine: PostgreSQL 14 with TimescaleDB extension (`timescale/timescaledb:latest-pg14`).
- Primary hypertable: `ohlcv` (OHLCV bars, optional open interest) with primary key `(ts, symbol, exchange, interval)`.
- Supporting table: `tester_results` for tester app output (UUID id, JSONB params/summary).
- Extensions enabled: `timescaledb`, `pgcrypto`; automatic compression policy trims `ohlcv` chunks older than 30 days.

Schema Bootstrap
----------------
- Both `tsdb_pipeline.ensure_schema()` and container init script `db_setup.sql` create the schema, hypertable, index, and compression settings.
- `db_setup.sql` runs automatically when the database container initializes via `/docker-entrypoint-initdb.d/001-db-setup.sql`.
- Script also adds descending index on `(symbol, exchange, interval, ts)` and marks `ohlcv` for Timescale compression segmented by `symbol,exchange,interval`.

Connecting Locally
------------------
- Default credentials (matching `.env` and compose files):
  - `PGHOST=localhost` (from host) or `db` (from other containers)
  - `PGPORT=5432`
  - `PGUSER=postgres`
  - `PGPASSWORD=postgres`
  - `PGDATABASE=trading`
- Quick CLI check: `psql "postgresql://postgres:postgres@localhost:5432/trading"`
- Python helper: `from tsdb_pipeline import get_conn` yields a psycopg2 connection with timezone forced to UTC.

Docker Compose Services
-----------------------
- `docker-compose.yml`
  - `db`: TimescaleDB service; mounts `db_data` volume and `db_setup.sql` for init; exposes 5432; health-checked via `pg_isready`.
  - `app`: FastAPI service (`main:app`) binding to 8000; depends on healthy `db`; mounts project for live reload.
  - `tester-app`: FastAPI tester UI (`tester_app.main:app`) on 8100; also depends on `db`; mounts exports to `/tmp`.
- `docker-compose.master.yml`
  - Shares the same `db` configuration.
  - Adds `master-app` (`master.main:app`) on port 8200 with additional env (`NUMBA_CACHE_DIR`, `PYTHONPATH=/app`).

Data Flow
---------
- Historical ingestion: `fetch_history_to_tsdb` (in `tsdb_pipeline.py`) ensures schema, calls OpenAlgo history API, normalizes payloads, and bulk upserts into `ohlcv`.
- On missing data, strategies such as `app/strategies/scalp_with_trend.py` auto-trigger the fetch and retry read.
- Backtest results persist via `tester_app/core/database.insert_result`, inserting into `tester_results` using JSONB columns and `gen_random_uuid()` ids.

Operational Notes
-----------------
- `list_available_series()` (in `tsdb_pipeline.py`) provides quick coverage metadata from `ohlcv`.
- Compression policy (30 days) is set via `add_compression_policy('ohlcv', INTERVAL '30 days')`; adjust in `db_setup.sql` if retention requirements change.
- Optional chunk size tuning is commented in `db_setup.sql` (`set_chunk_time_interval('ohlcv', INTERVAL '7 days')`)—enable if chunk management is needed for consistent workload. 
