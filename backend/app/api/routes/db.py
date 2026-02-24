from fastapi import APIRouter

from app.db.database import initialize_database

router = APIRouter()


@router.post("/db/init")
def init_db() -> dict[str, str]:
    initialize_database()
    return {"status": "ok"}
