from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func, or_, text
from sqlalchemy.orm import Session

from app.db_compat import trunc_day
from app.models.event import Event
from app.schemas.agent import (
    AgentDetail,
    AgentSummary,
    CostByDay,
    CostByModel,
    ErrorSummary,
    LatencyPercentiles,
    RecentRun,
)

# Infrastructure agent IDs that should never appear in the user-facing agents list
_EXCLUDED_AGENTS = {"openclaw-gateway"}

# Exclude session_metrics events from all run-level queries - they are session-boundary
# aggregates emitted by the plugin, not individual agent runs. Without this filter they
# inflate run counts, cost totals, and latency averages.
_NOT_SESSION_METRICS = or_(
    Event.run_metadata.is_(None),
    Event.run_metadata["event_name"].astext.is_(None),
    Event.run_metadata["event_name"].astext != "session_metrics",
)


def _retention_since(org_id: str, db: Session) -> datetime:
    # Self-hosted: no retention limit - return epoch zero so all data is visible
    return datetime.min.replace(tzinfo=UTC)


def get_agents_summary(org_id: str, db: Session, limit: int = 200, offset: int = 0) -> list[AgentSummary]:
    since = _retention_since(org_id, db)
    rows = (
        db.query(
            Event.agent_id,
            func.count(Event.id).label("total_calls"),
            func.sum(case((Event.status == "success", 1), else_=0)).label("successful"),
            func.sum(case((Event.status == "failed", 1), else_=0)).label("failed"),
            func.sum(Event.cost_usd).label("total_cost"),
            func.avg(Event.cost_usd).label("avg_cost"),
            func.max(Event.timestamp).label("last_seen"),
        )
        .filter(Event.org_id == org_id, ~Event.agent_id.in_(_EXCLUDED_AGENTS), Event.timestamp >= since, _NOT_SESSION_METRICS)
        .group_by(Event.agent_id)
        .order_by(func.sum(Event.cost_usd).desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    results = []
    for row in rows:
        total = row.total_calls or 0
        successful = row.successful or 0
        results.append(AgentSummary(
            agent_id=row.agent_id,
            total_calls=total,
            successful=successful,
            failed=row.failed or 0,
            total_cost=round(row.total_cost or 0.0, 6),
            avg_cost=round(row.avg_cost or 0.0, 6),
            success_rate=round((successful / total * 100) if total > 0 else 0.0, 1),
            last_seen=row.last_seen,
        ))
    return results


def _event_to_run(e: "Event") -> RecentRun:
    meta = e.run_metadata or {}
    # Prefer promoted columns; fall back to JSONB for events before migration 012
    def _int(col_val, meta_key: str):
        if col_val is not None:
            return int(col_val)
        v = meta.get(meta_key)
        return int(v) if v is not None else None

    return RecentRun(
        trace_id=e.trace_id,
        status=e.status,
        cost_usd=round(e.cost_usd or 0.0, 6),
        duration_ms=e.duration_ms,
        error_message=e.error_message,
        timestamp=e.timestamp,
        model=e.model,
        input_tokens=int(e.input_tokens) if e.input_tokens is not None else None,
        output_tokens=int(e.output_tokens) if e.output_tokens is not None else None,
        step_count=e.step_count,
        tool_calls=e.tool_calls,
        loop_count=_int(e.loop_count, "loop_count"),
        cache_read_tokens=_int(e.cache_read_tokens, "cache_read_tokens"),
        cache_write_tokens=_int(e.cache_write_tokens, "cache_write_tokens"),
        llm_calls=_int(e.llm_calls, "llm_calls"),
        environment=e.environment,
        version=e.version,
        steps=meta.get("steps") or None,
    )


def get_agent_runs(
    org_id: str, agent_id: str, db: Session, limit: int = 50, offset: int = 0
) -> tuple[list[RecentRun], int]:
    since = _retention_since(org_id, db)
    total = db.query(func.count(Event.id)).filter(
        Event.org_id == org_id, Event.agent_id == agent_id, Event.timestamp >= since, _NOT_SESSION_METRICS
    ).scalar() or 0

    events = (
        db.query(Event)
        .filter(Event.org_id == org_id, Event.agent_id == agent_id, Event.timestamp >= since, _NOT_SESSION_METRICS)
        .order_by(Event.timestamp.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return [_event_to_run(e) for e in events], total


def _percentiles(db: Session, org_id: str, agent_id: str, since: datetime) -> tuple:
    """Fetch p50/p95/p99 in a single query instead of three separate round-trips."""
    row = db.execute(
        text(
            "SELECT "
            "  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms), "
            "  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), "
            "  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) "
            "FROM events WHERE org_id = :org_id AND agent_id = :agent_id "
            "AND duration_ms IS NOT NULL AND timestamp >= :since "
            "AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL "
            "     OR run_metadata->>'event_name' != 'session_metrics')"
        ),
        {"org_id": str(org_id), "agent_id": agent_id, "since": since},
    ).fetchone()
    def _r(v):
        return round(float(v), 2) if v is not None else None
    return (_r(row[0]), _r(row[1]), _r(row[2])) if row else (None, None, None)


def get_agent_detail(org_id: str, agent_id: str, db: Session) -> AgentDetail | None:
    since = _retention_since(org_id, db)
    # Summary stats
    row = (
        db.query(
            func.count(Event.id).label("total_calls"),
            func.sum(case((Event.status == "success", 1), else_=0)).label("successful"),
            func.sum(case((Event.status == "failed", 1), else_=0)).label("failed"),
            func.sum(Event.cost_usd).label("total_cost"),
            func.avg(Event.cost_usd).label("avg_cost"),
            func.avg(Event.duration_ms).label("avg_duration"),
            func.max(Event.timestamp).label("last_seen"),
        )
        .filter(Event.org_id == org_id, Event.agent_id == agent_id, Event.timestamp >= since, _NOT_SESSION_METRICS)
        .first()
    )

    if not row or not row.total_calls:
        return None

    total = row.total_calls or 0
    successful = row.successful or 0

    # Latency percentiles - single query for all three
    p50, p95, p99 = _percentiles(db, org_id, agent_id, since)
    latency = LatencyPercentiles(
        p50=p50, p95=p95, p99=p99,
        avg=round(float(row.avg_duration), 2) if row.avg_duration else None,
    )

    # Cost by day (last 30 days, capped by plan retention)
    thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
    cost_since = max(since, thirty_days_ago)
    daily_rows = (
        db.query(
            trunc_day(Event.timestamp).label("day"),
            func.sum(Event.cost_usd).label("cost"),
            func.count(Event.id).label("calls"),
        )
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.timestamp >= cost_since,
            _NOT_SESSION_METRICS,
        )
        .group_by(trunc_day(Event.timestamp))
        .order_by(text("day"))
        .all()
    )
    cost_by_day = [
        CostByDay(date=str(r.day)[:10], cost=round(r.cost or 0.0, 6), calls=r.calls)
        for r in daily_rows
    ]

    # Cost by model
    model_rows = (
        db.query(
            Event.model,
            func.sum(Event.cost_usd).label("cost"),
            func.count(Event.id).label("calls"),
            func.sum(Event.input_tokens).label("input_tokens"),
            func.sum(Event.output_tokens).label("output_tokens"),
        )
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.model.isnot(None),
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .group_by(Event.model)
        .order_by(func.sum(Event.cost_usd).desc())
        .all()
    )
    cost_by_model = [
        CostByModel(
            model=r.model,
            cost_usd=round(r.cost or 0.0, 6),
            calls=r.calls,
            input_tokens=int(r.input_tokens or 0),
            output_tokens=int(r.output_tokens or 0),
        )
        for r in model_rows
    ]

    # MTTR: avg gap (ms) between a failure and the following success
    mttr_result = db.execute(
        text("""
            WITH ordered AS (
                SELECT status, timestamp,
                       LAG(status)    OVER (ORDER BY timestamp) AS prev_status,
                       LAG(timestamp) OVER (ORDER BY timestamp) AS prev_ts
                FROM events
                WHERE org_id = :org_id AND agent_id = :agent_id
                  AND timestamp >= :since
                  AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
            )
            SELECT AVG(EXTRACT(EPOCH FROM (timestamp - prev_ts)) * 1000)
            FROM ordered
            WHERE status = 'success' AND prev_status = 'failed'
        """),
        {"org_id": str(org_id), "agent_id": agent_id, "since": since},
    ).scalar()
    mttr_ms = round(float(mttr_result), 2) if mttr_result is not None else None

    # Recent runs (last 20)
    recent_events = (
        db.query(Event)
        .filter(Event.org_id == org_id, Event.agent_id == agent_id, Event.timestamp >= since, _NOT_SESSION_METRICS)
        .order_by(Event.timestamp.desc())
        .limit(20)
        .all()
    )
    recent_runs = [_event_to_run(e) for e in recent_events]

    # Top errors
    error_rows = (
        db.query(Event.error_message, func.count(Event.id).label("count"))
        .filter(
            Event.org_id == org_id,
            Event.agent_id == agent_id,
            Event.status == "failed",
            Event.error_message.isnot(None),
            Event.timestamp >= since,
            _NOT_SESSION_METRICS,
        )
        .group_by(Event.error_message)
        .order_by(func.count(Event.id).desc())
        .limit(5)
        .all()
    )
    top_errors = [ErrorSummary(error_message=r.error_message, count=r.count) for r in error_rows]

    # Aggregate v2 promoted columns + JSONB fallback for pre-migration events
    meta_row = db.execute(text("""
        SELECT
            COALESCE(SUM(COALESCE(llm_calls,         (run_metadata->>'llm_calls')::int)),         0) AS llm_calls,
            COALESCE(SUM(COALESCE(subagents_spawned, (run_metadata->>'subagents_spawned')::int)),  0) AS subagents_spawned,
            COALESCE(SUM(COALESCE(compactions,       (run_metadata->>'compactions')::int)),        0) AS compactions,
            COALESCE(SUM(COALESCE(resets,            (run_metadata->>'resets')::int)),             0) AS resets,
            COALESCE(SUM(input_tokens::int),                                                       0) AS input_tokens,
            COALESCE(SUM(output_tokens::int),                                                      0) AS output_tokens,
            COALESCE(SUM(COALESCE(cache_read_tokens,  (run_metadata->>'cache_read_tokens')::int)), 0) AS cache_read_tokens,
            COALESCE(SUM(COALESCE(cache_write_tokens, (run_metadata->>'cache_write_tokens')::int)),0) AS cache_write_tokens,
            COALESCE(SUM(tool_calls),                                                              0) AS tool_calls,
            COALESCE(SUM(COALESCE(tool_errors,        (run_metadata->>'tool_errors')::int)),       0) AS tool_errors
        FROM events
        WHERE org_id = :org_id AND agent_id = :agent_id
          AND timestamp >= :since
          AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')
    """), {"org_id": str(org_id), "agent_id": agent_id, "since": since}).fetchone()

    # Aggregate top tools from tool_names JSON arrays in run_metadata
    tool_name_rows = db.execute(text("""
        SELECT tool_name, COUNT(*) AS cnt
        FROM events,
             jsonb_array_elements_text(run_metadata->'tool_names') AS tool_name
        WHERE org_id = :org_id AND agent_id = :agent_id
          AND run_metadata ? 'tool_names'
          AND timestamp >= :since
        GROUP BY tool_name
        ORDER BY cnt DESC
        LIMIT 10
    """), {"org_id": str(org_id), "agent_id": agent_id, "since": since}).fetchall()
    top_tools = [r[0] for r in tool_name_rows]

    return AgentDetail(
        agent_id=agent_id,
        total_calls=total,
        successful=successful,
        failed=row.failed or 0,
        total_cost=round(row.total_cost or 0.0, 6),
        avg_cost=round(row.avg_cost or 0.0, 6),
        success_rate=round((successful / total * 100) if total > 0 else 0.0, 1),
        last_seen=row.last_seen,
        latency=latency,
        avg_duration_ms=round(float(row.avg_duration), 2) if row.avg_duration else None,
        cost_by_day=cost_by_day,
        cost_by_model=cost_by_model,
        mttr_ms=mttr_ms,
        recent_runs=recent_runs,
        top_errors=top_errors,
        total_input_tokens=int(meta_row.input_tokens or 0) if meta_row else 0,
        total_output_tokens=int(meta_row.output_tokens or 0) if meta_row else 0,
        total_cache_read_tokens=int(meta_row.cache_read_tokens or 0) if meta_row else 0,
        total_cache_write_tokens=int(meta_row.cache_write_tokens or 0) if meta_row else 0,
        total_llm_calls=int(meta_row.llm_calls or 0) if meta_row else 0,
        total_tool_calls=int(meta_row.tool_calls or 0) if meta_row else 0,
        total_tool_errors=int(meta_row.tool_errors or 0) if meta_row else 0,
        total_subagents_spawned=int(meta_row.subagents_spawned or 0) if meta_row else 0,
        total_compactions=int(meta_row.compactions or 0) if meta_row else 0,
        total_resets=int(meta_row.resets or 0) if meta_row else 0,
        top_tools=top_tools,
    )
