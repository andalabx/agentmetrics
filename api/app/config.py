from pathlib import Path as _Path

from pydantic import Field
from pydantic_settings import BaseSettings


def _default_db_url() -> str:
    data_dir = _Path.home() / ".local" / "share" / "agentmetrics"
    data_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{data_dir / 'agentmetrics.db'}"


class Settings(BaseSettings):
    DATABASE_URL: str = Field(default_factory=_default_db_url)
    ENVIRONMENT: str = "development"
    FRONTEND_URL: str = "http://localhost:3099"
    APP_URL: str = "http://localhost:3099"
    API_URL: str = "http://localhost:8099"
    bind_host: str = "127.0.0.1"

    class Config:
        env_file = (".env.local", ".env")
        extra = "ignore"


settings = Settings()
