from __future__ import annotations

import math
import threading
import time
from collections import defaultdict


_lock = threading.Lock()
_latencies: dict[str, list[float]] = defaultdict(list)
_max_samples = 500

_budgets_ms = {
    "GET /api/v1/dashboard/summary": 2000.0,
    "POST /api/v1/analysis/run": 3000.0,
    "POST /api/v1/fetch/run-now": 600000.0,
}


def now_ms() -> float:
    return time.perf_counter() * 1000.0


def record_latency(route_key: str, elapsed_ms: float) -> None:
    with _lock:
        samples = _latencies[route_key]
        samples.append(float(elapsed_ms))
        if len(samples) > _max_samples:
            del samples[: len(samples) - _max_samples]


def _percentile(sorted_values: list[float], percentile: float) -> float:
    if not sorted_values:
        return 0.0
    idx = max(0, min(len(sorted_values) - 1, math.ceil((percentile / 100) * len(sorted_values)) - 1))
    return sorted_values[idx]


def summarize_metrics() -> dict:
    with _lock:
        snapshot = {key: values[:] for key, values in _latencies.items()}

    endpoints: list[dict] = []
    warnings: list[str] = []
    for route_key, values in sorted(snapshot.items()):
        if not values:
            continue
        sorted_values = sorted(values)
        p50 = round(_percentile(sorted_values, 50), 2)
        p95 = round(_percentile(sorted_values, 95), 2)
        budget = _budgets_ms.get(route_key)
        over_budget = budget is not None and p95 > budget

        endpoints.append(
            {
                "endpoint": route_key,
                "samples": len(sorted_values),
                "p50_ms": p50,
                "p95_ms": p95,
                "budget_ms": budget,
                "over_budget": over_budget,
            }
        )

        if over_budget:
            warnings.append(f"{route_key} p95 {p95}ms exceeds budget {budget}ms")

    return {
        "endpoints": endpoints,
        "warnings": warnings,
        "tracked_budgets": _budgets_ms,
    }
