-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- OHLCV table (one row per bar)
CREATE TABLE IF NOT EXISTS ohlcv (
  ts           TIMESTAMPTZ       NOT NULL,
  symbol       TEXT              NOT NULL,
  exchange     TEXT              NOT NULL,
  interval     TEXT              NOT NULL,
  open         DOUBLE PRECISION  NOT NULL,
  high         DOUBLE PRECISION  NOT NULL,
  low          DOUBLE PRECISION  NOT NULL,
  close        DOUBLE PRECISION  NOT NULL,
  volume       DOUBLE PRECISION  NOT NULL,
  oi           DOUBLE PRECISION  NULL,
  PRIMARY KEY (ts, symbol, exchange, interval)
);

-- Convert to hypertable (time partitioning)
SELECT create_hypertable('ohlcv', by_range('ts'), if_not_exists => TRUE);

-- Helpful index for symbol/exchange/interval filtering
CREATE INDEX IF NOT EXISTS ohlcv_sei_ts_idx
  ON ohlcv (symbol, exchange, interval, ts DESC);

-- Optional: compress older chunks to save space
ALTER TABLE ohlcv SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol,exchange,interval'
);

-- Compress data older than 30 days (adjust as needed)
SELECT add_compression_policy('ohlcv', INTERVAL '30 days');

-- Optional: chunk interval per interval type (5m bars → 7 days per chunk is fine)
-- SELECT set_chunk_time_interval('ohlcv', INTERVAL '7 days');
