"""3D AI Cultural Sandbox: any of the 11 nations × any of 8 life situations, with an embodied NPC.

POST /api/roleplay/interact receives what the learner *said* and *did* (a gesture, the distance in cm) and returns
what the 3D character says, which of the 9 procedural animations it plays, its facial emotion, gaze and the new trust.

  1. live LLM (Gemini / OpenAI) plays the character in the first person and picks the animation   → source "live"
  2. deterministic culture engine (always available, offline): the text judge from roleplay.py
     + gesture rules + Hall proxemics, all derived from the country's dimensions in the DB            → source "engine"
Physical facts (personal-space violation) are computed here in both modes, so the LLM cannot ignore them.
"""
import json
import logging
import re
from types import SimpleNamespace

from sqlalchemy import select

from . import ai, roleplay
from .extensions import db
from .models import Country

log = logging.getLogger(__name__)

ANIMATIONS = ("idle_breathing", "bow_respect", "handshake_reach", "two_hands_present", "expressive_gestures",
              "step_back_uncomfortable", "warm_welcome_tea", "nod_approval", "offended_look_away")
EMOTIONS = ("neutral", "joy", "surprise", "annoyed", "anger", "embarrassed", "sad")
GAZES = ("direct", "soft", "averted")
MAX_UP, MAX_DOWN = roleplay.MAX_UP, roleplay.MAX_DOWN

SITUATIONS = {
    "academic_dispute": {
        "title": "Dispute with a professor", "icon": "🎓", "kind": "formal", "role": "Professor · thesis supervisor",
        "brief": "You want a deadline extension — or you disagree with your grade. Ask without making your professor lose face.",
        "tests": ["hierarchy", "direct"],
        "open": {"formal": "Good afternoon. You asked to see me about your essay — please, have a seat. What is it?",
                 "casual": "Hi, come on in! You wanted to talk about your essay grade, right? What's up?"},
    },
    "team_criticism": {
        "title": "Criticise a teammate's idea", "icon": "🧩", "kind": "peer", "role": "Groupmate · university project",
        "brief": "Your groupmate is proud of a weak idea for the group project. Reject it without breaking the relationship.",
        "tests": ["context", "direct"],
        "open": {"formal": "So… this is my concept for our presentation. I worked on it all weekend. What do you think?",
                 "casual": "Okay, here's my idea for the project — I think it's pretty great! Thoughts?"},
    },
    "home_hospitality": {
        "title": "Dinner at a local family's home", "icon": "🍲", "kind": "host", "role": "Host · local family",
        "brief": "The family serves a traditional dish, tea and keeps offering more. Accept graciously — or decline politely for dietary reasons.",
        "tests": ["hospitality", "contact"],
        "open": {"formal": "Welcome, welcome to our home! Please sit down — I prepared our traditional dish especially for you.",
                 "casual": "Hey, come in, make yourself at home! Dinner's ready — hope you're hungry!"},
    },
    "gift_ceremony": {
        "title": "Giving a gift", "icon": "🎁", "kind": "host", "role": "Mentor · host",
        "brief": "You brought a gift to say thank you. Choose what to give (watch, flowers, souvenir) and how to hand it over.",
        "tests": ["hierarchy", "context"],
        "open": {"formal": "Oh, how nice of you to visit. Please come in — it is always a pleasure to see you.",
                 "casual": "Hey, so good to see you! Come in, come in!"},
    },
    "first_contact": {
        "title": "First day: meeting your roommate", "icon": "🏠", "kind": "peer", "role": "Roommate · dormitory",
        "brief": "You meet your new roommate. Choose a greeting, a comfortable distance, small talk and personal boundaries.",
        "tests": ["contact", "smalltalk"],
        "open": {"formal": "Ah… hello. I think we will share this room. Nice to meet you.",
                 "casual": "Hey! You must be my new roommate! Welcome — how was the trip?"},
    },
    "lateness_crisis": {
        "title": "15 minutes late to a meeting", "icon": "⏰", "kind": "formal", "role": "Project supervisor",
        "brief": "You arrive 15 minutes late to an important meeting. Explain and rebuild trust.",
        "tests": ["time"],
        "open": {"formal": "Ah. There you are. We started fifteen minutes ago.",
                 "casual": "Oh, hey, you made it! We kind of started already."},
    },
    "public_etiquette": {
        "title": "Awkward moment in public", "icon": "🚌", "kind": "stranger", "role": "Local · in a queue / on transport",
        "brief": "You accidentally cut a queue, spoke loudly on a bus or bumped into someone. Repair the moment.",
        "tests": ["express", "contact"],
        "open": {"formal": "Excuse me… I believe the queue starts back there.",
                 "casual": "Uh, hey — there's actually a line here, buddy."},
    },
    "custom_sandbox": {
        "title": "Custom situation", "icon": "✨", "kind": "peer", "role": "Local",
        "brief": "Describe any situation in one line — the character will play it out with the culture's norms.",
        "tests": ["direct", "hierarchy"],
        "open": {"formal": "Good day. So — {context}. How may I help you?",
                 "casual": "Hi there! So — {context}. What's on your mind?"},
    },
}

# name, gender (f/m), age (young/adult/elder) — one persona per relationship kind and nation
PERSONAS = {
    "KZ": {"formal": ("Prof. Aigerim Nurlanovna", "f", "adult"), "peer": ("Daniyar", "m", "young"),
           "host": ("Gulnara apa", "f", "elder"), "stranger": ("Serik aga", "m", "elder")},
    "IT": {"formal": ("Prof. Marco Bianchi", "m", "adult"), "peer": ("Giulia", "f", "young"),
           "host": ("Nonna Rosa", "f", "elder"), "stranger": ("Signor Ferri", "m", "adult")},
    "HU": {"formal": ("Dr. Kovács Péter", "m", "adult"), "peer": ("Anna", "f", "young"),
           "host": ("Erzsébet néni", "f", "elder"), "stranger": ("Tóth úr", "m", "adult")},
    "CA": {"formal": ("Prof. Sarah Thompson", "f", "adult"), "peer": ("Liam", "m", "young"),
           "host": ("Mrs. Leblanc", "f", "adult"), "stranger": ("Mr. Campbell", "m", "adult")},
    "US": {"formal": ("Prof. David Miller", "m", "adult"), "peer": ("Ashley", "f", "young"),
           "host": ("Mrs. Johnson", "f", "adult"), "stranger": ("Mike", "m", "adult")},
    "CN": {"formal": ("Professor Wang Lei", "m", "adult"), "peer": ("Li Na", "f", "young"),
           "host": ("Auntie Zhang", "f", "elder"), "stranger": ("Uncle Chen", "m", "elder")},
    "JP": {"formal": ("Tanaka-sensei", "m", "adult"), "peer": ("Yuki", "f", "young"),
           "host": ("Mrs. Sato", "f", "elder"), "stranger": ("Mr. Watanabe", "m", "adult")},
    "KR": {"formal": ("Professor Kim", "m", "adult"), "peer": ("Ji-woo", "f", "young"),
           "host": ("Mrs. Park", "f", "elder"), "stranger": ("Grandma Choi", "f", "elder")},
    "GB": {"formal": ("Dr. Oliver Hughes", "m", "adult"), "peer": ("Emily", "f", "young"),
           "host": ("Mrs. Wright", "f", "elder"), "stranger": ("Mr. Davies", "m", "adult")},
    "DE": {"formal": ("Prof. Dr. Schneider", "m", "adult"), "peer": ("Lukas", "m", "young"),
           "host": ("Frau Müller", "f", "elder"), "stranger": ("Herr Becker", "m", "adult")},
    "TR": {"formal": ("Prof. Ayşe Demir", "f", "adult"), "peer": ("Emre", "m", "young"),
           "host": ("Fatma teyze", "f", "elder"), "stranger": ("Mehmet amca", "m", "elder")},
}
DEFAULT_PERSONA = {"formal": ("Professor", "m", "adult"), "peer": ("Alex", "m", "young"),
                   "host": ("Host", "f", "elder"), "stranger": ("Local", "m", "adult")}

# local-colour interjections that open a reply: (positive, neutral, negative)
INTERJECTIONS = {
    "KZ": ("Жарайсың! ", "Иә, ", "Ой, балам… "), "IT": ("Perfetto! ", "Allora, ", "Mamma mia… "),
    "HU": ("Nagyszerű! ", "Hát, ", "Na de… "), "CA": ("Oh, that's great! ", "Okay, ", "Oh — sorry, but "),
    "US": ("Awesome! ", "Okay, so ", "Whoa, "), "CN": ("Hǎo de! ", "Ēn, ", "Āiyā… "),
    "JP": ("Ā, sō desu ne. ", "Hai… ", "Ano… "), "KR": ("Ne, joayo! ", "Ne… ", "Eh… "),
    "GB": ("Lovely. ", "Right, ", "Right… well. "), "DE": ("Gut. ", "Also. ", "Moment mal. "),
    "TR": ("Harika! ", "Peki, ", "Aman… "),
}

# reply lines by situation: good / ok / bad (said openly in direct cultures) / hint (said indirectly)
LINES = {
    "academic_dispute": {
        "good": "Thank you for raising this so respectfully. Let me look at your work again — we will find a fair solution.",
        "ok": "I understand your point. Please explain your reasons in a little more detail.",
        "bad": "I don't accept that tone. If you disagree with the grade, bring me written arguments.",
        "hint": "Hmm… that may be a little difficult. Perhaps we can discuss it another time.",
    },
    "team_criticism": {
        "good": "Okay, I see what you mean — let's keep the best parts and try your alternative together.",
        "ok": "Hmm, maybe. What exactly don't you like about my idea?",
        "bad": "That's harsh. Give me concrete reasons instead of just saying it's bad.",
        "hint": "…I see. Well, maybe my idea is not so good. Let's just do it your way, then.",
    },
    "home_hospitality": {
        "good": "I am so happy you like it! Please, have a little more — you are our guest!",
        "ok": "Please, please, eat! You have hardly touched anything.",
        "bad": "Oh. Okay, if you don't want it, fine — but you could have said that more kindly.",
        "hint": "…Is something wrong with the food? I cooked it especially for you.",
    },
    "gift_ceremony": {
        "good": "Oh, you really shouldn't have! Thank you — this is very thoughtful of you.",
        "ok": "Thank you. That's kind of you.",
        "bad": "To be honest, this kind of gift makes me a little uncomfortable.",
        "hint": "…Thank you. I will… put it somewhere safe.",
    },
    "first_contact": {
        "good": "Great to meet you! I think we're going to get along really well.",
        "ok": "Nice to meet you. So… which side of the room would you like?",
        "bad": "Whoa, okay. I think we need some ground rules for this room.",
        "hint": "Ah… yes. I will be in my corner if you need anything.",
    },
    "lateness_crisis": {
        "good": "Thank you for explaining and apologising. Let's use the remaining time well.",
        "ok": "Alright. Let's begin — we have already lost some time.",
        "bad": "Fifteen minutes is not acceptable. Next time, inform us in advance.",
        "hint": "…It's fine. We were just… waiting for you.",
    },
    "public_etiquette": {
        "good": "Ah, no problem at all — thank you for being so considerate.",
        "ok": "It's okay. Just be a bit more careful next time.",
        "bad": "Excuse me! There are rules here — please respect the people around you.",
        "hint": "*sighs quietly and looks away*",
    },
    "custom_sandbox": {
        "good": "That's very considerate of you — of course, I'm happy to help.",
        "ok": "I see. Tell me a little more, please.",
        "bad": "Honestly, that came across as quite rude.",
        "hint": "Hmm… that might be a little difficult.",
    },
}

BOUNDARY = {
    "direct": "Please — a little more space. You are standing too close to me.",
    "hint": "Ah… *takes a small step back* …so, as I was saying.",
}

ACTION_LABELS = {
    "bow": "bows", "handshake": "offers a handshake", "hug": "goes in for a hug",
    "give_two_hands": "hands something over with both hands", "give_one_hand": "hands something over with one hand",
    "give_clock": "gives a clock / watch as a gift", "accept_tea": "accepts the tea / food offered",
    "refuse_food_bluntly": "flatly refuses the food", "step_too_close": "steps very close",
    "step_optimal": "keeps a comfortable distance", "eye_contact_intense": "holds intense direct eye contact",
    "modest_gaze": "keeps a modest, lowered gaze",
}

# (situations, label, regex, effect) — cues the generic text judge does not know about
SITUATION_CUES = [
    (("lateness_crisis",), "apology for being late", r"\b(sorry|apolog\w+|excuse me|forgive)\b", 4),
    (("lateness_crisis",), "gives a concrete reason", r"\b(because|bus|train|traffic|metro|tram|missed|delayed|accident)\b", 4),
    (("lateness_crisis",), "promises it won't repeat", r"(won'?t happen again|next time|in advance|make (?:it|this) up)", 5),
    (("academic_dispute",), "accusing the teacher", r"\b(unfair|wrong grade|you made a mistake|you must change|i deserve)\b", -9),
    (("team_criticism",), "constructive alternative", r"\b(what if|maybe we could|how about|combine|build on|another option|alternative)\b", 6),
    (("gift_ceremony",), "modest presentation", r"\b(small|little|just a token|something small|humble)\b", 4),
    (("gift_ceremony",), "talks about the price", r"\b(expensive|cost|price|paid|dollars|euros)\b", -6),
    (("home_hospitality",), "explains a dietary reason", r"\b(allerg\w*|vegetarian|vegan|halal|diet|can'?t eat|doctor)\b", 5),
    (("first_contact",), "introduces themself", r"\b(my name is|i'?m [a-z]+|call me)\b", 4),
    (("first_contact", "public_etiquette"), "too personal a question", r"\b(how old|salary|how much do you earn|married|religion|weight)\b", -7),
    (("public_etiquette",), "takes responsibility", r"\b(my mistake|my fault|didn'?t see|after you|go ahead|i'?ll go to the end)\b", 6),
]
MASKED = {
    "lateness_crisis": (r"(won'?t happen again|next time|in advance)", r"\b(late|lateness|minutes?|delay\w*|wait\w*)\b"),
    "home_hospitality": (r"\b(can'?t eat|allerg\w*)\b",),
}
APOLOGY = re.compile(r"\b(sorry|apolog\w+|forgive)\b", re.IGNORECASE)

PROMPT = """You are {npc}, {role}, a person from {country}, embodied as a 3D character. Stay in character, first person.
Culture of {country}: {context}; directness {direct}/100, expressiveness {express}/100, touch & contact {contact}/100,
time strictness {time}/100, hierarchy {hierarchy}/100, small talk {smalltalk}/100, hospitality ×{hospitality}.
Comfortable personal distance here: {comfort} cm.
Situation: {situation}. {brief}
{custom}
Conversation so far: {history}
Current trust towards the Kazakh student: {trust}/100.
This turn the student {action_desc}, standing {distance} cm from you{violation}.
The student says: \"\"\"{message}\"\"\"
React exactly like a typical {country} person would (body AND words). Return ONLY JSON with keys:
"npc_reply": string, 1-2 sentences you say aloud, in English (a local word or two is fine),
"animation": one of {animations},
"emotion": one of {emotions},
"gaze": one of direct|soft|averted,
"mood": one of happy|neutral|annoyed|sad|angry,
"delta": integer from -30 to 25 (change of trust; 0 for the opening line),
"feedback": string, 1-2 sentences for the student explaining the cultural reason for your reaction,
"signals": array of up to 4 objects {{"label": short string, "effect": integer}}."""


def situations_payload() -> dict:
    """GET /api/roleplay/sandbox — the matrix the UI renders (situations × personas × actions)."""
    return {
        "situations": [{"id": k, "title": s["title"], "icon": s["icon"], "kind": s["kind"], "role": s["role"],
                        "brief": s["brief"], "tests": s["tests"]} for k, s in SITUATIONS.items()],
        "personas": {code: {kind: {"name": n, "gender": g, "age": a} for kind, (n, g, a) in p.items()}
                     for code, p in PERSONAS.items()},
        "actions": list(ACTION_LABELS),
        "animations": list(ANIMATIONS),
    }


def persona(code: str, situation: str) -> dict:
    sit = SITUATIONS[situation]
    name, gender, age = PERSONAS.get(code, DEFAULT_PERSONA)[sit["kind"]]
    return {"name": name, "gender": gender, "age": age, "kind": sit["kind"], "role": sit["role"]}


def hall_zone(cm: int) -> str:
    """Edward T. Hall (1966): intimate < 45 cm, personal < 120 cm, social < 360 cm, public beyond."""
    return "intimate" if cm < 45 else "personal" if cm < 120 else "social" if cm < 360 else "public"


def proximity(country: Country, distance: int, action: str) -> dict:
    comfort = country.proxemics_cm
    threshold = round(comfort * 0.75)
    violated = distance < threshold or action == "step_too_close"
    if action == "step_too_close":
        distance = min(distance, threshold - 5)
    return {"distance_cm": distance, "comfort_cm": comfort, "threshold_cm": threshold, "zone": hall_zone(distance),
            "violated": violated, "cold": distance > comfort * 2.4,
            "step_back_cm": max(0, comfort - distance + 10) if violated else 0}


def bow_depth(dims: dict, apology: bool) -> int:
    """15° greeting bow … 45° deep respect / apology, scaled by power distance."""
    base = 5 + dims["hierarchy"] / 100 * 20
    return int(min(45, round(base + (20 if apology else 0))))


def _action_effect(action: str, country: Country, situation: str) -> tuple[int, str, str | None, str | None]:
    """(trust effect, signal label, animation, emotion) of a physical action in this culture."""
    code, d, hosp = country.code, country.dims(), country.hospitality
    bowing, east_asia = code in ("JP", "KR"), code in ("JP", "KR", "CN")
    formal = SITUATIONS[situation]["kind"] in ("formal", "host")
    if action == "bow":
        if bowing:
            return 9, "a bow — the expected sign of respect", "bow_respect", "joy"
        if code in ("CN", "KZ", "TR"):
            return 4, "a respectful bow / nod", "bow_respect", "joy"
        return (2 if d["hierarchy"] >= 60 else 0), "a bow — unusual here, but polite", "nod_approval", "surprise"
    if action == "handshake":
        if bowing:
            return 2, "a handshake — accepted, but a bow fits better", "bow_respect", "neutral"
        return 6, "a firm, friendly handshake", "handshake_reach", "joy"
    if action == "hug":
        if d["contact"] >= 80:
            return 6, "a warm hug — natural in a high-contact culture", "expressive_gestures", "joy"
        if d["contact"] >= 60:
            ok = situation in ("home_hospitality", "gift_ceremony") or not formal
            return (2, "a hug — fine among close people", "nod_approval", "joy") if ok else \
                (-5, "a hug with a person of higher status", "step_back_uncomfortable", "surprise")
        if d["contact"] >= 40:
            return -7, "an unexpected hug — too much touch", "step_back_uncomfortable", "surprise"
        return -13, "a hug invades personal space in a low-contact culture", "step_back_uncomfortable", "surprise"
    if action == "give_two_hands":
        if d["hierarchy"] >= 80 or east_asia:
            return 9, "both hands — the respectful way to give", "two_hands_present", "joy"
        if code in ("KZ", "TR"):
            return 6, "both hands — shows respect", "two_hands_present", "joy"
        return 3, "a careful two-handed hand-over", "nod_approval", "joy"
    if action == "give_one_hand":
        if east_asia:
            return -7, "one hand — looks careless in East Asia", "idle_breathing", "annoyed"
        if code == "KZ" and formal:
            return -3, "one hand to an elder/teacher", "idle_breathing", "neutral"
        return 1, "a casual one-hand hand-over", "nod_approval", "neutral"
    if action == "give_clock":
        if code == "CN":
            return -22, "a clock: 送钟 sounds like 送终 — 'seeing someone off to death'", "offended_look_away", "anger"
        return (6 if situation == "gift_ceremony" else 2), "a practical, thoughtful gift", "two_hands_present", "joy"
    if action == "accept_tea":
        if hosp >= 1.4:
            return 9, "accepting tea/food honours the host", "warm_welcome_tea", "joy"
        return 4, "accepting what is offered", "warm_welcome_tea", "joy"
    if action == "refuse_food_bluntly":
        effect = -round(6 + 10 * max(0.0, hosp - 0.8) / 0.75)
        return effect, "a flat refusal rejects the host's generosity", \
            ("offended_look_away" if hosp >= 1.4 else "idle_breathing"), ("sad" if hosp >= 1.4 else "annoyed")
    if action == "step_optimal":
        return 3, "respects the local comfort distance", "nod_approval", "joy"
    if action == "eye_contact_intense":
        if d["hierarchy"] >= 70 and d["direct"] <= 40 and formal:
            return -7, "staring at a person of higher status", "offended_look_away", "embarrassed"
        if d["direct"] >= 55:
            return 4, "direct eye contact — reads as honest here", "nod_approval", "joy"
        return 1, "steady eye contact", None, None
    if action == "modest_gaze":
        if east_asia:
            return (8 if formal else 5), "a modest gaze shows deference", "nod_approval", "joy"
        if d["hierarchy"] >= 70 and formal:
            return 4, "a modest gaze shows respect", "nod_approval", "neutral"
        if d["direct"] >= 55:
            return -4, "avoiding eye contact looks evasive here", None, "annoyed"
        return 1, "a calm, modest gaze", None, None
    return 0, "", None, None


def _text_judge(message: str, country: Country, situation: str) -> dict:
    sit = SITUATIONS[situation]
    scenario = SimpleNamespace(npc_role=sit["role"], slug="sandbox-dinner" if situation == "home_hospitality" else situation)
    lower = message.lower()
    extra, judged_text = [], message
    for sits, label, rx, eff in SITUATION_CUES:
        if situation in sits and re.search(rx, lower):
            extra.append({"label": label, "effect": eff})
    # phrases the situation itself requires ("won't happen again", "I was late") must not trip the generic detectors
    for rx in MASKED.get(situation, ()):
        judged_text = re.sub(rx, " ", judged_text, flags=re.IGNORECASE)
    result = roleplay.judge(judged_text if judged_text.strip() else message, country, scenario, ai.lexicon())
    if situation == "lateness_crisis" and country.dims()["time"] >= 70 and not APOLOGY.search(lower):
        extra.append({"label": "no apology in a monochronic culture", "effect": -8})
    result["signals"] = (result["signals"] + extra)[:8]
    result["delta"] = max(MAX_DOWN, min(MAX_UP, sum(s["effect"] for s in result["signals"])))
    return result


def _reply(code: str, situation: str, dims: dict, delta: int, context: str | None) -> str:
    lines = LINES[situation]
    pos, neu, neg = INTERJECTIONS.get(code, ("", "", ""))
    if delta >= 6:
        text = pos + lines["good"]
    elif delta >= 0:
        text = neu + lines["ok"]
    elif dims["direct"] >= 55:
        text = neg + lines["bad"]
    else:
        text = neg + lines["hint"]
    return re.sub(r"…\s*…", "…", text)


def _animation(prox: dict, act_anim: str | None, delta: int, trust: int, dims: dict) -> str:
    if prox["violated"]:
        return "step_back_uncomfortable"
    if act_anim:
        return act_anim
    if delta < 0 and trust < 35:
        return "offended_look_away"
    if delta <= -12:
        return "offended_look_away" if dims["hierarchy"] >= 60 else "step_back_uncomfortable"
    if delta >= 6:
        return "expressive_gestures" if dims["express"] >= 70 else "nod_approval"
    return "idle_breathing"


def _emotion(mood: str) -> str:
    return {"happy": "joy", "neutral": "neutral", "annoyed": "annoyed", "sad": "sad", "angry": "anger"}[mood]


def _opening(country: Country, situation: str, context: str | None) -> dict:
    d, code = country.dims(), country.code
    sit = SITUATIONS[situation]
    register = "formal" if d["hierarchy"] >= 65 or d["direct"] <= 30 else "casual"
    ctx = (context or "").rstrip(".!?")
    text = sit["open"][register].replace("{context}", ctx[:1].lower() + ctx[1:])
    emotion, anim = "neutral", "idle_breathing"
    if situation in ("home_hospitality", "gift_ceremony") and country.hospitality >= 1.4:
        anim, emotion = "warm_welcome_tea", "joy"
    elif situation == "lateness_crisis":
        emotion = "annoyed" if d["time"] >= 70 else "neutral"
    elif situation == "public_etiquette":
        emotion = "annoyed"
    elif code in ("JP", "KR"):
        anim = "bow_respect"
    elif d["express"] >= 70 and sit["kind"] != "formal":
        anim, emotion = "expressive_gestures", "joy"
    elif sit["kind"] == "formal" or situation == "first_contact":
        anim = "handshake_reach"
    return {"npc_reply": text, "animation": anim, "emotion": emotion, "mood": "neutral", "delta": 0,
            "feedback": sit["brief"], "signals": []}


def hints(country: Country) -> list[str]:
    """Cheat-sheet shown when a simulation starts — derived from the six dimensions, not hard-coded per country."""
    d, out = country.dims(), []
    out.append(f"Keep about {country.proxemics_cm} cm of personal space (closer than "
               f"{round(country.proxemics_cm * 0.75)} cm feels invasive).")
    if d["hierarchy"] >= 70:
        out.append("High power distance: use titles, let the senior person lead, give and receive with both hands.")
    if d["direct"] <= 35:
        out.append("Indirect culture: cushion any 'no' or criticism; a hint is often the whole message.")
    elif d["direct"] >= 70:
        out.append("Direct culture: be clear and specific; heavy hedging sounds vague.")
    if d["time"] >= 75:
        out.append("Monochronic time: punctuality is respect — apologise and give a reason if late.")
    if country.hospitality >= 1.4:
        out.append("Hospitality is honour: accept tea or a small portion instead of a flat refusal.")
    if d["contact"] >= 75:
        out.append("High-contact culture: warmth, touch and lively gestures are welcome.")
    elif d["contact"] <= 30:
        out.append("Low-contact culture: avoid hugs and touching with people you have just met.")
    return out[:4]


def _clean_llm(raw: str) -> dict:
    j = roleplay._clean_llm(raw)  # delta, mood, npc_reply, feedback, signals
    full = json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip())
    anim, emotion, gaze = (str(full.get(k, "")).strip().lower() for k in ("animation", "emotion", "gaze"))
    j["animation"] = anim if anim in ANIMATIONS else None
    j["emotion"] = emotion if emotion in EMOTIONS else None
    j["gaze"] = gaze if gaze in GAZES else None
    return j


def interact(body) -> dict:
    """One sandbox turn. ``body`` is a validated schemas.RoleplayInteractIn."""
    country = db.session.scalar(select(Country).where(Country.code == body.country))
    if country is None:
        raise LookupError("Unknown country")
    code, dims, sit = country.code, country.dims(), SITUATIONS[body.situation]
    npc = persona(code, body.situation)
    prox = proximity(country, body.distance_cm, body.user_action)
    opening = body.turn == 0
    provider, key, model = ai.active_provider()
    result, source = None, "engine"

    if provider != "none":
        history = [f"{h.role}: {h.text}" for h in body.history[-6:]]
        violation = (f" — CLOSER than your comfort zone ({prox['threshold_cm']} cm): you feel your space invaded"
                     if prox["violated"] else "")
        prompt = PROMPT.format(
            npc=npc["name"], role=npc["role"], country=country.name, context=country.context.lower(),
            hospitality=country.hospitality, comfort=prox["comfort_cm"], situation=sit["title"], brief=sit["brief"],
            custom=f"Custom setting described by the student: {body.custom_context}" if body.custom_context else "",
            history=json.dumps(history, ensure_ascii=False), trust=round(body.trust),
            action_desc=("enters the scene — open the situation with your first line" if opening
                         else ACTION_LABELS.get(body.user_action, "makes no special gesture")),
            distance=prox["distance_cm"], violation=violation,
            message=(body.user_message or "(says nothing)").replace('"""', "'''"),
            animations="|".join(ANIMATIONS), emotions="|".join(EMOTIONS), **dims)
        try:
            result, source = _clean_llm(ai._call_llm(provider, key, model, prompt)), "live"
            if opening:
                result["delta"], result["signals"] = 0, []
        except Exception as exc:  # network down, quota, bad JSON → deterministic culture engine
            log.warning("Sandbox LLM failed (%s): %s", provider, exc)

    engine = None
    if opening:
        engine = _opening(country, body.situation, body.custom_context)
    else:
        signals, act_anim, act_emotion = [], None, None
        if body.user_message:
            judged = _text_judge(body.user_message, country, body.situation)
            signals += judged["signals"]
        if body.user_action not in ("none", "step_too_close"):
            eff, label, act_anim, act_emotion = _action_effect(body.user_action, country, body.situation)
            if label:
                signals.append({"label": label, "effect": eff})
        if prox["violated"]:
            signals.append({"label": f"too close: {prox['distance_cm']} cm < {prox['threshold_cm']} cm comfort limit",
                            "effect": -round(5 + 13 * (1 - dims["contact"] / 100))})
        elif prox["cold"] and dims["contact"] >= 55:
            signals.append({"label": "keeps a cold, distant position", "effect": -3})
        delta = max(MAX_DOWN, min(MAX_UP, sum(s["effect"] for s in signals)))
        new_trust = max(0, min(100, round(body.trust + delta)))
        mood = roleplay._mood_for(delta)
        reply = _reply(code, body.situation, dims, delta, body.custom_context)
        if prox["violated"]:
            reply = BOUNDARY["direct" if dims["direct"] >= 55 else "hint"] + " " + reply
        good = [s["label"] for s in signals if s["effect"] > 0][:2]
        bad = [s["label"] for s in signals if s["effect"] < 0][:2]
        if delta >= 6:
            feedback = f"Well done in {country.name}: " + ", ".join(good or ["your behaviour matched local norms"]) + "."
        elif delta >= 0:
            feedback = "Acceptable, but not memorable." + (f" Strong point: {good[0]}." if good else "") + \
                       " Add a culturally fitting gesture or a polite cushion to earn more trust."
        else:
            bad = [re.sub(r"^risky for [^:]+:\s*", "", b) for b in bad]
            feedback = f"Risky in {country.name}: " + ", ".join(bad or ["the tone felt abrupt"]) + "."
        engine = {"npc_reply": reply, "animation": _animation(prox, act_anim, delta, new_trust, dims),
                  "emotion": act_emotion if act_emotion and delta >= -5 else _emotion(mood), "mood": mood,
                  "delta": delta, "feedback": feedback, "signals": signals[:6]}

    if result is None:
        result = engine
    else:  # fill what the LLM left out, and never let it ignore a personal-space violation
        result["npc_reply"] = result["npc_reply"] or engine["npc_reply"]
        result["feedback"] = result["feedback"] or engine["feedback"]
        result["animation"] = result.get("animation") or engine["animation"]
        result["emotion"] = result.get("emotion") or engine["emotion"]
        if prox["violated"] and result["animation"] not in ("step_back_uncomfortable", "offended_look_away"):
            result["animation"] = "step_back_uncomfortable"

    new_trust = max(0, min(100, round(body.trust + result["delta"])))
    anim = result["animation"]
    gaze = result.get("gaze") or (
        "averted" if anim == "offended_look_away" or result["emotion"] == "embarrassed"
        else "soft" if dims["hierarchy"] >= 80 and dims["direct"] <= 40 else "direct")
    apology = bool(APOLOGY.search(body.user_message)) or body.situation == "lateness_crisis"
    return {
        "npc_reply": result["npc_reply"], "animation": anim, "emotion": result["emotion"], "gaze": gaze,
        "mood": result["mood"], "delta": result["delta"], "trust_score": new_trust,
        "feedback": result["feedback"], "signals": result["signals"],
        "body": {"bow_deg": bow_depth(dims, apology and anim == "bow_respect" and not opening),
                 "gesture_amp": round(dims["express"] / 100, 2),
                 "gesture_freq": round(0.6 + dims["express"] / 100 * 1.8, 2),
                 "step_back_cm": prox["step_back_cm"]},
        "proximity": prox,
        "voice": {"lang": country.lang, "rate": round(0.85 + dims["express"] / 100 * 0.3, 2),
                  "volume": round(country.voice_max / 100, 2)},
        "npc": npc, "country": code, "situation": body.situation,
        "hints": hints(country) if opening else [],
        "source": source, "provider": provider if source == "live" else "engine",
        "model": model if source == "live" else "culture-rules-v1",
    }
