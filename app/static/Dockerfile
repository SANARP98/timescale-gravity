# ---- Builder Stage ----
# This stage installs dependencies into a virtual environment using the fast `uv` installer.
FROM python:3.12-slim-bookworm AS builder

# Set environment variables for uv and Python
ENV UV_VERSION=0.2.21
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install uv - a fast Python package installer
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -LsSf https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-x86_64-unknown-linux-gnu.tar.gz | tar -zxvf - -C /usr/local/bin && \
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/*

# Create a virtual environment
RUN python3 -m venv $VIRTUAL_ENV

# Copy only the requirements file to leverage Docker cache
WORKDIR /app
COPY requirements.txt .

# Install dependencies using uv
RUN uv pip install --no-cache --system -r requirements.txt


# ---- Runtime Stage ----
# This is the final, lean image that will run the application.
FROM python:3.12-slim-bookworm AS runtime

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Create a non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

# Copy the virtual environment from the builder stage
COPY --from=builder $VIRTUAL_ENV $VIRTUAL_ENV

# Copy the application code
WORKDIR /app
COPY --chown=appuser:appgroup . .

# Switch to the non-root user
USER appuser

# Expose the port the app runs on
EXPOSE 8000

# Define the command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]