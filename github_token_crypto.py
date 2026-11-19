"""Encrypt/decrypt GitHub PATs at rest (Fernet)."""

from __future__ import annotations

import base64
import hashlib
import logging
import os

logger = logging.getLogger(__name__)


def _fernet():
    key = (os.getenv("GITHUB_TOKEN_ENC_KEY") or "").strip()
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
        raise RuntimeError("GITHUB_TOKEN_ENC_KEY is not configured")
    return f.encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(ciphertext: str) -> str:
    f = _fernet()
    if not f:
        raise RuntimeError("GITHUB_TOKEN_ENC_KEY is not configured")
    return f.decrypt(ciphertext.encode("ascii")).decode("utf-8")