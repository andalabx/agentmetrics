import gzip
import json
import logging
import random
import threading
import time

import requests

logger = logging.getLogger("agentmetrics")

# Error messages are truncated before transmission to avoid leaking sensitive
# data from exceptions (e.g. connection strings, file paths, API responses).
_MAX_ERROR_LEN = 500


def _sanitize_error(msg: str) -> str:
    if not msg:
        return msg
    return msg[:_MAX_ERROR_LEN] + ("…" if len(msg) > _MAX_ERROR_LEN else "")


class HttpClient:
    def __init__(self, api_key: str, base_url: str, compress: bool = False):
        self.api_key = api_key
        # Normalise: strip trailing slash and any /v1 suffix - versioned paths
        # are constructed explicitly below so callers can pass either form.
        self.base_url = base_url.rstrip("/").removesuffix("/v1")
        self._compress = compress
        self._pending_threads: list[threading.Thread] = []
        self._lock = threading.Lock()

    def fire_and_forget(self, payload: dict) -> None:
        """Post event in a background thread. Never blocks. Never raises."""
        if payload.get("error"):
            payload = {**payload, "error": _sanitize_error(str(payload["error"]))}
        t = threading.Thread(target=self._post_with_retry, args=(payload,), daemon=True)
        with self._lock:
            self._pending_threads = [x for x in self._pending_threads if x.is_alive()]
            self._pending_threads.append(t)
        t.start()

    def fire_and_forget_batch(self, payloads: list) -> None:
        """Post a batch of events via /events/batch."""
        sanitized = [
            {**p, "error": _sanitize_error(str(p["error"]))}
            if p.get("error") else p
            for p in payloads
        ]
        t = threading.Thread(target=self._post_batch_with_retry, args=(sanitized,), daemon=True)
        with self._lock:
            self._pending_threads = [x for x in self._pending_threads if x.is_alive()]
            self._pending_threads.append(t)
        t.start()

    def _build_request(self, body: dict) -> tuple[bytes, dict]:
        raw = json.dumps(body).encode()
        headers: dict = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self._compress and len(raw) > 1024:
            raw = gzip.compress(raw)
            headers["Content-Encoding"] = "gzip"
        return raw, headers

    def _post_batch_with_retry(self, payloads: list, retries: int = 3) -> None:
        url = f"{self.base_url}/v1/events/batch"
        data, headers = self._build_request({"events": payloads})
        got_404 = False
        for attempt in range(retries):
            try:
                resp = requests.post(url, data=data, headers=headers, timeout=10)
                if resp.status_code in (200, 201):
                    return
                if resp.status_code == 404:
                    got_404 = True
                    break
                logger.debug("AgentMetrics batch: non-2xx response %s", resp.status_code)
            except Exception as exc:
                logger.debug("AgentMetrics batch: send failed (attempt %d): %s", attempt + 1, exc)
                if attempt < retries - 1:
                    time.sleep(_backoff(attempt))
        if got_404:
            for payload in payloads:
                self._post_with_retry(payload)

    def _post_with_retry(self, payload: dict, retries: int = 3) -> None:
        url = f"{self.base_url}/v1/events"
        data, headers = self._build_request(payload)
        for attempt in range(retries):
            try:
                resp = requests.post(url, data=data, headers=headers, timeout=5)
                if resp.status_code in (200, 201):
                    return
                logger.debug("AgentMetrics: non-2xx response %s", resp.status_code)
            except Exception as exc:
                logger.debug("AgentMetrics: send failed (attempt %d): %s", attempt + 1, exc)
                if attempt < retries - 1:
                    time.sleep(_backoff(attempt))

    def flush(self, timeout: float = 10.0) -> None:
        """Wait for all in-flight events to complete."""
        with self._lock:
            threads = list(self._pending_threads)
        for t in threads:
            t.join(timeout=timeout)
        with self._lock:
            self._pending_threads = [t for t in self._pending_threads if t.is_alive()]


def _backoff(attempt: int, base: float = 1.0, cap: float = 16.0) -> float:
    """Exponential backoff with full jitter."""
    return random.uniform(0, min(cap, base * (2 ** attempt)))
