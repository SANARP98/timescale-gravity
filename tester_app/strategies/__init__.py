"""
Strategy registry and discovery system for the tester app.
"""

from __future__ import annotations

import importlib
import importlib.util
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class StrategyRegistry:
    """
    Automatically discovers and registers strategies from the parent app/strategies folder.
    Each strategy must implement:
    - get_info() -> Dict with name, title, description, parameters (JSON schema)
    - run(config: Dict, write_csv: bool) -> Dict with summary, trades, etc.
    """

    def __init__(self):
        self._strategies: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    def discover_strategies(self, strategies_path: Optional[Path] = None) -> None:
        """
        Discover strategies from app/strategies folder.
        """
        if self._loaded:
            return

        if strategies_path is None:
            # Go up to parent directory and look for app/strategies
            current_dir = Path(__file__).resolve().parent.parent.parent
            strategies_path = current_dir / "app" / "strategies"

        if not strategies_path.exists():
            logger.warning(f"Strategies path not found: {strategies_path}")
            return

        logger.info(f"Discovering strategies in: {strategies_path}")

        # Find all .py files in strategies folder
        for strategy_file in strategies_path.glob("*.py"):
            if strategy_file.name.startswith("_"):
                continue

            try:
                # Import the strategy module
                # Use fully qualified name to fix dataclass module context
                module_name = f"app.strategies.{strategy_file.stem}"
                spec = importlib.util.spec_from_file_location(module_name, strategy_file)
                if spec is None or spec.loader is None:
                    continue

                module = importlib.util.module_from_spec(spec)
                # Register module in sys.modules BEFORE executing to fix dataclass issue
                import sys
                sys.modules[module_name] = module
                spec.loader.exec_module(module)

                # Check if it has get_info and run functions
                if not hasattr(module, "get_info") or not hasattr(module, "run"):
                    logger.debug(f"Skipping {module_name}: missing get_info() or run()")
                    continue

                # Get strategy metadata
                info = module.get_info()
                strategy_name = info.get("name", module_name)

                self._strategies[strategy_name] = {
                    "module": module,
                    "info": info,
                    "run": module.run,
                    "file": str(strategy_file),
                }

                logger.info(f"✓ Registered strategy: {strategy_name} ({info.get('title', strategy_name)})")

            except Exception as exc:
                logger.exception(f"Failed to load strategy from {strategy_file}: {exc}")

        self._loaded = True
        logger.info(f"Strategy discovery complete. Loaded {len(self._strategies)} strategies.")

    def get_strategy(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a strategy by name."""
        return self._strategies.get(name)

    def get_all_strategies(self) -> Dict[str, Dict[str, Any]]:
        """Get all registered strategies."""
        return self._strategies.copy()

    def list_strategies(self) -> List[Dict[str, Any]]:
        """
        List all strategies with their metadata (for API consumption).
        """
        result = []
        for name, strategy in self._strategies.items():
            info = strategy["info"]
            result.append({
                "name": name,
                "title": info.get("title", name),
                "description": info.get("description", ""),
                "parameters": info.get("parameters", {}),
            })
        return result

    def run_strategy(self, name: str, config: Dict[str, Any], write_csv: bool = False) -> Dict[str, Any]:
        """Run a strategy by name."""
        strategy = self.get_strategy(name)
        if strategy is None:
            raise ValueError(f"Strategy '{name}' not found")

        return strategy["run"](config, write_csv=write_csv)


# Global registry instance
registry = StrategyRegistry()


def get_registry() -> StrategyRegistry:
    """Get the global strategy registry."""
    if not registry._loaded:
        registry.discover_strategies()
    return registry
