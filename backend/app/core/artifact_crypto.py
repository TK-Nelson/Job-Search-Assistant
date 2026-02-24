from __future__ import annotations

from pathlib import Path

from cryptography.fernet import Fernet
from fastapi import HTTPException

from app.core.secret_store import get_or_create_artifact_key


def _fernet() -> Fernet:
    try:
        key = get_or_create_artifact_key().encode("utf-8")
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_ERROR",
                "message": "Failed to initialize secure secret store for artifact encryption.",
                "details": {"reason": str(exc)},
            },
        )
    return Fernet(key)


def encrypt_bytes(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt_bytes(data: bytes) -> bytes:
    return _fernet().decrypt(data)


def write_artifact_bytes(path: Path, data: bytes, encrypt: bool = True) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    target_path = path
    payload = data
    if encrypt:
        target_path = path.with_suffix(path.suffix + ".enc")
        payload = encrypt_bytes(data)
    target_path.write_bytes(payload)
    return target_path


def read_artifact_bytes(path: Path) -> bytes:
    if not path.exists():
        raise FileNotFoundError(str(path))
    payload = path.read_bytes()
    if path.suffix.lower() == ".enc":
        return decrypt_bytes(payload)
    return payload
