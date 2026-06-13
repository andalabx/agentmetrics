import asyncio
import functools
import logging
import random
import threading
import time
import uuid
from contextvars import ContextVar
from typing import Any, Optional

from agentmetrics.http_client import HttpClient

logger = logging.getLogger("agentmetrics")

# (input, output, cacheRead, cacheWrite) - cost per million tokens
_PRICING: dict[str, tuple] = {
    "claude-opus-4-7":                  (15.0,  75.0,  1.50,  18.75),
    "claude-sonnet-4-6":                (3.0,   15.0,  0.30,  3.75),
    "claude-haiku-4-5":                 (0.8,   4.0,   0.08,  1.00),
    "claude-haiku-4-5-20251001":        (0.8,   4.0,   0.08,  1.00),
    "claude-3-7-sonnet-20250219":       (3.0,   15.0,  0.30,  3.75),
    "claude-3-5-sonnet-20241022":       (3.0,   15.0,  0.30,  3.75),
    "claude-3-5-haiku-20241022":        (0.8,   4.0,   0.08,  1.00),
    "claude-3-opus-20240229":           (15.0,  75.0,  1.50,  18.75),
    "claude-3-sonnet-20240229":         (3.0,   15.0,  0.30,  3.75),
    "claude-3-haiku-20240307":          (0.25,  1.25,  0.03,  0.30),
    "gpt-4o":                           (2.5,   10.0),
    "gpt-4o-mini":                      (0.15,  0.60),
    "gpt-4-turbo":                      (10.0,  30.0),
    "gpt-4":                            (30.0,  60.0),
    "gpt-3.5-turbo":                    (0.50,  1.50),
    "o1":                               (15.0,  60.0),
    "o1-mini":                          (3.0,   12.0),
    "o3-mini":                          (1.10,  4.40),
    "gemini-2.0-flash":                 (0.075, 0.30),
    "gemini-2.0-flash-lite":            (0.075, 0.30),
    "gemini-1.5-pro":                   (1.25,  5.00),
    "gemini-1.5-flash":                 (0.075, 0.30),
}


def _estimate_cost(
    model: Optional[str],
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> Optional[float]:
    if not model:
        return None
    rates = _PRICING.get(model)
    if not rates:
        # Try prefix match (e.g. "claude-sonnet-4-6-20260101" → "claude-sonnet-4-6")
        for key, r in _PRICING.items():
            if model.startswith(key):
                rates = r
                break
    if not rates:
        return None
    r_in, r_out = rates[0], rates[1]
    r_cr = rates[2] if len(rates) > 2 else 0.0
    r_cw = rates[3] if len(rates) > 3 else 0.0
    cost = (
        input_tokens       * r_in  / 1_000_000
        + output_tokens    * r_out / 1_000_000
        + cache_read_tokens  * r_cr  / 1_000_000
        + cache_write_tokens * r_cw  / 1_000_000
    )
    return round(cost, 8)


_current_trace_id: ContextVar[Optional[str]] = ContextVar("agentmetrics_trace_id", default=None)
_current_agent_id: ContextVar[Optional[str]] = ContextVar("agentmetrics_agent_id", default=None)
_step_accumulator: ContextVar[Optional[list]] = ContextVar("agentmetrics_steps", default=None)
_tool_call_accumulator: ContextVar[Optional[list]] = ContextVar("agentmetrics_tools", default=None)
_llm_token_accumulator: ContextVar[Optional[dict]] = ContextVar("agentmetrics_tokens", default=None)
_score_accumulator: ContextVar[Optional[dict]] = ContextVar("agentmetrics_scores", default=None)


class _BatchSender:
    def __init__(self, client: "HttpClient", max_size: int = 20, flush_interval: float = 2.0):
        self._client = client
        self._max_size = max_size
        self._flush_interval = flush_interval
        self._queue: list[dict] = []
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
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
    def __init__(self, name: str, step_type: str = "custom", metadata: Optional[dict] = None):
        self.name = name
        self.step_type = step_type
        self.metadata = metadata or {}
        self._start: float = 0.0
        self.status = "success"
        self.error: Optional[str] = None

    def __enter__(self):
        self._start = time.monotonic()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
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

    async def __aenter__(self):
        return self.__enter__()

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return self.__exit__(exc_type, exc_val, exc_tb)


class _ToolContext:
    def __init__(self, name: str, metadata: Optional[dict] = None):
        self.name = name
        self.metadata = metadata or {}
        self._start: float = 0.0
        self.status = "success"
        self.error: Optional[str] = None

    def __enter__(self):
        self._start = time.monotonic()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
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

    async def __aenter__(self):
        return self.__enter__()

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return self.__exit__(exc_type, exc_val, exc_tb)


# ---------------------------------------------------------------------------
# Auto-instrumentation patches - each returns True if the library is installed
# ---------------------------------------------------------------------------

def _patch_litellm(on_response):
    try:
        import litellm
        _orig_c = litellm.completion
        _orig_a = litellm.acompletion

        def _pc(*a, **kw):
            resp = _orig_c(*a, **kw)
            try:
                u = getattr(resp, "usage", None)
                m = getattr(resp, "model", kw.get("model"))
                if u:
                    on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))
            except Exception:
                pass
            return resp

        async def _pa(*a, **kw):
            resp = await _orig_a(*a, **kw)
            try:
                u = getattr(resp, "usage", None)
                m = getattr(resp, "model", kw.get("model"))
                if u:
                    on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))
            except Exception:
                pass
            return resp

        litellm.completion = _pc
        litellm.acompletion = _pa
        return True
    except ImportError:
        return False


def _patch_anthropic(on_response):
    try:
        from anthropic.resources.messages import Messages
        from anthropic.resources.messages import AsyncMessages
        _orig_sync = Messages.create
        _orig_async = AsyncMessages.create

        def _capture_anthropic(resp, kw):
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

        def _p(s, *a, **kw):
            if kw.get("stream"):
                return _orig_sync(s, *a, **kw)
            resp = _orig_sync(s, *a, **kw)
            try:
                _capture_anthropic(resp, kw)
            except Exception:
                pass
            return resp

        async def _pa(s, *a, **kw):
            if kw.get("stream"):
                return await _orig_async(s, *a, **kw)
            resp = await _orig_async(s, *a, **kw)
            try:
                _capture_anthropic(resp, kw)
            except Exception:
                pass
            return resp

        Messages.create = _p
        AsyncMessages.create = _pa
        return True
    except (ImportError, AttributeError):
        return False


def _patch_openai(on_response):
    # Covers OpenAI, Azure OpenAI, Groq, Together AI (all use openai SDK).
    try:
        from openai.resources.chat.completions import Completions, AsyncCompletions
        _orig_sync = Completions.create
        _orig_async = AsyncCompletions.create

        def _capture_openai(resp, kw):
            u = getattr(resp, "usage", None)
            m = getattr(resp, "model", kw.get("model"))
            if u:
                on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))

        def _p(s, *a, **kw):
            if kw.get("stream"):
                return _orig_sync(s, *a, **kw)
            resp = _orig_sync(s, *a, **kw)
            try:
                _capture_openai(resp, kw)
            except Exception:
                pass
            return resp

        async def _pa(s, *a, **kw):
            if kw.get("stream"):
                return await _orig_async(s, *a, **kw)
            resp = await _orig_async(s, *a, **kw)
            try:
                _capture_openai(resp, kw)
            except Exception:
                pass
            return resp

        Completions.create = _p
        AsyncCompletions.create = _pa
        return True
    except (ImportError, AttributeError):
        return False


def _patch_google(on_response):
    try:
        import google.generativeai as genai
        _orig = genai.GenerativeModel.generate_content

        def _p(s, *a, **kw):
            resp = _orig(s, *a, **kw)
            try:
                u = getattr(resp, "usage_metadata", None)
                m = getattr(s, "model_name", None)
                if u:
                    on_response(m, getattr(u, "prompt_token_count", 0), getattr(u, "candidates_token_count", 0))
            except Exception:
                pass
            return resp

        genai.GenerativeModel.generate_content = _p
        return True
    except (ImportError, AttributeError):
        return False


def _patch_cohere(on_response):
    try:
        import cohere
        _orig = cohere.Client.chat

        def _p(s, *a, **kw):
            resp = _orig(s, *a, **kw)
            try:
                meta = getattr(resp, "meta", None)
                tokens = getattr(meta, "tokens", None) if meta else None
                m = kw.get("model", "command-r")
                if tokens:
                    on_response(m, getattr(tokens, "input_tokens", 0), getattr(tokens, "output_tokens", 0))
            except Exception:
                pass
            return resp

        cohere.Client.chat = _p
        return True
    except (ImportError, AttributeError):
        return False


def _patch_mistral(on_response):
    try:
        from mistralai.client import MistralClient
        _orig = MistralClient.chat

        def _p(s, *a, **kw):
            resp = _orig(s, *a, **kw)
            try:
                u = getattr(resp, "usage", None)
                m = kw.get("model", "mistral-small-latest")
                if u:
                    on_response(m, getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0))
            except Exception:
                pass
            return resp

        MistralClient.chat = _p
        return True
    except (ImportError, AttributeError):
        return False


def _patch_langchain(on_response):
    # LangChain BaseCallbackHandler covers LangGraph + CrewAI + any chain.
    try:
        from langchain_core.callbacks.base import BaseCallbackHandler

        class _CB(BaseCallbackHandler):
            def on_llm_end(self, response, **kwargs):
                try:
                    for gl in response.generations:
                        for g in gl:
                            info = getattr(g, "generation_info", {}) or {}
                            u = info.get("usage") or {}
                            m = info.get("model_name") or info.get("model")
                            if u:
                                on_response(m, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                except Exception:
                    pass

        from langchain_core.callbacks.manager import get_callback_manager
        try:
            get_callback_manager().add_handler(_CB())
        except Exception:
            pass
        return True
    except (ImportError, AttributeError):
        return False


def _patch_llamaindex(on_response):
    try:
        from llama_index.core.callbacks.base import CallbackManager
        from llama_index.core.callbacks.schema import CBEventType, EventPayload
        from llama_index.core.callbacks.base_handler import BaseCallbackHandler as LIH

        class _CB(LIH):
            event_starts_to_ignore: list = []
            event_ends_to_ignore: list = []

            def on_event_end(self, event_type, payload=None, event_id="", **kwargs):
                if event_type != CBEventType.LLM:
                    return
                try:
                    resp = (payload or {}).get(EventPayload.RESPONSE)
                    raw = getattr(resp, "raw", None)
                    u = (raw.get("usage") if raw and hasattr(raw, "get") else None) or {}
                    m = getattr(resp, "additional_kwargs", {}).get("model")
                    if u:
                        on_response(m, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                except Exception:
                    pass

            def start_trace(self, trace_id=None):
                pass

            def end_trace(self, trace_id=None, trace_map=None):
                pass

            def on_event_start(self, event_type, payload=None, event_id="", parent_id="", **kwargs):
                pass

        from llama_index.core import Settings
        if Settings.callback_manager is None:
            Settings.callback_manager = CallbackManager()
        Settings.callback_manager.add_handler(_CB())
        return True
    except (ImportError, AttributeError):
        return False


def _count_loops(tool_calls: list, threshold: int = 3) -> int:
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


# ---------------------------------------------------------------------------
# Main Tracker class
# ---------------------------------------------------------------------------

class Tracker:
    def __init__(self):
        self._api_key: Optional[str] = None
        self._client: Optional[HttpClient] = None
        self._batch: Optional[_BatchSender] = None
        self._environment: Optional[str] = None
        self._sample_rate: float = 1.0
        self._instrumented: bool = False

    def configure(
        self,
        api_key: str = "",
        base_url: str = "http://localhost:8099",
        environment: Optional[str] = None,
        sample_rate: float = 1.0,
        batch_size: int = 20,
        flush_interval: float = 2.0,
        compress: bool = False,
    ) -> None:
        if self._client is not None:
            logger.warning("agentmetrics: configure() called more than once; overwriting previous configuration")
        self._api_key = api_key or None
        self._environment = environment
        self._sample_rate = max(0.0, min(1.0, sample_rate))
        self._client = HttpClient(api_key=api_key, base_url=base_url, compress=compress)
        self._batch = _BatchSender(self._client, max_size=batch_size, flush_interval=flush_interval)

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

    def _on_llm_response(self, model: Optional[str], input_tokens: int, output_tokens: int, cache_read: int = 0, cache_write: int = 0) -> None:
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

    def track(self, agent_id: str, metadata: Optional[dict] = None):
        def decorator(func):
            if asyncio.iscoroutinefunction(func):
                @functools.wraps(func)
                async def async_wrapper(*args, **kwargs):
                    if not self.is_configured:
                        logger.warning("agentmetrics: configure() was not called before tracking agent '%s'", agent_id)
                        return await func(*args, **kwargs)
                    return await self._run_async(func, agent_id, args, kwargs, metadata)
                return async_wrapper
            else:
                @functools.wraps(func)
                def sync_wrapper(*args, **kwargs):
                    if not self.is_configured:
                        logger.warning("agentmetrics: configure() was not called before tracking agent '%s'", agent_id)
                        return func(*args, **kwargs)
                    return self._run_sync(func, agent_id, args, kwargs, metadata)
                return sync_wrapper
        return decorator

    def step(self, name: str, step_type: str = "custom", metadata: Optional[dict] = None) -> _StepContext:
        return _StepContext(name, step_type=step_type, metadata=metadata)

    def tool(self, name: str, metadata: Optional[dict] = None) -> _ToolContext:
        return _ToolContext(name, metadata=metadata)

    def score(self, name: str, value: float) -> None:
        scores = _score_accumulator.get()
        if scores is None:
            logger.warning("agentmetrics: score() called outside a tracked function; score '%s' ignored", name)
            return
        scores[name] = value

    def _run_sync(self, func, agent_id: str, args, kwargs, extra_metadata):
        if self._sample_rate < 1.0 and random.random() > self._sample_rate:
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

    async def _run_async(self, func, agent_id: str, args, kwargs, extra_metadata):
        if self._sample_rate < 1.0 and random.random() > self._sample_rate:
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
        error_msg: Optional[str],
        steps: list,
        tool_calls: list,
        tok_acc: dict,
        extra_metadata: Optional[dict],
        parent_trace_id: Optional[str] = None,
        scores: Optional[dict] = None,
    ) -> None:
        if not self._batch:
            return
        import time as _time
        loop_count = _count_loops(tool_calls)
        tool_names = list({t["name"] for t in tool_calls})
        tool_errors = sum(1 for t in tool_calls if t.get("status") == "failed")
        payload: dict[str, Any] = {
            # v2 identity fields
            "event_id":                 str(uuid.uuid4()),
            "trace_id":                 trace_id,
            "agent_id":                 agent_id,
            "platform":                 "python",
            "event_name":               "agent_end",
            "ts":                       int(_time.time() * 1000),
            "redaction_policy_version": "v1-strict",
            # run data
            "status":       status,
            "duration_ms":  round(duration_ms, 2),
            "error":        error_msg,
            "step_count":   len(steps),
            "tool_calls":   len(tool_calls),
            "tool_errors":  tool_errors,
            "tool_names":   tool_names,
        }
        if loop_count:
            payload["loop_count"] = loop_count
            payload["status"] = "failed"
            if not error_msg:
                payload["error"] = "Loop detected: repeated tool calls"
        if parent_trace_id:
            payload["parent_trace_id"] = parent_trace_id
        if self._environment:
            payload["environment"] = self._environment
        if tok_acc:
            model = tok_acc.get("model")
            input_tok   = tok_acc.get("input_tokens", 0)
            output_tok  = tok_acc.get("output_tokens", 0)
            cr_tok      = tok_acc.get("cache_read_tokens", 0)
            cw_tok      = tok_acc.get("cache_write_tokens", 0)
            payload["model"]         = model
            payload["input_tokens"]  = input_tok
            payload["output_tokens"] = output_tok
            if tok_acc.get("llm_calls"):
                payload["llm_calls"] = tok_acc["llm_calls"]
            if cr_tok:
                payload["cache_read_tokens"] = cr_tok
            if cw_tok:
                payload["cache_write_tokens"] = cw_tok
            est = _estimate_cost(model, input_tok, output_tok, cr_tok, cw_tok)
            if est is not None:
                payload["estimated_cost_usd"] = est
        metadata: dict[str, Any] = {}
        if steps:
            metadata["steps"] = steps
        if tool_calls:
            metadata["tool_calls_detail"] = tool_calls
        if scores:
            metadata["scores"] = scores
        if extra_metadata:
            metadata.update(extra_metadata)
        if metadata:
            payload["metadata"] = metadata
        self._batch.enqueue(payload)

    @property
    def trace_id(self) -> Optional[str]:
        return _current_trace_id.get()

    def flush(self, timeout: float = 10.0) -> None:
        if self._batch:
            self._batch.flush(timeout=timeout)

