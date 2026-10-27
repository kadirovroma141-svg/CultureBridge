"""Application configuration, read from environment variables (.env supported)."""
import logging
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

log = logging.getLogger(__name__)


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return f"sqlite:///{(BASE_DIR / 'culturebridge.db').as_posix()}"
    # Render / Heroku still hand out the legacy scheme
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    # Supabase (and most managed Postgres) only accept TLS connections
    if url.startswith("postgresql") and "sslmode=" not in url and "localhost" not in url and "127.0.0.1" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


# Vercel runs each instance as a short-lived serverless function: keep no idle connections (Supabase's pooler does
# the pooling) and do not run migrations / seeding on every cold start — do them once with `python seed.py`.
SERVERLESS = bool(os.getenv("VERCEL"))


def _engine_options() -> dict:
    if SERVERLESS:
        from sqlalchemy.pool import NullPool
        return {"poolclass": NullPool}
    return {"pool_pre_ping": True}


def _secret_key() -> str:
    """SECRET_KEY from the environment; otherwise a key persisted next to the database.

    A random key per process would log admins out whenever gunicorn runs several workers
    or restarts, so the generated key is stored once in ``<data dir>/.secret_key``.
    """
    key = os.getenv("SECRET_KEY", "").strip()
    if key and key != "change-me":
        return key
    data_dir = Path(os.getenv("DATA_DIR", "")) if os.getenv("DATA_DIR") else BASE_DIR
    path = data_dir / ".secret_key"
    try:
        if path.exists():
            stored = path.read_text(encoding="utf-8").strip()
            if stored:
                return stored
        data_dir.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_hex(32)
        try:  # O_EXCL: if two workers race, only one writes and both read the same value
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(generated)
        except FileExistsError:
            pass
        return path.read_text(encoding="utf-8").strip() or generated
    except OSError:
        log.warning("SECRET_KEY is not set and cannot be persisted — using a per-process key. Set SECRET_KEY in production.")
        return secrets.token_hex(32)


class Config:
    APP_ENV = os.getenv("APP_ENV", "development").lower()            # development | production
    SECRET_KEY = _secret_key()
    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_ENGINE_OPTIONS = _engine_options()
    JSON_SORT_KEYS = False
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024
    JSON_AS_ASCII = False
    TEMPLATES_AUTO_RELOAD = APP_ENV != "production"

    # Public URL (used for canonical links, sitemap.xml, Open Graph). Empty = derived from the request.
    BASE_URL = os.getenv("BASE_URL", "").rstrip("/")

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE")
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8
    ENABLE_HSTS = _bool("ENABLE_HSTS", "true" if os.getenv("APP_ENV", "").lower() == "production" else "false")
    STATIC_MAX_AGE = int(os.getenv("STATIC_MAX_AGE", "86400"))       # seconds, applied to /static in production

    # AI engine
    AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower()          # gemini | openai | none
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    AI_MODEL = os.getenv("AI_MODEL", "")
    AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "15"))

    # Rate limits (requests / minute / IP, in-memory per worker; 0 = unlimited)
    DECODE_RATE_LIMIT = int(os.getenv("DECODE_RATE_LIMIT", "20"))
    ROLEPLAY_RATE_LIMIT = int(os.getenv("ROLEPLAY_RATE_LIMIT", "30"))
    SANDBOX_RATE_LIMIT = int(os.getenv("SANDBOX_RATE_LIMIT", "60"))    # 3D sandbox turns (words + gestures)
    SUBMIT_RATE_LIMIT = int(os.getenv("SUBMIT_RATE_LIMIT", "6"))      # community stories + trainer results

    # Community stories: show immediately (moderate later in /admin) or hold for review
    AUTO_APPROVE_SUBMISSIONS = _bool("AUTO_APPROVE_SUBMISSIONS", "true")

    # Admin panel
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

    SEED_FILE = BASE_DIR / "seed_data" / "research_data.json"
    AUTO_SEED = _bool("AUTO_SEED", "false" if SERVERLESS else "true")
    AUTO_MIGRATE = _bool("AUTO_MIGRATE", "false" if SERVERLESS else "true")
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    AUTO_SEED = True
    AUTO_MIGRATE = True
    AI_PROVIDER = "none"
    ADMIN_PASSWORD = "test-admin"
    SECRET_KEY = "test"
    BASE_URL = "https://example.test"
    DECODE_RATE_LIMIT = 0
    ROLEPLAY_RATE_LIMIT = 0
    SANDBOX_RATE_LIMIT = 0
    SUBMIT_RATE_LIMIT = 0
