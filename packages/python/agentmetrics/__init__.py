from typing import Optional

from agentmetrics.tracker import Tracker as _Tracker

_client = _Tracker()

configure = _client.configure
track = _client.track
flush = _client.flush
instrument = _client.instrument
step = _client.step
tool = _client.tool
score = _client.score


def trace_id() -> str | None:
    """Return the active trace ID from inside a @track call, or None."""
    return _client.trace_id


__version__ = "0.1.2"
__all__ = ["configure", "flush", "instrument", "score", "step", "tool", "trace_id", "track"]
