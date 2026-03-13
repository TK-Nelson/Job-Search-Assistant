from __future__ import annotations

from pydantic import BaseModel
from typing import Literal


class NotificationCreate(BaseModel):
    level: Literal["info", "warning", "error"] = "info"
    title: str
    message: str


class NotificationRead(BaseModel):
    id: int
    level: str
    title: str
    message: str
    is_read: bool
    created_at: str


class NotificationListResponse(BaseModel):
    items: list[NotificationRead]
    count: int
    unread_count: int
