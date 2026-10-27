"""CultureBridge AI — Intercultural Intelligence Platform (Flask application factory)."""
import logging
import os
import uuid
from datetime import timedelta
from pathlib import Path

import click
from flask import Flask, g, request
from sqlalchemy import func, select
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .extensions import db

# Content-Security-Policy for the public site (admin pages use Tailwind/Alpine runtimes and are excluded).
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; "
       "media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
       "form-action 'self'; frame-ancestors 'self'")


def _asset_version(static_dir: Path) -> str:
    """Cache-busting token: git commit from the platform, else the newest static file mtime."""
    for var in ("VERCEL_GIT_COMMIT_SHA", "RENDER_GIT_COMMIT", "RAILWAY_GIT_COMMIT_SHA", "SOURCE_VERSION", "GIT_COMMIT"):
        if os.getenv(var):
            return os.getenv(var)[:8]
    try:
        return str(int(max(p.stat().st_mtime for p in static_dir.rglob("*") if p.is_file())))
    except ValueError:
        return "1"


def create_app(config_object=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # behind Vercel / Render / nginx
    logging.basicConfig(level=getattr(logging, app.config["LOG_LEVEL"], logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    production = app.config["APP_ENV"] == "production"
    if production:
        app.config["SEND_FILE_MAX_AGE_DEFAULT"] = timedelta(seconds=app.config["STATIC_MAX_AGE"])
        if not app.config["SESSION_COOKIE_SECURE"] and not app.config.get("TESTING"):
            app.logger.warning("APP_ENV=production but SESSION_COOKIE_SECURE=false — enable it when serving over HTTPS.")
        if not app.config["ADMIN_PASSWORD"]:
            app.logger.info("ADMIN_PASSWORD is empty — the /admin panel is disabled.")
    app.config["ASSET_VERSION"] = _asset_version(Path(app.static_folder))

    db.init_app(app)

    from . import admin, api, models, web  # noqa: F401  (models registers tables)
    app.register_blueprint(web.bp)
    app.register_blueprint(api.bp)
    app.register_blueprint(admin.pages)
    app.register_blueprint(admin.api)
    api.register_error_handlers(app)

    @app.before_request
    def request_id():
        g.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]

    @app.after_request
    def security_headers(resp):
        h = resp.headers
        h.setdefault("X-Request-ID", getattr(g, "request_id", "-"))
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("X-Frame-Options", "SAMEORIGIN")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()")
        if not request.path.startswith("/admin"):
            h.setdefault("Content-Security-Policy", CSP)
        if app.config["ENABLE_HSTS"] and request.is_secure:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if request.path.startswith(("/api/", "/admin", "/certificate/")):
            h.setdefault("Cache-Control", "no-store")
        return resp

    from .migrate import ensure_schema
    from .seeding import import_alumni, seed

    @app.cli.command("seed")
    def seed_command():
        """Create tables and load research data (idempotent)."""
        print(seed())

    @app.cli.command("upgrade-db")
    def upgrade_command():
        """Add any columns introduced by newer releases to an existing database."""
        print("Added columns:", ", ".join(ensure_schema()) or "none — schema is up to date")

    @app.cli.command("import-alumni")
    @click.argument("path", type=click.Path(exists=True, dir_okay=False))
    def import_alumni_command(path):
        """Load full alumni survey records: flask import-alumni seed_data/alumni_survey.json"""
        print(import_alumni(path))

    with app.app_context():
        if app.config["AUTO_MIGRATE"]:
            ensure_schema()
        from . import models as m
        if app.config["AUTO_SEED"] and not db.session.scalar(select(func.count(m.Country.id))):
            app.logger.info("Empty database — seeding research data…")
            seed()
        elif app.config["AUTO_SEED"]:
            from .seeding import add_new_countries
            added = add_new_countries()
            if added:
                app.logger.info("Added new countries from research data: %s", ", ".join(added))

    return app
