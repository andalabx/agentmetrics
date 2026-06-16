"""
Background worker — APScheduler jobs that run inside the FastAPI process.

Jobs:
  hourly_aggregate   every hour at :05  — aggregate metrics_hourly
  evaluate_alerts    every hour at :10  — evaluate alert rules
  monthly_aggregate  daily   at 03:00   — upsert monthly_usage (full-month scan,
                                          no need to run every hour)
  data_retention     daily   at 03:30   — delete events beyond plan retention
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import SessionLocal
from app.services.aggregation_service import run_hourly_aggregation, run_monthly_aggregation
from app.services.alert_service import evaluate_alerts

logger = logging.getLogger(__name__)

# Plan retention limits in days (0 = unlimited)
_RETENTION_DAYS = {
    "free":        7,
    "growth":     30,
    "pro":        90,
    "enterprise":  0,
}

# Track plans that failed retention on the last tick (for retry logging)
_retention_failures: set = set()


def _job_aggregate() -> None:
    db = SessionLocal()
    try:
        run_hourly_aggregation(db)
    finally:
        db.close()


def _job_monthly() -> None:
    db = SessionLocal()
    try:
        run_monthly_aggregation(db)
    finally:
        db.close()


def _job_alerts() -> None:
    db = SessionLocal()
    try:
        evaluate_alerts(db)
    finally:
        db.close()


def _job_retention() -> None:
    from sqlalchemy import text

    from app.database import IS_SQLITE

    global _retention_failures
    db = SessionLocal()
    failed_this_tick: set = set()
    try:
        for plan, days in _RETENTION_DAYS.items():
            if days == 0:
                continue
            try:
                if IS_SQLITE:
                    sql = text("""
                        DELETE FROM events
                        WHERE org_id IN (SELECT id FROM organizations WHERE plan = :plan)
                          AND timestamp < datetime('now', '-' || cast(:days AS TEXT) || ' days')
                    """)
                else:
                    sql = text("""
                        DELETE FROM events
                        WHERE org_id IN (SELECT id FROM organizations WHERE plan = :plan)
                          AND timestamp < now() - (:days * INTERVAL '1 day')
                    """)
                result = db.execute(sql, {"plan": plan, "days": days})
                deleted = result.rowcount
                if deleted:
                    logger.info("[retention] Deleted %d events older than %dd for plan=%s",
                                deleted, days, plan)
                _retention_failures.discard(plan)
            except Exception as exc:
                logger.error("[retention] Plan %r failed: %s", plan, exc, exc_info=True)
                failed_this_tick.add(plan)
                db.rollback()
                continue
        db.commit()
        _retention_failures.update(failed_this_tick)
        if _retention_failures:
            logger.warning(
                "[retention] %d plan(s) failed this tick and will be retried: %s",
                len(_retention_failures), _retention_failures,
            )
    finally:
        db.close()


_scheduler: BackgroundScheduler | None = None


def start_worker() -> None:
    global _scheduler
    if _scheduler is not None:
        return

    _scheduler = BackgroundScheduler(timezone="UTC")

    # Hourly metrics aggregation at :05 past each hour
    _scheduler.add_job(
        _job_aggregate,
        CronTrigger(minute=5),
        id="hourly_aggregate",
        replace_existing=True,
        misfire_grace_time=300,
        coalesce=True,
    )

    # Alert evaluation at :10 (after aggregation)
    _scheduler.add_job(
        _job_alerts,
        CronTrigger(minute=10),
        id="evaluate_alerts",
        replace_existing=True,
        misfire_grace_time=300,
        coalesce=True,
    )

    # Monthly usage — daily at 03:00 UTC (full-month scan, no point running every hour)
    _scheduler.add_job(
        _job_monthly,
        CronTrigger(hour=3, minute=0),
        id="monthly_aggregate",
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
    )

    # Data retention — daily at 03:30 UTC
    _scheduler.add_job(
        _job_retention,
        CronTrigger(hour=3, minute=30),
        id="data_retention",
        replace_existing=True,
        misfire_grace_time=3600,  # run within 1 hour of missed fire
        coalesce=True,
    )

    _scheduler.start()
    logger.info("[worker] Background scheduler started (4 jobs)")


def stop_worker() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[worker] Background scheduler stopped")
