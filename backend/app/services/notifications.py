"""Notification CRUD service."""

from __future__ import annotations

import sqlite3

from app.db.database import get_connection
from app.schemas.notification import NotificationRead


def _map_row(row: tuple) -> NotificationRead:
    return NotificationRead(
        id=row[0],
        level=row[1],
        title=row[2],
        message=row[3],
        is_read=bool(row[4]),
        created_at=row[5],
    )


def create_notification(
    level: str,
    title: str,
    message: str,
    *,
    deduplicate_title: bool = True,
) -> NotificationRead:
    """
    Insert a new notification.

    If *deduplicate_title* is True (default), an unread notification with the
    same title will be updated instead of creating a duplicate.
    """
    with get_connection() as conn:
        if deduplicate_title:
            existing = conn.execute(
                "SELECT id FROM notifications WHERE title = ? AND is_read = 0 ORDER BY id DESC LIMIT 1",
                (title,),
            ).fetchone()
            if existing:
                conn.execute(
                    "UPDATE notifications SET message = ?, level = ?, created_at = datetime('now') WHERE id = ?",
                    (message, level, existing[0]),
                )
                conn.commit()
                row = conn.execute(
                    "SELECT id, level, title, message, is_read, created_at FROM notifications WHERE id = ?",
                    (existing[0],),
                ).fetchone()
                return _map_row(row)

        conn.execute(
            "INSERT INTO notifications (level, title, message) VALUES (?, ?, ?)",
            (level, title, message),
        )
        conn.commit()
        row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute(
            "SELECT id, level, title, message, is_read, created_at FROM notifications WHERE id = ?",
            (row_id,),
        ).fetchone()
    return _map_row(row)


def list_notifications(limit: int = 100, unread_only: bool = False) -> tuple[list[NotificationRead], int]:
    """Return (items, unread_count)."""
    safe_limit = max(1, min(limit, 500))
    with get_connection() as conn:
        where = "WHERE is_read = 0" if unread_only else ""
        rows = conn.execute(
            f"SELECT id, level, title, message, is_read, created_at FROM notifications {where} ORDER BY created_at DESC LIMIT ?",
            (safe_limit,),
        ).fetchall()
        unread_count = conn.execute("SELECT COUNT(*) FROM notifications WHERE is_read = 0").fetchone()[0]
    return [_map_row(r) for r in rows], int(unread_count)


def mark_read(notification_id: int) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (notification_id,))
        conn.commit()


def mark_all_read() -> int:
    with get_connection() as conn:
        conn.execute("UPDATE notifications SET is_read = 1 WHERE is_read = 0")
        conn.commit()
        return conn.total_changes


def delete_notification(notification_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM notifications WHERE id = ?", (notification_id,))
        conn.commit()


def get_unread_count() -> int:
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) FROM notifications WHERE is_read = 0").fetchone()
    return int(row[0]) if row else 0
