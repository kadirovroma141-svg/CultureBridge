"""Pydantic request schemas (validation for every write endpoint)."""
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CountryCode = Field(min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")
Mood = Literal["happy", "neutral", "annoyed", "sad", "angry"]


class DecodeIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    country: str = CountryCode
    fresh: bool = False

    @field_validator("text")
    @classmethod
    def strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be empty")
        return v


class QuizAnswerIn(BaseModel):
    option_id: int


class QuizFinishIn(BaseModel):
    answers: dict[int, int] = Field(description="question_id → option_id")


class MatchCheckIn(BaseModel):
    pairs: dict[int, str] = Field(description="situation_id → custom slug")


class RoleplayResultIn(BaseModel):
    trust: float = Field(ge=0, le=100)
    mode: Literal["guided", "free"] = "guided"
    session_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]{8,64}$")


SessionId = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]{8,64}$")


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = " ".join(v.split())
    return v or None


class SubtextIn(BaseModel):
    """POST /api/ai/translate-subtext"""
    text: str = Field(min_length=1, max_length=500)
    target_country: str = CountryCode
    fresh: bool = False

    @field_validator("text")
    @classmethod
    def strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be empty")
        return v


class RoleplayTurnIn(BaseModel):
    """POST /api/ai/roleplay — one free-text reply inside a scenario."""
    scenario: str = Field(min_length=3, max_length=60, pattern=r"^[a-z0-9-]+$")
    message: str = Field(min_length=1, max_length=400)
    trust: float = Field(default=50, ge=0, le=100)
    turn: int = Field(default=1, ge=1, le=30)
    history: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("message")
    @classmethod
    def strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        return v

    @field_validator("history")
    @classmethod
    def cut(cls, v: list[str]) -> list[str]:
        return [h[:400] for h in v]


Situation = Literal["academic_dispute", "team_criticism", "home_hospitality", "gift_ceremony", "first_contact",
                    "lateness_crisis", "public_etiquette", "custom_sandbox"]
UserAction = Literal["none", "bow", "handshake", "hug", "give_two_hands", "give_one_hand", "give_clock", "accept_tea",
                     "refuse_food_bluntly", "step_too_close", "step_optimal", "eye_contact_intense", "modest_gaze"]


class SandboxLine(BaseModel):
    role: Literal["user", "npc"]
    text: str = Field(max_length=500)


class RoleplayInteractIn(BaseModel):
    """POST /api/roleplay/interact — one turn in the 3D Nation × Situation sandbox (words and/or a physical action)."""
    country: str = CountryCode
    situation: Situation
    custom_context: str | None = Field(default=None, max_length=300)
    user_message: str = Field(default="", max_length=500)
    user_action: UserAction = "none"
    distance_cm: int = Field(default=120, ge=20, le=400)
    trust: float = Field(default=50, ge=0, le=100)
    turn: int = Field(default=1, ge=0, le=60)
    history: list[SandboxLine] = Field(default_factory=list, max_length=12)

    @field_validator("user_message")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("custom_context")
    @classmethod
    def tidy_context(cls, v):
        return _clean(v)

    @model_validator(mode="after")
    def check(self):
        if self.situation == "custom_sandbox" and not self.custom_context:
            raise ValueError("custom_context is required for the custom_sandbox situation")
        if self.turn > 0 and not self.user_message and self.user_action == "none":
            raise ValueError("say something or perform an action")
        return self


class SandboxResultIn(BaseModel):
    country: str = CountryCode
    situation: Situation
    trust: float = Field(ge=0, le=100)
    turns: int = Field(default=0, ge=0, le=200)
    session_id: str | None = SessionId


class LearnerIn(BaseModel):
    """Identity block shared by the trainer submissions (all optional — anonymous by default)."""
    session_id: str | None = SessionId
    user_name: str | None = Field(default=None, max_length=80)
    origin_country: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")
    target_country: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")

    @field_validator("user_name")
    @classmethod
    def tidy_name(cls, v):
        return _clean(v)


class QuizSubmitIn(LearnerIn):
    answers: dict[int, int] = Field(description="question_id → option_id")


class MatchSubmitIn(LearnerIn):
    pairs: dict[int, str] = Field(description="situation_id → custom slug")


class AlumniAddIn(BaseModel):
    """POST /api/alumni/add — 'Share your study-abroad experience'."""
    country: str = CountryCode
    university: str = Field(min_length=2, max_length=160)
    cultural_observations: str = Field(min_length=20, max_length=1200)
    advice_for_students: str | None = Field(default=None, max_length=800)
    student_name: str | None = Field(default=None, max_length=120)
    nis_branch: str | None = Field(default=None, max_length=120)
    program_duration: str | None = Field(default=None, max_length=60)
    consent_to_publish_name: bool = False
    website: str = Field(default="", max_length=200)   # honeypot: real users leave it empty

    @field_validator("university", "cultural_observations", "advice_for_students", "student_name", "nis_branch",
                     "program_duration")
    @classmethod
    def tidy(cls, v):
        if v is None:
            return None
        v = v.strip()
        return v or None


# ---------------------------------------------------------------- admin
class QuizCreate(BaseModel):
    topic: str = Field(min_length=2, max_length=80)
    flag: str = Field(default="🌍", max_length=16)
    question: str = Field(min_length=10, max_length=1000)
    explanation: str = Field(min_length=10, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0)

    @model_validator(mode="after")
    def check_correct(self):
        self.options = [o.strip() for o in self.options]
        if any(not o for o in self.options):
            raise ValueError("options must not be empty")
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index out of range")
        return self


class QuizPatch(BaseModel):
    active: bool


class VoiceCreate(BaseModel):
    country: str = CountryCode
    university: str = Field(min_length=2, max_length=160)
    text: str = Field(min_length=10, max_length=1200)
    student_name: str | None = Field(default=None, max_length=120)
    nis_branch: str | None = Field(default=None, max_length=120)
    program_duration: str | None = Field(default=None, max_length=60)
    advice: str | None = Field(default=None, max_length=800)
    is_verified: bool = True


class VoicePatch(BaseModel):
    approved: bool | None = None
    is_verified: bool | None = None


class EtiquetteCreate(BaseModel):
    country: str = CountryCode
    title: str = Field(min_length=2, max_length=120)
    text: str = Field(min_length=10, max_length=1000)


class ScenarioOptionIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    delta: int = Field(ge=-50, le=50)
    mood: Mood
    feedback: str = Field(min_length=5, max_length=1000)


class ScenarioStepIn(BaseModel):
    npc: str = Field(min_length=1, max_length=1000)
    options: list[ScenarioOptionIn] = Field(min_length=2, max_length=4)


class ScenarioCreate(BaseModel):
    slug: str = Field(min_length=3, max_length=60, pattern=r"^[a-z0-9-]+$")
    country: str = CountryCode
    title: str = Field(min_length=3, max_length=160)
    npc: str = Field(min_length=1, max_length=80)
    npc_role: str = Field(min_length=1, max_length=120)
    avatar: str = Field(default="🧑", max_length=32)
    intro: str = Field(min_length=5, max_length=1000)
    start_trust: int = Field(default=50, ge=0, le=100)
    steps: list[ScenarioStepIn] = Field(min_length=1, max_length=10)


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=100)
    full_name: str | None = Field(default=None, max_length=100)
    target_country: str = CountryCode


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=100)


class TrackStepCompleteIn(BaseModel):
    step_id: str = Field(min_length=2, max_length=40)
    score: float | None = Field(default=None, ge=0, le=100)
    detail: dict | None = None

