"""Relational schema for CultureBridge AI.

Reference data (countries, dimensions, cases) is filled by seed.py from
seed_data/research_data.json. Activity tables (attempts, AI cache) grow at runtime.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import true

from .extensions import db


def utcnow():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Countries and cultural dimensions
# ---------------------------------------------------------------------------
class Country(db.Model):
    __tablename__ = "countries"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(2), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    flag: Mapped[str] = mapped_column(String(16))
    iso_numeric: Mapped[str] = mapped_column(String(3))
    lang: Mapped[str] = mapped_column(String(10))
    context: Mapped[str] = mapped_column(String(60))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    mentality: Mapped[str] = mapped_column(Text)
    proxemics_cm: Mapped[int] = mapped_column(Integer)
    voice_min: Mapped[int] = mapped_column(Integer)
    voice_max: Mapped[int] = mapped_column(Integer)
    hospitality: Mapped[float] = mapped_column(Float, default=1.0)

    etiquette: Mapped[list["EtiquetteRule"]] = relationship(back_populates="country", cascade="all, delete-orphan", order_by="EtiquetteRule.position")
    universities: Mapped[list["University"]] = relationship(back_populates="country", cascade="all, delete-orphan")
    voices: Mapped[list["AlumniVoice"]] = relationship(back_populates="country", cascade="all, delete-orphan")
    scores: Mapped[list["CountryDimension"]] = relationship(back_populates="country", cascade="all, delete-orphan")

    def dims(self) -> dict:
        return {s.dimension.key: s.value for s in self.scores}


class Dimension(db.Model):
    __tablename__ = "dimensions"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(20), unique=True)
    label: Mapped[str] = mapped_column(String(80))
    short: Mapped[str] = mapped_column(String(40))
    low_label: Mapped[str] = mapped_column(String(120))
    high_label: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer, default=0)

    advice: Mapped[list["GapAdvice"]] = relationship(back_populates="dimension", cascade="all, delete-orphan")


class CountryDimension(db.Model):
    __tablename__ = "country_dimensions"
    __table_args__ = (UniqueConstraint("country_id", "dimension_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id", ondelete="CASCADE"))
    dimension_id: Mapped[int] = mapped_column(ForeignKey("dimensions.id", ondelete="CASCADE"))
    value: Mapped[int] = mapped_column(Integer)

    country: Mapped[Country] = relationship(back_populates="scores")
    dimension: Mapped[Dimension] = relationship(lazy="joined")


class GapAdvice(db.Model):
    __tablename__ = "gap_advice"
    id: Mapped[int] = mapped_column(primary_key=True)
    dimension_id: Mapped[int] = mapped_column(ForeignKey("dimensions.id", ondelete="CASCADE"))
    direction: Mapped[str] = mapped_column(String(4))  # "up" | "down"
    text: Mapped[str] = mapped_column(Text)

    dimension: Mapped[Dimension] = relationship(back_populates="advice")


class EtiquetteRule(db.Model):
    __tablename__ = "etiquette_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    text: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)

    country: Mapped[Country] = relationship(back_populates="etiquette")


# ---------------------------------------------------------------------------
# NIS alumni survey
# ---------------------------------------------------------------------------
class University(db.Model):
    __tablename__ = "universities"
    id: Mapped[int] = mapped_column(primary_key=True)
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(160))

    country: Mapped[Country] = relationship(back_populates="universities")


class AlumniVoice(db.Model):
    """One survey response / community story about studying abroad (a.k.a. AlumniInsight).

    ``text`` holds the cultural observations. Survey rows are anonymous by default
    (``student_name`` is NULL) — names are published only with the author's consent.
    """
    __tablename__ = "alumni_voices"
    id: Mapped[int] = mapped_column(primary_key=True)
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id", ondelete="CASCADE"))
    university: Mapped[str] = mapped_column(String(160))
    text: Mapped[str] = mapped_column(Text)
    approved: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # structured survey fields (added in schema v2; nullable so old databases migrate in place)
    student_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    nis_branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    program_duration: Mapped[str | None] = mapped_column(String(60), nullable=True)
    advice: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)   # survey | community | admin

    country: Mapped[Country] = relationship(back_populates="voices")


# ---------------------------------------------------------------------------
# Learning content
# ---------------------------------------------------------------------------
class Greeting(db.Model):
    __tablename__ = "greetings"
    id: Mapped[int] = mapped_column(primary_key=True)
    word: Mapped[str] = mapped_column(String(80))
    roman: Mapped[str] = mapped_column(String(80))
    language: Mapped[str] = mapped_column(String(60))
    lang_code: Mapped[str] = mapped_column(String(10))
    gesture: Mapped[str] = mapped_column(String(16))
    gesture_name: Mapped[str] = mapped_column(String(80))
    note: Mapped[str] = mapped_column(String(200))


class MatchItem(db.Model):
    __tablename__ = "match_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    custom: Mapped[str] = mapped_column(String(80))
    icon: Mapped[str] = mapped_column(String(16))
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id"))
    situation: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text)

    country: Mapped[Country] = relationship()


class QuizQuestion(db.Model):
    __tablename__ = "quiz_questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    topic: Mapped[str] = mapped_column(String(80))
    flag: Mapped[str] = mapped_column(String(16), default="🌍")
    question: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    options: Mapped[list["QuizOption"]] = relationship(back_populates="question", cascade="all, delete-orphan", order_by="QuizOption.position")


class QuizOption(db.Model):
    __tablename__ = "quiz_options"
    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("quiz_questions.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)

    question: Mapped[QuizQuestion] = relationship(back_populates="options")


class QuizBadge(db.Model):
    __tablename__ = "quiz_badges"
    id: Mapped[int] = mapped_column(primary_key=True)
    min_score: Mapped[int] = mapped_column(Integer)
    max_score: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(80))
    icon: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)


class Scenario(db.Model):
    __tablename__ = "scenarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id"))
    title: Mapped[str] = mapped_column(String(160))
    npc: Mapped[str] = mapped_column(String(80))
    npc_role: Mapped[str] = mapped_column(String(120))
    avatar: Mapped[str] = mapped_column(String(32))
    intro: Mapped[str] = mapped_column(Text)
    start_trust: Mapped[int] = mapped_column(Integer, default=50)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    country: Mapped[Country] = relationship()
    steps: Mapped[list["ScenarioStep"]] = relationship(back_populates="scenario", cascade="all, delete-orphan", order_by="ScenarioStep.position")


class ScenarioStep(db.Model):
    __tablename__ = "scenario_steps"
    id: Mapped[int] = mapped_column(primary_key=True)
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    npc_line: Mapped[str] = mapped_column(Text)

    scenario: Mapped[Scenario] = relationship(back_populates="steps")
    options: Mapped[list["ScenarioOption"]] = relationship(back_populates="step", cascade="all, delete-orphan", order_by="ScenarioOption.position")


class ScenarioOption(db.Model):
    __tablename__ = "scenario_options"
    id: Mapped[int] = mapped_column(primary_key=True)
    step_id: Mapped[int] = mapped_column(ForeignKey("scenario_steps.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    delta: Mapped[int] = mapped_column(Integer)
    mood: Mapped[str] = mapped_column(String(12))
    feedback: Mapped[str] = mapped_column(Text)

    step: Mapped[ScenarioStep] = relationship(back_populates="options")


class Reference(db.Model):
    __tablename__ = "reference_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(Text)


class Setting(db.Model):
    """Key/value store for structured reference data (pragmatic engine lexicon, moods…)."""
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


# ---------------------------------------------------------------------------
# AI cache and analytics
# ---------------------------------------------------------------------------
class TranslationCache(db.Model):
    __tablename__ = "translation_cache"
    __table_args__ = (UniqueConstraint("phrase_hash", "country_code", "provider"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    phrase_hash: Mapped[str] = mapped_column(String(64), index=True)
    phrase: Mapped[str] = mapped_column(Text)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    provider: Mapped[str] = mapped_column(String(20))   # gemini | openai | expert
    model: Mapped[str] = mapped_column(String(60), default="")
    result: Mapped[dict] = mapped_column(JSON)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Attempt(db.Model):
    """Activity log (a.k.a. UserAttempt): quiz, match, roleplay and decoder results.

    Name and countries are optional and only set when a learner asks for a certificate.
    ``detail`` keeps per-item results (e.g. wrong quiz question ids) for the "most common mistakes" analytics.
    """
    __tablename__ = "attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    module: Mapped[str] = mapped_column(String(20), index=True)   # quiz | match | roleplay | decode | roleplay_ai
    ref: Mapped[str] = mapped_column(String(60), default="")      # scenario slug / country code
    score: Mapped[float] = mapped_column(Float, default=0)
    max_score: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # learner analytics (schema v2)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    origin_country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    target_country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    cultural_level: Mapped[str | None] = mapped_column(String(20), nullable=True)   # Beginner | Learner | Expert
    token: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)  # certificate URL token
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)


# ---------------------------------------------------------------------------
# Systematic Learning & Accounts (User accounts, Tracks & Mastery)
# ---------------------------------------------------------------------------
from werkzeug.security import check_password_hash, generate_password_hash


class User(db.Model):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(100), default="")
    target_country: Mapped[str] = mapped_column(String(2), default="DE")
    cq_level: Mapped[str] = mapped_column(String(40), default="Novice Explorer")
    streak_days: Mapped[int] = mapped_column(Integer, default=1)
    last_active_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    tracks: Mapped[list["TrackProgress"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    attempts: Mapped[list["Attempt"]] = relationship(foreign_keys=[Attempt.user_id], cascade="all")

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "fullName": self.full_name or self.username,
            "targetCountry": self.target_country,
            "cqLevel": self.cq_level,
            "streakDays": self.streak_days,
            "createdAt": self.created_at.date().isoformat() if self.created_at else None,
        }


class TrackProgress(db.Model):
    __tablename__ = "track_progress"
    __table_args__ = (UniqueConstraint("user_id", "country_code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    current_step: Mapped[int] = mapped_column(Integer, default=1)  # 1 to 5
    completed_steps: Mapped[list] = mapped_column(JSON, default=list)  # ["first_contact", ...]
    scores: Mapped[dict] = mapped_column(JSON, default=dict)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    certificate_token: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped["User"] = relationship(back_populates="tracks")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "countryCode": self.country_code,
            "currentStep": self.current_step,
            "completedSteps": self.completed_steps or [],
            "scores": self.scores or {},
            "isCompleted": bool(self.is_completed),
            "certificateToken": self.certificate_token,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


# Names used in the architecture brief
AlumniInsight = AlumniVoice
MatchingTask = MatchItem
UserAttempt = Attempt
AICacheLog = TranslationCache

