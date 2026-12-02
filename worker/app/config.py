from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), extra="ignore"
    )

    database_url: SecretStr
    mock_ai: bool = True
    openai_api_key: SecretStr = SecretStr("")
    gemini_api_key: SecretStr = SecretStr("")
    anthropic_api_key: SecretStr = SecretStr("")
    media_dir: Path = Path("/app/media")
    openai_model: str = "gpt-4o-mini"
    whisper_model: str = "whisper-1"
    signals_api_url: str = ""
    signals_api_key: SecretStr = SecretStr("")
    provider_timeout_seconds: float = 180
    job_timeout_seconds: float = 900
