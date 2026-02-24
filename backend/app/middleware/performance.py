from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.services.performance_metrics import now_ms, record_latency


class PerformanceMetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_ms = now_ms()
        response = await call_next(request)
        elapsed_ms = now_ms() - start_ms

        route_key = f"{request.method} {request.url.path}"
        record_latency(route_key, elapsed_ms)
        return response
