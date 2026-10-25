"""Serialisation helpers and domain algorithms (Gap Radar)."""
import math

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .extensions import db
from .models import (AlumniVoice, Attempt, Country, CountryDimension, Dimension, Greeting, QuizBadge, Reference,
                     Scenario, ScenarioStep, Setting, TranslationCache)


def countries_query():
    return (select(Country)
            .options(selectinload(Country.etiquette), selectinload(Country.universities),
                     selectinload(Country.voices), selectinload(Country.scores).joinedload(CountryDimension.dimension))
            .order_by(Country.id))


def get_country(code: str) -> Country | None:
    return db.session.scalar(countries_query().where(Country.code == code.upper()))


def country_dict(c: Country) -> dict:
    voices = [v for v in c.voices if v.approved]
    has_alumni = bool(c.universities or voices)
    return {
        "code": c.code,
        "name": c.name,
        "flag": c.flag,
        "iso": c.iso_numeric,
        "lang": c.lang,
        "context": c.context,
        "coords": [c.lon, c.lat],
        "mentality": c.mentality,
        "etiquette": [[e.title, e.text] for e in c.etiquette],
        "dims": c.dims(),
        "proxemics": c.proxemics_cm,
        "voice": [c.voice_min, c.voice_max],
        "alumni": {
            "universities": [u.name for u in c.universities],
            "voices": [{"uni": v.university, "text": v.text} for v in voices],
        } if has_alumni else None,
    }


def dimensions() -> list[Dimension]:
    return db.session.scalars(select(Dimension).options(selectinload(Dimension.advice)).order_by(Dimension.position)).all()


def dimension_dict(d: Dimension) -> dict:
    return {"key": d.key, "label": d.label, "short": d.short, "low": d.low_label, "high": d.high_label}


def greeting_dict(g: Greeting) -> dict:
    return {"word": g.word, "roman": g.roman, "lang": g.language, "code": g.lang_code,
            "gesture": g.gesture, "gestureName": g.gesture_name, "note": g.note}


def scenario_dict(s: Scenario) -> dict:
    return {
        "id": s.slug, "country": s.country.code, "title": s.title, "npc": s.npc, "npcRole": s.npc_role,
        "avatar": s.avatar, "start": s.start_trust, "intro": s.intro,
        "steps": [{"npc": st.npc_line,
                   "options": [{"text": o.text, "delta": o.delta, "mood": o.mood, "feedback": o.feedback}
                               for o in st.options]} for st in s.steps],
    }


def scenarios(active_only=True) -> list[Scenario]:
    q = (select(Scenario)
         .options(selectinload(Scenario.steps).selectinload(ScenarioStep.options), selectinload(Scenario.country))
         .order_by(Scenario.id))
    if active_only:
        q = q.where(Scenario.active.is_(True))
    return db.session.scalars(q).all()


def setting(key: str, default=None):
    row = db.session.get(Setting, key)
    return row.value if row else default


def community_stats() -> dict:
    def agg(module):
        n, avg = db.session.execute(
            select(func.count(Attempt.id), func.avg(Attempt.score / func.nullif(Attempt.max_score, 0)))
            .where(Attempt.module == module)).one()
        return {"count": n, "avg_pct": round((avg or 0) * 100)}
    return {
        "quiz": agg("quiz"), "match": agg("match"), "roleplay": agg("roleplay"),
        "decodes": db.session.scalar(select(func.count(Attempt.id)).where(Attempt.module == "decode")),
        "cached_analyses": db.session.scalar(select(func.count(TranslationCache.id))),
        "alumni_voices": db.session.scalar(select(func.count(AlumniVoice.id)).where(AlumniVoice.approved.is_(True))),
    }


def badge_for(score: int, total: int) -> QuizBadge | None:
    # Badges are defined for 12 cases; rescale if admins added/removed questions.
    scaled = round(score * 12 / total) if total else 0
    return db.session.scalar(select(QuizBadge).where(QuizBadge.min_score <= scaled, QuizBadge.max_score >= scaled))


def references() -> list[str]:
    return [r.text for r in db.session.scalars(select(Reference).order_by(Reference.id))]


# ---------------------------------------------------------------------------
# 6D Gap Radar: Cultural Distance Index + Culture Shock Warning
# ---------------------------------------------------------------------------
def radar(a: Country, b: Country) -> dict:
    dims = dimensions()
    da, db_ = a.dims(), b.dims()
    va = [da[d.key] for d in dims]
    vb = [db_[d.key] for d in dims]
    # RMS of the six gaps, scaled to 0–100
    rms = math.sqrt(sum((y - x) ** 2 for x, y in zip(va, vb)) / len(dims))
    index = min(100, round(rms * 2))
    level = ("low", "Mild adjustment") if index < 35 else ("mid", "Moderate culture shock risk") if index < 60 \
        else ("high", "High culture shock risk")

    gaps = []
    for i, d in enumerate(dims):
        diff = vb[i] - va[i]
        if abs(diff) < 10:
            continue
        direction = "up" if diff > 0 else "down"
        sev = "high" if abs(diff) >= 40 else "mid" if abs(diff) >= 20 else "low"
        gaps.append({
            "index": i, "key": d.key, "label": d.label, "diff": diff, "abs": abs(diff),
            "from": va[i], "to": vb[i], "severity": sev, "direction": direction,
            "pole": d.high_label if diff > 0 else d.low_label,
            "advice": [g.text for g in d.advice if g.direction == direction],
        })
    gaps.sort(key=lambda g: g["abs"], reverse=True)
    return {
        "from": {"code": a.code, "name": a.name, "flag": a.flag, "values": va},
        "to": {"code": b.code, "name": b.name, "flag": b.flag, "values": vb},
        "dimensions": [dimension_dict(d) for d in dims],
        "distance_index": index,
        "level": level[0],
        "level_label": level[1],
        "top_gaps": gaps[:3],
    }
