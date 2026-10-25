"""Public REST API (/api)."""
import random
import threading
import time
from collections import defaultdict, deque

from flask import Blueprint, current_app, jsonify, render_template, request, session, url_for
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from werkzeug.exceptions import HTTPException

from . import ai, roleplay, services, tracks
from .extensions import db
from .models import AlumniVoice, Country, Greeting, MatchItem, QuizQuestion, Scenario, TrackProgress, User
from .schemas import (AlumniAddIn, DecodeIn, LoginIn, MatchCheckIn, MatchSubmitIn, QuizAnswerIn, QuizFinishIn,
                      QuizSubmitIn, RegisterIn, RoleplayResultIn, RoleplayTurnIn, SubtextIn, TrackStepCompleteIn)

bp = Blueprint("api", __name__, url_prefix="/api")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def parse(schema: type[BaseModel]) -> BaseModel:
    data = request.get_json(silent=True)
    if data is None:
        raise ApiError("Expected a JSON body", 400)
    return schema.model_validate(data)


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def _api_error(e: ApiError):
        return jsonify(error=e.message), e.status

    @app.errorhandler(ValidationError)
    def _validation_error(e: ValidationError):
        return jsonify(error="Validation failed",
                       details=[{"field": ".".join(map(str, x["loc"])), "msg": x["msg"]} for x in e.errors()]), 422

    @app.errorhandler(HTTPException)
    def _http_error(e: HTTPException):
        if e.code and e.code >= 500:
            db.session.rollback()
        if request.path.startswith("/api/"):
            return jsonify(error=e.description or e.name), e.code
        return render_template("error.html", code=e.code, name=e.name, description=e.description), e.code

    @app.errorhandler(Exception)
    def _unhandled(e: Exception):
        db.session.rollback()
        current_app.logger.exception("Unhandled error on %s %s", request.method, request.path)
        if request.path.startswith("/api/"):
            return jsonify(error="Internal server error"), 500
        return render_template("error.html", code=500, name="Server error",
                               description="Something went wrong on our side. Please try again in a moment."), 500


# ---------------------------------------------------------------- rate limit
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def rate_limited(bucket: str, config_key: str = "DECODE_RATE_LIMIT", window: int = 60) -> bool:
    limit = current_app.config[config_key]
    if limit <= 0:
        return False
    key = f"{bucket}:{request.remote_addr}"
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
    return False


# ---------------------------------------------------------------- core
@bp.get("/health")
def health():
    db.session.execute(text("SELECT 1"))
    provider, _, model = ai.active_provider()
    return jsonify(status="ok", database="ok", ai_provider=provider, ai_model=model, env=current_app.config["APP_ENV"])


@bp.get("/bootstrap")
def bootstrap():
    """Everything the UI needs in one round trip."""
    countries = db.session.scalars(services.countries_query()).all()
    provider, _, model = ai.active_provider()
    return jsonify(
        countries={c.code: services.country_dict(c) for c in countries},
        dimensions=[services.dimension_dict(d) for d in services.dimensions()],
        greetings=[services.greeting_dict(g) for g in db.session.scalars(select(Greeting).order_by(Greeting.id))],
        presets=services.setting("translator_presets", []),
        moods=services.setting("moods", {}),
        references=services.references(),
        stats=services.community_stats(),
        ai={"provider": provider, "model": model},
    )


@bp.get("/countries")
def countries():
    return jsonify([services.country_dict(c) for c in db.session.scalars(services.countries_query())])


@bp.get("/countries/<code>")
def country(code):
    c = services.get_country(code)
    if not c:
        raise ApiError("Country not found", 404)
    return jsonify(services.country_dict(c))


@bp.get("/country/<code>")
def country_detail(code):
    """Country card for the atlas: profile, the six 0-100 indices, greeting and the alumni insights from the DB."""
    c = services.get_country(code)
    if not c:
        raise ApiError("Country not found", 404)
    d = services.country_dict(c)
    g = db.session.scalar(select(Greeting).where(Greeting.lang_code == c.lang).order_by(Greeting.id))
    dims = d["dims"]
    d.update(
        quick_summary=c.mentality,
        proxemics_cm=c.proxemics_cm,
        greeting={"word": g.word, "phonetic": g.roman, "gesture": g.gesture_name, "emoji": g.gesture, "note": g.note,
                  "lang": g.language} if g else None,
        indices={"directness_score": dims["direct"], "expressiveness_score": dims["express"],
                 "personal_space_score": 100 - dims["contact"], "punctuality_score": dims["time"],
                 "hierarchy_score": dims["hierarchy"], "small_talk_score": dims["smalltalk"]},
        insights=d["alumni"]["voices"] if d["alumni"] else [],
    )
    return jsonify(d)


@bp.get("/radar")
def radar():
    a = services.get_country(request.args.get("from", "KZ"))
    b = services.get_country(request.args.get("to", "DE"))
    if not a or not b:
        raise ApiError("Unknown country code", 404)
    return jsonify(services.radar(a, b))


@bp.get("/compare")
def compare():
    """6D Cultural Gap Radar: both countries' metrics, the delta, the distance index and the culture-shock risk zones."""
    a = services.get_country(request.args.get("from", "KZ"))
    b = services.get_country(request.args.get("to", "IT"))
    if not a or not b:
        raise ApiError("Unknown country code", 404)
    r = services.radar(a, b)
    keys = [d["key"] for d in r["dimensions"]]
    r["cultural_distance_index"] = r["distance_index"]
    r["deltas"] = {k: r["to"]["values"][i] - r["from"]["values"][i] for i, k in enumerate(keys)}
    r["risk_zones"] = [{
        "key": g["key"], "dimension": g["label"], "severity": g["severity"], "delta": g["diff"],
        "from": g["from"], "to": g["to"],
        "headline": f"{r['to']['name']}: {g['pole'].lower()} ({g['to']} vs {g['from']} in {r['from']['name']})",
        "tips": g["advice"],
    } for g in r["top_gaps"]]
    return jsonify(r)


# ---------------------------------------------------------------- alumni insights
@bp.get("/alumni")
def alumni_list():
    q = select(AlumniVoice).options(selectinload(AlumniVoice.country)).where(AlumniVoice.approved.is_(True))
    code = (request.args.get("country") or "").upper()
    if code:
        q = q.join(Country).where(Country.code == code)
    limit = max(1, min(int(request.args.get("limit", 50) or 50), 100))
    rows = db.session.scalars(q.order_by(AlumniVoice.created_at.desc(), AlumniVoice.id.desc()).limit(limit)).all()
    return jsonify([{**services.voice_dict(v), "country": v.country.code, "flag": v.country.flag,
                     "country_name": v.country.name} for v in rows])


@bp.post("/alumni/add")
def alumni_add():
    """'Share Your Study Abroad Experience': stores a community story and returns it for instant display."""
    body = parse(AlumniAddIn)
    if body.website:                       # honeypot filled in -> a bot; pretend success, store nothing
        return jsonify(ok=True), 202
    if rate_limited("alumni", "SUBMIT_RATE_LIMIT", window=600):
        raise ApiError("Too many submissions — please try again in a few minutes.", 429)
    c = services.get_country(body.country)
    if not c:
        raise ApiError("Unknown country", 404)
    approved = current_app.config["AUTO_APPROVE_SUBMISSIONS"]
    v = AlumniVoice(
        country=c, university=body.university, text=body.cultural_observations, advice=body.advice_for_students,
        student_name=body.student_name if body.consent_to_publish_name else None,  # names only with consent
        nis_branch=body.nis_branch, program_duration=body.program_duration,
        approved=approved, is_verified=False, source="community")
    db.session.add(v)
    db.session.commit()
    return jsonify(ok=True, approved=approved, voice=services.voice_dict(v), country=c.code,
                   alumni_voices=services.community_stats()["alumni_voices"],
                   message="Thank you! Your story is live." if approved else "Thank you! Your story will appear after review."), 201


# ---------------------------------------------------------------- AI decoder
@bp.get("/ai/status")
def ai_status():
    provider, _, model = ai.active_provider()
    return jsonify(provider=provider, model=model, live=provider != "none")


def _decode(text_: str, code: str, fresh: bool) -> dict:
    if rate_limited("decode", "DECODE_RATE_LIMIT"):
        raise ApiError("Too many requests — please wait a minute.", 429)
    try:
        result = ai.decode(text_, code, fresh=fresh)
    except ValueError as e:
        raise ApiError(str(e), 404)
    services.log_attempt("decode", ref=code, score=result["risk"], max_score=100)
    db.session.commit()
    return result


@bp.post("/decode")
def decode():
    body = parse(DecodeIn)
    return jsonify(_decode(body.text, body.country, body.fresh))


@bp.post("/ai/translate-subtext")
def translate_subtext():
    """AI Pragmatic Subtext Translator: conflict risk, how a local hears it, culturally adapted rephrasings."""
    body = parse(SubtextIn)
    r = _decode(body.text, body.target_country, body.fresh)
    v = r["variants"]
    return jsonify(
        input=body.text, target_country=body.target_country,
        conflict_risk=r["risk"], level=r["level"], level_label=r["level_label"],
        how_they_hear_it=r["heard"],
        culturally_adapted={"english": v["en"], "local": v["local"]},
        tags=r["tags"], notes=r["notes"], category=r["category"],
        source=r["source"], provider=r["provider"], model=r["model"],
    )


# ---------------------------------------------------------------- AI roleplay
@bp.post("/ai/roleplay")
def ai_roleplay():
    """Free-text turn in a roleplay: the server judges the etiquette and moves the Cultural Trust Meter."""
    body = parse(RoleplayTurnIn)
    if rate_limited("roleplay", "ROLEPLAY_RATE_LIMIT"):
        raise ApiError("Too many requests — please wait a minute.", 429)
    try:
        result = roleplay.respond(body.scenario, body.message, body.trust, body.history)
    except LookupError as e:
        raise ApiError(str(e), 404)
    return jsonify(result)


# ---------------------------------------------------------------- quiz
def _quiz_questions():
    return db.session.scalars(select(QuizQuestion).options(selectinload(QuizQuestion.options))
                              .where(QuizQuestion.active.is_(True)).order_by(QuizQuestion.position, QuizQuestion.id)).all()


@bp.get("/quiz")
def quiz():
    out = []
    for q in _quiz_questions():
        opts = [{"id": o.id, "text": o.text} for o in q.options]
        random.shuffle(opts)  # correct answer position is never predictable
        out.append({"id": q.id, "topic": q.topic, "flag": q.flag, "question": q.question, "options": opts})
    return jsonify(out)


@bp.post("/quiz/<int:qid>/answer")
def quiz_answer(qid):
    body = parse(QuizAnswerIn)
    q = db.session.get(QuizQuestion, qid)
    if not q or not q.active:
        raise ApiError("Question not found", 404)
    correct = next(o for o in q.options if o.is_correct)
    if body.option_id not in {o.id for o in q.options}:
        raise ApiError("Option does not belong to this question", 400)
    return jsonify(correct=body.option_id == correct.id, correct_option_id=correct.id, explanation=q.explanation)


def _finish_quiz(answers: dict[int, int], learner=None) -> dict:
    questions = _quiz_questions()
    review, score, wrong = [], 0, []
    for q in questions:
        correct = next(o for o in q.options if o.is_correct)
        ok = answers.get(q.id) == correct.id
        score += ok
        if not ok:
            wrong.append(q.id)
        review.append({"id": q.id, "topic": q.topic, "flag": q.flag, "correct": ok, "answer": correct.text,
                       "explanation": q.explanation})
    badge = services.badge_for(score, len(questions))
    attempt = services.log_attempt("quiz", score=score, max_score=len(questions), learner=learner,
                                   detail={"wrong": wrong}, graded=True)
    db.session.commit()
    return {
        "score": score, "total": len(questions), "review": review, "level": attempt.cultural_level,
        "badge": {"title": badge.title, "icon": badge.icon, "text": badge.text} if badge else None,
        "certificate": {"token": attempt.token, "url": url_for("web.certificate", token=attempt.token)},
    }


@bp.post("/quiz/finish")
def quiz_finish():
    body = parse(QuizFinishIn)
    return jsonify(_finish_quiz(body.answers))


@bp.post("/quiz/submit")
def quiz_submit():
    """Server-side grading + saving the result (name, countries, level) + certificate link."""
    if rate_limited("submit", "SUBMIT_RATE_LIMIT", window=60):
        raise ApiError("Too many submissions — please wait a minute.", 429)
    body = parse(QuizSubmitIn)
    return jsonify(_finish_quiz(body.answers, body))


# ---------------------------------------------------------------- match
def _match_items():
    return db.session.scalars(select(MatchItem).options(selectinload(MatchItem.country)).order_by(MatchItem.id)).all()


@bp.get("/match")
def match():
    items = _match_items()
    customs = [{"slug": m.slug, "custom": m.custom, "icon": m.icon} for m in items]
    situations = [{"id": m.id, "text": m.situation} for m in items]
    random.shuffle(customs)
    random.shuffle(situations)
    return jsonify(customs=customs, situations=situations)


def _check_match(pairs: dict[int, str], learner=None) -> dict:
    items = _match_items()
    results, explanations, score, wrong = {}, [], 0, []
    for m in items:
        ok = pairs.get(m.id) == m.slug
        score += ok
        results[m.id] = ok
        if not ok:
            wrong.append(m.slug)
        explanations.append({"custom": m.custom, "icon": m.icon, "country": m.country.name, "flag": m.country.flag,
                             "explain": m.explanation, "correct": ok})
    attempt = services.log_attempt("match", score=score, max_score=len(items), learner=learner,
                                   detail={"wrong": wrong}, graded=True)
    db.session.commit()
    return {
        "score": score, "total": len(items), "results": results, "explanations": explanations,
        "level": attempt.cultural_level,
        "certificate": {"token": attempt.token, "url": url_for("web.certificate", token=attempt.token)},
    }


@bp.post("/match/check")
def match_check():
    body = parse(MatchCheckIn)
    return jsonify(_check_match(body.pairs))


@bp.post("/matching/submit")
def matching_submit():
    """Server-side check of the drag-and-drop trainer + saving the result + certificate link."""
    if rate_limited("submit", "SUBMIT_RATE_LIMIT", window=60):
        raise ApiError("Too many submissions — please wait a minute.", 429)
    body = parse(MatchSubmitIn)
    return jsonify(_check_match(body.pairs, body))


# ---------------------------------------------------------------- roleplay (scripted scenarios)
@bp.get("/scenarios")
def scenarios():
    return jsonify([services.scenario_dict(s) for s in services.scenarios()])


@bp.post("/scenarios/<slug>/result")
def scenario_result(slug):
    body = parse(RoleplayResultIn)
    if not db.session.scalar(select(Scenario.id).where(Scenario.slug == slug)):
        raise ApiError("Scenario not found", 404)
    a = services.log_attempt("roleplay_ai" if body.mode == "free" else "roleplay", ref=slug, score=body.trust,
                             max_score=100)
    a.session_id = services.clean_session(body.session_id)
    db.session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------- analytics
@bp.get("/stats")
def stats():
    return jsonify(services.community_stats())


@bp.get("/stats/detail")
def stats_detail():
    return jsonify(services.detailed_stats())


# ---------------------------------------------------------------- authentication & accounts
def current_user() -> User | None:
    uid = session.get("user_id")
    if not uid:
        return None
    return db.session.get(User, uid)


from datetime import datetime, timezone


@bp.post("/auth/register")
def auth_register():
    body = parse(RegisterIn)
    existing = db.session.scalar(select(User).where(User.username == body.username))
    if existing:
        raise ApiError("Username already taken", 409)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    user = User(
        username=body.username,
        full_name=body.full_name or body.username,
        target_country=body.target_country,
        streak_days=1,
        last_active_date=today,
    )
    user.set_password(body.password)
    db.session.add(user)
    db.session.commit()
    session["user_id"] = user.id
    return jsonify(user=user.to_dict()), 201


@bp.post("/auth/login")
def auth_login():
    body = parse(LoginIn)
    user = db.session.scalar(select(User).where(User.username == body.username))
    if not user or not user.check_password(body.password):
        raise ApiError("Invalid username or password", 401)
    session["user_id"] = user.id
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if user.last_active_date != today:
        user.streak_days = (user.streak_days or 1) + 1
        user.last_active_date = today
        db.session.commit()
    return jsonify(user=user.to_dict())


@bp.post("/auth/logout")
def auth_logout():
    session.pop("user_id", None)
    return jsonify(ok=True)


@bp.get("/auth/me")
def auth_me():
    u = current_user()
    if not u:
        return jsonify(user=None)
    pts = db.session.scalars(select(TrackProgress).where(TrackProgress.user_id == u.id)).all()
    return jsonify(user=u.to_dict(), tracks=[t.to_dict() for t in pts])


# ---------------------------------------------------------------- systematic country learning tracks
@bp.get("/tracks")
def tracks_list():
    u = current_user()
    return jsonify(tracks.list_tracks_overview(u))


@bp.get("/tracks/<country_code>")
def track_detail(country_code: str):
    u = current_user()
    data = tracks.get_country_track(country_code.upper(), u)
    if not data:
        raise ApiError("Country track not found", 404)
    return jsonify(data)


@bp.post("/tracks/<country_code>/step/<step_id>/complete")
def track_complete_step(country_code: str, step_id: str):
    u = current_user()
    if not u:
        raise ApiError("Please sign in to track your learning progress and save certificates", 401)
    body = parse(TrackStepCompleteIn)
    try:
        res = tracks.record_step_progress(u, country_code.upper(), step_id, score=body.score, detail=body.detail)
    except ValueError as e:
        raise ApiError(str(e), 400)
    return jsonify(res)

