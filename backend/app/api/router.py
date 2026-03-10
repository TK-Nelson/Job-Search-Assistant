from fastapi import APIRouter

from app.api.routes import applications, analysis, audit, companies, comparisons, dashboard, db, fetch, fetch_routine, health, maintenance, metrics, optimization, postings, resumes, settings

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(settings.router, tags=["settings"])
api_router.include_router(db.router, tags=["database"])
api_router.include_router(companies.router, tags=["companies"])
api_router.include_router(applications.router, tags=["applications"])
api_router.include_router(dashboard.router, tags=["dashboard"])
api_router.include_router(audit.router, tags=["audit"])
api_router.include_router(metrics.router, tags=["metrics"])
api_router.include_router(maintenance.router, tags=["maintenance"])
api_router.include_router(fetch.router, tags=["fetch"])
api_router.include_router(fetch_routine.router, tags=["fetch-routine"])
api_router.include_router(postings.router, tags=["postings"])
api_router.include_router(analysis.router, tags=["analysis"])
api_router.include_router(comparisons.router, tags=["comparisons"])
api_router.include_router(optimization.router, tags=["optimization"])
api_router.include_router(resumes.router, tags=["resumes"])
