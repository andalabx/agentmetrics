from __future__ import annotations

import logging
import time
from typing import Any
from uuid import UUID

from agentmetrics.http_client import HttpClient
from agentmetrics_shared import AgentEndEvent, estimate_cost
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.outputs import LLMResult

logger = logging.getLogger(__name__)

# INT-18: maximum depth for the parent chain walk (cycle guard)
_MAX_CHAIN_DEPTH = 50

# INT-17: maximum number of concurrent tracked runs (memory cap)
_MAX_TRACKED_RUNS = 5_000


class _RunState:
    __slots__ = (
        "_counted_errors",
        "agent_id",
        "cache_read_tokens",
        "cache_write_tokens",
        "error",
        "input_tokens",
        "llm_calls",
        "model",
        "output_tokens",
        "start_ms",
        "status",
        "tool_calls",
        "tool_errors",
        "tool_names",
    )

    def __init__(self, agent_id: str) -> None:
        self.agent_id         = agent_id
        self.start_ms         = time.monotonic()
        self.input_tokens     = 0
        self.output_tokens    = 0
        self.cache_read_tokens  = 0
        self.cache_write_tokens = 0
        self.llm_calls        = 0
        self.tool_calls       = 0
        self.tool_errors      = 0
        self.tool_names: set[str] = set()
        self._counted_errors: set[str] = set()  # INT-19: dedup error IDs
        self.model: str | None = None
        self.status           = "success"
        self.error: str | None = None


class AgentMetricsCallback(BaseCallbackHandler):
    """
    LangChain callback handler that sends a run summary to AgentMetrics
    whenever a top-level chain (agent run) completes.

    Usage::

        from agentmetrics_langchain import AgentMetricsCallback

        cb = AgentMetricsCallback(api_key="am_...", agent_id="my-agent")
        result = agent.invoke({"input": "..."}, config={"callbacks": [cb]})
    """

    def __init__(
        self,
        api_key: str,
        agent_id: str = "langchain-agent",
        base_url: str = "http://localhost:8099",
    ) -> None:
        super().__init__()
        self._client   = HttpClient(api_key=api_key, base_url=base_url)
        self._agent_id = agent_id
        # run_id (str) → RunState for top-level chains
        self._runs: dict[str, _RunState] = {}
        # run_id → parent run_id for walking the ancestry chain
        self._parent_map: dict[str, str] = {}
        # tool run_id → tool name (resolved in on_tool_end)
        self._tool_names_pending: dict[str, str] = {}


    def _track_run(self, run_id: str, data: _RunState) -> None:
        """INT-17: Store a run state with a safety cap to prevent unbounded memory growth."""
        if len(self._runs) >= _MAX_TRACKED_RUNS:
            logger.warning(
                "agentmetrics: _runs cap (%d) reached, dropping oldest entry",
                _MAX_TRACKED_RUNS,
            )
            oldest = next(iter(self._runs))
            del self._runs[oldest]
        self._runs[run_id] = data

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        rid = str(run_id)
        if parent_run_id is None:
            self._track_run(rid, _RunState(self._agent_id))
        else:
            self._parent_map[rid] = str(parent_run_id)

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id is None:
            self._emit(str(run_id))

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id is None:
            run = self._runs.get(str(run_id))
            if run:
                run.status = "failed"
                run.error  = str(error)[:500]
            self._emit(str(run_id))  # _emit already pops from _runs (INT-17)


    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id is not None:
            self._parent_map[str(run_id)] = str(parent_run_id)

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id is not None:
            self._parent_map[str(run_id)] = str(parent_run_id)

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        run = self._find_top_run(str(run_id))
        if run is None:
            return
        run.llm_calls += 1

        found_usage = False
        for gen_list in response.generations:
            for gen in gen_list:
                # Path 1: ChatGeneration → message.usage_metadata (Anthropic / OpenAI)
                msg  = getattr(gen, "message", None)
                umeta = getattr(msg, "usage_metadata", None) if msg else None
                if umeta:
                    run.input_tokens       += umeta.get("input_tokens", 0) or 0
                    run.output_tokens      += umeta.get("output_tokens", 0) or 0
                    details = umeta.get("input_token_details") or {}
                    run.cache_read_tokens  += details.get("cache_read", 0) or 0
                    run.cache_write_tokens += details.get("cache_creation", 0) or 0
                    if not run.model:
                        rmeta = getattr(msg, "response_metadata", {}) or {}
                        run.model = rmeta.get("model_name") or rmeta.get("model")
                    found_usage = True
        if found_usage:
            return

        # Path 2: llm_output dict (older models / non-chat)
        lo    = response.llm_output or {}
        usage = lo.get("token_usage") or lo.get("usage") or {}
        run.input_tokens  += usage.get("prompt_tokens", 0) or 0
        run.output_tokens += usage.get("completion_tokens", 0) or 0
        # INT-16: also extract cache tokens from the llm_output token_usage path
        token_usage = lo.get("token_usage") or {}
        cache_read = (
            token_usage.get("cache_read_input_tokens")
            or token_usage.get("cache_read_tokens")
            or 0
        )
        cache_write = (
            token_usage.get("cache_creation_input_tokens")
            or token_usage.get("cache_write_tokens")
            or 0
        )
        run.cache_read_tokens  += cache_read
        run.cache_write_tokens += cache_write
        if not run.model:
            run.model = lo.get("model_name") or lo.get("model")

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        pass


    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        rid  = str(run_id)
        name = serialized.get("name") or (serialized.get("id") or ["unknown"])[-1]
        self._tool_names_pending[rid] = str(name)
        if parent_run_id is not None:
            self._parent_map[rid] = str(parent_run_id)

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        rid = str(run_id)
        run = self._find_top_run(rid)
        if run:
            run.tool_calls += 1
            name = self._tool_names_pending.pop(rid, None)
            if name:
                run.tool_names.add(name)

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        rid = str(run_id)
        run = self._find_top_run(rid)
        if run:
            run.tool_calls += 1
            # INT-19: deduplicate error counting to avoid double-counting the same failure
            if rid not in run._counted_errors:
                run._counted_errors.add(rid)
                run.tool_errors += 1
            name = self._tool_names_pending.pop(rid, None)
            if name:
                run.tool_names.add(name)
        # Clean up tool-level entries from parent map (INT-17: prevent unbounded growth)
        self._parent_map.pop(rid, None)
        self._tool_names_pending.pop(rid, None)


    def _find_top_run(self, run_id: str, depth: int = 0) -> _RunState | None:
        """Walk the parent chain from run_id upward to find a top-level RunState.

        INT-18: depth limit prevents infinite loops from cyclic parent references.
        """
        seen: set[str] = set()
        rid = run_id
        current_depth = 0
        while rid and rid not in seen:
            if current_depth > _MAX_CHAIN_DEPTH:
                logger.warning(
                    "agentmetrics: parent chain depth exceeded %d at run %s, stopping walk",
                    _MAX_CHAIN_DEPTH, rid,
                )
                return None
            seen.add(rid)
            if rid in self._runs:
                return self._runs[rid]
            rid = self._parent_map.get(rid, "")
            current_depth += 1
        return None

    def _emit(self, run_id: str) -> None:
        run = self._runs.pop(run_id, None)
        if run is None:
            return
        # clean up orphan parent-map entries
        dead = [k for k, v in self._parent_map.items() if v == run_id]
        for k in dead:
            self._parent_map.pop(k, None)

        duration_ms = (time.monotonic() - run.start_ms) * 1000
        ev = AgentEndEvent(agent_id=run.agent_id, platform="langchain")
        ev.trace_id            = run_id
        ev.input_tokens        = run.input_tokens
        ev.output_tokens       = run.output_tokens
        ev.cache_read_tokens   = run.cache_read_tokens
        ev.cache_write_tokens  = run.cache_write_tokens
        ev.llm_calls           = run.llm_calls
        ev.tool_calls          = run.tool_calls
        ev.tool_errors         = run.tool_errors
        ev.tool_names          = list(run.tool_names)
        ev.status              = run.status
        ev.duration_ms         = round(duration_ms, 2)
        ev.error               = run.error
        ev.model               = run.model
        ev.estimated_cost_usd  = estimate_cost(
            run.model or "", run.input_tokens, run.output_tokens,
            run.cache_read_tokens, run.cache_write_tokens,
        ) or None
        self._client.fire_and_forget(ev.to_payload())

    def flush(self, timeout: float = 10.0) -> None:
        """Wait for all in-flight HTTP requests to complete."""
        self._client.flush(timeout=timeout)
