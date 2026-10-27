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
    assert len(d["countries"]) == 11 and d["countries"]["TR"]["lang"] == "tr-TR"
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


def test_web_pages_and_seo(client):
    pages = ["/", "/learn", "/auth", "/atlas", "/greetings", "/radar", "/decoder", "/proxemics",
             "/roleplay", "/match", "/quiz", "/stats", "/about", "/docs"]
    for path in pages:
        res = client.get(path)
        assert res.status_code == 200, f"Page {path} failed with {res.status_code}"
        assert b"Culture" in res.data and b"Bridge" in res.data

    # SEO & probe endpoints
    assert client.get("/robots.txt").status_code == 200
    assert client.get("/sitemap.xml").status_code == 200
    assert client.get("/manifest.webmanifest").status_code == 200
    assert client.get("/healthz").status_code == 200

    # Quiz finish generates a valid certificate token
    finish_res = client.post("/api/quiz/finish", json={"answers": {}}).get_json()
    assert "certificate" in finish_res and "token" in finish_res["certificate"]
    token = finish_res["certificate"]["token"]
    cert_page = client.get(f"/certificate/{token}")
    assert cert_page.status_code == 200
    assert b"Certificate of Cultural Awareness" in cert_page.data

    # Non-existent certificate returns 404
    assert client.get("/certificate/invalid-token-12345").status_code == 404


def test_auth_and_systematic_tracks(client):
    # 1. Unauthenticated state
    me = client.get("/api/auth/me").get_json()
    assert me["user"] is None

    # Tracks list works for guests
    tracks_list = client.get("/api/tracks").get_json()
    assert len(tracks_list) == 11
    de_track = client.get("/api/tracks/DE").get_json()
    assert len(de_track["curriculum"]) == 5
    assert de_track["curriculum"][0]["id"] == "first_contact"

    # Step completion requires auth
    unauth_step = client.post("/api/tracks/DE/step/first_contact/complete", json={"step_id": "first_contact"})
    assert unauth_step.status_code == 401

    # 2. Registration
    reg_data = {
        "username": "scholar_dana",
        "password": "secretpassword123",
        "full_name": "Dana Bolatova",
        "target_country": "DE"
    }
    r = client.post("/api/auth/register", json=reg_data)
    assert r.status_code == 201
    user_info = r.get_json()["user"]
    assert user_info["username"] == "scholar_dana"
    assert user_info["targetCountry"] == "DE"

    # Duplicate username returns 409
    dup = client.post("/api/auth/register", json=reg_data)
    assert dup.status_code == 409

    # Auth me now returns logged-in user
    me = client.get("/api/auth/me").get_json()
    assert me["user"]["username"] == "scholar_dana"

    # 3. Systematic track progression
    step1 = client.post("/api/tracks/DE/step/first_contact/complete", json={"step_id": "first_contact", "score": 90}).get_json()
    assert step1["percent"] == 20
    assert not step1["isCompleted"]

    step2 = client.post("/api/tracks/DE/step/shock_radar/complete", json={"step_id": "shock_radar", "score": 85}).get_json()
    assert step2["percent"] == 40

    step3 = client.post("/api/tracks/DE/step/pragmatics/complete", json={"step_id": "pragmatics", "score": 95}).get_json()
    step4 = client.post("/api/tracks/DE/step/simulation/complete", json={"step_id": "simulation", "score": 90}).get_json()
    step5 = client.post("/api/tracks/DE/step/exam/complete", json={"step_id": "exam", "score": 100}).get_json()

    assert step5["percent"] == 100
    assert step5["isCompleted"]
    assert step5["certificateToken"]
    assert step5["certificateUrl"].startswith("/certificate/")
    assert step5["cqLevel"] == "Cultural Analyst"

    # Verify unlocked certificate works
    cert_res = client.get(step5["certificateUrl"])
    assert cert_res.status_code == 200
    assert b"Dana Bolatova" in cert_res.data

    # 4. Logout and Login
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").get_json()["user"] is None

    # Login with bad password fails
    bad_login = client.post("/api/auth/login", json={"username": "scholar_dana", "password": "wrong"})
    assert bad_login.status_code == 401

    # Login with good password succeeds
    login_res = client.post("/api/auth/login", json={"username": "scholar_dana", "password": "secretpassword123"})
    assert login_res.status_code == 200
    assert login_res.get_json()["user"]["username"] == "scholar_dana"




def test_sandbox_matrix_any_nation_any_situation(client):
    m = client.get("/api/roleplay/sandbox").get_json()
    assert len(m["situations"]) == 8 and len(m["personas"]) == 11 and len(m["animations"]) == 9
    codes = list(client.get("/api/bootstrap").get_json()["countries"])
    for code in codes:                                   # 11 nations × 8 situations, opening turn
        for s in m["situations"]:
            body = {"country": code, "situation": s["id"], "turn": 0, "custom_context": "Asking a landlord to fix the heating"}
            r = client.post("/api/roleplay/interact", json=body)
            assert r.status_code == 200, (code, s["id"])
            j = r.get_json()
            assert j["animation"] in m["animations"] and j["npc_reply"] and j["delta"] == 0 and j["hints"]
            assert j["voice"]["lang"] == client.get(f"/api/countries/{code}").get_json()["lang"]


def test_sandbox_gestures_and_proxemics(client):
    def turn(**kw):
        r = client.post("/api/roleplay/interact", json={"turn": 1, "trust": 50, **kw})
        assert r.status_code == 200, r.get_json()
        return r.get_json()

    clock = turn(country="CN", situation="gift_ceremony", user_action="give_clock")
    assert clock["delta"] < -15 and clock["animation"] == "offended_look_away" and clock["gaze"] == "averted"
    assert turn(country="DE", situation="gift_ceremony", user_action="give_clock")["delta"] > 0
    hug_jp = turn(country="JP", situation="first_contact", user_action="hug")
    hug_it = turn(country="IT", situation="first_contact", user_action="hug")
    assert hug_jp["animation"] == "step_back_uncomfortable" and hug_jp["delta"] < 0 < hug_it["delta"]
    assert turn(country="KR", situation="gift_ceremony", user_action="give_two_hands")["animation"] == "two_hands_present"
    assert turn(country="JP", situation="academic_dispute", user_action="bow")["animation"] == "bow_respect"
    refuse = turn(country="KZ", situation="home_hospitality", user_action="refuse_food_bluntly")
    assert refuse["delta"] < turn(country="DE", situation="home_hospitality", user_action="refuse_food_bluntly")["delta"] < 0
    # closer than 0.75 × proxemics_cm (JP = 110 cm → 82 cm) → the character steps back and says so
    close = turn(country="JP", situation="first_contact", user_message="Hello, nice to meet you!", distance_cm=60)
    assert close["proximity"]["violated"] and close["animation"] == "step_back_uncomfortable"
    assert close["body"]["step_back_cm"] > 0 and close["proximity"]["zone"] == "personal"
    assert not turn(country="IT", situation="first_contact", user_message="Ciao!", distance_cm=60)["proximity"]["violated"]
    sorry = turn(country="DE", situation="lateness_crisis",
                 user_message="I am very sorry for being late, the train was delayed. It won't happen again.")
    rude = turn(country="DE", situation="lateness_crisis", user_message="whatever, I'm late")
    assert sorry["delta"] > 5 > rude["delta"] and sorry["source"] == "engine"
    assert sorry["trust_score"] == 50 + sorry["delta"]


def test_sandbox_validation_and_result(client):
    post = lambda body: client.post("/api/roleplay/interact", json=body)
    assert post({"country": "JP", "situation": "custom_sandbox", "turn": 0}).status_code == 422
    assert post({"country": "JP", "situation": "first_contact", "turn": 2}).status_code == 422          # nothing done
    assert post({"country": "JP", "situation": "dance_battle", "turn": 0}).status_code == 422
    assert post({"country": "JP", "situation": "first_contact", "user_action": "kiss", "turn": 1}).status_code == 422
    assert post({"country": "ZZ", "situation": "first_contact", "turn": 0}).status_code == 404
    r = client.post("/api/roleplay/sandbox/result", json={"country": "TR", "situation": "home_hospitality", "trust": 82, "turns": 5})
    assert r.get_json() == {"ok": True}


def test_sandbox_llm_drives_the_character_but_not_physics(monkeypatch):
    from app import ai

    class LiveConfig(TestConfig):
        AI_PROVIDER, GEMINI_API_KEY = "gemini", "fake-key"

    c = create_app(LiveConfig).test_client()
    prompts = []

    def fake_llm(provider, key, model, prompt):
        prompts.append(prompt)
        return ('{"npc_reply": "Ah, thank you, Sensei will be pleased.", "animation": "nod_approval", "emotion": "joy",'
                ' "gaze": "soft", "mood": "happy", "delta": 9, "feedback": "Two hands show respect.", "signals": []}')

    monkeypatch.setattr(ai, "_call_llm", fake_llm)
    body = {"country": "JP", "situation": "gift_ceremony", "user_action": "give_two_hands", "turn": 1, "trust": 50}
    r = c.post("/api/roleplay/interact", json=body).get_json()
    assert r["source"] == "live" and r["animation"] == "nod_approval" and r["trust_score"] == 59
    assert "Tanaka" not in prompts[0] and "Mrs. Sato" in prompts[0] and "both hands" in prompts[0]
    r = c.post("/api/roleplay/interact", json={**body, "distance_cm": 50}).get_json()   # space invaded
    assert r["animation"] == "step_back_uncomfortable" and r["proximity"]["violated"]

    monkeypatch.setattr(ai, "_call_llm", lambda *a: (_ for _ in ()).throw(ConnectionError("offline")))
    r = c.post("/api/roleplay/interact", json=body).get_json()
    assert r["source"] == "engine" and r["animation"] == "two_hands_present"


def test_new_countries_are_added_to_an_existing_database():
    from sqlalchemy import delete, select

    from app.extensions import db
    from app.models import Country, Setting, TranslationCache
    from app.seeding import add_new_countries, seed

    app = create_app(TestConfig)
    with app.app_context():
        db.session.delete(db.session.scalar(select(Country).where(Country.code == "TR")))   # an "old" DB without Turkey
        db.session.execute(delete(TranslationCache).where(TranslationCache.country_code == "TR"))
        s = db.session.get(Setting, "pragma")
        s.value = {**s.value, "hearing": {k: v for k, v in s.value["hearing"].items() if k != "TR"}}
        db.session.commit()
        assert add_new_countries() == ["TR"] and add_new_countries() == []
        assert "TR" in db.session.get(Setting, "pragma").value["hearing"]
        assert "nothing to do" in seed()
    r = app.test_client().post("/api/decode", json={"text": "Your idea won't work, we need another solution.", "country": "TR"})
    assert r.get_json()["source"] == "expert-cache"
