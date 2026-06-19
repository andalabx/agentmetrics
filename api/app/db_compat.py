"""
Cross-dialect SQL helpers. Use these instead of PostgreSQL-specific functions
so the codebase works on both PostgreSQL (production) and SQLite (local/dev).
"""
from sqlalchemy import String, cast, func

from app.database import IS_SQLITE


def json_extract_text(col, key: str):
    """ORM expression: extract a text/scalar value from a JSON column at the given key."""
    if IS_SQLITE:
        return func.json_extract(col, f"$.{key}")
    return cast(col[key], String)


def json_sql_not_eq(column_name: str, key: str, value: str) -> str:
    """Raw SQL fragment: column JSON key != value (returns NULL-safe expression)."""
    if IS_SQLITE:
        return f"(json_extract({column_name}, '$.{key}') IS NULL OR json_extract({column_name}, '$.{key}') != '{value}')"
    return f"({column_name} IS NULL OR {column_name}->>'{key}' IS NULL OR {column_name}->>'{key}' != '{value}')"


def json_sql_extract(column_name: str, key: str) -> str:
    """Raw SQL fragment: extract a JSON key as text."""
    if IS_SQLITE:
        return f"json_extract({column_name}, '$.{key}')"
    return f"{column_name}->>'{key}'"


def epoch_diff_ms(ts_col: str, prev_col: str) -> str:
    """Raw SQL expression: milliseconds between two timestamp columns."""
    if IS_SQLITE:
        return f"(julianday({ts_col}) - julianday({prev_col})) * 86400000.0"
    return f"EXTRACT(EPOCH FROM ({ts_col} - {prev_col})) * 1000"


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
