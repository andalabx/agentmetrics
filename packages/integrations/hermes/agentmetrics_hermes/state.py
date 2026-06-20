from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field


@dataclass
class SpanState:
    span_id: str
    parent_span_id: str | None
    run_id: str
    started_at: float = field(default_factory=time.time)


@dataclass
class RunState:
    """Aggregated counters for a single Hermes turn (message → response cycle)."""

    run_id: str
    session_key: str = ""
    model: str = ""
    provider: str = ""
    started_at: float = field(default_factory=time.time)
    delegation_depth: int = 0

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    llm_calls: int = 0
    tool_calls: int = 0
    tool_errors: int = 0
    tool_names: set[str] = field(default_factory=set)
    images_count: int = 0
    subagents_spawned: int = 0
    subagent_errors: int = 0
    skills_loaded_count: int = 0
    skill_names: set[str] = field(default_factory=set)
    memory_writes_count: int = 0
    session_search_calls: int = 0
    gateway_disconnects: int = 0
    reconnects: int = 0
    cronjob_id: str = ""
    cron_run_id: str = ""
    last_error: str = ""
    step_count: int = 0
    secrets_blocked: int = 0
    finished: bool = False


@dataclass
class SessionState:
    """Aggregated state across all runs in a single Hermes session."""

    session_key: str
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str = "hermes"
    started_at: float = field(default_factory=time.time)
    compactions: int = 0
    resets: int = 0

    run_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_read_tokens: int = 0
    total_cache_write_tokens: int = 0
    total_tool_calls: int = 0
    total_estimated_cost_usd: float = 0.0
    total_duration_ms: int = 0


class StateStore:
    """Thread-safe store for session and run state."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}
        self._runs: dict[str, RunState] = {}
        self._spans: dict[str, SpanState] = {}
        self._active_run: dict[str, str] = {}  # session_key → run_id
        self._lock = threading.Lock()

    # ── Session helpers ───────────────────────────────────────────────────────

    def get_or_create_session(self, session_key: str, agent_id: str = "hermes") -> SessionState:
        with self._lock:
            if session_key not in self._sessions:
                self._sessions[session_key] = SessionState(
                    session_key=session_key, agent_id=agent_id
                )
            return self._sessions[session_key]

    def get_session(self, session_key: str) -> SessionState | None:
        with self._lock:
            return self._sessions.get(session_key)

    def pop_session(self, session_key: str) -> SessionState | None:
        with self._lock:
            self._active_run.pop(session_key, None)
            return self._sessions.pop(session_key, None)

    # ── Run helpers ───────────────────────────────────────────────────────────

    def get_or_create_run(self, session_key: str) -> RunState:
        with self._lock:
            run_id = self._active_run.get(session_key)
            if run_id and run_id in self._runs and not self._runs[run_id].finished:
                return self._runs[run_id]
            # Start a new run for this session turn.
            new_run_id = str(uuid.uuid4())
            run = RunState(run_id=new_run_id, session_key=session_key)
            self._runs[new_run_id] = run
            self._active_run[session_key] = new_run_id
            return run

    def get_active_run(self, session_key: str) -> RunState | None:
        with self._lock:
            run_id = self._active_run.get(session_key)
            if run_id:
                return self._runs.get(run_id)
            return None

    def finish_run(self, session_key: str) -> RunState | None:
        """Mark current run finished and return it for serialization."""
        with self._lock:
            run_id = self._active_run.pop(session_key, None)
            if run_id:
                run = self._runs.pop(run_id, None)
                if run:
                    run.finished = True
                    return run
        return None

    # ── Span helpers ──────────────────────────────────────────────────────────

    def start_span(self, run_id: str, parent_span_id: str | None = None) -> str:
        span_id = str(uuid.uuid4())
        with self._lock:
            self._spans[span_id] = SpanState(
                span_id=span_id, parent_span_id=parent_span_id, run_id=run_id
            )
        return span_id

    def end_span(self, span_id: str) -> SpanState | None:
        with self._lock:
            return self._spans.pop(span_id, None)
