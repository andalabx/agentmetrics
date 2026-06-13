"""
In-memory activity store for real-time agent event streaming.

Architecture:
  - POST /v1/activity  (sync, API-key auth) calls store.publish()
  - GET  /v1/live      (async, JWT auth)    uses store.subscribe() + run_in_executor

queue.Queue bridges the sync publish side to the async SSE generator.
"""
import queue
import threading
from collections import defaultdict, deque


class ActivityStore:
    def __init__(self):
        self._lock    = threading.Lock()
        # Recent events per org - replayed to new SSE subscribers
        self._recent:  dict[str, deque]           = defaultdict(lambda: deque(maxlen=200))
        # Per-org list of subscriber queues
        self._queues:  dict[str, list[queue.Queue]] = defaultdict(list)

    def publish(self, org_id: str, event: dict) -> None:
        """Called from sync request handlers. Thread-safe."""
        with self._lock:
            self._recent[org_id].append(event)
            dead = []
            for q in self._queues[org_id]:
                try:
                    q.put_nowait(event)
                except Exception:
                    dead.append(q)
            for q in dead:
                self._queues[org_id].remove(q)

    def subscribe(self, org_id: str) -> queue.Queue:
        """Register a new SSE subscriber. Returns a queue to read from."""
        q: queue.Queue = queue.Queue(maxsize=500)
        with self._lock:
            self._queues[org_id].append(q)
        return q

    def unsubscribe(self, org_id: str, q: queue.Queue) -> None:
        with self._lock:
            try:
                self._queues[org_id].remove(q)
            except ValueError:
                pass
            if not self._queues[org_id]:
                del self._queues[org_id]

    def recent(self, org_id: str) -> list:
        """Return recent events for replay on new connection."""
        with self._lock:
            return list(self._recent[org_id])


# Singleton - imported by both routers
store = ActivityStore()
