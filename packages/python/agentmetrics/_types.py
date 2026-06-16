"""Shared types for AgentMetrics SDK."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TokenUsage:
    """Normalised token counts across all LLM providers."""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    total_tokens: int | None = None

    def to_payload(self) -> dict:
        d: dict = {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
        }
        if self.cache_read_tokens is not None:
            d["cache_read_tokens"] = self.cache_read_tokens
        if self.cache_write_tokens is not None:
            d["cache_write_tokens"] = self.cache_write_tokens
        if self.total_tokens is not None:
            d["total_tokens"] = self.total_tokens
        return d

    @classmethod
    def from_openai(cls, usage) -> TokenUsage:
        """Parse OpenAI usage object or dict."""
        if isinstance(usage, dict):
            details = usage.get("prompt_tokens_details") or {}
            return cls(
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
                total_tokens=usage.get("total_tokens"),
                cache_read_tokens=details.get("cached_tokens"),
            )
        return cls(
            input_tokens=getattr(usage, "prompt_tokens", 0),
            output_tokens=getattr(usage, "completion_tokens", 0),
            total_tokens=getattr(usage, "total_tokens", None),
            cache_read_tokens=getattr(
                getattr(usage, "prompt_tokens_details", None), "cached_tokens", None
            ),
        )

    @classmethod
    def from_anthropic(cls, usage) -> TokenUsage:
        """Parse Anthropic usage object or dict."""
        if isinstance(usage, dict):
            return cls(
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
                cache_read_tokens=usage.get("cache_read_input_tokens"),
                cache_write_tokens=usage.get("cache_creation_input_tokens"),
            )
        return cls(
            input_tokens=getattr(usage, "input_tokens", 0),
            output_tokens=getattr(usage, "output_tokens", 0),
            cache_read_tokens=getattr(usage, "cache_read_input_tokens", None),
            cache_write_tokens=getattr(usage, "cache_creation_input_tokens", None),
        )
