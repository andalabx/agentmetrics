from __future__ import annotations

import asyncio
import functools
import logging
import random
import threading
import time
import uuid
from collections.abc import AsyncGenerator, Callable, Generator
from contextvars import ContextVar
from typing import Any, ClassVar

from agentmetrics_shared import AgentEndEvent
from agentmetrics_shared import estimate_cost as _shared_estimate_cost

from agentmetrics.http_client import HttpClient

# SDK-07: Named constant for tool-loop detection threshold
_TOOL_LOOP_THRESHOLD = 3  # consecutive identical tool calls marks run as failed

# SEC-J01: Module-level lock to prevent monkey-patch race conditions
_PATCH_LOCK = threading.Lock()

# Sentinel attribute name used for double-patch guard (SDK-02)
_PATCHED_ATTR = "_agentmetrics_patched"

logger = logging.getLogger("agentmetrics")

# SEC-J02: Module-level scrub function hook
_scrub_fn: Callable[[dict], dict] | None = None


def _apply_scrub(payload: dict) -> dict:
    """SEC-J02: Apply user-supplied scrub_fn to payload before sending."""
    if _scrub_fn is not None:
        try:
            return _scrub_fn(dict(payload))
        except Exception as exc:
            logger.warning("agentmetrics: scrub_fn raised %s; sending unscrubbed", exc)
    return payload


# SDK-01: Helpers to wrap sync/async streaming generators
def _wrap_sync_stream(gen: Any, on_done: Callable[[Any], None]) -> Generator[Any, None, None]:  # type annotation — wraps arbitrary callable
    """Wrap a sync generator; call on_done(last_chunk) after exhaustion."""
    last = None
    try:
        for chunk in gen:
            last = chunk
            yield chunk
    finally:
        on_done(last)


async def _wrap_async_stream(agen: Any, on_done: Callable[[Any], None]) -> AsyncGenerator[Any, None]:  # type annotation — wraps arbitrary callable
    """Wrap an async generator; call on_done(last_chunk) after exhaustion."""
    last = None
    try:
        async for chunk in agen:
            last = chunk
            yield chunk
    finally:
        on_done(last)


def _extract_stream_usage(chunk: Any) -> dict:  # type annotation — wraps arbitrary callable
    """SDK-01: Extract token usage from the last chunk of a streaming response."""
    if chunk is None:
        return {}
    # Anthropic: chunk.usage.input_tokens
    usage = getattr(chunk, "usage", None)
    if usage:
        input_tokens = getattr(usage, "input_tokens", 0) or 0
        output_tokens = getattr(usage, "output_tokens", 0) or 0
        # Check for OpenAI-style prompt_tokens / completion_tokens on the same object
        if not input_tokens:
            input_tokens = getattr(usage, "prompt_tokens", 0) or 0
        if not output_tokens:
            output_tokens = getattr(usage, "completion_tokens", 0) or 0
        return {"input_tokens": input_tokens, "output_tokens": output_tokens}
    return {}


_current_trace_id: ContextVar[str | None] = ContextVar("agentmetrics_trace_id", default=None)
_current_agent_id: ContextVar[str | None] = ContextVar("agentmetrics_agent_id", default=None)
_step_accumulator: ContextVar[list | None] = ContextVar("agentmetrics_steps", default=None)
_tool_call_accumulator: ContextVar[list | None] = ContextVar("agentmetrics_tools", default=None)
_llm_token_accumulator: ContextVar[dict | None] = ContextVar("agentmetrics_tokens", default=None)
_score_accumulator: ContextVar[dict | None] = ContextVar("agentmetrics_scores", default=None)


class _BatchSender:
    def __init__(self, client: HttpClient, max_size: int = 20, flush_interval: float = 2.0) -> None:
        self._client = client
        self._max_size = max_size
        self._flush_interval = flush_interval
        self._queue: list[dict] = []
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._stopped = False
        self._start_timer()

    def enqueue(self, payload: dict) -> None:
        with self._lock:
            self._queue.append(payload)
            if len(self._queue) >= self._max_size:
                self._flush_locked()

    def _start_timer(self) -> None:
        self._timer = threading.Timer(self._flush_interval, self._flush_from_timer)
        self._timer.daemon = True
        self._timer.start()

    def _flush_from_timer(self) -> None:
        with self._lock:
            self._flush_locked()
        if not self._stopped:
            self._start_timer()

    def _flush_locked(self) -> None:
        if not self._queue:
            return
        batch = self._queue[:]
        self._queue.clear()
        if len(batch) == 1:
            self._client.fire_and_forget(batch[0])
        else:
            self._client.fire_and_forget_batch(batch)

    def flush(self, timeout: float = 10.0) -> None:
        with self._lock:
            self._flush_locked()
        self._client.flush(timeout=timeout)

    def stop(self) -> None:
        self._stopped = True
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def __del__(self) -> None:
        self.stop()


class _StepContext:
    def __init__(self, name: str, step_type: str = "custom", metadata: dict | None = None) -> None:
        self.name = name
        self.step_type = step_type
        self.metadata = metadata or {}
        self._start: float = 0.0
        self.status = "success"
        self.error: str | None = None

    def __enter__(self) -> _StepContext:
        self._start = time.monotonic()
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: Any) -> bool:
        duration_ms = (time.monotonic() - self._start) * 1000
        if exc_type is not None:
            self.status = "failed"
            self.error = str(exc_val)
        steps = _step_accumulator.get()
        if steps is not None:
            entry: dict[str, Any] = {
                "name": self.name,
                "type": self.step_type,
                "status": self.status,
                "duration_ms": round(duration_ms, 2),
            }
            if self.error:
                entry["error"] = self.error
            if self.metadata:
                entry["metadata"] = self.metadata
            steps.append(entry)
        return False

    async def __aenter__(self) -> _StepContext:
        return self.__enter__()

    async def __aexit__(self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: Any) -> bool:
        return self.__exit__(exc_type, exc_val, exc_tb)


class _ToolContext:
    def __init__(self, name: str, metadata: dict | None = None) -> None:
        self.name = name
        self.metadata = metadata or {}
        self._start: float = 0.0
        self.status = "success"
        self.error: str | None = None

    def __enter__(self) -> _ToolContext:
        self._start = time.monotonic()
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: Any) -> bool:
        duration_ms = (time.monotonic() - self._start) * 1000
        if exc_type is not None:
            self.status = "failed"
            self.error = str(exc_val)
        tools = _tool_call_accumulator.get()
        if tools is not None:
            entry: dict[str, Any] = {
                "name": self.name,
                "status": self.status,
                "duration_ms": round(duration_ms, 2),
            }
            if self.error:
                entry["error"] = self.error
            if self.metadata:
                entry["metadata"] = self.metadata
            tools.append(entry)
        return False

    async def __aenter__(self) -> _ToolContext:
        return self.__enter__()

    async def __aexit__(self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: Any) -> bool:
        return self.__exit__(exc_type, exc_val, exc_tb)


def _patch_litellm(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            import litellm
            # SDK-02: Double-patch guard for sync
            _orig_c = getattr(litellm, "completion", None)
            if _orig_c is None or getattr(_orig_c, _PATCHED_ATTR, False):
                _orig_a = getattr(litellm, "acompletion", None)
                if _orig_a is None or getattr(_orig_a, _PATCHED_ATTR, False):
                    return True  # already patched
            _orig_c = litellm.completion
            _orig_a = litellm.acompletion

            def _pc(*a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                # SDK-01: Streaming support
                if kw.get("stream"):
                    resp = _orig_c(*a, **kw)
                    m = kw.get("model")
                    def on_done(last_chunk: Any) -> None:
                        usage = _extract_stream_usage(last_chunk)
                        if usage:
                            on_response(m, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
                    return _wrap_sync_stream(resp, on_done)
                resp = _orig_c(*a, **kw)
                try:
                    u = getattr(resp, "usage", None)
                    m = getattr(resp, "model", kw.get("model"))
                    if u:
                        on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in litellm.completion (%s), passing through: %s",
                                   type(exc).__name__, exc)
                return resp

            async def _pa(*a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                # SDK-01: Streaming support
                if kw.get("stream"):
                    resp = await _orig_a(*a, **kw)
                    m = kw.get("model")
                    def on_done(last_chunk: Any) -> None:
                        usage = _extract_stream_usage(last_chunk)
                        if usage:
                            on_response(m, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
                    return _wrap_async_stream(resp, on_done)
                resp = await _orig_a(*a, **kw)
                try:
                    u = getattr(resp, "usage", None)
                    m = getattr(resp, "model", kw.get("model"))
                    if u:
                        on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in litellm.acompletion (%s), passing through: %s",
                                   type(exc).__name__, exc)
                return resp

            _pc._agentmetrics_patched = True  # SDK-02
            _pc._agentmetrics_original = _orig_c
            _pa._agentmetrics_patched = True  # SDK-02
            _pa._agentmetrics_original = _orig_a
            litellm.completion = _pc
            litellm.acompletion = _pa
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for litellm: %s", exc)
            return False


def _patch_anthropic(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            from anthropic.resources.messages import AsyncMessages, Messages
            # SDK-02: Double-patch guard
            _orig_sync = getattr(Messages, "create", None)
            if _orig_sync is None or getattr(_orig_sync, _PATCHED_ATTR, False):
                return True
            _orig_async = getattr(AsyncMessages, "create", None)
            if _orig_async is None or getattr(_orig_async, _PATCHED_ATTR, False):
                return True

            def _capture_anthropic(resp: Any, kw: Any) -> None:  # type annotation — wraps arbitrary callable
                u = getattr(resp, "usage", None)
                m = getattr(resp, "model", kw.get("model"))
                if u:
                    on_response(
                        m,
                        getattr(u, "input_tokens", 0),
                        getattr(u, "output_tokens", 0),
                        cache_read=getattr(u, "cache_read_input_tokens", 0) or 0,
                        cache_write=getattr(u, "cache_creation_input_tokens", 0) or 0,
                    )

            def _p(s: Any, *a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                # SDK-01: Wrap streaming response
                if kw.get("stream"):
                    resp = _orig_sync(s, *a, **kw)
                    m = kw.get("model")
                    def on_done(last_chunk: Any) -> None:
                        usage = _extract_stream_usage(last_chunk)
                        if usage:
                            on_response(m, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
                    return _wrap_sync_stream(resp, on_done)
                resp = _orig_sync(s, *a, **kw)
                try:
                    _capture_anthropic(resp, kw)
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in anthropic Messages.create (%s), passing through: %s",
                                   type(exc).__name__, exc)
                    return _orig_sync(s, *a, **kw)
                return resp

            async def _pa(s: Any, *a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                # SDK-01: Wrap async streaming response
                if kw.get("stream"):
                    resp = await _orig_async(s, *a, **kw)
                    m = kw.get("model")
                    def on_done(last_chunk: Any) -> None:
                        usage = _extract_stream_usage(last_chunk)
                        if usage:
                            on_response(m, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
                    return _wrap_async_stream(resp, on_done)
                resp = await _orig_async(s, *a, **kw)
                try:
                    _capture_anthropic(resp, kw)
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in anthropic AsyncMessages.create (%s), passing through: %s",
                                   type(exc).__name__, exc)
                    return await _orig_async(s, *a, **kw)
                return resp

            _p._agentmetrics_patched = True  # SDK-02
            _p._agentmetrics_original = _orig_sync
            _pa._agentmetrics_patched = True  # SDK-02
            _pa._agentmetrics_original = _orig_async
            Messages.create = _p
            AsyncMessages.create = _pa
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for anthropic: %s", exc)
            return False


def _patch_openai(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # Covers OpenAI, Azure OpenAI, Groq, Together AI (all use openai SDK).
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            from openai.resources.chat.completions import AsyncCompletions, Completions
            # SDK-02: Double-patch guard
            _orig_sync = getattr(Completions, "create", None)
            if _orig_sync is None or getattr(_orig_sync, _PATCHED_ATTR, False):
                return True
            _orig_async = getattr(AsyncCompletions, "create", None)
            if _orig_async is None or getattr(_orig_async, _PATCHED_ATTR, False):
                return True

            def _capture_openai(resp: Any, kw: Any) -> None:  # type annotation — wraps arbitrary callable
                u = getattr(resp, "usage", None)
                m = getattr(resp, "model", kw.get("model"))
                if u:
                    on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))

            def _p(s: Any, *a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                # SDK-01: Wrap streaming response
                if kw.get("stream"):
                    resp = _orig_sync(s, *a, **kw)
                    m = kw.get("model")
                    def on_done(last_chunk: Any) -> None:
                        usage = _extract_stream_usage(last_chunk)
                        if usage:
                            on_response(m, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
                    return _wrap_sync_stream(resp, on_done)
                resp = _orig_sync(s, *a, **kw)
                try:
                    _capture_openai(resp, kw)
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in openai Completions.create (%s), passing through: %s",
                                   type(exc).__name__, exc)
                    return _orig_sync(s, *a, **kw)
                return resp

            async def _pa(s: Any, *a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                # SDK-01: Wrap async streaming response
                if kw.get("stream"):
                    resp = await _orig_async(s, *a, **kw)
                    m = kw.get("model")
                    def on_done(last_chunk: Any) -> None:
                        usage = _extract_stream_usage(last_chunk)
                        if usage:
                            on_response(m, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
                    return _wrap_async_stream(resp, on_done)
                resp = await _orig_async(s, *a, **kw)
                try:
                    _capture_openai(resp, kw)
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in openai AsyncCompletions.create (%s), passing through: %s",
                                   type(exc).__name__, exc)
                    return await _orig_async(s, *a, **kw)
                return resp

            _p._agentmetrics_patched = True  # SDK-02
            _p._agentmetrics_original = _orig_sync
            _pa._agentmetrics_patched = True  # SDK-02
            _pa._agentmetrics_original = _orig_async
            Completions.create = _p
            AsyncCompletions.create = _pa
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for openai: %s", exc)
            return False


def _patch_google(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            import google.generativeai as genai
            # SDK-02: Double-patch guard
            _orig = getattr(genai.GenerativeModel, "generate_content", None)
            if _orig is None or getattr(_orig, _PATCHED_ATTR, False):
                return True

            def _p(s: Any, *a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                resp = _orig(s, *a, **kw)
                try:
                    u = getattr(resp, "usage_metadata", None)
                    m = getattr(s, "model_name", None)
                    if u:
                        on_response(m, getattr(u, "prompt_token_count", 0), getattr(u, "candidates_token_count", 0))
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in google generate_content (%s), passing through: %s",
                                   type(exc).__name__, exc)
                    return _orig(s, *a, **kw)
                return resp

            _p._agentmetrics_patched = True  # SDK-02
            _p._agentmetrics_original = _orig
            genai.GenerativeModel.generate_content = _p
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for google-generativeai: %s", exc)
            return False


def _patch_cohere(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            import cohere
            # SDK-02: Double-patch guard
            _orig = getattr(cohere.Client, "chat", None)
            if _orig is None or getattr(_orig, _PATCHED_ATTR, False):
                return True

            def _p(s: Any, *a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                resp = _orig(s, *a, **kw)
                try:
                    meta = getattr(resp, "meta", None)
                    tokens = getattr(meta, "tokens", None) if meta else None
                    m = kw.get("model", "command-r")
                    if tokens:
                        on_response(m, getattr(tokens, "input_tokens", 0), getattr(tokens, "output_tokens", 0))
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in cohere Client.chat (%s), passing through: %s",
                                   type(exc).__name__, exc)
                    return _orig(s, *a, **kw)
                return resp

            _p._agentmetrics_patched = True  # SDK-02
            _p._agentmetrics_original = _orig
            cohere.Client.chat = _p
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for cohere: %s", exc)
            return False


def _patch_mistral(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            from mistralai.client import MistralClient
            # SDK-02: Double-patch guard
            _orig = getattr(MistralClient, "chat", None)
            if _orig is None or getattr(_orig, _PATCHED_ATTR, False):
                return True

            def _p(s: Any, *a: Any, **kw: Any) -> Any:  # type annotation — wraps arbitrary callable
                resp = _orig(s, *a, **kw)
                try:
                    u = getattr(resp, "usage", None)
                    m = kw.get("model", "mistral-small-latest")
                    if u:
                        on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))
                except (TypeError, AttributeError, RuntimeError) as exc:
                    logger.warning("agentmetrics: patch error in mistral MistralClient.chat (%s), passing through: %s",
                                   type(exc).__name__, exc)
                    return _orig(s, *a, **kw)
                return resp

            _p._agentmetrics_patched = True  # SDK-02
            _p._agentmetrics_original = _orig
            MistralClient.chat = _p
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for mistralai: %s", exc)
            return False


def _patch_langchain(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # LangChain BaseCallbackHandler covers LangGraph + CrewAI + any chain.
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            from langchain_core.callbacks.base import BaseCallbackHandler

            class _CB(BaseCallbackHandler):
                def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # type annotation — wraps arbitrary callable
                    try:
                        for gl in response.generations:
                            for g in gl:
                                info = getattr(g, "generation_info", {}) or {}
                                u = info.get("usage") or {}
                                m = info.get("model_name") or info.get("model")
                                if u:
                                    on_response(m, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                    except (TypeError, AttributeError, RuntimeError) as exc:
                        logger.warning("agentmetrics: patch error in langchain on_llm_end (%s), passing through: %s",
                                       type(exc).__name__, exc)

            from langchain_core.callbacks.manager import get_callback_manager
            try:
                get_callback_manager().add_handler(_CB())
            except (TypeError, AttributeError, RuntimeError) as exc:
                logger.debug("agentmetrics: could not add langchain callback handler: %s", exc)
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for langchain: %s", exc)
            return False


def _patch_llamaindex(on_response: Callable[..., None]) -> bool:  # type annotation — wraps arbitrary callable
    # SEC-J01: Acquire patch lock to prevent race conditions
    with _PATCH_LOCK:
        try:
            from llama_index.core.callbacks.base import CallbackManager
            from llama_index.core.callbacks.base_handler import BaseCallbackHandler as LIH
            from llama_index.core.callbacks.schema import CBEventType, EventPayload

            class _CB(LIH):
                # SDK-03: Typed ClassVar to prevent accidental mutation of the class-level default
                event_starts_to_ignore: ClassVar[list[str]] = []
                event_ends_to_ignore: ClassVar[list[str]] = []

                def on_event_end(self, event_type: Any, payload: Any = None, event_id: str = "", **kwargs: Any) -> None:  # type annotation — wraps arbitrary callable
                    if event_type != CBEventType.LLM:
                        return
                    try:
                        resp = (payload or {}).get(EventPayload.RESPONSE)
                        raw = getattr(resp, "raw", None)
                        u = (raw.get("usage") if raw and hasattr(raw, "get") else None) or {}
                        m = getattr(resp, "additional_kwargs", {}).get("model")
                        if u:
                            on_response(m, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                    except (TypeError, AttributeError, RuntimeError) as exc:
                        logger.warning("agentmetrics: patch error in llamaindex on_event_end (%s), passing through: %s",
                                       type(exc).__name__, exc)

                def start_trace(self, trace_id: str | None = None) -> None:
                    pass

                def end_trace(self, trace_id: str | None = None, trace_map: Any = None) -> None:
                    pass

                def on_event_start(self, event_type: Any, payload: Any = None, event_id: str = "", parent_id: str = "", **kwargs: Any) -> None:  # type annotation — wraps arbitrary callable
                    pass

            from llama_index.core import Settings
            if Settings.callback_manager is None:
                Settings.callback_manager = CallbackManager()
            Settings.callback_manager.add_handler(_CB())
            return True
        except (ImportError, AttributeError) as exc:
            logger.debug("agentmetrics: skipping patch for llama-index: %s", exc)
            return False


def _count_loops(tool_calls: list, threshold: int = _TOOL_LOOP_THRESHOLD) -> int:
    """Count how many loop sequences (threshold identical consecutive tool names) occur."""
    if len(tool_calls) < threshold:
        return 0
    names = [t["name"] for t in tool_calls]
    count = 0
    i = 0
    while i <= len(names) - threshold:
        if len(set(names[i: i + threshold])) == 1:
            count += 1
            i += threshold  # skip past this loop
        else:
            i += 1
    return count


class Tracker:
    def __init__(self) -> None:
        self._api_key: str | None = None
        self._client: HttpClient | None = None
        self._batch: _BatchSender | None = None
        self._environment: str | None = None
        self._sample_rate: float = 1.0
        self._instrumented: bool = False

    def configure(
        self,
        api_key: str = "",
        base_url: str = "http://localhost:8099",
        environment: str | None = None,
        sample_rate: float = 1.0,
        batch_size: int = 20,
        flush_interval: float = 2.0,
        compress: bool = False,
        scrub_fn: Callable[[dict], dict] | None = None,
    ) -> None:
        global _scrub_fn
        if self._client is not None:
            logger.warning("agentmetrics: configure() called more than once; overwriting previous configuration")
        self._api_key = api_key or None
        self._environment = environment
        self._sample_rate = max(0.0, min(1.0, sample_rate))
        self._client = HttpClient(api_key=api_key, base_url=base_url, compress=compress)
        self._batch = _BatchSender(self._client, max_size=batch_size, flush_interval=flush_interval)
        # SEC-J02: Register the scrub function hook
        _scrub_fn = scrub_fn

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    def instrument(self) -> None:
        if self._instrumented:
            return
        if not self.is_configured:
            logger.warning("agentmetrics: call configure() before instrument()")
            return
        installed = []
        for fn, name in [
            (_patch_litellm,    "litellm"),
            (_patch_anthropic,  "anthropic"),
            (_patch_openai,     "openai"),
            (_patch_google,     "google-generativeai"),
            (_patch_cohere,     "cohere"),
            (_patch_mistral,    "mistralai"),
            (_patch_langchain,  "langchain"),
            (_patch_llamaindex, "llama-index"),
        ]:
            if fn(self._on_llm_response):
                installed.append(name)
        self._instrumented = True
        if installed:
            logger.debug("agentmetrics: instrumented %s", ", ".join(installed))

    def _on_llm_response(self, model: str | None, input_tokens: int, output_tokens: int, cache_read: int = 0, cache_write: int = 0) -> None:
        tokens = _llm_token_accumulator.get()
        if tokens is not None:
            tokens["model"] = model or tokens.get("model")
            tokens["input_tokens"] = tokens.get("input_tokens", 0) + (input_tokens or 0)
            tokens["output_tokens"] = tokens.get("output_tokens", 0) + (output_tokens or 0)
            tokens["llm_calls"] = tokens.get("llm_calls", 0) + 1
            if cache_read:
                tokens["cache_read_tokens"] = tokens.get("cache_read_tokens", 0) + cache_read
            if cache_write:
                tokens["cache_write_tokens"] = tokens.get("cache_write_tokens", 0) + cache_write

    def track(self, agent_id: str, metadata: dict | None = None) -> Callable[[Any], Any]:  # type annotation — wraps arbitrary callable
        def decorator(func: Any) -> Any:  # type annotation — wraps arbitrary callable
            if asyncio.iscoroutinefunction(func):
                @functools.wraps(func)
                async def async_wrapper(*args: Any, **kwargs: Any) -> Any:  # type annotation — wraps arbitrary callable
                    if not self.is_configured:
                        logger.warning("agentmetrics: configure() was not called before tracking agent '%s'", agent_id)
                        return await func(*args, **kwargs)
                    return await self._run_async(func, agent_id, args, kwargs, metadata)
                return async_wrapper
            else:
                @functools.wraps(func)
                def sync_wrapper(*args: Any, **kwargs: Any) -> Any:  # type annotation — wraps arbitrary callable
                    if not self.is_configured:
                        logger.warning("agentmetrics: configure() was not called before tracking agent '%s'", agent_id)
                        return func(*args, **kwargs)
                    return self._run_sync(func, agent_id, args, kwargs, metadata)
                return sync_wrapper
        return decorator

    def step(self, name: str, step_type: str = "custom", metadata: dict | None = None) -> _StepContext:
        return _StepContext(name, step_type=step_type, metadata=metadata)

    def tool(self, name: str, metadata: dict | None = None) -> _ToolContext:
        return _ToolContext(name, metadata=metadata)

    def score(self, name: str, value: float) -> None:
        scores = _score_accumulator.get()
        if scores is None:
            logger.warning("agentmetrics: score() called outside a tracked function; score '%s' ignored", name)
            return
        scores[name] = value

    def _run_sync(self, func: Any, agent_id: str, args: Any, kwargs: Any, extra_metadata: dict | None) -> Any:  # type annotation — wraps arbitrary callable
        if self._sample_rate < 1.0 and random.random() > self._sample_rate:
            # SDK-06: Log when a run is sampled out so operators know it happened
            _tid = _current_trace_id.get() or "(not yet set)"
            logger.debug(
                "agentmetrics: run sampled out (sample_rate=%.2f, trace_id=%s)",
                self._sample_rate, _tid,
            )
            return func(*args, **kwargs)
        parent_trace_id = _current_trace_id.get()
        trace_id = str(uuid.uuid4())
        t1 = _current_trace_id.set(trace_id)
        t2 = _current_agent_id.set(agent_id)
        steps: list = []
        tools: list = []
        tok_acc: dict = {}
        scores: dict = {}
        t3 = _step_accumulator.set(steps)
        t4 = _tool_call_accumulator.set(tools)
        t5 = _llm_token_accumulator.set(tok_acc)
        t6 = _score_accumulator.set(scores)
        start = time.monotonic()
        status, error_msg = "success", None
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            status, error_msg = "failed", str(exc)
            raise
        finally:
            duration_ms = (time.monotonic() - start) * 1000
            _current_trace_id.reset(t1)
            _current_agent_id.reset(t2)
            _step_accumulator.reset(t3)
            _tool_call_accumulator.reset(t4)
            _llm_token_accumulator.reset(t5)
            _score_accumulator.reset(t6)
            self._send(trace_id, agent_id, status, duration_ms, error_msg, steps, tools, tok_acc, extra_metadata, parent_trace_id=parent_trace_id, scores=scores)

    async def _run_async(self, func: Any, agent_id: str, args: Any, kwargs: Any, extra_metadata: dict | None) -> Any:  # type annotation — wraps arbitrary callable
        if self._sample_rate < 1.0 and random.random() > self._sample_rate:
            # SDK-06: Log when a run is sampled out so operators know it happened
            _tid = _current_trace_id.get() or "(not yet set)"
            logger.debug(
                "agentmetrics: run sampled out (sample_rate=%.2f, trace_id=%s)",
                self._sample_rate, _tid,
            )
            return await func(*args, **kwargs)
        parent_trace_id = _current_trace_id.get()
        trace_id = str(uuid.uuid4())
        t1 = _current_trace_id.set(trace_id)
        t2 = _current_agent_id.set(agent_id)
        steps: list = []
        tools: list = []
        tok_acc: dict = {}
        scores: dict = {}
        t3 = _step_accumulator.set(steps)
        t4 = _tool_call_accumulator.set(tools)
        t5 = _llm_token_accumulator.set(tok_acc)
        t6 = _score_accumulator.set(scores)
        start = time.monotonic()
        status, error_msg = "success", None
        try:
            return await func(*args, **kwargs)
        except Exception as exc:
            status, error_msg = "failed", str(exc)
            raise
        finally:
            duration_ms = (time.monotonic() - start) * 1000
            _current_trace_id.reset(t1)
            _current_agent_id.reset(t2)
            _step_accumulator.reset(t3)
            _tool_call_accumulator.reset(t4)
            _llm_token_accumulator.reset(t5)
            _score_accumulator.reset(t6)
            self._send(trace_id, agent_id, status, duration_ms, error_msg, steps, tools, tok_acc, extra_metadata, parent_trace_id=parent_trace_id, scores=scores)

    def _send(
        self,
        trace_id: str,
        agent_id: str,
        status: str,
        duration_ms: float,
        error_msg: str | None,
        steps: list,
        tool_calls: list,
        tok_acc: dict,
        extra_metadata: dict | None,
        parent_trace_id: str | None = None,
        scores: dict | None = None,
    ) -> None:
        if not self._batch:
            return
        loop_count = _count_loops(tool_calls)

        ev = AgentEndEvent(agent_id=agent_id, platform="python")
        ev.trace_id   = trace_id
        ev.status     = status
        ev.duration_ms = round(duration_ms, 2)
        ev.error       = error_msg
        ev.step_count  = len(steps)
        ev.tool_calls  = len(tool_calls)
        ev.tool_errors = sum(1 for t in tool_calls if t.get("status") == "failed")
        ev.tool_names  = list({t["name"] for t in tool_calls})

        if loop_count:
            ev.loop_count = loop_count
            ev.status = "failed"
            if not error_msg:
                ev.error = "Loop detected: repeated tool calls"
        if parent_trace_id:
            ev.parent_trace_id = parent_trace_id

        if tok_acc:
            ev.model         = tok_acc.get("model")
            ev.input_tokens  = tok_acc.get("input_tokens", 0)
            ev.output_tokens = tok_acc.get("output_tokens", 0)
            ev.llm_calls     = tok_acc.get("llm_calls", 0) or 0
            cr = tok_acc.get("cache_read_tokens", 0)
            cw = tok_acc.get("cache_write_tokens", 0)
            if cr:
                ev.cache_read_tokens = cr
            if cw:
                ev.cache_write_tokens = cw
            ev.estimated_cost_usd = _shared_estimate_cost(
                ev.model or "", ev.input_tokens, ev.output_tokens,
                ev.cache_read_tokens, ev.cache_write_tokens,
            ) or None

        meta: dict[str, Any] = {}
        if self._environment:
            meta["environment"] = self._environment
        if steps:
            meta["steps"] = steps
        if tool_calls:
            meta["tool_calls_detail"] = tool_calls
        if scores:
            meta["scores"] = scores
        if extra_metadata:
            meta.update(extra_metadata)
        if meta:
            ev.metadata = meta

        from agentmetrics import __version__ as _SDK_VERSION
        ev.sdk_version = _SDK_VERSION

        # SEC-J02: Apply scrub function before sending
        self._batch.enqueue(_apply_scrub(ev.to_payload()))

    @property
    def trace_id(self) -> str | None:
        return _current_trace_id.get()

    def flush(self, timeout: float = 10.0) -> None:
        if self._batch:
            self._batch.flush(timeout=timeout)

