import pytest

from app import create_app
from app.config import TestConfig


@pytest.fixture()
def client():
    app = create_app(TestConfig)  # in-memory SQLite, auto-seeded, AI disabled
    with app.test_client() as c:
        yield c


def login(client):
    r = client.post("/admin/login", data={"password": "test-admin"})
    assert r.status_code == 302


def test_health_and_index(client):
    assert client.get("/api/health").get_json()["status"] == "ok"
    r = client.get("/")
    assert r.status_code == 200 and b"CultureBridge" in r.data


def test_bootstrap_contains_research_data(client):
    d = client.get("/api/bootstrap").get_json()
    assert len(d["countries"]) == 10
    it = d["countries"]["IT"]
    assert len(it["alumni"]["universities"]) == 5 and it["dims"]["express"] == 92
    assert d["countries"]["JP"]["alumni"] is None
    assert len(d["dimensions"]) == 6 and len(d["greetings"]) == 20
    assert d["ai"]["provider"] == "none"


def test_radar_distance_and_gaps(client):
    r = client.get("/api/radar?from=KZ&to=DE").get_json()
    assert r["distance_index"] == 79 and r["level"] == "high"
    assert [g["key"] for g in r["top_gaps"]] == ["time", "direct", "contact"]
    assert all(g["advice"] for g in r["top_gaps"])
    assert client.get("/api/radar?from=KZ&to=XX").status_code == 404


def test_decode_uses_expert_cache_then_engine(client):
    r = client.post("/api/decode", json={"text": "Your idea won't work, we need another solution.", "country": "JP"}).get_json()
    assert r["source"] == "expert-cache" and r["level"] == 2 and "Thank you" in r["adapted"]
    r = client.post("/api/decode", json={"text": "Professor, I need you to check my essay by tomorrow.", "country": "DE"}).get_json()
    assert r["source"] == "expert-cache"
    r = client.post("/api/decode", json={"text": "Hey guys, send me the slides NOW!", "country": "KR"}).get_json()
    assert r["source"] == "engine" and r["risk"] > 30 and "slides" in r["adapted"]
    r = client.post("/api/decode", json={"text": "Hey guys, this plan is stupid!!", "country": "JP"}).get_json()
    assert r["category"] == "criticism" and r["level"] == 2
    assert client.post("/api/decode", json={"text": "", "country": "JP"}).status_code == 422
    assert client.post("/api/decode", json={"text": "hi", "country": "ZZ"}).status_code == 404


def test_llm_answer_is_cached_and_replayed_offline(monkeypatch):
    from app import ai

    class LiveConfig(TestConfig):
        AI_PROVIDER, GEMINI_API_KEY = "gemini", "fake-key"

    app = create_app(LiveConfig)
    c = app.test_client()
    calls = []

    def fake_llm(provider, key, model, prompt):
        calls.append(prompt)
        return '{"risk": 45, "heard": "Too blunt.", "adapted": "Perhaps we could try another way?", "tags": ["Directness"], "notes": ["Face"]}'

    monkeypatch.setattr(ai, "_call_llm", fake_llm)
    body = {"text": "That is a bad plan.", "country": "JP"}
    r = c.post("/api/decode", json=body).get_json()
    assert r["source"] == "live" and r["risk"] == 45 and r["level"] == 1

    def offline(*a):
        raise ConnectionError("no internet")

    monkeypatch.setattr(ai, "_call_llm", offline)
    r = c.post("/api/decode", json={**body, "fresh": True}).get_json()   # live fails → DB cache
    assert r["source"] == "cache" and r["adapted"] == "Perhaps we could try another way?"
    r = c.post("/api/decode", json={"text": "No, I can't come to your party.", "country": "JP"}).get_json()
    assert r["source"] == "expert-cache"                                 # seeded preset
    r = c.post("/api/decode", json={"text": "Brand new phrase", "country": "JP"}).get_json()
    assert r["source"] == "engine"                                       # rule engine never fails
    assert len(calls) == 1


def test_quiz_is_checked_on_server(client):
    qs = client.get("/api/quiz").get_json()
    assert len(qs) == 12 and all("is_correct" not in o for q in qs for o in q["options"])
    answers = {}
    for q in qs:
        first = q["options"][0]["id"]
        r = client.post(f"/api/quiz/{q['id']}/answer", json={"option_id": first}).get_json()
        answers[q["id"]] = r["correct_option_id"]  # then submit the right ones
        assert r["explanation"]
    r = client.post("/api/quiz/finish", json={"answers": answers}).get_json()
    assert r["score"] == 12 and r["badge"]["title"] == "Cultural Awareness Expert"
    r = client.post("/api/quiz/finish", json={"answers": {}}).get_json()
    assert r["score"] == 0 and r["badge"]["title"] == "Cultural Awareness Beginner"


def test_match_check(client):
    d = client.get("/api/match").get_json()
    assert len(d["customs"]) == 10 and len(d["situations"]) == 10
    r = client.post("/api/match/check", json={"pairs": {}}).get_json()
    assert r["score"] == 0 and len(r["explanations"]) == 10


def test_scenarios_and_result(client):
    sc = client.get("/api/scenarios").get_json()
    assert len(sc) == 4 and all(len(s["steps"]) == 4 for s in sc)
    assert client.post(f"/api/scenarios/{sc[0]['id']}/result", json={"trust": 88}).status_code == 200
    assert client.get("/api/stats").get_json()["roleplay"]["count"] == 1


def test_admin_requires_login(client):
    assert client.get("/api/admin/stats").status_code == 401
    assert client.post("/admin/login", data={"password": "nope"}).status_code == 401


def test_admin_adds_quiz_case(client):
    login(client)
    r = client.post("/api/admin/quiz", json={
        "topic": "Tipping", "flag": "🇯🇵", "question": "Should you tip a waiter in Japan?",
        "explanation": "Tipping is not customary in Japan and may cause confusion.",
        "options": ["Yes, 15%", "No, excellent service is standard"], "correct_index": 1})
    assert r.status_code == 201
    assert len(client.get("/api/quiz").get_json()) == 13
    bad = client.post("/api/admin/quiz", json={"topic": "x", "question": "short", "explanation": "e", "options": ["a"], "correct_index": 3})
    assert bad.status_code == 422


def test_admin_adds_voice_etiquette_and_scenario(client):
    login(client)
    assert client.post("/api/admin/voices", json={"country": "JP", "university": "University of Tokyo",
                                                  "text": "People are extremely punctual and quiet on trains."}).status_code == 201
    assert client.get("/api/countries/JP").get_json()["alumni"]["voices"][0]["uni"] == "University of Tokyo"
    assert client.post("/api/admin/etiquette", json={"country": "DE", "title": "Quiet Sundays",
                                                     "text": "Sunday is a rest day; avoid noisy activities."}).status_code == 201
    scenario = {"slug": "jp-test", "country": "JP", "title": "Test", "npc": "Aiko", "npc_role": "Classmate", "intro": "Hello there",
                "steps": [{"npc": "Hi!", "options": [{"text": "Bow", "delta": 10, "mood": "happy", "feedback": "Good choice"},
                                                     {"text": "Hug", "delta": -10, "mood": "sad", "feedback": "Too close"}]}]}
    assert client.post("/api/admin/scenarios", json=scenario).status_code == 201
    assert client.post("/api/admin/scenarios", json=scenario).status_code == 409
    assert len(client.get("/api/scenarios").get_json()) == 5


def test_admin_rejects_form_posts(client):
    login(client)
    r = client.post("/api/admin/voices", data={"country": "JP"})
    assert r.status_code == 415
