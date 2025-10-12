# Running Tester App with Docker

## Quick Start

### 1. Build and Start All Services
```bash
# From the project root (timescale-gravity/)
docker-compose up --build tester-app
```

This will:
- ✅ Start TimescaleDB database
- ✅ Build and start the tester app
- ✅ Auto-discover strategies
- ✅ Expose app on http://localhost:8100

### 2. Access the App
Open your browser to: **http://localhost:8100**

### 3. Check Logs
```bash
# View tester app logs
docker-compose logs -f tester-app

# You should see:
# INFO: Starting Strategy Tester App...
# INFO: ✓ Registered strategy: scalp_with_trend (Scalp with Trend)
# INFO: ✓ Registered strategy: random_scalp (Random Scalp)
# INFO: Discovered 2 strategies
```

## Services in Docker Compose

### Database (db)
- **Container**: `timescale-gravity-db`
- **Port**: 5432
- **Database**: trading
- **User**: postgres
- **Password**: postgres

### Main App (app)
- **Container**: `timescale-gravity-app`
- **Port**: 8000
- **Purpose**: Main FastAPI application

### Tester App (tester-app) ⭐
- **Container**: `timescale-gravity-tester`
- **Port**: 8100
- **Purpose**: Multi-strategy backtesting interface
- **Max Workers**: 4 (configurable via env)

## Configuration

### Environment Variables

Create or update `.env` file in project root:
```bash
# Database
PGHOST=db
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=trading

# Tester App
TESTER_MAX_WORKERS=4  # Number of parallel workers (1-8)

# Add your other env vars here
```

### Adjust Resources

Edit `docker-compose.yml` to change CPU/memory limits:
```yaml
tester-app:
  deploy:
    resources:
      limits:
        cpus: "4"      # Max CPUs (adjust based on your machine)
        memory: 8g     # Max RAM
      reservations:
        cpus: "2"      # Minimum guaranteed CPUs
        memory: 4g     # Minimum guaranteed RAM
```

## Common Commands

### Start Only Tester App
```bash
docker-compose up tester-app
```

### Start in Detached Mode (Background)
```bash
docker-compose up -d tester-app
```

### Rebuild After Code Changes
```bash
docker-compose up --build tester-app
```

### Stop Services
```bash
docker-compose stop tester-app
```

### Stop and Remove Containers
```bash
docker-compose down
```

### View Logs
```bash
# All logs
docker-compose logs tester-app

# Follow logs (live)
docker-compose logs -f tester-app

# Last 100 lines
docker-compose logs --tail=100 tester-app
```

### Restart Service
```bash
docker-compose restart tester-app
```

### Execute Command in Container
```bash
docker-compose exec tester-app bash
```

## Development Mode

The docker-compose is configured for **hot-reload**:
- Volume mount: `.:/app`
- Command includes: `--reload`

**This means:**
- ✅ Edit code on your host machine
- ✅ Changes automatically reload in container
- ✅ No rebuild needed for Python changes
- ⚠️ Rebuild needed for dependency changes

### Editing Code
```bash
# On your host machine
vim tester_app/main.py

# Container automatically reloads
# Check logs to see reload message
```

### Adding New Dependencies
```bash
# 1. Update requirements.txt
echo "new-package==1.0.0" >> requirements.txt

# 2. Rebuild container
docker-compose up --build tester-app
```

## Troubleshooting

### Issue: "Cannot connect to database"
**Check database is healthy:**
```bash
docker-compose ps
# db service should show "healthy"

# If not healthy, check db logs:
docker-compose logs db
```

### Issue: "Strategies not loading"
**Verify app/strategies files exist:**
```bash
docker-compose exec tester-app ls -la /app/app/strategies/
# Should show: scalp_with_trend.py, random_scalp.py
```

**Check import paths:**
```bash
docker-compose exec tester-app python -c "from tester_app.strategies import get_registry; print(get_registry().list_strategies())"
```

### Issue: "Module not found"
**Check PYTHONPATH:**
```bash
docker-compose exec tester-app env | grep PYTHONPATH
# Should show: PYTHONPATH=/app

# Test imports:
docker-compose exec tester-app python -c "import tester_app; print('OK')"
```

### Issue: Port Already in Use
**Change port in docker-compose.yml:**
```yaml
ports:
  - "8101:8100"  # Use 8101 on host instead
```

### Issue: Out of Memory
**Reduce workers or increase memory:**
```yaml
environment:
  TESTER_MAX_WORKERS: "2"  # Reduce from 4 to 2

deploy:
  resources:
    limits:
      memory: 16g  # Increase memory
```

### Issue: Changes Not Reflecting
**Ensure volume mount is correct:**
```bash
docker-compose exec tester-app ls -la /app/tester_app/main.py
# Should show recent modification time

# If stale, restart:
docker-compose restart tester-app
```

## Production Deployment

For production, update docker-compose.yml:

```yaml
tester-app:
  # Remove volume mount (bake code into image)
  # volumes:
  #   - .:/app  # REMOVE THIS

  # Remove --reload flag
  command: ["uvicorn", "tester_app.main:app", "--host", "0.0.0.0", "--port", "8100"]

  # Add health check
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8100/status"]
    interval: 30s
    timeout: 10s
    retries: 3

  # Adjust restart policy
  restart: always
```

## Viewing Strategy Discovery

To see which strategies were discovered:

```bash
# Method 1: Check logs
docker-compose logs tester-app | grep "Registered strategy"

# Method 2: Query API
curl http://localhost:8100/strategies | jq .

# Method 3: Execute Python directly
docker-compose exec tester-app python -c "
from tester_app.strategies import get_registry
for strat in get_registry().list_strategies():
    print(f\"- {strat['name']}: {strat['title']}\")
"
```

## Connecting to Database from Host

If you want to connect to the database from your host machine:

```bash
# Using psql
psql -h localhost -p 5432 -U postgres -d trading

# Using Python
python -c "
from tsdb_pipeline import get_conn
with get_conn() as conn:
    with conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM tester_results')
        print(f'Results: {cur.fetchone()[0]}')
"
```

## Performance Tips

1. **Adjust Workers Based on CPU Cores**
   ```bash
   # Check available CPUs
   docker info | grep CPUs

   # Set TESTER_MAX_WORKERS to number of cores
   ```

2. **Monitor Resource Usage**
   ```bash
   docker stats timescale-gravity-tester
   ```

3. **Database Connection Pooling**
   - Already handled by `tsdb_pipeline.py`
   - Connection pool size: Check `get_conn()` implementation

4. **Large Job Sets**
   - For 100k+ jobs, consider increasing memory
   - Monitor with `docker stats`

## Backup and Restore

### Backup Database
```bash
docker-compose exec db pg_dump -U postgres trading > backup.sql
```

### Restore Database
```bash
cat backup.sql | docker-compose exec -T db psql -U postgres trading
```

### Export Results
Use the UI's "Download All (CSV)" button or:
```bash
curl http://localhost:8100/history/export-file > results.csv
```

## Multi-Stage Build (Optional)

For smaller production images, update `tester_app/Dockerfile`:

```dockerfile
FROM python:3.12-slim-bookworm AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

FROM python:3.12-slim-bookworm
COPY --from=builder /root/.local /root/.local
WORKDIR /app
COPY . .
ENV PATH=/root/.local/bin:$PATH
CMD ["uvicorn", "tester_app.main:app", "--host", "0.0.0.0", "--port", "8100"]
```

## Health Checks

Check if services are healthy:
```bash
# Overall health
docker-compose ps

# Specific health check
curl http://localhost:8100/status

# Database health
docker-compose exec db pg_isready -U postgres -d trading
```

## Summary

**Start Command:**
```bash
docker-compose up --build tester-app
```

**Access:**
- Tester App: http://localhost:8100
- Database: localhost:5432

**Logs:**
```bash
docker-compose logs -f tester-app
```

**Stop:**
```bash
docker-compose down
```

That's it! Your multi-strategy tester app is now running in Docker with hot-reload enabled for development.
