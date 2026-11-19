"""Encrypt/decrypt GitHub PATs at rest (Fernet)."""

from __future__ import annotations

import base64
import hashlib
import logging
import os

logger = logging.getLogger(__name__)

_WARNED_MISSING_KEY = False


def encryption_key_material() -> str:
    """TOKEN_ENCRYPTION_KEY (preferred) or GITHUB_TOKEN_ENC_KEY."""
    global _WARNED_MISSING_KEY
    key = (
        (os.getenv("TOKEN_ENCRYPTION_KEY") or "").strip()
        or (os.getenv("GITHUB_TOKEN_ENC_KEY") or "").strip()
    )
    if not key and not _WARNED_MISSING_KEY:
        _WARNED_MISSING_KEY = True
        logger.warning(
            "TOKEN_ENCRYPTION_KEY / GITHUB_TOKEN_ENC_KEY is unset — "
            "GitHub PATs cannot be encrypted at rest (local dev only)."
        )
    return key


def _fernet():
    key = encryption_key_material()
    if not key:
        return None
    from cryptography.fernet import Fernet

    try:
        return Fernet(key.encode("utf-8"))
    except Exception:  # noqa: BLE001
        digest = hashlib.sha256(key.encode("utf-8")).digest()
        fkey = base64.urlsafe_b64encode(digest)
        return Fernet(fkey)


def encrypt_token(token: str) -> str:
    f = _fernet()
    if not f:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY (or GITHUB_TOKEN_ENC_KEY) is not configured"
        )
    return f.encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(ciphertext: str) -> str:
    f = _fernet()
    if not f:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY (or GITHUB_TOKEN_ENC_KEY) is not configured"
        )
    return f.decrypt(ciphertext.encode("ascii")).decode("utf-8")


def looks_encrypted(ciphertext: str) -> bool:
    """Heuristic: Fernet tokens start with gAAAA."""
    return (ciphertext or "").startswith("gAAAA")