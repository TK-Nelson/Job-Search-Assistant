"""Notification API routes."""

from fastapi import APIRouter, HTTPException

from app.schemas.notification import NotificationListResponse, NotificationRead
from app.services.notifications import (
    create_notification,
    delete_notification,
    list_notifications,
    mark_all_read,
    mark_read,
)

router = APIRouter()


@router.get("/notifications", response_model=NotificationListResponse)
def get_notifications(limit: int = 100, unread_only: bool = False) -> NotificationListResponse:
    items, unread_count = list_notifications(limit=limit, unread_only=unread_only)
    return NotificationListResponse(items=items, count=len(items), unread_count=unread_count)


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: int) -> dict:
    mark_read(notification_id)
    return {"ok": True}


@router.post("/notifications/read-all")
def read_all_notifications() -> dict:
    count = mark_all_read()
    return {"ok": True, "marked": count}


@router.delete("/notifications/{notification_id}")
def remove_notification(notification_id: int) -> dict:
    delete_notification(notification_id)
    return {"ok": True}
