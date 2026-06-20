from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import IS_SQLITE, get_db
from app.deps import get_current_org_from_api_key, get_current_org_from_jwt
from app.models.metrics import InfraMetric
from app.models.organization import Organization

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/infra", tags=["infra"])


class InfraMetricCreate(BaseModel):
    host_id: str = Field(..., max_length=255)
    agent_id: str | None = Field(None, max_length=255)
    ts: int  # Unix ms
    cpu_pct: float | None = Field(None, ge=0, le=100)
    mem_used_mb: float | None = Field(None, ge=0)
    mem_total_mb: float | None = Field(None, ge=0)
    disk_used_pct: float | None = Field(None, ge=0, le=100)
    net_rx_kbps: float | None = Field(None, ge=0)
    net_tx_kbps: float | None = Field(None, ge=0)
    custom: dict[str, Any] | None = None

    @field_validator("custom")
    @classmethod
    def cap_custom_size(cls, v: dict | None) -> dict | None:
        if v is not None and len(json.dumps(v)) > 65_536:
            raise ValueError("custom must be 64 KB or smaller")
        return v


class InfraMetricBatch(BaseModel):
    metrics: list[InfraMetricCreate] = Field(..., min_length=1, max_length=500)


@router.post("/metrics")
def ingest_infra_metrics(
    body: InfraMetricBatch,
    org: Organization = Depends(get_current_org_from_api_key),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Accept a batch of host infrastructure metrics."""
    rows = []
    for m in body.metrics:
        row = InfraMetric(
            id=uuid.uuid4(),
            org_id=org.id,
            host_id=m.host_id,
            agent_id=m.agent_id,
            ts=datetime.fromtimestamp(m.ts / 1000, tz=UTC),
            cpu_pct=m.cpu_pct,
            mem_used_mb=m.mem_used_mb,
            mem_total_mb=m.mem_total_mb,
            disk_used_pct=m.disk_used_pct,
            net_rx_kbps=m.net_rx_kbps,
            net_tx_kbps=m.net_tx_kbps,
            custom=m.custom,
        )
        rows.append(row)
    db.add_all(rows)
    db.commit()
    return {"accepted": len(rows)}


@router.get("/metrics")
def get_infra_metrics(
    host_id: str = Query(...),
    window_hours: int = Query(1, ge=1, le=168),
    limit: int = Query(500, ge=1, le=5000),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return infra metrics for a host over the given window."""
    from datetime import timedelta

    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    try:
        rows = (
            db.query(InfraMetric)
            .filter(
                InfraMetric.org_id == org.id,
                InfraMetric.host_id == host_id,
                InfraMetric.ts >= cutoff,
            )
            .order_by(InfraMetric.ts.asc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": str(r.id),
                "org_id": str(r.org_id),
                "host_id": r.host_id,
                "agent_id": r.agent_id,
                "ts": r.ts.isoformat() if r.ts else None,
                "received_at": r.received_at.isoformat() if r.received_at else None,
                "cpu_pct": r.cpu_pct,
                "mem_used_mb": r.mem_used_mb,
                "mem_total_mb": r.mem_total_mb,
                "disk_used_pct": r.disk_used_pct,
                "net_rx_kbps": r.net_rx_kbps,
                "net_tx_kbps": r.net_tx_kbps,
                "custom": r.custom,
            }
            for r in rows
        ]
    except Exception:
        db.rollback()
        logger.exception("[infra] get_infra_metrics failed for org %s host %s", org.id, host_id)
        return []


@router.get("/hosts")
def get_infra_hosts(
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return distinct host_ids with last_seen and metric_count."""
    org_id = str(org.id)
    try:
        if IS_SQLITE:
            from sqlalchemy import func

            rows = (
                db.query(
                    InfraMetric.host_id,
                    func.max(InfraMetric.ts).label("last_seen"),
                    func.count(InfraMetric.id).label("metric_count"),
                )
                .filter(InfraMetric.org_id == org.id)
                .group_by(InfraMetric.host_id)
                .order_by(func.max(InfraMetric.ts).desc())
                .all()
            )
            return [
                {
                    "host_id": r.host_id,
                    "last_seen": r.last_seen.isoformat() if r.last_seen else None,
                    "metric_count": int(r.metric_count),
                }
                for r in rows
            ]
        else:
            rows = db.execute(text("""
                SELECT host_id, MAX(ts) AS last_seen, COUNT(*) AS metric_count
                FROM infra_metrics
                WHERE org_id = :org_id
                GROUP BY host_id
                ORDER BY last_seen DESC
            """), {"org_id": org_id}).fetchall()
            return [
                {
                    "host_id": r[0],
                    "last_seen": r[1].isoformat() if r[1] else None,
                    "metric_count": int(r[2]),
                }
                for r in rows
            ]
    except Exception:
        db.rollback()
        logger.exception("[infra] get_infra_hosts failed for org %s", org_id)
        return []


@router.get("/correlation")
def get_infra_correlation(
    host_id: str = Query(...),
    window_hours: int = Query(1, ge=1, le=168),
    org: Organization = Depends(get_current_org_from_jwt),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Correlate agent events with infra metrics for a given host in a time window."""
    org_id = str(org.id)
    try:
        from datetime import timedelta

        from app.models.event import Event
        cutoff = datetime.now(UTC) - timedelta(hours=window_hours)

        # Agent runs for this host
        from sqlalchemy import case, func

        agent_row = (
            db.query(
                func.count(Event.id).label("total"),
                func.sum(case((Event.status == "failed", 1), else_=0)).label("failed"),
                func.coalesce(func.sum(Event.cost_usd), 0).label("cost_usd"),
                func.avg(Event.duration_ms).label("avg_duration_ms"),
            )
            .filter(
                Event.org_id == org.id,
                Event.host_id == host_id,
                Event.timestamp >= cutoff,
            )
            .one()
        )

        # Host infra metrics for the same window
        infra_row = (
            db.query(
                func.count(InfraMetric.id).label("samples"),
                func.avg(InfraMetric.cpu_pct).label("avg_cpu_pct"),
                func.max(InfraMetric.cpu_pct).label("max_cpu_pct"),
                func.avg(InfraMetric.mem_used_mb).label("avg_mem_used_mb"),
            )
            .filter(
                InfraMetric.org_id == org.id,
                InfraMetric.host_id == host_id,
                InfraMetric.ts >= cutoff,
            )
            .one()
        )

        return {
            "host_id": host_id,
            "window_hours": window_hours,
            "agent_runs": {
                "total": int(agent_row.total or 0),
                "failed": int(agent_row.failed or 0),
                "cost_usd": float(agent_row.cost_usd or 0),
                "avg_duration_ms": float(agent_row.avg_duration_ms) if agent_row.avg_duration_ms is not None else None,
            },
            "host_metrics": {
                "samples": int(infra_row.samples or 0),
                "avg_cpu_pct": float(infra_row.avg_cpu_pct) if infra_row.avg_cpu_pct is not None else None,
                "max_cpu_pct": float(infra_row.max_cpu_pct) if infra_row.max_cpu_pct is not None else None,
                "avg_mem_used_mb": float(infra_row.avg_mem_used_mb) if infra_row.avg_mem_used_mb is not None else None,
            },
        }
    except Exception:
        db.rollback()
        logger.exception("[infra] correlation failed for org %s host %s", org_id, host_id)
        return {
            "host_id": host_id,
            "window_hours": window_hours,
            "agent_runs": {"total": 0, "failed": 0, "cost_usd": 0, "avg_duration_ms": None},
            "host_metrics": {"samples": 0, "avg_cpu_pct": None, "max_cpu_pct": None, "avg_mem_used_mb": None},
        }
