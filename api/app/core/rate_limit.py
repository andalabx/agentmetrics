"""
Per-API-key sliding window rate limiter (in-memory, per-process).

Default: 600 events/minute per key (10/s burst headroom).
Batch endpoint counts each event in the batch separately.
"""
import collections
import threading
import time

from fastapi import HTTPException

_DEFAULT_RPM = 600

_local_windows: dict[str, collections.deque] = {}
_local_lock = threading.Lock()


def check_rate_limit(api_key_hash: str, cost: int = 1, limit: int = _DEFAULT_RPM) -> int:
    """
    Sliding window counter. Raises HTTP 429 if limit exceeded.
    Returns remaining budget.
    """
    now_ms = int(time.time() * 1000)
    cutoff = now_ms - 60_000

    with _local_lock:
        if api_key_hash not in _local_windows:
            _local_windows[api_key_hash] = collections.deque()
        dq = _local_windows[api_key_hash]

        while dq and dq[0] <= cutoff:
            dq.popleft()
        if not dq:
            del _local_windows[api_key_hash]
            dq = _local_windows.setdefault(api_key_hash, collections.deque())

        count = len(dq) + cost
        if count > limit:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: {limit} events/minute per key.",
                headers={"Retry-After": "60", "X-RateLimit-Limit": str(limit), "X-RateLimit-Remaining": "0"},
            )

        for _ in range(cost):
            dq.append(now_ms)

        return max(0, limit - count)
