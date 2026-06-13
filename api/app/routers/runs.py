"""
Individual run detail endpoint - exposes a single event by trace_id.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_org_from_jwt
from app.models.organization import Organization

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs", tags=["runs"])

@router.get("/{trace_id}")
def get_run(
    trace_id: str,
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
):
    """Full detail for a single run by trace_id."""
    org_id = str(org.id)

    row = db.execute(text("""
        SELECT
            id, trace_id, agent_id, status, duration_ms,
            cost_usd, model, input_tokens, output_tokens,
            error_message, step_count, tool_calls,
            environment, version, timestamp,
            run_metadata,
            loop_count, cache_read_tokens, cache_write_tokens,
            llm_calls, subagents_spawned, subagent_errors,
            compactions, resets, images_count, tool_errors, total_tokens
        FROM events
        WHERE org_id = :org_id AND trace_id = :trace_id
        ORDER BY timestamp DESC
        LIMIT 1
    """), {"org_id": org_id, "trace_id": trace_id}).mappings().fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Run '{trace_id}' not found")

    r = dict(row)

    metadata = r.get("run_metadata") or {}
    parent_trace_id = metadata.get("parent_trace_id")
    llm_calls_meta  = metadata.get("llm_calls") or r.get("llm_calls")

    # Fields promoted from JSONB to top-level in v2 schema
    _promoted = {
        "parent_trace_id", "cache_read_tokens", "cache_write_tokens",
        "llm_calls", "subagents_spawned", "compactions", "resets", "images_count",
        "tool_errors", "subagent_errors", "platform", "tool_names",
        "redaction_policy_version", "session_id", "run_id", "event_id",
        "event_name", "ts", "estimated_cost_usd",
    }

    result = {
        "id":                       str(r["id"]),
        "trace_id":                 r["trace_id"],
        "agent_id":                 r["agent_id"],
        "status":                   r["status"],
        "duration_ms":              r["duration_ms"],
        "cost_usd":                 float(r["cost_usd"] or 0),
        "model":                    r["model"],
        "input_tokens":             r["input_tokens"],
        "output_tokens":            r["output_tokens"],
        "error_message":            r["error_message"],
        "step_count":               r["step_count"],
        "tool_calls":               r["tool_calls"],
        "environment":              r["environment"],
        "version":                  r["version"],
        "timestamp":                r["timestamp"].isoformat() if r["timestamp"] else None,
        # v2 promoted columns (fall back to JSONB for events before migration 012)
        "loop_count":               r.get("loop_count"),
        "cache_read_tokens":        r.get("cache_read_tokens") or metadata.get("cache_read_tokens"),
        "cache_write_tokens":       r.get("cache_write_tokens") or metadata.get("cache_write_tokens"),
        "total_tokens":             r.get("total_tokens") or metadata.get("total_tokens"),
        "llm_calls":                r.get("llm_calls") or llm_calls_meta,
        "subagents_spawned":        r.get("subagents_spawned") or metadata.get("subagents_spawned"),
        "subagent_errors":          r.get("subagent_errors") or metadata.get("subagent_errors"),
        "compactions":              r.get("compactions") or metadata.get("compactions"),
        "resets":                   r.get("resets") or metadata.get("resets"),
        "images_count":             r.get("images_count") or metadata.get("images_count"),
        "tool_errors":              r.get("tool_errors") or metadata.get("tool_errors"),
        "parent_trace_id":          parent_trace_id,
        # v2 schema fields still in JSONB only
        "platform":                 metadata.get("platform"),
        "tool_names":               metadata.get("tool_names"),
        "redaction_policy_version": metadata.get("redaction_policy_version"),
        "session_id":               metadata.get("session_id"),
        "run_id":                   metadata.get("run_id"),
        "event_name":               metadata.get("event_name"),
        "estimated_cost_usd":       float(metadata["estimated_cost_usd"]) if metadata.get("estimated_cost_usd") is not None else None,
        "metadata":                 {k: v for k, v in metadata.items() if k not in _promoted},
    }
    return result
