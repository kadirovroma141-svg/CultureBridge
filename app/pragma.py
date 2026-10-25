"""Rule-based pragmatic engine (offline expert system).

Detects face-threatening features in an English phrase (Brown & Levinson),
weights them by the listener culture's dimensions (Hall, Hofstede, Meyer)
and returns a conflict-risk score, an interpretation and an adapted phrase.
Used as the fallback when no LLM is reachable, and to pre-compute the
expert cache during seeding.
"""
import math
import re
from functools import lru_cache

FEATURE_NOTES = {
    "criticism": "Open criticism threatens the listener’s “positive face” (Brown & Levinson).",
    "rejection": "A bare “no” without a cushion or reason is a face-threatening act.",
    "food": "Refusing food rejects the host’s generosity — hospitality is tied to honour.",
    "blame": "Starting with “you/your” makes it personal instead of task-focused.",
    "imperative": "A command imposes on the listener’s “negative face” (freedom of action).",
    "superior": "Giving orders or deadlines to a professor/elder reverses the expected power distance (Hofstede).",
    "informal": "Casual register ignores status differences.",
    "absolute": "Absolutes (always, never, unacceptable) escalate emotion.",
    "time": "Time is a value issue: the meaning of lateness differs across cultures.",
    "intensity": "Exclamation marks / caps read as shouting.",
}
AUTHORITY_RX = re.compile(r"(professor|teacher|sir|madam|\bdr\b|doctor|sensei|tanár)")
OBJECT_RX = re.compile(r"(?:give|send|share|lend|bring|show) me (.+?)[.!?]*$")
LEVEL_LABELS = ["Low risk", "Caution", "High conflict risk"]


@lru_cache(maxsize=256)
def _rx(pattern: str, case_sensitive: bool = False) -> re.Pattern:
    return re.compile(pattern, 0 if case_sensitive else re.IGNORECASE)


def sensitivity(dims: dict, hospitality: float) -> dict:
    return {
        "indirect": 0.25 + (100 - dims["direct"]) / 100 * 1.3,   # indirect cultures amplify criticism
        "hierarchy": 0.5 + dims["hierarchy"] / 100 * 1.1,        # hierarchical cultures amplify commands
        "hospitality": hospitality,
        "time": 0.5 + dims["time"] / 100 * 0.9,                  # monochronic cultures care about lateness
        "neutral": 0.6 + (100 - dims["express"]) / 100 * 0.7,    # neutral cultures dislike outbursts
    }


def level_of(risk: int) -> int:
    return 0 if risk < 30 else 1 if risk < 60 else 2


def analyze(text: str, country, lexicon: dict) -> dict:
    """country: Country model; lexicon: the 'pragma' setting from the DB."""
    code = country.code
    dims = country.dims()
    lower = text.lower().strip()
    sens = sensitivity(dims, country.hospitality)

    found, raw = [], 0.0
    for f in lexicon["features"]:
        subject = text if f["id"] == "intensity" else lower
        hits = sum(1 for p in f["patterns"] if _rx(p, f["id"] == "intensity").search(subject))
        if hits:
            found.append(f)
            raw += f["weight"] * (1 + 0.5 * (min(hits, 3) - 1)) * sens[f["amp"]]

    soft = sum(1 for p in lexicon["softeners"] if _rx(p).search(lower))
    raw = max(0.0, raw - min(soft, 3) * 9)
    risk = round(100 * (1 - math.exp(-raw / 45)))
    notes = []
    if not found and soft >= 3 and dims["direct"] >= 70:
        risk = 18
        notes.append("Very heavy hedging may sound vague or insincere in a low-context culture — state your point clearly.")
    risk = max(2, min(98, risk))
    level = level_of(risk)

    ids = [f["id"] for f in found]
    cat = next((c["id"] for c in lexicon["categories"] if any(t in ids for t in c["test"])), "neutral")
    adapt = lexicon["adapt"]
    if cat == "request" and not AUTHORITY_RX.search(lower):
        cat = "ask"
    if cat == "ask":
        m = OBJECT_RX.search(lower)
        obj = re.sub(r"\bmy\b", "your", m.group(1)) if m else "it"
        adapted = adapt["ask"][code].replace("{obj}", obj)
    elif cat == "neutral":
        t = text.strip()
        for pat, rep in ((r"\bwon'?t\b", "might not"), (r"\bcan'?t\b", "may not be able to"),
                         (r"\byou must\b", "it would be great if you could"), (r"\bneed to\b", "could perhaps")):
            t = re.sub(pat, rep, t, flags=re.IGNORECASE)
        t = t[:1].lower() + t[1:]
        adapted = adapt["neutral"][code].replace("{text}", t)
        if risk < 25:
            notes.append("Your phrase is already culturally safe — the version below is only an optional polish.")
    else:
        adapted = adapt[cat][code]

    notes += [FEATURE_NOTES[f["id"]] for f in found if f["id"] in FEATURE_NOTES]
    return {
        "risk": risk,
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "heard": lexicon["hearing"][code][level],
        "adapted": adapted,
        "tags": [f["label"] for f in found],
        "notes": notes,
        "softeners": soft,
        "category": cat,
    }
