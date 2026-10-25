"""Serialisation helpers and domain algorithms (Gap Radar)."""
import math
import re
import secrets
from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .extensions import db
from .models import (AlumniVoice, Attempt, Country, CountryDimension, Dimension, Greeting, MatchItem, QuizBadge,
                     QuizQuestion, Reference, Scenario, ScenarioStep, Setting, TranslationCache)


def countries_query():
    return (select(Country)
            .options(selectinload(Country.etiquette), selectinload(Country.universities),
                     selectinload(Country.voices), selectinload(Country.scores).joinedload(CountryDimension.dimension))
            .order_by(Country.id))


def get_country(code: str) -> Country | None:
    return db.session.scalar(countries_query().where(Country.code == code.upper()))


def voice_dict(v: AlumniVoice) -> dict:
    return {
        "id": v.id, "uni": v.university, "text": v.text,
        "student": v.student_name, "branch": v.nis_branch, "duration": v.program_duration, "advice": v.advice,
        "verified": True if v.is_verified is None else bool(v.is_verified), "source": v.source or "survey",
        "created": v.created_at.date().isoformat() if v.created_at else None,
    }


def country_dict(c: Country) -> dict:
    voices = sorted((v for v in c.voices if v.approved), key=lambda v: v.id)
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
            "voices": [voice_dict(v) for v in voices],
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
        "participants": db.session.scalar(select(func.count(func.distinct(Attempt.session_id)))) or 0,
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


# ---------------------------------------------------------------------------
# Learner results: level, certificate, analytics
# ---------------------------------------------------------------------------
LEVELS = ("Beginner", "Learner", "Expert")
_SESSION_RX = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def level_for(score: float, total: float) -> str:
    """Beginner 0–6, Learner 7–9, Expert 10–12 on the 12-point scale (rescaled for other totals)."""
    scaled = round(score * 12 / total) if total else 0
    return LEVELS[0] if scaled <= 6 else LEVELS[1] if scaled <= 9 else LEVELS[2]


def clean_session(session_id: str | None) -> str | None:
    return session_id if session_id and _SESSION_RX.match(session_id) else None


def log_attempt(module: str, *, score: float, max_score: float, ref: str = "", learner=None, detail: dict | None = None,
                graded: bool = False) -> Attempt:
    """Persist one result. ``graded`` attempts (quiz / match) get a cultural level and a certificate token."""
    a = Attempt(module=module, ref=ref, score=score, max_score=max_score, detail=detail)
    if learner is not None:
        a.session_id = clean_session(learner.session_id)
        a.user_name = learner.user_name
        a.origin_country = learner.origin_country
        a.target_country = learner.target_country
    if graded:
        a.cultural_level = level_for(score, max_score)
        a.token = secrets.token_urlsafe(12)
    db.session.add(a)
    return a


def _best_pct(session_id: str | None, module: str, fallback: Attempt | None) -> float | None:
    pcts = []
    if session_id:
        rows = db.session.execute(select(Attempt.score, Attempt.max_score)
                                  .where(Attempt.session_id == session_id, Attempt.module == module)).all()
        pcts += [s / m * 100 for s, m in rows if m]
    if fallback is not None and fallback.module == module and fallback.max_score:
        pcts.append(fallback.score / fallback.max_score * 100)
    return round(max(pcts)) if pcts else None


def certificate_data(token: str) -> dict | None:
    """Everything the printable certificate needs: the attempt plus the learner's best results in this session."""
    a = db.session.scalar(select(Attempt).where(Attempt.token == token))
    if a is None:
        return None
    quiz, match = _best_pct(a.session_id, "quiz", a), _best_pct(a.session_id, "match", a)
    parts = [p for p in (quiz, match) if p is not None]
    overall = round(sum(parts) / len(parts)) if parts else 0
    names = {c.code: c for c in db.session.scalars(select(Country)).all()}
    pick = lambda code: ({"code": code, "name": names[code].name, "flag": names[code].flag} if code in names else None)
    return {
        "token": a.token, "name": a.user_name or "CultureBridge Learner", "module": a.module,
        "score": round(a.score), "max_score": round(a.max_score), "quiz_pct": quiz, "match_pct": match,
        "overall_pct": overall, "level": level_for(overall, 100), "issued": a.created_at,
        "origin": pick(a.origin_country), "target": pick(a.target_country),
    }


def detailed_stats() -> dict:
    """Live analytics for /stats: usage, level mix, score histogram, most common mistakes, popular countries."""
    by_module = dict(db.session.execute(select(Attempt.module, func.count(Attempt.id)).group_by(Attempt.module)).all())
    levels = dict.fromkeys(LEVELS, 0)
    levels.update(dict(db.session.execute(
        select(Attempt.cultural_level, func.count(Attempt.id))
        .where(Attempt.cultural_level.is_not(None)).group_by(Attempt.cultural_level)).all()))

    quiz_total = db.session.scalar(select(func.count(QuizQuestion.id)).where(QuizQuestion.active.is_(True))) or 12
    histogram = [0] * (quiz_total + 1)
    for (score,) in db.session.execute(select(Attempt.score).where(Attempt.module == "quiz")).all():
        histogram[max(0, min(quiz_total, round(score)))] += 1

    # most common mistakes (recent 1500 graded attempts that carry per-item results)
    def wrong_counter(module: str) -> tuple[Counter, int]:
        rows = db.session.scalars(select(Attempt).where(Attempt.module == module)
                                  .order_by(Attempt.id.desc()).limit(1500)).all()
        rows = [r for r in rows if isinstance(r.detail, dict) and "wrong" in r.detail]
        c = Counter()
        for r in rows:
            c.update(r.detail["wrong"])
        return c, len(rows)

    quiz_wrong, quiz_n = wrong_counter("quiz")
    topics = {q.id: q for q in db.session.scalars(select(QuizQuestion)).all()}
    top_quiz = [{"id": qid, "topic": topics[qid].topic, "flag": topics[qid].flag, "wrong": n,
                 "rate": round(n / quiz_n * 100) if quiz_n else 0}
                for qid, n in quiz_wrong.most_common(5) if qid in topics]
    match_wrong, match_n = wrong_counter("match")
    items = {m.slug: m for m in db.session.scalars(select(MatchItem).options(selectinload(MatchItem.country))).all()}
    top_match = [{"slug": s, "custom": items[s].custom, "icon": items[s].icon, "country": items[s].country.name,
                  "flag": items[s].country.flag, "wrong": n, "rate": round(n / match_n * 100) if match_n else 0}
                 for s, n in match_wrong.most_common(5) if s in items]

    names = {c.code: c for c in db.session.scalars(select(Country)).all()}
    decode_rows = db.session.execute(select(Attempt.ref, func.count(Attempt.id), func.avg(Attempt.score))
                                     .where(Attempt.module == "decode").group_by(Attempt.ref)
                                     .order_by(func.count(Attempt.id).desc()).limit(10)).all()
    decode_countries = [{"code": r, "name": names[r].name, "flag": names[r].flag, "count": n, "avg_risk": round(avg or 0)}
                        for r, n, avg in decode_rows if r in names]

    scen = {s.slug: s.title for s in db.session.scalars(select(Scenario)).all()}
    rp_rows = db.session.execute(select(Attempt.ref, func.count(Attempt.id), func.avg(Attempt.score))
                                 .where(Attempt.module.in_(("roleplay", "roleplay_ai"))).group_by(Attempt.ref)).all()
    roleplay = [{"slug": r, "title": scen[r], "count": n, "avg_trust": round(avg or 0)} for r, n, avg in rp_rows if r in scen]

    route_rows = db.session.execute(
        select(Attempt.origin_country, Attempt.target_country, func.count(Attempt.id))
        .where(Attempt.origin_country.is_not(None), Attempt.target_country.is_not(None))
        .group_by(Attempt.origin_country, Attempt.target_country)
        .order_by(func.count(Attempt.id).desc()).limit(6)).all()
    routes = [{"from": names[o].flag + " " + names[o].name, "to": names[t].flag + " " + names[t].name, "count": n}
              for o, t, n in route_rows if o in names and t in names]

    daily_rows = db.session.execute(select(func.date(Attempt.created_at), func.count(Attempt.id))
                                    .group_by(func.date(Attempt.created_at))
                                    .order_by(func.date(Attempt.created_at).desc()).limit(14)).all()
    daily = [{"date": str(d), "count": n} for d, n in reversed(daily_rows)]

    return {
        "totals": community_stats(), "by_module": by_module, "levels": levels,
        "quiz_histogram": histogram, "quiz_questions": quiz_total,
        "top_mistakes": {"quiz": top_quiz, "match": top_match},
        "decode_countries": decode_countries, "roleplay": roleplay, "routes": routes, "daily": daily,
    }

