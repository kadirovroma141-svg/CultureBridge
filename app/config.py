"""Application configuration, read from environment variables (.env supported)."""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return f"sqlite:///{(BASE_DIR / 'culturebridge.db').as_posix()}"
    # Render / Heroku still hand out the legacy scheme
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)
    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    JSON_SORT_KEYS = False
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"

    # AI engine
    AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower()          # gemini | openai | none
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    AI_MODEL = os.getenv("AI_MODEL", "")
    AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "15"))
    DECODE_RATE_LIMIT = int(os.getenv("DECODE_RATE_LIMIT", "20"))       # requests / minute / IP

    # Admin panel
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

    SEED_FILE = BASE_DIR / "seed_data" / "research_data.json"
    AUTO_SEED = os.getenv("AUTO_SEED", "true").lower() == "true"


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    AI_PROVIDER = "none"
    ADMIN_PASSWORD = "test-admin"
    SECRET_KEY = "test"
