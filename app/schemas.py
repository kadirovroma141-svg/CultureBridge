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
    text: str = Field(min_length=10, max_length=1000)


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
