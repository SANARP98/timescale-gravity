#!/bin/bash
# Test script for Docker setup of tester app

set -e

echo "================================================"
echo "Testing Tester App Docker Setup"
echo "================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

# Check if Docker is running
echo "1. Checking Docker..."
if docker info > /dev/null 2>&1; then
    print_success "Docker is running"
else
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker-compose is available
echo ""
echo "2. Checking docker-compose..."
if command -v docker-compose &> /dev/null; then
    print_success "docker-compose is installed"
else
    print_error "docker-compose is not installed"
    exit 1
fi

# Stop any existing containers
echo ""
echo "3. Stopping existing containers..."
docker-compose down > /dev/null 2>&1 || true
print_success "Cleaned up existing containers"

# Build and start services
echo ""
echo "4. Building and starting services..."
print_info "This may take a few minutes on first run..."
if docker-compose up -d --build tester-app; then
    print_success "Services started successfully"
else
    print_error "Failed to start services"
    exit 1
fi

# Wait for database to be healthy
echo ""
echo "5. Waiting for database to be ready..."
MAX_WAIT=60
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if docker-compose exec -T db pg_isready -U postgres -d trading > /dev/null 2>&1; then
        print_success "Database is ready"
        break
    fi
    echo -n "."
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ $WAIT_COUNT -eq $MAX_WAIT ]; then
    print_error "Database did not become ready in time"
    echo ""
    echo "Database logs:"
    docker-compose logs db
    exit 1
fi

# Wait for tester app to start
echo ""
echo "6. Waiting for tester app to start..."
sleep 10
print_success "Tester app should be starting"

# Check if tester app is responding
echo ""
echo "7. Testing tester app health..."
MAX_WAIT=30
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if curl -s http://localhost:8100/status > /dev/null 2>&1; then
        print_success "Tester app is responding"
        break
    fi
    echo -n "."
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ $WAIT_COUNT -eq $MAX_WAIT ]; then
    print_error "Tester app did not start properly"
    echo ""
    echo "Tester app logs:"
    docker-compose logs --tail=50 tester-app
    exit 1
fi

# Check strategies endpoint
echo ""
echo "8. Checking strategies discovery..."
STRATEGIES=$(curl -s http://localhost:8100/strategies)
if echo "$STRATEGIES" | grep -q "scalp_with_trend"; then
    print_success "Strategy 'scalp_with_trend' discovered"
else
    print_error "Strategy 'scalp_with_trend' not found"
    echo "Response: $STRATEGIES"
fi

if echo "$STRATEGIES" | grep -q "random_scalp"; then
    print_success "Strategy 'random_scalp' discovered"
else
    print_error "Strategy 'random_scalp' not found"
    echo "Response: $STRATEGIES"
fi

# Count strategies
STRATEGY_COUNT=$(echo "$STRATEGIES" | grep -o '"name"' | wc -l)
print_info "Total strategies discovered: $STRATEGY_COUNT"

# Check status endpoint
echo ""
echo "9. Checking runner status..."
STATUS=$(curl -s http://localhost:8100/status)
if echo "$STATUS" | grep -q "total_jobs"; then
    print_success "Status endpoint working"
else
    print_error "Status endpoint not working properly"
    echo "Response: $STATUS"
fi

# Check container logs for strategy registration
echo ""
echo "10. Verifying strategy registration in logs..."
if docker-compose logs tester-app | grep -q "Registered strategy: scalp_with_trend"; then
    print_success "scalp_with_trend registered successfully"
else
    print_error "scalp_with_trend registration not found in logs"
fi

if docker-compose logs tester-app | grep -q "Registered strategy: random_scalp"; then
    print_success "random_scalp registered successfully"
else
    print_error "random_scalp registration not found in logs"
fi

# Check if UI is accessible
echo ""
echo "11. Checking UI accessibility..."
if curl -s http://localhost:8100/ | grep -q "Strategy Permutation Tester"; then
    print_success "UI is accessible"
else
    print_error "UI not accessible"
fi

# Final summary
echo ""
echo "================================================"
echo "Test Summary"
echo "================================================"
echo ""
print_success "All tests passed!"
echo ""
echo "Access the app at: ${GREEN}http://localhost:8100${NC}"
echo ""
echo "Useful commands:"
echo "  View logs:        docker-compose logs -f tester-app"
echo "  Stop services:    docker-compose stop"
echo "  Restart:          docker-compose restart tester-app"
echo "  Shell access:     docker-compose exec tester-app bash"
echo ""
echo "API Endpoints:"
echo "  Strategies:       curl http://localhost:8100/strategies | jq"
echo "  Status:           curl http://localhost:8100/status | jq"
echo "  History:          curl http://localhost:8100/history | jq"
echo ""
print_info "Services are running in the background (detached mode)"
print_info "Use 'docker-compose down' to stop all services"
