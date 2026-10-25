"""Server-side AI Pragmatic Translator.

Resolution order for POST /api/decode:
  1. LLM answer cached in the DB for the same phrase + country  → instant, works offline
  2. live LLM call (Gemini via google-genai, or OpenAI)          → stored in the cache
  3. expert answer pre-computed by seed.py for the same phrase
  4. rule-based pragmatic engine (app/pragma.py)                 → always available
"""
import hashlib
import json
import logging
import re

from flask import current_app
from sqlalchemy import select

from . import localize, pragma
from .extensions import db
from .models import Country, Setting, TranslationCache

log = logging.getLogger(__name__)

DEFAULT_MODELS = {"gemini": "gemini-2.5-flash", "openai": "gpt-4o-mini"}

PROMPT = """You are an expert in intercultural pragmatics (Hall's high/low-context communication,
Hofstede's 6-D model, Erin Meyer's Culture Map, Brown & Levinson politeness theory).
A student from Kazakhstan wants to say this English phrase to a person from {country}
(a {context} culture; directness {direct}/100, hierarchy {hierarchy}/100):
\"\"\"{text}\"\"\"
Return ONLY a JSON object with keys:
"risk": integer 0-100 — risk of offending / conflict for a listener from {country},
"heard": string, 1-2 sentences — how a typical local would psychologically interpret it,
"adapted": string — the culturally adapted English version for {country}, same intent,
"adapted_alt": string — a second polite English version in a different register (formal vs friendly),
"adapted_local": string — the same polite message written in {language}, the local language,
"category": one of criticism|food|time|request|ask|decline|neutral,
"tags": array of 1-4 short labels of detected pragmatic issues,
"notes": array of 1-3 short explanations referencing cultural theory."""


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def phrase_hash(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


def active_provider() -> tuple[str, str, str]:
    """(provider, api_key, model) or ("none", "", "")."""
    cfg = current_app.config
    provider = cfg["AI_PROVIDER"]
    key = {"gemini": cfg["GEMINI_API_KEY"], "openai": cfg["OPENAI_API_KEY"]}.get(provider, "")
    if not key:
        return "none", "", ""
    return provider, key, cfg["AI_MODEL"] or DEFAULT_MODELS[provider]


def lexicon() -> dict:
    return db.session.get(Setting, "pragma").value


def _call_llm(provider: str, key: str, model: str, prompt: str) -> str:
    timeout = current_app.config["AI_TIMEOUT"]
    if provider == "gemini":
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=int(timeout * 1000)))
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.4),
        )
        return resp.text
    from openai import OpenAI

    client = OpenAI(api_key=key, timeout=timeout, max_retries=1)
    resp = client.chat.completions.create(
        model=model,
        temperature=0.4,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.choices[0].message.content


def _clean_llm(raw: str) -> dict:
    j = json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip())
    risk = max(0, min(100, int(round(float(j.get("risk", 0))))))
    level = pragma.level_of(risk)
    category = str(j.get("category", "")).strip().lower()
    return {
        "risk": risk,
        "level": level,
        "level_label": pragma.LEVEL_LABELS[level],
        "heard": str(j.get("heard", "")),
        "adapted": str(j.get("adapted", "")),
        "adapted_alt": str(j.get("adapted_alt", "")),
        "adapted_local": str(j.get("adapted_local", "")),
        "category": category if category in localize.CATEGORIES else "",
        "tags": [str(t) for t in j.get("tags", [])][:4],
        "notes": [str(n) for n in j.get("notes", [])][:3],
        "softeners": 0,
    }


def with_variants(result: dict, text: str, country: Country) -> dict:
    """Attach ``variants`` (2 English + 1 local-language rephrasing) to any decode result, online or offline."""
    out = dict(result)
    category = out.get("category") or pragma.analyze(text, country, lexicon()).get("category", "neutral")
    v = localize.variants(category, country.lang, out.get("adapted", ""), country.dims().get("hierarchy", 50))
    if out.get("adapted_alt"):
        v["en"][1] = out["adapted_alt"]
    if out.get("adapted_local"):
        v["local"]["text"] = out["adapted_local"]
    out["category"], out["variants"] = category, v
    return out


def _cached(h: str, code: str, providers: tuple[str, ...]):
    rows = db.session.scalars(
        select(TranslationCache).where(
            TranslationCache.phrase_hash == h,
            TranslationCache.country_code == code,
            TranslationCache.provider.in_(providers),
        ).order_by(TranslationCache.created_at.desc())
    ).all()
    return rows[0] if rows else None


def decode(text: str, code: str, fresh: bool = False) -> dict:
    country = db.session.scalar(select(Country).where(Country.code == code))
    if country is None:
        raise ValueError(f"Unknown country {code}")
    h = phrase_hash(text)
    provider, key, model = active_provider()

    def serve(row: TranslationCache, source: str) -> dict:
        row.hits += 1
        db.session.commit()
        return with_variants({**row.result, "source": source, "provider": row.provider, "model": row.model}, text, country)

    # 1. previously generated LLM answer
    if not fresh:
        row = _cached(h, code, ("gemini", "openai"))
        if row:
            return serve(row, "cache")

    # 2. live LLM
    if provider != "none":
        dims = country.dims()
        prompt = PROMPT.format(country=country.name, context=country.context.lower(), direct=dims["direct"],
                               hierarchy=dims["hierarchy"], language=localize.LANGUAGE_NAMES.get(country.lang, country.lang),
                               text=text.replace('"""', "'''"))
        try:
            result = _clean_llm(_call_llm(provider, key, model, prompt))
            row = _cached(h, code, (provider,))
            if row:
                row.result, row.model = result, model
            else:
                db.session.add(TranslationCache(phrase_hash=h, phrase=text, country_code=code,
                                                provider=provider, model=model, result=result))
            db.session.commit()
            return with_variants({**result, "source": "live", "provider": provider, "model": model}, text, country)
        except Exception as exc:  # network down, quota, bad JSON… never break the demo
            db.session.rollback()
            log.warning("LLM call failed (%s): %s", provider, exc)
            row = _cached(h, code, ("gemini", "openai"))
            if row:
                return serve(row, "cache")

    # 3. expert answer pre-computed at seed time
    row = _cached(h, code, ("expert",))
    if row:
        return serve(row, "expert-cache")

    # 4. rule-based engine
    return with_variants({**pragma.analyze(text, country, lexicon()), "source": "engine", "provider": "engine",
                          "model": "pragma-rules-v1"}, text, country)
