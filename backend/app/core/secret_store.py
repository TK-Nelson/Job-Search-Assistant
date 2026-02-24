from __future__ import annotations

import keyring
from cryptography.fernet import Fernet


SERVICE_NAME = "JobSearchAssistant"
ARTIFACT_KEY_NAME = "artifact_encryption_key"


def get_secret(name: str) -> str | None:
    return keyring.get_password(SERVICE_NAME, name)


def set_secret(name: str, value: str) -> None:
    keyring.set_password(SERVICE_NAME, name, value)


def get_or_create_artifact_key() -> str:
    existing = get_secret(ARTIFACT_KEY_NAME)
    if existing:
        return existing

    generated = Fernet.generate_key().decode("utf-8")
    set_secret(ARTIFACT_KEY_NAME, generated)
    return generated


def secret_store_ready() -> bool:
    try:
        get_or_create_artifact_key()
        return True
    except Exception:
        return False
