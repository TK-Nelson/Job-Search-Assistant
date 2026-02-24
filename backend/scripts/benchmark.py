from __future__ import annotations

import argparse
import statistics
import time
from urllib import error, request


def _measure(url: str, method: str = "GET", data: bytes | None = None, content_type: str | None = None) -> tuple[float, int]:
    headers = {}
    if content_type:
        headers["Content-Type"] = content_type
    req = request.Request(url=url, method=method, data=data, headers=headers)

    start = time.perf_counter()
    try:
        with request.urlopen(req, timeout=30) as resp:
            _ = resp.read()
            status = resp.status
    except error.HTTPError as exc:
        status = exc.code
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return elapsed_ms, status


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round(0.95 * len(ordered) + 0.5)) - 1))
    return ordered[idx]


def run_benchmark(base_url: str, iterations: int) -> None:
    targets = [
        ("GET dashboard", f"{base_url}/api/v1/dashboard/summary", "GET", None, None),
        ("GET metrics", f"{base_url}/api/v1/metrics/summary", "GET", None, None),
        ("POST fetch run", f"{base_url}/api/v1/fetch/run-now", "POST", b"", "application/json"),
    ]

    print(f"Benchmarking {len(targets)} endpoint(s) for {iterations} iteration(s)...")
    for name, url, method, data, content_type in targets:
        samples: list[float] = []
        statuses: list[int] = []
        for _ in range(iterations):
            elapsed_ms, status = _measure(url, method=method, data=data, content_type=content_type)
            samples.append(elapsed_ms)
            statuses.append(status)

        p50 = statistics.median(samples) if samples else 0.0
        p95 = _p95(samples)
        ok_rate = (sum(1 for code in statuses if 200 <= code < 300) / len(statuses)) * 100 if statuses else 0.0

        print(f"\n{name}")
        print(f"  p50_ms: {p50:.2f}")
        print(f"  p95_ms: {p95:.2f}")
        print(f"  ok_rate: {ok_rate:.1f}%")


def main() -> None:
    parser = argparse.ArgumentParser(description="Local benchmark for key API latency.")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--iterations", type=int, default=5, help="Requests per endpoint")
    args = parser.parse_args()

    run_benchmark(args.base_url.rstrip("/"), max(1, args.iterations))


if __name__ == "__main__":
    main()
