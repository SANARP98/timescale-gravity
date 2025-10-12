"""
Permutation runner for testing multiple parameter combinations.
"""

from __future__ import annotations

import concurrent.futures
import itertools
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from tester_app.strategies import get_registry

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Job:
    """Represents a single backtest job."""
    strategy_name: str
    symbol: str
    params: Dict[str, Any]

    def describe(self) -> Dict[str, Any]:
        return {"strategy": self.strategy_name, "symbol": self.symbol, **self.params}

    def __hash__(self) -> int:
        items = tuple(sorted(self.params.items()))
        return hash((self.strategy_name, self.symbol, items))


class JobGenerator:
    """
    Generates jobs based on parameter ranges.
    Dynamically adapts to different strategy parameter schemas.
    """

    @staticmethod
    def generate_jobs(strategy_name: str, param_ranges: Dict[str, Any]) -> List[Job]:
        """
        Generate all permutations of jobs for a strategy.

        param_ranges should contain:
        - symbols: List[str]
        - For each parameter: either a single value or a list of values
        """
        symbols = param_ranges.get("symbols", [])
        if not symbols:
            return []

        # Extract all other parameters
        other_params = {k: v for k, v in param_ranges.items() if k != "symbols"}

        # Convert single values to lists for consistency
        param_lists = {}
        for key, value in other_params.items():
            if isinstance(value, list):
                param_lists[key] = value
            else:
                param_lists[key] = [value]

        # Generate all combinations
        jobs: List[Job] = []
        if not param_lists:
            # No parameters to vary, just one job per symbol
            for symbol in symbols:
                jobs.append(Job(strategy_name=strategy_name, symbol=symbol, params={}))
        else:
            # Generate cartesian product of all parameter values
            param_names = list(param_lists.keys())
            param_values = [param_lists[name] for name in param_names]

            for symbol in symbols:
                for value_combo in itertools.product(*param_values):
                    params = dict(zip(param_names, value_combo))
                    jobs.append(Job(strategy_name=strategy_name, symbol=symbol, params=params))

        logger.info(f"Generated {len(jobs)} jobs for strategy {strategy_name}")
        return jobs


class PermutationRunner:
    """
    Runs backtests for all permutations of parameters.
    Supports pause/resume, parallel execution, and progress tracking.
    """

    def __init__(
        self,
        strategy_name: str,
        base_config: Dict[str, Any],
        param_ranges: Dict[str, Any],
        max_workers: int = 2,
        on_result_callback: Optional[callable] = None,
    ):
        self.strategy_name = strategy_name
        self.base_config = base_config
        self.param_ranges = param_ranges
        self.max_workers = max(1, max_workers)
        self.on_result_callback = on_result_callback

        # Generate jobs
        self._all_jobs: List[Job] = JobGenerator.generate_jobs(strategy_name, param_ranges)
        self.total_jobs = len(self._all_jobs)

        # State management
        self._index = 0
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._pause_event = threading.Event()
        self._pause_event.clear()
        self._stop_requested = False
        self.running = False
        self._current_jobs: Set[Job] = set()
        self.last_result: Optional[Dict[str, Any]] = None
        self.last_error: Optional[str] = None
        self._completed_count = 0

    def reconfigure(
        self,
        base_config: Optional[Dict[str, Any]] = None,
        param_ranges: Optional[Dict[str, Any]] = None,
        max_workers: Optional[int] = None,
    ) -> None:
        """Reconfigure the runner. Must be called when runner is stopped."""
        with self._lock:
            if self.running or (self._thread and self._thread.is_alive()):
                raise RuntimeError("Cannot reconfigure while runner is active.")

            if base_config is not None:
                self.base_config = base_config
            if max_workers is not None:
                self.max_workers = max(1, max_workers)
            if param_ranges is not None:
                self.param_ranges = param_ranges
                self._all_jobs = JobGenerator.generate_jobs(self.strategy_name, param_ranges)
                self.total_jobs = len(self._all_jobs)
                self._index = 0
                self._completed_count = 0

    def reset(self) -> None:
        """Reset the runner to initial state."""
        with self._lock:
            self._stop_requested = True
            self._pause_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join()
        with self._lock:
            self._index = 0
            self._completed_count = 0
            self._current_jobs.clear()
            self.last_result = None
            self.last_error = None
            self._stop_requested = False
            self.running = False
            self._thread = None
            self._pause_event = threading.Event()
        logger.info("Runner reset")

    def start(self) -> None:
        """Start or resume the runner."""
        with self._lock:
            if self._thread and self._thread.is_alive():
                self._pause_event.set()
                self.running = True
                logger.info("Runner resumed")
                return

            if self._index >= self.total_jobs:
                self._index = 0
                self._completed_count = 0
            self._pause_event.set()
            self._stop_requested = False
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            self.running = True
            logger.info("Runner started")

    def pause(self) -> None:
        """Pause the runner."""
        self._pause_event.clear()
        self.running = False
        logger.info("Runner paused")

    def _next_job(self) -> Optional[Job]:
        """Get the next job to process."""
        with self._lock:
            if self._index >= self.total_jobs:
                return None
            job = self._all_jobs[self._index]
            self._index += 1
            return job

    def _run_loop(self) -> None:
        """Main execution loop (runs in background thread)."""
        self.running = True
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            active: Dict[concurrent.futures.Future, Job] = {}
            while not self._stop_requested:
                self._pause_event.wait()
                if self._stop_requested:
                    break

                while self._pause_event.is_set() and not self._stop_requested:
                    # Submit new jobs up to max_workers
                    while len(active) < self.max_workers:
                        job = self._next_job()
                        if job is None:
                            break
                        future = executor.submit(self._run_single_job, job)
                        active[future] = job
                        with self._lock:
                            self._current_jobs.add(job)

                    # Check if we're done
                    if not active:
                        if self._index >= self.total_jobs:
                            logger.info("Runner completed all jobs")
                            self.running = False
                            self._pause_event.clear()
                            return
                        time.sleep(0.1)
                        continue

                    # Wait for at least one job to complete
                    done, _ = concurrent.futures.wait(
                        active.keys(),
                        timeout=0.5,
                        return_when=concurrent.futures.FIRST_COMPLETED,
                    )
                    if not done:
                        continue

                    # Process completed jobs
                    for fut in done:
                        job = active.pop(fut)
                        with self._lock:
                            self._current_jobs.discard(job)
                        try:
                            result_payload = fut.result()
                            self.last_result = result_payload
                            self.last_error = None
                            if self.on_result_callback:
                                self.on_result_callback(result_payload)
                        except Exception as exc:
                            self.last_error = str(exc)
                            logger.exception(f"Job failed: {exc}")
                        finally:
                            with self._lock:
                                self._completed_count += 1
                                completed = self._completed_count
                            logger.info(f"Job {completed}/{self.total_jobs} completed")

                    # Final check
                    if self._index >= self.total_jobs and not active:
                        logger.info("Runner completed all jobs")
                        self.running = False
                        self._pause_event.clear()
                        return

                time.sleep(0.1)
        self.running = False

    def _run_single_job(self, job: Job) -> Dict[str, Any]:
        """Execute a single backtest job."""
        # Merge base config with job params
        config = {**self.base_config, **job.params, "symbol": job.symbol}

        # Run the strategy
        registry = get_registry()
        result = registry.run_strategy(job.strategy_name, config, write_csv=False)

        # Extract or create summary
        summary = result.get("summary")
        if not summary:
            logger.warning(f"No trades for {job.symbol} with {job.params}")
            summary = {
                "trades": 0,
                "wins": 0,
                "losses": 0,
                "winrate_percent": 0.0,
                "net_rupees": 0.0,
                "gross_rupees": 0.0,
                "costs_rupees": 0.0,
                "roi_percent": 0.0,
                "risk_reward": 0.0,
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "no_trades_reason": result.get("message", "No trades generated"),
            }
        else:
            summary["last_run_at"] = datetime.now(timezone.utc).isoformat()

        return {
            "strategy": job.strategy_name,
            "symbol": job.symbol,
            "params": job.params,
            "summary": summary,
        }

    @property
    def completed_jobs(self) -> int:
        """Get the number of completed jobs."""
        with self._lock:
            return min(self._completed_count, self.total_jobs)

    def status(self) -> Dict[str, Any]:
        """Get the current status of the runner."""
        with self._lock:
            current_jobs = [job.describe() for job in self._current_jobs]
            completed = self._completed_count
            is_running = self.running and self._pause_event.is_set()

        remaining = max(self.total_jobs - completed, 0)
        progress = (completed / self.total_jobs * 100) if self.total_jobs else 0.0

        return {
            "running": is_running,
            "paused": not self._pause_event.is_set() and not self._stop_requested and completed > 0,
            "current_jobs": current_jobs,
            "active_workers": len(current_jobs),
            "completed_jobs": completed,
            "total_jobs": self.total_jobs,
            "remaining_jobs": remaining,
            "progress_percent": round(progress, 2),
            "last_result": self.last_result,
            "last_error": self.last_error,
            "max_workers": self.max_workers,
            "strategy": self.strategy_name,
        }
