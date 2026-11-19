"""In-memory anonymous scan rate limit by client IP."""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict
from typing import DefaultDict

from fastapi import HTTPException, Request

_DEFAULT_LIMIT = 10
_WINDOW_SEC = 3600

_limit = int(os.getenv("ANONYMOUS_SCAN_LIMIT_PER_HOUR", str(_DEFAULT_LIMIT)))
_lock = threading.Lock()
_buckets: DefaultDict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def check_anonymous_scan_allowed(request: Request) -> None:
    if _limit <= 0:
        return
    ip = _client_ip(request)
    now = time.time()
    cutoff = now - _WINDOW_SEC
    with _lock:
        hits = [t for t in _buckets[ip] if t > cutoff]
        if len(hits) >= _limit:
            raise HTTPException(
                status_code=429,
                detail="Anonymous demo scan limit reached. Sign in or use an API key.",
            )
        hits.append(now)
        _buckets[ip] = hits