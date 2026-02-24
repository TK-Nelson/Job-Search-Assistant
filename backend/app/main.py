from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.db.database import initialize_database
from app.jobs.maintenance_scheduler import start_maintenance_scheduler, stop_maintenance_scheduler
from app.core.observability import configure_logging, log_info
from app.core.secret_store import secret_store_ready
from app.middleware.correlation import CorrelationIdMiddleware
from app.middleware.performance import PerformanceMetricsMiddleware

app = FastAPI(title="Job Search Assistant API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(CorrelationIdMiddleware)
app.add_middleware(PerformanceMetricsMiddleware)

app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
def on_startup() -> None:
    configure_logging()
    log_info("app.lifecycle", "Application startup")
    initialize_database()
    secret_store_ready()
    start_maintenance_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
    log_info("app.lifecycle", "Application shutdown")
    stop_maintenance_scheduler()


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Job Search Assistant API", "version": "0.1.0"}
