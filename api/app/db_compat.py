"""
Cross-dialect SQL helpers. Use these instead of PostgreSQL-specific functions
so the codebase works on both PostgreSQL (production) and SQLite (local/dev).
"""
from sqlalchemy import func, String, cast
from app.database import IS_SQLITE


def trunc_day(col):
    """Truncate a timestamp to day. Returns a string "YYYY-MM-DD" on both dialects."""
    if IS_SQLITE:
        return func.strftime("%Y-%m-%d", col)
    # PostgreSQL: cast to date gives "YYYY-MM-DD" string representation
    return cast(func.date_trunc("day", col), String)


def trunc_hour(col):
    """Truncate a timestamp to hour. Returns ISO string on both dialects."""
    if IS_SQLITE:
        return func.strftime("%Y-%m-%dT%H:00:00", col)
    return cast(func.date_trunc("hour", col), String)


def now_sql() -> str:
    """Current timestamp expression for raw SQL."""
    return "datetime('now')" if IS_SQLITE else "now()"


def interval_hours_ago(hours: int) -> str:
    """Raw SQL expression: current time minus N hours."""
    if IS_SQLITE:
        return f"datetime('now', '-{hours} hours')"
    return f"now() - interval '{hours} hours'"


def interval_days_ago(days: int) -> str:
    """Raw SQL expression: current time minus N days."""
    if IS_SQLITE:
        return f"datetime('now', '-{days} days')"
    return f"now() - interval '{days} days'"
