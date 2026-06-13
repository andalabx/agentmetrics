from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./agentmetrics.db"
    ENVIRONMENT: str = "development"
    FRONTEND_URL: str = "http://localhost:3099"
    APP_URL: str = "http://localhost:3099"
    API_URL: str = "http://localhost:8099"

    class Config:
        env_file = (".env.local", ".env")
        extra = "ignore"


settings = Settings()
