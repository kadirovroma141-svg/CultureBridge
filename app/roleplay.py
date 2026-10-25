"""Free-text roleplay judge with the Cultural Trust Meter.

POST /api/ai/roleplay evaluates what the learner *typed* inside a scenario:
  1. live LLM (Gemini / OpenAI) plays the character and scores the reply          → source "live"
  2. rule-based judge (always available, works offline, deterministic)             → source "engine"
The judge reuses the pragmatic engine (face-threatening features, politeness, formality) and adds cultural cues
derived from the scenario country's six dimensions, so the trust score reacts to etiquette, not just keywords.
"""
import json
import logging
import re

from sqlalchemy import select

from . import ai, pragma
from .extensions import db
from .models import Scenario

log = logging.getLogger(__name__)

MOODS = ("happy", "neutral", "annoyed", "sad", "angry")
MAX_UP, MAX_DOWN = 25, -30

PROMPT = """You are role-playing {npc} ({npc_role}) from {country}, a {context} culture
(directness {direct}/100, hierarchy {hierarchy}/100, expressiveness {express}/100, small talk {smalltalk}/100).
Situation: {intro}
A Kazakh exchange student writes to you: \"\"\"{message}\"\"\"
Earlier student lines: {history}
Current trust of the character towards the student: {trust}/100.
Judge the reply by the cultural etiquette of {country} (not by grammar). Return ONLY JSON with keys:
"delta": integer from -30 to 25 (change of trust),
"mood": one of happy|neutral|annoyed|sad|angry (the character's feeling now),
"npc_reply": string, 1-2 sentences, in character, in English,
"feedback": string, 1-2 sentences explaining what worked or offended, citing the cultural reason,
"signals": array of up to 4 objects {{"label": short string, "effect": integer}}."""

REPLIES = {
    "HU": {
        "happy": "Thank you, that is a very courteous way to put it. Please, tell me more.",
        "neutral": "I see. Please continue — what exactly do you need from me?",
        "annoyed": "Hmm. Here we usually address teachers a little more formally. Let us start again.",
        "sad": "That was rather abrupt, I must say. Could you rephrase that, please?",
        "angry": "I am sorry, but this tone is not acceptable in my office.",
    },
    "IT": {
        "happy": "Che bravo! Come, sit, sit — you are already part of the family!",
        "neutral": "Eh, va bene… but you must taste a little at least, no?",
        "annoyed": "Mamma mia… you do not like my cooking? I made it with love all morning.",
        "sad": "…I see. In this house we show respect at the table. It hurts a little.",
        "angry": "Basta! If you do not want to eat with us, then…",
    },
    "DE": {
        "happy": "Good, that is clear and fair. Let's agree on a concrete plan then.",
        "neutral": "Okay. Can you be more specific about the timeline?",
        "annoyed": "That is vague. I need exact times and who does what.",
        "sad": "Honestly, that was not constructive. Let's stick to the facts.",
        "angry": "This is unprofessional. If you cannot keep the deadline, tell me directly, now.",
    },
    "US": {
        "happy": "Aw, that's so sweet! We should totally grab coffee sometime!",
        "neutral": "Oh, cool! So, how are you liking it here so far?",
        "annoyed": "Oh… okay. Um, well, anyway. Have a good one, I guess.",
        "sad": "Wow, okay. That was kind of cold… I was just trying to be friendly.",
        "angry": "Alright, whatever. I'm gonna go sit over there.",
    },
    "_": {
        "happy": "That is very considerate of you, thank you.",
        "neutral": "I see, please go on.",
        "annoyed": "That sounded a little abrupt to me.",
        "sad": "That was hurtful. Could you say it differently?",
        "angry": "I think we should end this conversation.",
    },
}

POSITIVE = [
    ("polite request", r"\b(please|would you mind|could you|would it be possible|if (?:it'?s )?possible|if you (?:have|had) (?:a )?(?:moment|time)|kindly)\b", 7),
    ("gratitude", r"\b(thank(?:s| you)|thanks a lot|appreciate|grateful|much obliged)\b", 7),
    ("warm greeting", r"\b(hello|hi\b|good (?:morning|afternoon|evening)|nice to meet|pleasure to meet|dear)\b", 5),
    ("apology / softening", r"\b(sorry|excuse me|apolog\w+|forgive me|pardon)\b", 5),
    ("genuine interest", r"(\?|tell me (?:more|about)|what do you think|how (?:was|is|are)|i(?:'d| would) love to (?:hear|know|learn))", 5),
    ("compliment", r"\b(delicious|wonderful|amazing|beautiful|lovely|great|fantastic|tasty|love (?:it|this|your))\b", 5),
]
TITLES = r"\b(professor|prof\.|dr\.?|doctor|herr|frau|mr\.?|ms\.?|mrs\.?|sir|madam)\b"
CASUAL = r"\b(hey|yo|dude|guys|mate|bro|gimme|whatever|nah)\b"
SMALLTALK = r"\b(weather|weekend|how are you|how's it going|how was your|your day|where are you from|coffee|campus|city)\b"
PRECISION = r"\b(by|until|deadline|schedule|agenda|plan|exactly|at \d|o'clock|tomorrow|on time|punctual|minutes?)\b"
ENTHUSIASM = r"(!|\b(love|delicious|amazing|beautiful|wonderful|fantastic|mamma)\b)"
SMALL_PORTION = r"\b(small (?:portion|bit|piece|amount)|a little|just a bit|try (?:a|some)|taste|small helping)\b"


def _rx(p: str) -> re.Pattern:
    return re.compile(p, re.IGNORECASE)


def _mood_for(delta: int) -> str:
    if delta >= 8:
        return "happy"
    if delta >= 0:
        return "neutral"
    if delta > -9:
        return "annoyed"
    if delta > -22:
        return "sad"
    return "angry"


def judge(message: str, country, scenario: Scenario, lexicon: dict) -> dict:
    """Deterministic scorer. Returns delta, mood, feedback and the list of signals that produced the score."""
    text, lower = message.strip(), message.lower()
    dims = country.dims()
    words = re.findall(r"[\w'’-]+", lower)
    signals: list[dict] = []

    def add(label: str, effect: int):
        signals.append({"label": label, "effect": effect})

    for label, pattern, pts in POSITIVE:
        if _rx(pattern).search(lower):
            add(label, pts)

    analysis = pragma.analyze(text, country, lexicon)
    penalty = round(analysis["risk"] * 0.45)
    if penalty >= 4:
        label = ", ".join(analysis["tags"][:2]) or "face-threatening wording"
        add(f"risky for {country.name}: {label}", -penalty)

    if dims["hierarchy"] >= 60:
        if _rx(TITLES).search(lower):
            add("respectful title / formal address", 8)
        elif scenario.npc_role.lower().startswith(("prof", "dr")) or "professor" in scenario.npc_role.lower():
            add("no title used with a person in authority", -8)
        if _rx(CASUAL).search(lower):
            add("too casual for the power distance", -10)
    if dims["direct"] >= 80:
        if _rx(PRECISION).search(lower):
            add("precise and time-specific (valued here)", 7)
        if analysis["softeners"] >= 3:
            add("over-hedged: sounds vague here", -6)
    if dims["smalltalk"] >= 70 and _rx(SMALLTALK).search(lower):
        add("friendly small talk", 7)
    if dims["express"] >= 80 and _rx(ENTHUSIASM).search(lower):
        add("warm, expressive tone", 6)
    if scenario.slug.endswith("dinner") or "food" in analysis.get("tags", []) or analysis.get("category") == "food":
        if _rx(SMALL_PORTION).search(lower):
            add("accepts a little: honours the host", 8)

    if len(words) < 3:
        add("too curt", -6)
    elif len(words) > 60:
        add("long-winded", -3)
    if text.isupper() and len(text) > 6:
        add("shouting (all caps)", -8)

    delta = max(MAX_DOWN, min(MAX_UP, sum(s["effect"] for s in signals)))
    mood = _mood_for(delta)
    good = [s["label"] for s in signals if s["effect"] > 0][:2]
    bad = [s["label"] for s in signals if s["effect"] < 0][:2]
    if delta >= 8:
        feedback = "Well done — " + (", ".join(good) if good else "your tone matched local expectations") + "."
    elif delta >= 0:
        feedback = "Acceptable, but not memorable." + (f" Strong point: {good[0]}." if good else "") + \
                   " Add a polite marker and a culturally fitting cue to earn more trust."
    else:
        feedback = "Risky: " + ", ".join(bad or ["the wording may sound abrupt"]) + ". " + \
                   (analysis["notes"][0] if analysis["notes"] else "Soften the tone and show respect for local norms.")
    return {"delta": delta, "mood": mood, "feedback": feedback, "signals": signals[:6]}


def npc_line(code: str, mood: str) -> str:
    return REPLIES.get(code, REPLIES["_"])[mood]


def _clean_llm(raw: str) -> dict:
    j = json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip())
    delta = max(MAX_DOWN, min(MAX_UP, int(round(float(j.get("delta", 0))))))
    mood = str(j.get("mood", "")).lower()
    signals = []
    for s in (j.get("signals") or [])[:4]:
        try:
            signals.append({"label": str(s["label"])[:80], "effect": max(-30, min(30, int(s["effect"])))})
        except (KeyError, TypeError, ValueError):
            continue
    return {"delta": delta, "mood": mood if mood in MOODS else _mood_for(delta),
            "npc_reply": str(j.get("npc_reply", ""))[:400], "feedback": str(j.get("feedback", ""))[:500], "signals": signals}


def respond(scenario_slug: str, message: str, trust: float, history: list[str]) -> dict:
    scenario = db.session.scalar(select(Scenario).where(Scenario.slug == scenario_slug, Scenario.active.is_(True)))
    if scenario is None:
        raise LookupError("Scenario not found")
    country = scenario.country
    provider, key, model = ai.active_provider()
    result, source = None, "engine"

    if provider != "none":
        dims = country.dims()
        prompt = PROMPT.format(
            npc=scenario.npc, npc_role=scenario.npc_role, country=country.name, context=country.context.lower(),
            direct=dims["direct"], hierarchy=dims["hierarchy"], express=dims["express"], smalltalk=dims["smalltalk"],
            intro=scenario.intro, message=message.replace('"""', "'''"),
            history=json.dumps(history[-4:], ensure_ascii=False), trust=round(trust))
        try:
            result, source = _clean_llm(ai._call_llm(provider, key, model, prompt)), "live"
        except Exception as exc:  # network down, quota, bad JSON → deterministic judge
            log.warning("Roleplay LLM failed (%s): %s", provider, exc)

    if result is None:
        result = judge(message, country, scenario, ai.lexicon())
        result["npc_reply"] = npc_line(country.code, result["mood"])
    elif not result["npc_reply"]:
        result["npc_reply"] = npc_line(country.code, result["mood"])
    if not result["feedback"]:
        result["feedback"] = judge(message, country, scenario, ai.lexicon())["feedback"]

    new_trust = max(0, min(100, round(trust + result["delta"])))
    return {
        "trust_score": new_trust, "delta": result["delta"], "mood": result["mood"], "npc_reply": result["npc_reply"],
        "feedback": result["feedback"], "signals": result["signals"], "source": source,
        "provider": provider if source == "live" else "engine", "npc": scenario.npc,
    }
