# CLAUDE.md — карта проекта CultureBridge AI

> Этот файл — полная выжимка структуры проекта, чтобы новой модели/разработчику не нужно было перечитывать весь код.
> Читай нужный файл только когда меняешь именно его. Держи этот документ актуальным при изменениях.

## Что это
Веб-платформа для межкультурной адаптации студентов (выпускников НИШ, Казахстан) за рубежом. Демонстрируется на научном конкурсе.
UI на **английском**, документация (README) на **русском**. Пользователь общается по-русски.

**Стек:** Python 3.12 · Flask 3.1 · Flask-SQLAlchemy 3.1 / SQLAlchemy 2.0 (typed `Mapped[]`) · Pydantic 2 · SQLite (`culturebridge.db`, PostgreSQL через `DATABASE_URL`) · google-genai / openai (на сервере) · Jinja2 · ванильный JS + Fetch · Chart.js 4 · D3 7 + TopoJSON (карта/глобус) · Web Audio / Web Speech API · Tailwind (Play CDN-скрипт) + Alpine.js только в админке · Gunicorn · Docker.
Все фронтенд-библиотеки **локально** в `app/static/vendor/` (работает офлайн). Никаких сборщиков (npm нет).

## Запуск и тесты
```bash
pip install -r requirements.txt
python seed.py            # создать схему и залить данные (идемпотентно); --reset = пересоздать БД
python wsgi.py            # dev-сервер, PORT (по умолчанию 5000)
pytest -q                 # 12 тестов, in-memory SQLite, AI выключен
gunicorn wsgi:app         # прод (только Linux)
```
Окружение этой машины (Windows): системного Python нет. В прошлой сессии использовался временный venv в scratchpad
(путь прописан в `.claude/launch.json`, конфиг `culturebridge-flask` для превью-сервера) — он может исчезнуть; тогда нужен Python 3.11+.
Git установлен в `C:\Program Files\Git\cmd\git.exe` (может не быть в PATH старых терминалов). Репозиторий: ветка `main`, remote ещё не добавлен.
Пустые папки `css/`, `js/`, `vendor/` в корне — остатки прототипа, заблокированы OneDrive, игнорировать.

## Структура файлов
```
app/
  __init__.py     create_app(): конфиг, ProxyFix, blueprints, security headers, CLI `flask seed`/`upgrade-db`/`import-alumni`, автосид
  config.py       Config (env/.env) и TestConfig (sqlite://, AI off, ADMIN_PASSWORD="test-admin")
  extensions.py   db = SQLAlchemy(model_class=Base)
  models.py       все ORM-модели (countries, dimensions, alumni, etiquette, greetings, match, quiz, roleplay, attempts, cache)
  schemas.py      Pydantic-схемы входа: DecodeIn, QuizAnswerIn, QuizFinishIn, MatchCheckIn, RoleplayResultIn, CRUD-схемы
  api.py          blueprint /api (публичный) + ApiError, parse(schema), register_error_handlers(app), in-memory rate limiter
  web.py          blueprint / (страницы сайта, SEO: robots.txt, sitemap.xml, manifest, /certificate/<token>, healthz)
  admin.py        blueprint pages /admin (логин/логаут, шаблоны) + blueprint api /api/admin (CRUD, требует session["admin"])
  ai.py           AI-декодер: цепочка кэш → LLM → экспертный кэш → движок; _call_llm(), PROMPT, phrase_hash()
  pragma.py       rule-based прагматический движок analyze(text, country, lexicon)
  localize.py     офлайн-разговорник (PHRASEBOOK): polite rephrasings на 10 языках + альтернативные регистры английского
  migrate.py      ensure_schema(): автоматическая миграция схемы SQLite/PostgreSQL без внешних инструментов
  tracks.py       движок страновых треков (5 этапов по Колбу), прогресс, уровни CQ, стрики и выдача сертификатов
  services.py     сериализация (country_dict, scenario_dict, …), radar(a, b), community_stats(), certificate_data()
  seeding.py      seed(reset) — заливает всё из seed_data/research_data.json + предрасчёт 60 экспертных разборов; import_alumni()
  templates/
    base.html           базовый каркас (HTML5, шрифты, CSP, тема)
    page_shell.html     общий shell для страниц (навигация, хлебные крошки, hero, карточка следующего модуля, футер)
    error.html          страницы ошибок (404, 500)
    admin.html          админка (Alpine: function admin()), вкладки dash/quiz/voices/etiquette/scenarios/cache
    admin_login.html    форма пароля
    partials/           nav.html, footer.html
    pages/              home.html, learn.html, auth.html, atlas.html, greetings.html, radar.html, decoder.html,
                        proxemics.html, roleplay.html, match.html, quiz.html, stats.html, about.html, docs.html, certificate.html
  static/
    css/styles.css      базовая дизайн-система (glassmorphism, bento, токены тем :root / [data-theme=light])
    css/pages.css       стили многостраничного интерфейса (module cards, theory cards, stats hero, certificate, print styles)
    js/app.js           фронтенд (null-safe для всех страниц, Three.js 3D-фон, Chart.js, D3 Atlas, Audio, Speech)
    vendor/             d3, topojson-client, world-110m, chart.umd, alpine, tailwind, three.min.js, TwemojiCountryFlags
seed_data/research_data.json   первичный источник контента (страны, опрос, квиз, матч, сценарии, приветствия, лексикон)
seed.py  wsgi.py  tests/test_api.py
requirements.txt  Dockerfile  Procfile  render.yaml  .env.example  .gitignore  .gitattributes(eol=lf)  .dockerignore  README.md
```

## Поток данных
`research_data.json` → `seed()` → таблицы БД → REST API (`services.*_dict`) → `app.js` (fetch) → DOM.
Изменил JSON → нужен `python seed.py --reset` (сид не обновляет существующую БД, только пустую). Контент, добавленный через админку, при reset теряется.

## Схема БД (app/models.py)
- `countries` (code 2 буквы, name, flag emoji, iso_numeric — для сопоставления с картой world-atlas, lang, context, lat/lon, mentality, proxemics_cm, voice_min/max, hospitality) →
  `etiquette_rules` (title, text, position), `universities`, `alumni_voices` (university, text, approved), `country_dimensions` (value 0–100)
- `dimensions` (key: direct|express|contact|time|hierarchy|smalltalk, label, short, low_label, high_label, position) → `gap_advice` (direction up|down, text)
- `greetings`, `match_items` (slug = id обычая, country_id, situation, explanation)
- `quiz_questions` (topic, flag, question, explanation, position, active) → `quiz_options` (text, is_correct, position); `quiz_badges` (min/max по шкале из 12)
- `scenarios` (slug, country_id, npc, npc_role, avatar, intro, start_trust, active) → `scenario_steps` (npc_line) → `scenario_options` (text, delta, mood, feedback)
- `reference_sources` (список литературы), `settings` (key/JSON: `pragma` = лексикон движка, `translator_presets`, `moods`)
- `translation_cache` (phrase_hash sha256 нормализованного текста, country_code, provider gemini|openai|expert, model, result JSON, hits; unique(hash,country,provider))
- `attempts` (module quiz|match|roleplay|decode, ref, score, max_score) — анонимная статистика

Страны в сиде: KZ, IT, HU, CA, US (последние 4 — с данными опроса выпускников), CN, JP, KR, GB, DE.

## REST API
Публичный (`app/api.py`):
| | |
|---|---|
| GET `/api/health` | БД + активный AI-провайдер |
| GET `/api/bootstrap` | `{countries:{CODE:country_dict}, dimensions, greetings, presets, moods, references, stats, ai:{provider,model}}` |
| GET `/api/countries[/<code>]` | профили |
| GET `/api/radar?from=KZ&to=DE` | `{from,to:{code,name,flag,values[6]}, dimensions, distance_index, level low|mid|high, level_label, top_gaps[≤3]{index,key,label,diff,abs,from,to,severity,direction,pole,advice[]}}` |
| POST `/api/decode` `{text≤500, country, fresh?}` | `{risk, level 0-2, level_label, heard, adapted, tags[], notes[], softeners, category?, source live|cache|expert-cache|engine, provider, model}`; 429 при лимите |
| GET `/api/ai/status` | провайдер |
| GET `/api/quiz` | активные вопросы, опции перемешаны, БЕЗ правильного ответа |
| POST `/api/quiz/<id>/answer` `{option_id}` | `{correct, correct_option_id, explanation}` |
| POST `/api/quiz/finish` `{answers:{qid:option_id}}` | сервер сам считает балл → `{score,total,review[],badge}`, пишет attempt |
| GET `/api/match` | `{customs[{slug,custom,icon}], situations[{id,text}]}` (перемешаны; связь id→slug скрыта) |
| POST `/api/match/check` `{pairs:{situation_id:slug}}` | `{score,total,results{id:bool},explanations[]}` (ключи results — строки) |
| GET `/api/scenarios` | сценарии в формате фронта: `{id(slug),country,title,npc,npcRole,avatar,start,intro,steps[{npc,options[{text,delta,mood,feedback}]}]}` |
| POST `/api/scenarios/<slug>/result` `{trust}` | статистика |
| GET `/api/stats` | community_stats |

Админ (`app/admin.py`, сессия; запись только с `Content-Type: application/json` — защита от CSRF):
`GET /api/admin/stats|countries|quiz|voices|etiquette|scenarios|cache`, `POST quiz|voices|etiquette|scenarios`, `PATCH quiz/<id> {active}`,
`DELETE quiz/<id>|voices/<id>|etiquette/<id>|scenarios/<slug>|cache/<id>|cache` (последний удаляет только LLM-записи, экспертные остаются).
Страницы: `GET /admin/`, `POST /admin/login` (form `password`, hmac.compare_digest), `POST /admin/logout`. Пустой `ADMIN_PASSWORD` = админка выключена.

Ошибки: `ApiError(msg, status)` → `{error}`; `pydantic.ValidationError` → 422 `{error, details[{field,msg}]}`; 404/500 на /api → JSON.

## AI-декодер (app/ai.py)
`decode(text, code, fresh)`:
1. если не `fresh` — LLM-ответ из `translation_cache` (provider gemini/openai) → `source:"cache"`
2. если есть ключ — `_call_llm()` (Gemini: `genai.Client(...).models.generate_content(response_mime_type="application/json")`; OpenAI: `chat.completions` с `response_format=json_object`), `_clean_llm()` нормализует JSON, upsert в кэш → `"live"`; при любой ошибке — снова кэш
3. экспертный кэш (provider `expert`, создаётся в seed для 6 пресетов × 10 стран) → `"expert-cache"`
4. `pragma.analyze()` → `"engine"` (не падает никогда)

Модель меняется через env: `AI_PROVIDER` (gemini|openai|none), `AI_MODEL` (по умолчанию `DEFAULT_MODELS` = gemini-2.5-flash / gpt-4o-mini), ключи `GEMINI_API_KEY`/`OPENAI_API_KEY`, `AI_TIMEOUT`. Промпт — константа `PROMPT` в ai.py.

### Прагматический движок (app/pragma.py)
Лексикон в `settings["pragma"]`: `features[{id,label,weight,amp,patterns[regex]}]`, `softeners[regex]`, `categories[{id,test[feature ids]}]` (порядок важен: food, time, criticism, request, decline), `adapt{category:{CODE:шаблон}}` (категории criticism, food, time, request, decline, ask с `{obj}`, neutral с `{text}`), `hearing{CODE:[low,mid,high]}`.
Алгоритм: для каждой фичи считаем совпадения регексов (фича `intensity` — регистрозависимая); `raw += weight·(1+0.5·(hits−1))·sens[amp]`, где `sensitivity(dims, hospitality)` усиливает: indirect = 0.25+(100−direct)/100·1.3, hierarchy = 0.5+hierarchy/100·1.1, time, neutral, hospitality (коэффициент страны). Минус 9 за каждый смягчитель (макс. 3). `risk = 100·(1−e^(−raw/45))`, обрезка 2..98; уровни <30 / <60 / ≥60. Категория → адаптированная фраза; `request` без обращения к преподавателю → `ask` (извлекает объект после give/send me).

## Алгоритм Gap Radar (services.radar)
Cultural Distance Index = min(100, round(2·RMS шести разниц)). Уровень <35 low, <60 mid, иначе high. Топ-3 разрыва с |diff|≥10, severity ≥40 high / ≥20 mid; advice = `gap_advice` по направлению (up — в стране назначения выше).

## Фронтенд (app/static/js/app.js)
Одна IIFE. `boot()` → `Promise.all(/api/bootstrap, /api/scenarios, загрузка шрифта флагов)` → заполняет глобали `COUNTRIES, CODES, DIMENSIONS, GREETINGS, MOODS, ROLEPLAYS` → вызывает модули:
`initGlobe` (canvas, d3.geoOrthographic, дуги из Астаны) · `initAtlas` (SVG карта NaturalEarth1, карточка страны, голоса выпускников; кнопка «Compare» → `radar.set`) · `initGreetings` (2 бегущие строки, 3D-переворот, speechSynthesis) · `initRadar` (Chart.js radar + `/api/radar`, панель Culture Shock + U-кривая Оберга; возвращает `{set}`) · `initDecoder(presets, ai)` (`POST /api/decode`, SVG-спидометр, бейдж источника) · `initVoice` (микрофон, RMS→0–100, онсеты=темп; только в браузере) · `initProxemics(voice)` (SVG-аватары, пороги по `proxemics_cm`: <0.6 красный, <0.88 жёлтый, ≤1.6 зелёный, иначе «холодно») · `initRoleplay` (диалог, trust 0–100, POST результата) · `initMatch` (drag&drop + tap, проверка на сервере) · `initQuiz` (ответ проверяется по одному, финиш на сервере, конфетти).
Прочее: `api(path, body?)` — fetch-обёртка; `progress` + `renderPassport()` — «CQ Passport» в localStorage (`cb-progress`); тема `cb-theme`; `themeListeners` перерисовывают canvas/Chart при смене темы; `esc()` — экранирование всего пользовательского/БД-текста в innerHTML.

## Важные нюансы
- Флаги-эмодзи на Windows не рисуются — подключён шрифт `Twemoji Country Flags` (первый в `--font`, и `Chart.defaults.font.family`). Не убирать.
- Цвета только через CSS-переменные в styles.css; тёмная тема по умолчанию (`data-theme="dark"`).
- Квиз-бейджи заданы для 12 вопросов; `badge_for` масштабирует счёт, если админ добавил/скрыл вопросы.
- Rate limiter декодера — in-memory, per-worker (`DECODE_RATE_LIMIT`/мин/IP).
- `SECRET_KEY` без env генерируется случайно на процесс → в проде задавать обязательно (render.yaml генерирует).
- В Docker БД лежит в `/app/data` (volume); render.yaml: план Starter + диск. На free-плане убрать `plan`/`disk` — SQLite будет пересоздаваться из сида при рестарте.
- `.env` (секреты, локальный пароль админки) и `*.db` — в .gitignore, не коммитить.
- Данные измерений — экспертные оценки (Hofstede/Meyer/Hall), цитаты выпускников — сокращённые анонимные ответы опроса; не выдумывать новые «голоса».

## Типовые изменения
- **Новая страна:** добавить объект в `countries` в research_data.json (+ шаблоны в `pragma_adapt.*` и `pragma_hearing` для её кода, иначе движок упадёт KeyError) → `seed.py --reset`. Числовой ISO-код должен совпадать с id в world-110m.
- **Новый кейс квиза / голос / этикет / сценарий:** через `/admin` (или в JSON + reset).
- **Сменить LLM:** только `.env` (`AI_PROVIDER`, `AI_MODEL`, ключ) и перезапуск.
- **Новый эндпоинт:** функция в api.py, схема в schemas.py, тест в tests/test_api.py.
