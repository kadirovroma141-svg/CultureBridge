"""Admin panel: login + JSON API for adding new cases (/admin, /api/admin)."""
import hmac
from functools import wraps

from flask import Blueprint, current_app, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from . import services
from .api import ApiError, parse
from .extensions import db
from .models import (AlumniVoice, Attempt, Country, EtiquetteRule, QuizOption, QuizQuestion, Scenario, ScenarioOption,
                     ScenarioStep, TranslationCache)
from .schemas import EtiquetteCreate, QuizCreate, QuizPatch, ScenarioCreate, VoiceCreate

pages = Blueprint("admin", __name__, url_prefix="/admin")
api = Blueprint("admin_api", __name__, url_prefix="/api/admin")


def _enabled() -> bool:
    return bool(current_app.config["ADMIN_PASSWORD"])


@pages.route("/", methods=["GET"])
def panel():
    if not session.get("admin"):
        return render_template("admin_login.html", enabled=_enabled(), error=None)
    return render_template("admin.html")


@pages.post("/login")
def login():
    if not _enabled():
        return render_template("admin_login.html", enabled=False, error=None), 403
    pw = request.form.get("password", "")
    if hmac.compare_digest(pw.encode(), current_app.config["ADMIN_PASSWORD"].encode()):
        session.clear()
        session["admin"] = True
        return redirect(url_for("admin.panel"))
    return render_template("admin_login.html", enabled=True, error="Wrong password"), 401


@pages.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("admin.panel"))


@api.before_request
def require_admin():
    if not session.get("admin"):
        return jsonify(error="Admin login required"), 401
    # JSON-only writes: a cross-site form post cannot set this content type (CSRF guard)
    if request.method in ("POST", "PATCH", "DELETE", "PUT") and request.mimetype != "application/json":
        return jsonify(error="Content-Type must be application/json"), 415


def _country(code: str) -> Country:
    c = db.session.scalar(select(Country).where(Country.code == code))
    if not c:
        raise ApiError(f"Unknown country {code}", 404)
    return c


# ---------------------------------------------------------------- dashboard
@api.get("/stats")
def stats():
    by_module = dict(db.session.execute(select(Attempt.module, func.count(Attempt.id)).group_by(Attempt.module)).all())
    recent = db.session.scalars(select(Attempt).order_by(Attempt.created_at.desc()).limit(15)).all()
    return jsonify(
        community=services.community_stats(),
        attempts=by_module,
        quiz_questions=db.session.scalar(select(func.count(QuizQuestion.id))),
        scenarios=db.session.scalar(select(func.count(Scenario.id))),
        recent=[{"module": a.module, "ref": a.ref, "score": a.score, "max": a.max_score,
                 "at": a.created_at.isoformat()} for a in recent],
    )


@api.get("/countries")
def countries():
    return jsonify([{"code": c.code, "name": c.name, "flag": c.flag}
                    for c in db.session.scalars(select(Country).order_by(Country.name))])


# ---------------------------------------------------------------- quiz cases
@api.get("/quiz")
def quiz_list():
    qs = db.session.scalars(select(QuizQuestion).options(selectinload(QuizQuestion.options))
                            .order_by(QuizQuestion.position, QuizQuestion.id)).all()
    return jsonify([{"id": q.id, "topic": q.topic, "flag": q.flag, "question": q.question, "explanation": q.explanation,
                     "active": q.active, "options": [{"text": o.text, "correct": o.is_correct} for o in q.options]}
                    for q in qs])


@api.post("/quiz")
def quiz_create():
    body = parse(QuizCreate)
    pos = (db.session.scalar(select(func.max(QuizQuestion.position))) or 0) + 1
    q = QuizQuestion(topic=body.topic, flag=body.flag, question=body.question, explanation=body.explanation, position=pos,
                     options=[QuizOption(text=t, is_correct=i == body.correct_index, position=i)
                              for i, t in enumerate(body.options)])
    db.session.add(q)
    db.session.commit()
    return jsonify(id=q.id), 201


@api.patch("/quiz/<int:qid>")
def quiz_patch(qid):
    body = parse(QuizPatch)
    q = db.session.get(QuizQuestion, qid) or abort404()
    q.active = body.active
    db.session.commit()
    return jsonify(ok=True)


@api.delete("/quiz/<int:qid>")
def quiz_delete(qid):
    q = db.session.get(QuizQuestion, qid) or abort404()
    db.session.delete(q)
    db.session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------- alumni voices
@api.get("/voices")
def voices_list():
    vs = db.session.scalars(select(AlumniVoice).options(selectinload(AlumniVoice.country)).order_by(AlumniVoice.id.desc())).all()
    return jsonify([{"id": v.id, "country": v.country.code, "flag": v.country.flag, "university": v.university,
                     "text": v.text, "approved": v.approved} for v in vs])


@api.post("/voices")
def voices_create():
    body = parse(VoiceCreate)
    v = AlumniVoice(country=_country(body.country), university=body.university, text=body.text)
    db.session.add(v)
    db.session.commit()
    return jsonify(id=v.id), 201


@api.delete("/voices/<int:vid>")
def voices_delete(vid):
    v = db.session.get(AlumniVoice, vid) or abort404()
    db.session.delete(v)
    db.session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------- etiquette
@api.get("/etiquette")
def etiquette_list():
    rows = db.session.scalars(select(EtiquetteRule).options(selectinload(EtiquetteRule.country))
                              .order_by(EtiquetteRule.country_id, EtiquetteRule.position)).all()
    return jsonify([{"id": e.id, "country": e.country.code, "flag": e.country.flag, "title": e.title, "text": e.text}
                    for e in rows])


@api.post("/etiquette")
def etiquette_create():
    body = parse(EtiquetteCreate)
    c = _country(body.country)
    pos = (db.session.scalar(select(func.max(EtiquetteRule.position)).where(EtiquetteRule.country_id == c.id)) or 0) + 1
    e = EtiquetteRule(country=c, title=body.title, text=body.text, position=pos)
    db.session.add(e)
    db.session.commit()
    return jsonify(id=e.id), 201


@api.delete("/etiquette/<int:eid>")
def etiquette_delete(eid):
    e = db.session.get(EtiquetteRule, eid) or abort404()
    db.session.delete(e)
    db.session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------- roleplay scenarios
@api.get("/scenarios")
def scenarios_list():
    return jsonify([{**services.scenario_dict(s), "active": s.active} for s in services.scenarios(active_only=False)])


@api.post("/scenarios")
def scenarios_create():
    body = parse(ScenarioCreate)
    if db.session.scalar(select(Scenario.id).where(Scenario.slug == body.slug)):
        raise ApiError("A scenario with this slug already exists", 409)
    db.session.add(build_scenario(body))
    db.session.commit()
    return jsonify(slug=body.slug), 201


@api.delete("/scenarios/<slug>")
def scenarios_delete(slug):
    s = db.session.scalar(select(Scenario).where(Scenario.slug == slug)) or abort404()
    db.session.delete(s)
    db.session.commit()
    return jsonify(ok=True)


def build_scenario(body: ScenarioCreate) -> Scenario:
    return Scenario(
        slug=body.slug, country=_country(body.country), title=body.title, npc=body.npc, npc_role=body.npc_role,
        avatar=body.avatar, intro=body.intro, start_trust=body.start_trust,
        steps=[ScenarioStep(position=i, npc_line=st.npc,
                            options=[ScenarioOption(position=j, text=o.text, delta=o.delta, mood=o.mood, feedback=o.feedback)
                                     for j, o in enumerate(st.options)])
               for i, st in enumerate(body.steps)],
    )


# ---------------------------------------------------------------- AI cache
@api.get("/cache")
def cache_list():
    rows = db.session.scalars(select(TranslationCache).order_by(TranslationCache.created_at.desc()).limit(200)).all()
    return jsonify([{"id": r.id, "phrase": r.phrase, "country": r.country_code, "provider": r.provider, "model": r.model,
                     "risk": r.result.get("risk"), "hits": r.hits, "at": r.created_at.isoformat()} for r in rows])


@api.delete("/cache/<int:cid>")
def cache_delete(cid):
    r = db.session.get(TranslationCache, cid) or abort404()
    db.session.delete(r)
    db.session.commit()
    return jsonify(ok=True)


@api.delete("/cache")
def cache_clear_llm():
    """Remove live-LLM entries only; seeded expert analyses stay as the offline fallback."""
    n = db.session.execute(delete(TranslationCache).where(TranslationCache.provider != "expert")).rowcount
    db.session.commit()
    return jsonify(deleted=n)


def abort404():
    raise ApiError("Not found", 404)
