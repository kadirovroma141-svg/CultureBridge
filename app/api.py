"""Public REST API (/api)."""
import random
import threading
import time
from collections import defaultdict, deque

from flask import Blueprint, current_app, jsonify, request
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from . import ai, services
from .extensions import db
from .models import Attempt, Greeting, MatchItem, QuizQuestion, Scenario
from .schemas import DecodeIn, MatchCheckIn, QuizAnswerIn, QuizFinishIn, RoleplayResultIn

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

    @app.errorhandler(404)
    def _not_found(e):
        if request.path.startswith("/api/"):
            return jsonify(error="Not found"), 404
        return e

    @app.errorhandler(500)
    def _server_error(e):
        db.session.rollback()
        if request.path.startswith("/api/"):
            return jsonify(error="Internal server error"), 500
        return e


# ---------------------------------------------------------------- rate limit
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def rate_limited(bucket: str) -> bool:
    limit = current_app.config["DECODE_RATE_LIMIT"]
    if limit <= 0:
        return False
    key = f"{bucket}:{request.remote_addr}"
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > 60:
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
    return jsonify(status="ok", database="ok", ai_provider=provider, ai_model=model)


@bp.get("/bootstrap")
def bootstrap():
    """Everything the single-page UI needs in one round trip."""
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


@bp.get("/radar")
def radar():
    a = services.get_country(request.args.get("from", "KZ"))
    b = services.get_country(request.args.get("to", "DE"))
    if not a or not b:
        raise ApiError("Unknown country code", 404)
    return jsonify(services.radar(a, b))


# ---------------------------------------------------------------- AI decoder
@bp.get("/ai/status")
def ai_status():
    provider, _, model = ai.active_provider()
    return jsonify(provider=provider, model=model, live=provider != "none")


@bp.post("/decode")
def decode():
    body = parse(DecodeIn)
    if rate_limited("decode"):
        raise ApiError("Too many requests — please wait a minute.", 429)
    try:
        result = ai.decode(body.text, body.country, fresh=body.fresh)
    except ValueError as e:
        raise ApiError(str(e), 404)
    db.session.add(Attempt(module="decode", ref=body.country, score=result["risk"], max_score=100))
    db.session.commit()
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


@bp.post("/quiz/finish")
def quiz_finish():
    body = parse(QuizFinishIn)
    questions = _quiz_questions()
    review, score = [], 0
    for q in questions:
        correct = next(o for o in q.options if o.is_correct)
        ok = body.answers.get(q.id) == correct.id
        score += ok
        review.append({"id": q.id, "topic": q.topic, "flag": q.flag, "correct": ok, "answer": correct.text})
    badge = services.badge_for(score, len(questions))
    db.session.add(Attempt(module="quiz", score=score, max_score=len(questions)))
    db.session.commit()
    return jsonify(score=score, total=len(questions), review=review,
                   badge={"title": badge.title, "icon": badge.icon, "text": badge.text} if badge else None)


# ---------------------------------------------------------------- match
@bp.get("/match")
def match():
    items = db.session.scalars(select(MatchItem).options(selectinload(MatchItem.country))).all()
    customs = [{"slug": m.slug, "custom": m.custom, "icon": m.icon} for m in items]
    situations = [{"id": m.id, "text": m.situation} for m in items]
    random.shuffle(customs)
    random.shuffle(situations)
    return jsonify(customs=customs, situations=situations)


@bp.post("/match/check")
def match_check():
    body = parse(MatchCheckIn)
    items = db.session.scalars(select(MatchItem).options(selectinload(MatchItem.country))).all()
    results, explanations, score = {}, [], 0
    for m in items:
        ok = body.pairs.get(m.id) == m.slug
        score += ok
        results[m.id] = ok
        explanations.append({"custom": m.custom, "icon": m.icon, "country": m.country.name, "flag": m.country.flag,
                             "explain": m.explanation, "correct": ok})
    db.session.add(Attempt(module="match", score=score, max_score=len(items)))
    db.session.commit()
    return jsonify(score=score, total=len(items), results=results, explanations=explanations)


# ---------------------------------------------------------------- roleplay
@bp.get("/scenarios")
def scenarios():
    return jsonify([services.scenario_dict(s) for s in services.scenarios()])


@bp.post("/scenarios/<slug>/result")
def scenario_result(slug):
    body = parse(RoleplayResultIn)
    if not db.session.scalar(select(Scenario.id).where(Scenario.slug == slug)):
        raise ApiError("Scenario not found", 404)
    db.session.add(Attempt(module="roleplay", ref=slug, score=body.trust, max_score=100))
    db.session.commit()
    return jsonify(ok=True)


@bp.get("/stats")
def stats():
    return jsonify(services.community_stats())
