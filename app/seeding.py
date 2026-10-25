"""Schema creation + seeding of all research data from seed_data/research_data.json."""
import json

from flask import current_app
from sqlalchemy import func, select

from . import pragma
from .ai import phrase_hash
from .extensions import db
from .models import (AlumniVoice, Country, CountryDimension, Dimension, EtiquetteRule, GapAdvice, Greeting, MatchItem,
                     QuizBadge, QuizOption, QuizQuestion, Reference, Scenario, ScenarioOption, ScenarioStep, Setting,
                     TranslationCache, University)


def load_data() -> dict:
    with open(current_app.config["SEED_FILE"], encoding="utf-8") as f:
        return json.load(f)


def seed(reset: bool = False) -> str:
    if reset:
        db.drop_all()
    db.create_all()
    if db.session.scalar(select(func.count(Country.id))):
        return "Database already seeded — nothing to do (use --reset to rebuild)."

    data = load_data()

    # dimensions + adaptation advice
    dims = {}
    for i, d in enumerate(data["dimensions"]):
        dim = Dimension(key=d["key"], label=d["label"], short=d["short"], low_label=d["low"], high_label=d["high"], position=i)
        for direction in ("up", "down"):
            dim.advice += [GapAdvice(direction=direction, text=t) for t in data["gap_advice"][d["key"]][direction]]
        dims[d["key"]] = dim
        db.session.add(dim)

    # countries, etiquette, alumni survey
    countries = {}
    for c in data["countries"]:
        country = Country(
            code=c["code"], name=c["name"], flag=c["flag"], iso_numeric=c["iso"], lang=c["lang"], context=c["context"],
            lat=c["lat"], lon=c["lon"], mentality=c["mentality"], proxemics_cm=c["proxemics"],
            voice_min=c["voice_min"], voice_max=c["voice_max"], hospitality=c["hospitality"],
            etiquette=[EtiquetteRule(title=e["title"], text=e["text"], position=i) for i, e in enumerate(c["etiquette"])],
            universities=[University(name=u) for u in c["universities"]],
            voices=[AlumniVoice(university=v["university"], text=v["text"]) for v in c["alumni_voices"]],
            scores=[CountryDimension(dimension=dims[k], value=v) for k, v in c["dims"].items()],
        )
        countries[c["code"]] = country
        db.session.add(country)

    db.session.add_all(Greeting(word=g["word"], roman=g["roman"], language=g["lang"], lang_code=g["code"],
                                gesture=g["gesture"], gesture_name=g["gestureName"], note=g["note"])
                       for g in data["greetings"])

    db.session.add_all(MatchItem(slug=m["id"], custom=m["custom"], icon=m["icon"], country=countries[m["country"]],
                                 situation=m["situation"], explanation=m["explain"]) for m in data["match_items"])

    for i, q in enumerate(data["quiz"]):
        db.session.add(QuizQuestion(
            topic=q["topic"], flag=q["flag"], question=q["q"], explanation=q["explain"], position=i,
            options=[QuizOption(text=t, is_correct=j == q["correct"], position=j) for j, t in enumerate(q["options"])]))

    db.session.add_all(QuizBadge(min_score=b["min"], max_score=b["max"], title=b["title"], icon=b["icon"], text=b["text"])
                       for b in data["quiz_badges"])

    for s in data["roleplays"]:
        db.session.add(Scenario(
            slug=s["id"], country=countries[s["country"]], title=s["title"], npc=s["npc"], npc_role=s["npcRole"],
            avatar=s["avatar"], intro=s["intro"], start_trust=s["start"],
            steps=[ScenarioStep(position=i, npc_line=st["npc"],
                                options=[ScenarioOption(position=j, text=o["text"], delta=o["delta"], mood=o["mood"],
                                                        feedback=o["feedback"]) for j, o in enumerate(st["options"])])
                   for i, st in enumerate(s["steps"])]))

    db.session.add_all(Reference(text=r) for r in data["references"])

    lexicon = {"features": data["pragma_features"], "softeners": data["pragma_softeners"],
               "categories": data["pragma_categories"], "adapt": data["pragma_adapt"], "hearing": data["pragma_hearing"]}
    db.session.add_all([Setting(key="pragma", value=lexicon),
                        Setting(key="translator_presets", value=data["translator_presets"]),
                        Setting(key="moods", value=data["moods"])])
    db.session.flush()

    # expert cache: every preset phrase × every country, so the decoder answers instantly offline
    cached = 0
    for phrase in data["translator_presets"]:
        for code, country in countries.items():
            db.session.add(TranslationCache(phrase_hash=phrase_hash(phrase), phrase=phrase, country_code=code,
                                            provider="expert", model="pragma-rules-v1",
                                            result=pragma.analyze(phrase, country, lexicon)))
            cached += 1

    db.session.commit()
    return (f"Seeded {len(countries)} countries, {len(dims)} dimensions, {len(data['quiz'])} quiz cases, "
            f"{len(data['match_items'])} match items, {len(data['roleplays'])} roleplay scenarios, "
            f"{len(data['greetings'])} greetings, {cached} expert analyses.")
