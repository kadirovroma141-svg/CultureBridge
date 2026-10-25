"""HTML pages (one URL per module), SEO endpoints (robots, sitemap, manifest) and probes."""
from datetime import datetime, timezone

from flask import (Blueprint, Response, abort, current_app, jsonify, redirect, render_template, request, session, url_for)

from . import services
from .extensions import db
from .models import User

bp = Blueprint("web", __name__)

# Order = navigation order = "next module" order at the bottom of each page.
PAGES = [
    {"key": "home", "path": "/", "nav": "Home", "icon": "◐",
     "title": "CultureBridge AI — Intercultural Intelligence Platform",
     "desc": "Interactive platform that helps students overcome the cultural barrier abroad: world atlas with NIS alumni stories, "
             "6D culture gap radar, AI subtext translator, roleplay simulator and proxemics lab."},
    {"key": "learn", "path": "/learn", "nav": "Tracks", "icon": "🎓", "group": "train",
     "title": "Guided Country Learning Tracks — CultureBridge AI",
     "desc": "Systematic 5-step intercultural preparation tracks for your destination country: First Contact, Gap Discovery, Pragmatics, Roleplay and Certification Exam."},
    {"key": "atlas", "path": "/atlas", "nav": "World Atlas", "icon": "🌍", "group": "explore",
     "title": "World Atlas & Voices of NIS Alumni — CultureBridge AI",
     "desc": "Click a country on the interactive map or 3D globe to read its etiquette, mentality and first-hand "
             "experience of NIS alumni studying abroad. Share your own story."},
    {"key": "greetings", "path": "/greetings", "nav": "Greetings", "icon": "👋", "group": "explore",
     "title": "Greetings of the World — words, gestures, pronunciation | CultureBridge AI",
     "desc": "20 greetings with 3D flip cards: the word, transliteration, the right gesture and spoken pronunciation."},
    {"key": "radar", "path": "/radar", "nav": "Gap Radar", "icon": "📡", "group": "explore",
     "title": "6D Cultural Gap Radar — compare two cultures | CultureBridge AI",
     "desc": "Compare any two countries on six cultural dimensions (Hofstede, Meyer, Hall), get a Cultural Distance Index, "
             "culture-shock risk zones and a personal adaptation checklist."},
    {"key": "decoder", "path": "/decoder", "nav": "AI Decoder", "icon": "🧠", "group": "tools",
     "title": "AI Pragmatic Subtext Translator — say it politely | CultureBridge AI",
     "desc": "Type a direct phrase and see how a local really hears it: conflict-risk meter, interpretation and polite "
             "rephrasings in English and in the local language. Works offline thanks to a database cache."},
    {"key": "proxemics", "path": "/proxemics", "nav": "Proxemics Lab", "icon": "📏", "group": "tools",
     "title": "Proxemics & Voice Lab — personal space in 3D | CultureBridge AI",
     "desc": "A 3D simulator of conversational distance in centimetres for 10 cultures plus a microphone-based voice "
             "loudness calibrator."},
    {"key": "roleplay", "path": "/roleplay", "nav": "Roleplay", "icon": "🎭", "group": "tools",
     "title": "Roleplay Simulator with Cultural Trust Meter | CultureBridge AI",
     "desc": "Talk to a Hungarian professor, an Italian host grandmother, a German teammate or an American classmate. "
             "Every reply moves your Cultural Trust Meter."},
    {"key": "match", "path": "/match", "nav": "Match Customs", "icon": "🧩", "group": "train",
     "title": "Match the Cultural Customs — drag & drop trainer | CultureBridge AI",
     "desc": "Drag 10 customs onto the situations where they belong. Answers are checked on the server and explained "
             "scientifically."},
    {"key": "quiz", "path": "/quiz", "nav": "Awareness Quiz", "icon": "🏆", "group": "train",
     "title": "Cultural Awareness Quiz — 12 real-life cases + certificate | CultureBridge AI",
     "desc": "Twelve situational questions with instant explanations. Earn a Beginner, Learner or Expert badge and a "
             "personal certificate."},
    {"key": "stats", "path": "/stats", "nav": "Live Stats", "icon": "📊", "group": "about",
     "title": "Live Community Statistics | CultureBridge AI",
     "desc": "Real-time analytics from the database: how many people trained, average cultural awareness score, "
             "level distribution and the most common mistakes."},
    {"key": "about", "path": "/about", "nav": "Methodology", "icon": "📚", "group": "about",
     "title": "Methodology, Sources & Architecture | CultureBridge AI",
     "desc": "The research behind CultureBridge AI: NIS alumni survey, Hofstede, Hall, Meyer and Brown & Levinson, "
             "ethics and limitations, and how the platform is built."},
    {"key": "docs", "path": "/docs", "nav": "API Docs", "icon": "🔌", "group": "about",
     "title": "REST API Reference | CultureBridge AI",
     "desc": "Reference of the public REST endpoints: countries, compare, subtext translator, roleplay, quiz, matching, "
             "alumni stories and statistics."},
]
BY_KEY = {p["key"]: p for p in PAGES}
LEARNING_FLOW = ["learn", "atlas", "radar", "decoder", "proxemics", "roleplay", "match", "quiz"]


def _endpoint_to_key() -> str | None:
    return (request.endpoint or "").removeprefix("web.") if (request.endpoint or "").startswith("web.") else None


def public_base() -> str:
    return current_app.config["BASE_URL"] or request.url_root.rstrip("/")


@bp.app_context_processor
def inject_site():
    key = _endpoint_to_key()
    page = BY_KEY.get(key, BY_KEY["home"])
    flow = LEARNING_FLOW
    nxt = None
    if key in flow and flow.index(key) < len(flow) - 1:
        nxt = BY_KEY[flow[flow.index(key) + 1]]
    prev = BY_KEY[flow[flow.index(key) - 1]] if key in flow and flow.index(key) > 0 else None

    uid = session.get("user_id")
    cur_user = db.session.get(User, uid) if uid else None

    return {
        "pages": PAGES, "page": page, "current_key": key, "next_page": nxt, "prev_page": prev,
        "site_url": public_base(), "canonical": public_base() + (request.path if request.path != "/" else "/"),
        "asset_v": current_app.config.get("ASSET_VERSION", "1"), "year": datetime.now(timezone.utc).year,
        "current_user": cur_user,
    }


def _page(template: str):
    return render_template(template)


@bp.get("/")
def home():
    return _page("pages/home.html")


@bp.get("/learn")
def learn():
    return _page("pages/learn.html")


@bp.get("/auth")
def auth():
    return _page("pages/auth.html")


@bp.get("/login")
def login_redirect():
    return redirect(url_for("web.auth"))


@bp.get("/register")
def register_redirect():
    return redirect(url_for("web.auth"))



@bp.get("/atlas")
def atlas():
    return _page("pages/atlas.html")


@bp.get("/greetings")
def greetings():
    return _page("pages/greetings.html")


@bp.get("/radar")
def radar():
    return _page("pages/radar.html")


@bp.get("/decoder")
def decoder():
    return _page("pages/decoder.html")


@bp.get("/proxemics")
def proxemics():
    return _page("pages/proxemics.html")


@bp.get("/roleplay")
def roleplay():
    return _page("pages/roleplay.html")


@bp.get("/match")
def match():
    return _page("pages/match.html")


@bp.get("/quiz")
def quiz():
    return _page("pages/quiz.html")


@bp.get("/stats")
def stats():
    return _page("pages/stats.html")


@bp.get("/about")
def about():
    return _page("pages/about.html")


@bp.get("/docs")
def docs():
    return _page("pages/docs.html")


@bp.get("/certificate/<token>")
def certificate(token: str):
    data = services.certificate_data(token)
    if data is None:
        abort(404)
    return render_template("pages/certificate.html", cert=data)


# Old single-page anchors keep working: /#atlas -> handled client-side; legacy paths redirect.
@bp.get("/index.html")
def legacy_index():
    return redirect(url_for("web.home"), 301)


# ------------------------------------------------------------------ SEO + probes
@bp.get("/robots.txt")
def robots():
    body = (f"User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/admin/\nDisallow: /certificate/\n\n"
            f"Sitemap: {public_base()}/sitemap.xml\n")
    return Response(body, mimetype="text/plain")


@bp.get("/sitemap.xml")
def sitemap():
    base = public_base()
    today = datetime.now(timezone.utc).date().isoformat()
    urls = "".join(
        f"<url><loc>{base}{p['path']}</loc><lastmod>{today}</lastmod>"
        f"<changefreq>{'daily' if p['key'] in ('home', 'stats') else 'weekly'}</changefreq>"
        f"<priority>{'1.0' if p['key'] == 'home' else '0.8'}</priority></url>" for p in PAGES)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return Response(xml, mimetype="application/xml")


@bp.get("/manifest.webmanifest")
def manifest():
    return jsonify(
        name="CultureBridge AI", short_name="CultureBridge", start_url="/", display="standalone",
        background_color="#070a17", theme_color="#8b6cff", description=BY_KEY["home"]["desc"],
        icons=[{"src": url_for("static", filename="img/icon.svg"), "sizes": "any", "type": "image/svg+xml",
                "purpose": "any maskable"}])


@bp.get("/favicon.ico")
def favicon():
    return redirect(url_for("static", filename="img/icon.svg"), 301)


@bp.get("/healthz")
def healthz():
    """Liveness probe (no database access). Use /api/health for readiness."""
    return Response("ok", mimetype="text/plain")
