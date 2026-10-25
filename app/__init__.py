"""CultureBridge AI — Intercultural Intelligence Platform (Flask application factory)."""
import logging

from flask import Flask, render_template
from sqlalchemy import func, select
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .extensions import db


def create_app(config_object=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)  # behind Render / Railway / nginx
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    db.init_app(app)

    from . import admin, api, models  # noqa: F401  (models registers tables)
    app.register_blueprint(api.bp)
    app.register_blueprint(admin.pages)
    app.register_blueprint(admin.api)
    api.register_error_handlers(app)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        resp.headers.setdefault("Permissions-Policy", "microphone=(self)")
        return resp

    from .seeding import seed

    @app.cli.command("seed")
    def seed_command():
        """Create tables and load research data (idempotent)."""
        print(seed())

    with app.app_context():
        db.create_all()
        if app.config["AUTO_SEED"] and not db.session.scalar(select(func.count(models.Country.id))):
            app.logger.info("Empty database — seeding research data…")
            seed()

    return app
