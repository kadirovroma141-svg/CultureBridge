"""Systematic Country Learning Tracks Curriculum & Progression Engine.

Implements David Kolb's Experiential Learning Cycle and Earley & Ang's CQ framework.
Each country track has 5 structured lessons:
  1. First Contact & Non-Verbal Codes (greetings, proxemics, voice)
  2. Cultural Gap Radar & Shock Prevention (6D dimensions, CDI, U-curve)
  3. Pragmatic Subtext Decoder (Hall context, face theory, polite registers)
  4. Roleplay Simulation (live dialogue with local NPC, target trust >= 70%)
  5. Qualification Exam (customs matching + situational dilemmas -> Official Certificate)
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import select

from .extensions import db
from .models import Attempt, Country, Scenario, TrackProgress, User
from .services import country_dict, radar


TRACK_STEPS = [
    {
        "id": "first_contact",
        "number": 1,
        "title": "First Contact & Non-Verbal Codes",
        "icon": "🤝",
        "objective": "Master initial greetings, observe interpersonal proxemics distance, and calibrate speech loudness.",
        "theory": "Edward T. Hall (1966) showed that physical distance communicates relationship boundaries before words are spoken.",
        "tasks": [
            "Learn the local greeting gesture and spoken pronunciation",
            "Adjust the proxemics comfort bubble to match the local norm",
            "Read the top 3 etiquette rules for acquaintances"
        ]
    },
    {
        "id": "shock_radar",
        "number": 2,
        "title": "Gap Radar & Shock Prevention",
        "icon": "📡",
        "objective": "Measure the 6D cultural distance from Kazakhstan, study the Oberg U-curve, and review risk zones.",
        "theory": "Geert Hofstede & Erin Meyer demonstrate that misalignment on communication directness or punctuality triggers acute culture shock.",
        "tasks": [
            "Inspect the 6D radar chart and the Cultural Distance Index (CDI)",
            "Review predicted crisis dip on Oberg's adaptation curve",
            "Complete the personal adaptation checklist for the largest gap"
        ]
    },
    {
        "id": "pragmatics",
        "number": 3,
        "title": "Pragmatic Subtext & Politeness",
        "icon": "🧠",
        "objective": "Learn to hear how direct phrases land on local ears, and master polite rephrasings in English and the local language.",
        "theory": "Brown & Levinson's Face Theory explains that direct criticism or abrupt refusals threaten positive or negative face.",
        "tasks": [
            "Decode a direct phrase using the Pragmatic Subtext Translator",
            "Examine how a local interprets the utterance and review the conflict-risk meter",
            "Save or practice the local-language alternative phrase"
        ]
    },
    {
        "id": "simulation",
        "number": 4,
        "title": "Live Interactive Simulation",
        "icon": "🎭",
        "objective": "Navigate a realistic dialogue with a local character and build trust to at least 70%.",
        "theory": "Earley & Ang's CQ Action component requires dynamic behavioral adaptation during real-time social exchanges.",
        "tasks": [
            "Initiate a dialogue with the virtual NPC character",
            "Balance formal respect and warmth according to local hierarchy",
            "Finish the scenario with at least 70% trust"
        ]
    },
    {
        "id": "exam",
        "number": 5,
        "title": "Country Qualification Exam",
        "icon": "🏆",
        "objective": "Demonstrate comprehensive cultural readiness and unlock the verified Certificate of Country Readiness.",
        "theory": "Comprehensive synthesis of cognitive, metacognitive, motivational, and behavioral CQ.",
        "tasks": [
            "Match specific customs and traditions with correct real-life situations",
            "Solve situational case dilemmas accurately",
            "Score at least 80% to earn the verifiable Track Certificate"
        ]
    }
]

STEP_IDS = [s["id"] for s in TRACK_STEPS]


def get_country_track(code: str, user: User | None = None) -> dict | None:
    """Return full curriculum and lesson tasks for a destination country track."""
    country = db.session.scalar(select(Country).where(Country.code == code))
    if not country:
        return None

    # Load user progress if logged in
    progress = None
    if user:
        progress = db.session.scalar(
            select(TrackProgress).where(
                TrackProgress.user_id == user.id,
                TrackProgress.country_code == code
            )
        )

    completed = set(progress.completed_steps if progress else [])
    scores = progress.scores if progress else {}
    current_idx = progress.current_step if progress else 1

    # Enrich steps with country-specific context
    c_info = country_dict(country)
    kz_country = db.session.scalar(select(Country).where(Country.code == "KZ"))
    if kz_country and code != "KZ":
        r_info = radar(kz_country, country)
    elif kz_country:
        de_c = db.session.scalar(select(Country).where(Country.code == "DE"))
        r_info = radar(kz_country, de_c) if de_c else {}
    else:
        r_info = {}

    scenarios = db.session.scalars(
        select(Scenario).where(Scenario.country_id == country.id, Scenario.active == True)
    ).all()

    enriched_steps = []
    for idx, s in enumerate(TRACK_STEPS, 1):
        step_copy = dict(s)
        is_done = s["id"] in completed
        # A step is unlocked if it's the first step OR the previous step is completed
        prev_done = (idx == 1) or (TRACK_STEPS[idx - 2]["id"] in completed)
        is_unlocked = prev_done or is_done

        step_copy["isCompleted"] = is_done
        step_copy["isUnlocked"] = is_unlocked
        step_copy["isCurrent"] = is_unlocked and not is_done
        step_copy["score"] = scores.get(s["id"])

        if s["id"] == "first_contact":
            step_copy["contextData"] = {
                "proxemics": country.proxemics_cm,
                "voice": [country.voice_min, country.voice_max],
                "etiquette": [[e.title, e.text] for e in country.etiquette[:3]],
            }
        elif s["id"] == "shock_radar":
            step_copy["contextData"] = {
                "distanceIndex": r_info.get("distance_index"),
                "level": r_info.get("level"),
                "levelLabel": r_info.get("level_label"),
                "topGaps": r_info.get("top_gaps")[:2]
            }
        elif s["id"] == "simulation":
            step_copy["contextData"] = {
                "scenarios": [{"id": sc.slug, "title": sc.title, "npc": sc.npc, "role": sc.npc_role, "avatar": sc.avatar} for sc in scenarios]
            }
        enriched_steps.append(step_copy)

    total_steps = len(TRACK_STEPS)
    completed_count = len(completed)
    percent = round((completed_count / total_steps) * 100)

    return {
        "country": {
            "code": country.code,
            "name": country.name,
            "flag": country.flag,
            "lang": country.lang,
            "context": country.context,
            "mentality": country.mentality,
        },
        "curriculum": enriched_steps,
        "progress": {
            "completedCount": completed_count,
            "totalSteps": total_steps,
            "percent": percent,
            "isCompleted": bool(progress and progress.is_completed),
            "certificateToken": progress.certificate_token if progress else None,
        }
    }


def list_tracks_overview(user: User | None = None) -> list[dict]:
    """List all 10 destination country tracks with user progress overview."""
    countries = db.session.scalars(select(Country).order_by(Country.id)).all()
    user_tracks = {}
    if user:
        pts = db.session.scalars(select(TrackProgress).where(TrackProgress.user_id == user.id)).all()
        user_tracks = {p.country_code: p for p in pts}

    results = []
    for c in countries:
        tp = user_tracks.get(c.code)
        completed_steps = tp.completed_steps if tp else []
        completed_count = len(completed_steps)
        total_steps = len(TRACK_STEPS)
        percent = round((completed_count / total_steps) * 100)

        results.append({
            "code": c.code,
            "name": c.name,
            "flag": c.flag,
            "context": c.context,
            "completedCount": completed_count,
            "totalSteps": total_steps,
            "percent": percent,
            "isCompleted": bool(tp and tp.is_completed),
            "isTarget": bool(user and user.target_country == c.code),
            "certificateToken": tp.certificate_token if tp else None
        })
    return results


def record_step_progress(user: User, country_code: str, step_id: str, score: float | None = None, detail: dict | None = None) -> dict:
    """Record completion of a track step, advance progression, update streak & certificates."""
    if step_id not in STEP_IDS:
        raise ValueError(f"Invalid step_id {step_id}")

    country = db.session.scalar(select(Country).where(Country.code == country_code))
    if not country:
        raise ValueError(f"Unknown country {country_code}")

    tp = db.session.scalar(
        select(TrackProgress).where(
            TrackProgress.user_id == user.id,
            TrackProgress.country_code == country_code
        )
    )
    if not tp:
        tp = TrackProgress(
            user_id=user.id,
            country_code=country_code,
            completed_steps=[],
            scores={},
            current_step=1,
            is_completed=False
        )
        db.session.add(tp)

    completed = list(tp.completed_steps or [])
    scores = dict(tp.scores or {})

    if step_id not in completed:
        completed.append(step_id)
        tp.completed_steps = completed

    if score is not None:
        scores[step_id] = round(score, 1)
        tp.scores = scores

    # Advance current_step
    next_idx = len(completed) + 1
    tp.current_step = min(len(TRACK_STEPS), next_idx)

    # Check if all steps completed
    cert_url = None
    if set(completed) >= set(STEP_IDS):
        tp.is_completed = True
        if not tp.certificate_token:
            token = uuid.uuid4().hex[:16]
            tp.certificate_token = token
            # Create attempt record for certificate verification
            avg_score = sum(scores.values()) / max(1, len(scores)) if scores else 90.0
            attempt = Attempt(
                module="track",
                ref=country_code,
                score=avg_score,
                max_score=100.0,
                user_id=user.id,
                user_name=user.full_name or user.username,
                origin_country="KZ",
                target_country=country_code,
                cultural_level="Expert" if avg_score >= 80 else "Learner",
                token=token,
                detail={"track": country_code, "scores": scores}
            )
            db.session.add(attempt)

    # Update streak
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if user.last_active_date != today_str:
        user.streak_days = (user.streak_days or 1) + 1
        user.last_active_date = today_str

    # Update user CQ Level based on total tracks completed
    all_completed = db.session.scalars(
        select(TrackProgress).where(TrackProgress.user_id == user.id, TrackProgress.is_completed == True)
    ).all()
    count_comp = len(all_completed) + (1 if tp.is_completed and tp not in all_completed else 0)
    if count_comp >= 3:
        user.cq_level = "Global Diplomat"
    elif count_comp >= 1:
        user.cq_level = "Cultural Analyst"
    else:
        user.cq_level = "Novice Explorer"

    db.session.commit()

    return {
        "stepId": step_id,
        "isCompleted": tp.is_completed,
        "certificateToken": tp.certificate_token,
        "certificateUrl": f"/certificate/{tp.certificate_token}" if tp.certificate_token else None,
        "percent": round((len(completed) / len(TRACK_STEPS)) * 100),
        "cqLevel": user.cq_level,
        "streakDays": user.streak_days
    }
