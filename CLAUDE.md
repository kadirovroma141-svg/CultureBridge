# CLAUDE.md — карта проекта CultureBridge AI

> Этот файл — полная выжимка структуры проекта, чтобы новой модели/разработчику не нужно было перечитывать весь код.
> Читай нужный файл только когда меняешь именно его. Держи этот документ актуальным при изменениях.

## Что это
Веб-платформа для межкультурной адаптации студентов (выпускников НИШ, Казахстан) за рубежом. Демонстрируется на научном конкурсе.
UI на **английском**, документация (README, CLAUDE.md) на **русском**. Пользователь общается по-русски.

**Стек:** Python 3.12 · Flask 3.1 · Flask-SQLAlchemy 3.1 / SQLAlchemy 2.0 (typed `Mapped[]`) · Pydantic 2 · Werkzeug Security (хэширование паролей) · SQLite (`culturebridge.db`, PostgreSQL через `DATABASE_URL`) · google-genai / openai (на сервере) · Jinja2 · ванильный JS + Fetch · Chart.js 4 · D3 7 + TopoJSON (карта/глобус) · Web Audio / Web Speech API · Tailwind (Play CDN-скрипт) + Alpine.js только в админке · Gunicorn · Docker.
Все фронтенд-библиотеки **локально** в `app/static/vendor/` (работает офлайн). Никаких сборщиков (npm нет).

## Запуск и тесты
```bash
pip install -r requirements.txt
python seed.py            # создать схему и залить данные (идемпотентно); --reset = пересоздать БД
python wsgi.py            # dev-сервер, PORT (по умолчанию 5000)
pytest -q                 # 19 тестов, in-memory SQLite, AI выключен
gunicorn wsgi:app         # прод (только Linux)
```
**Деплой: Vercel + Supabase.** Vercel сам определяет Flask и запускает `wsgi.py` (rewrites не нужны — с ними Flask получает путь `/api/index` и отдаёт 404); `app/static` в функцию не попадает, поэтому `vercel.json` → `buildCommand` копирует его в `public/static` (раздаётся CDN); `.python-version` (3.12) + `.vercelignore`.
На Vercel (`VERCEL=1`) пул соединений `NullPool`, `AUTO_SEED`/`AUTO_MIGRATE` по умолчанию выключены — схему и данные заливать локально:
`DATABASE_URL=<pooler-строка Supabase> python seed.py`. Прямой хост `db.<ref>.supabase.co` только IPv6 → использовать пулер
`aws-0-ap-northeast-2.pooler.supabase.com:6543`, пользователь `postgres.<ref>`, `@` в пароле → `%40`. `sslmode=require` добавляется сам.
`ensure_schema()` на PostgreSQL включает RLS на всех таблицах (закрывает REST API Supabase; приложение — владелец таблиц, RLS его не касается).
Окружение этой машины (Windows): системного Python нет. Используется виртуальное окружение:
`C:\Users\kadir\AppData\Local\Temp\claude\C--Users-kadir-OneDrive-Documents-claude-zerde\b36ede1d-8fa8-4fbc-85dd-87d58c546ef2\scratchpad\venv\Scripts\python.exe`
Git установлен в `C:\Program Files\Git\cmd\git.exe`. Репозиторий: ветка `main`.
Пустые папки `css/`, `js/`, `vendor/` в корне — остатки старого прототипа, заблокированы OneDrive, игнорировать.

## Структура файлов
```
app/
  __init__.py     create_app(): конфиг, ProxyFix, blueprints, security headers, CLI `flask seed`/`upgrade-db`/`import-alumni`, автосид
  config.py       Config (env/.env) и TestConfig (sqlite://, AI off, ADMIN_PASSWORD="test-admin")
  extensions.py   db = SQLAlchemy(model_class=Base)
  models.py       все ORM-модели (User, TrackProgress, Country, CountryDimension, Dimension, AlumniVoice, EtiquetteRule,
                  University, Greeting, MatchItem, QuizQuestion, QuizOption, QuizBadge, Scenario, ScenarioStep, ScenarioOption,
                  Reference, Setting, TranslationCache, Attempt)
  schemas.py      Pydantic-схемы входа: RegisterIn, LoginIn, TrackStepCompleteIn, DecodeIn, QuizAnswerIn, QuizFinishIn,
                  MatchCheckIn, RoleplayResultIn, RoleplayInteractIn / SandboxResultIn (3D-песочница), CRUD-схемы админки
  api.py          blueprint /api (публичный) + аутентификация (/api/auth/*) + треки (/api/tracks/*) + ApiError, parse(schema)
  web.py          blueprint / (страницы сайта, группы навигации NAV_GROUPS, SEO: robots.txt, sitemap.xml, manifest, /certificate/<token>, healthz)
  admin.py        blueprint pages /admin (логин/логаут, шаблоны) + blueprint api /api/admin (CRUD, требует session["admin"])
  ai.py           AI-декодер: цепочка кэш → LLM → экспертный кэш → движок; _call_llm(), PROMPT, phrase_hash()
  pragma.py       rule-based прагматический движок analyze(text, country, lexicon)
  roleplay.py     судья свободных реплик judge() + LLM-персонаж для POST /api/ai/roleplay
  sandbox.py      3D AI Cultural Sandbox: SITUATIONS (8), PERSONAS (11 наций × 4 роли), жесты, проксемика, interact()
  localize.py     офлайн-разговорник (PHRASEBOOK): polite rephrasings на 10 языках + альтернативные регистры английского
  migrate.py      ensure_schema(): автоматическая миграция схемы SQLite/PostgreSQL без внешних инструментов
  tracks.py       движок 5-ступенчатых треков по Колбу: First Contact, Gap Discovery, Pragmatics, Roleplay, Certification Exam
  services.py     сериализация (country_dict, scenario_dict, …), radar(a, b), community_stats(), certificate_data()
  seeding.py      seed(reset) — заливает всё из seed_data/research_data.json + предрасчёт 66 экспертных разборов; import_alumni();
                  add_new_countries() — досев стран, появившихся в JSON после сида (вызывается при старте и в seed())
  templates/
    base.html           базовый каркас (HTML5, шрифты, CSP, тема dark/light)
    page_shell.html     общий shell для страниц (навигация, хлебные крошки, переключатель смежных модулей Sibling Navigator, hero, футер)
    error.html          страницы ошибок (404, 500)
    admin.html          админка (Alpine: function admin()), вкладки dash/quiz/voices/etiquette/scenarios/cache
    admin_login.html    форма пароля
    partials/           nav.html (Mega-Dropdowns, ⌘K поиск, mobile drawer, профиль), footer.html
    pages/              home.html, learn.html, auth.html, atlas.html, greetings.html, radar.html, decoder.html,
                        proxemics.html, roleplay.html (3D-песочница + классика), match.html, quiz.html, stats.html, about.html, docs.html, certificate.html
  static/
    css/styles.css      базовая дизайн-система (Glassmorphism 2.0, obsidian темная тема, дропдауны, модальный поиск, мобильный ящик)
    css/pages.css       стили страниц (модули, тикер стран, промо-баннер трека, роадмап, авторизация, карточки теорий, сертификат)
    js/app.js           фронтенд (initNavigation, поиск ⌘K, мобильное меню, Three.js 3D-фон, Chart.js, D3 Atlas, Audio, Speech, initSandbox)
    js/sandbox3d.js     3D-движок песочницы (window.CBSandbox3D: Stage, LOOKS) — гуманоид, комнаты, 9 анимаций; грузится только на /roleplay
    img/icon.svg        векторный SVG логотип платформы
    vendor/             d3, topojson-client, world-110m, chart.umd, alpine, tailwind, three.min.js, TwemojiCountryFlags
seed_data/research_data.json   первичный источник контента (страны, опрос, квиз, матч, сценарии, приветствия, лексикон)
seed.py  wsgi.py  tests/test_api.py
requirements.txt  Dockerfile  Procfile  render.yaml  .env.example  .gitignore  .gitattributes(eol=lf)  .dockerignore  README.md
```

## Поток данных
`research_data.json` → `seed()` → таблицы БД → REST API (`services.*_dict`, `tracks.py`) → `app.js` (fetch) → DOM.
Изменил JSON → нужен `python seed.py --reset` (сид не обновляет существующую БД, только пустую). Контент, добавленный через админку, при reset теряется.
Исключение: **новые страны** из JSON досеваются автоматически (`add_new_countries()` при старте приложения) — reset не нужен.

## Схема БД (app/models.py)
- `users` (id, username unique, password_hash, full_name, target_country default DE, cq_level, streak_days, last_active_date YYYY-MM-DD, created_at; методы `set_password`, `check_password`, `to_dict`)
- `track_progress` (id, user_id FK, country_code 2 буквы, current_step 1-5, completed_steps JSON list, scores JSON dict, is_completed bool, certificate_token unique, updated_at; unique(user_id, country_code))
- `countries` (code 2 буквы, name, flag emoji, iso_numeric — для сопоставления с картой world-atlas, lang, context, lat/lon, mentality, proxemics_cm, voice_min/max, hospitality) →
  `etiquette_rules` (title, text, position), `universities`, `alumni_voices` (student_name, nis_branch, program_duration, text, advice, is_verified, source, approved), `country_dimensions` (value 0–100)
- `dimensions` (key: direct|express|contact|time|hierarchy|smalltalk, label, short, low_label, high_label, position) → `gap_advice` (direction up|down, text)
- `greetings`, `match_items` (slug = id обычая, country_id, situation, explanation)
- `quiz_questions` (topic, flag, question, explanation, position, active) → `quiz_options` (text, is_correct, position); `quiz_badges` (min/max по шкале из 12)
- `scenarios` (slug, country_id, npc, npc_role, avatar, intro, start_trust, active) → `scenario_steps` (npc_line) → `scenario_options` (text, delta, mood, feedback)
- `reference_sources` (список литературы), `settings` (key/JSON: `pragma` = лексикон движка, `translator_presets`, `moods`)
- `translation_cache` (phrase_hash sha256 нормализованного текста, country_code, provider gemini|openai|expert, model, result JSON, hits; unique(hash,country,provider))
- `attempts` (module quiz|match|roleplay|decode|roleplay_ai, ref, score, max_score, session_id, user_name, origin_country, target_country, cultural_level, token, detail JSON, user_id FK)

Страны в сиде (11): KZ, IT, HU, CA, US (с данными опроса выпускников), CN, JP, KR, GB, DE, TR (TR — без голосов выпускников).

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
| GET `/api/roleplay/sandbox` | матрица песочницы: `{situations[8]{id,title,icon,kind,role,brief,tests}, personas{CODE:{formal,peer,host,stranger:{name,gender,age}}}, actions[], animations[9]}` |
| POST `/api/roleplay/interact` `{country, situation, custom_context?, user_message, user_action, distance_cm, trust, turn, history[{role,text}]}` | ход с 3D-персонажем → `{npc_reply, animation, emotion, gaze, mood, delta, trust_score, feedback, signals[], body{bow_deg,gesture_amp,gesture_freq,step_back_cm}, proximity{distance_cm,comfort_cm,threshold_cm,zone,violated}, voice{lang,rate,volume}, npc, hints[], source live\|engine}`; turn 0 = реплика-открытие |
| POST `/api/roleplay/sandbox/result` `{country, situation, trust, turns}` | attempt `roleplay_ai`, ref `sandbox:CODE:situation` |
| GET `/api/stats` | community_stats |
| POST `/api/auth/register` `{username, password, full_name, target_country}` | регистрация студента, создание сессии |
| POST `/api/auth/login` `{username, password}` | вход в аккаунт, инкремент стрика дней активности |
| POST `/api/auth/logout` | завершение сессии пользователя |
| GET `/api/auth/me` | профиль текущего пользователя, стрик и список активных треков |
| GET `/api/tracks` | сводка по всем 11 страновым трекам (название, флаг, процент прогресса, статус) |
| GET `/api/tracks/<country_code>` | учебный план 5 этапов по стране (isUnlocked, isCompleted, score, contextData) |
| POST `/api/tracks/<country_code>/step/<step_id>/complete` `{score, detail?}` | фиксация прохождения шага (1..5), разблокировка следующего, генерация сертификата на 5-м шаге |

Админ (`app/admin.py`, сессия; запись только с `Content-Type: application/json` — защита от CSRF):
`GET /api/admin/stats|countries|quiz|voices|etiquette|scenarios|cache`, `POST quiz|voices|etiquette|scenarios`, `PATCH quiz/<id> {active}`,
`DELETE quiz/<id>|voices/<id>|etiquette/<id>|scenarios/<slug>|cache/<id>|cache` (последний удаляет только LLM-записи, экспертные остаются).
Страницы: `GET /admin/`, `POST /admin/login` (form `password`, hmac.compare_digest), `POST /admin/logout`. Пустой `ADMIN_PASSWORD` = админка выключена.

Ошибки: `ApiError(msg, status)` → `{error}`; `pydantic.ValidationError` → 422 `{error, details[{field,msg}]}`; 404/500 на /api → JSON.

## Системное обучение: 5-ступенчатые треки (app/tracks.py)
Модель основана на цикле эмпирического обучения Дэвида Колба (Experiential Learning Cycle) и модели культурного интеллекта (CQ: Earley & Ang):
1. **First Contact & Non-Verbal Codes (`first_contact`)**:
   - Теория: Edward T. Hall (1966) — проксемика и невербальные границы.
   - Задачи: ритуал приветствия с аудио-произношением, калибровка дистанции комфорта (cm), порог громкости голоса.
2. **Gap Radar & Shock Prevention (`shock_radar`)**:
   - Теория: Geert Hofstede & Erin Meyer — 6 измерений культуры, кривая адаптации Калерво Оберга (U-curve).
   - Задачи: 6D-радар относительно Казахстана, Cultural Distance Index (CDI), чек-лист превентивной адаптации.
3. **Pragmatic Subtext & Politeness (`pragmatics`)**:
   - Теория: Brown & Levinson Face Theory + Hall Context.
   - Задачи: расшифровка скрытого подтекста, измеритель риска обидеть собеседника, вежливые речевые шаблоны на 10 языках.
4. **Live Interactive Simulation (`simulation`)**:
   - Теория: Behavioral CQ (динамическая адаптация стиля коммуникации под социальную иерархию).
   - Задачи: диалог с виртуальным NPC персонажем, достижение уровня доверия ≥ 70%.
5. **Country Qualification Exam (`exam`)**:
   - Теория: Комплексная оценка когнитивного и практического CQ.
   - Задачи: проверка обычаев в реальных ситуациях, разбор кейс-дилемм, балл ≥ 80% → официальный верифицированный цифровой сертификат (`/certificate/<token>`).

## 3D AI Cultural Sandbox (/roleplay, app/sandbox.py + static/js/sandbox3d.js)
Любая из 11 стран × любая из 8 ситуаций (`academic_dispute, team_criticism, home_hospitality, gift_ceremony, first_contact, lateness_crisis, public_etiquette, custom_sandbox` — последняя требует `custom_context`).
- Ситуация задаёт тип отношений (`kind`: formal/peer/host/stranger) → персонаж из `PERSONAS[code][kind]` (имя, пол, возраст).
- `interact()`: LLM (тот же `ai._call_llm`, промпт `sandbox.PROMPT`) выбирает реплику + одну из 9 анимаций (`ANIMATIONS`) + эмоцию/взгляд; при отказе/без ключа — движок: `roleplay.judge()` по тексту + `SITUATION_CUES` + `_action_effect()` (жест × измерения страны) + проксемика.
- Проксемика всегда считается на сервере: `distance_cm < 0.75·proxemics_cm` или `step_too_close` → `violated`, штраф по `contact`, анимация принудительно `step_back_uncomfortable` (даже если LLM выбрал иное).
- `MASKED` убирает из текста фразы, которые сама ситуация требует («late», «won't happen again»), чтобы общий детектор их не штрафовал.
- Фронт: `initSandbox()` в app.js (селекторы, Web Speech TTS с `lang` страны + липсинк, SpeechRecognition, слайдер дистанции/W·S/Shift+колесо, HUD-радар зон Холла); `CBSandbox3D.Stage` рисует сцену: `setScene`, `play(anim, body)`, `setEmotion`, `setGaze`, `stepBack(cm)`. Внешность/декор — `LOOKS[code]` в sandbox3d.js. Прогресс — `progress.sandbox` в localStorage.
- Лимит запросов: `SANDBOX_RATE_LIMIT` (/мин/IP, по умолчанию 60).

## Навигация и визуальный дизайн
Навигация структурирована по категориям (`NAV_GROUPS` в `web.py`):
- **🎓 Tracks (`/learn`)** — прямой переход к 5-ступенчатым страновым трекам (выделен градиентной плашкой `5-Stage`).
- **🌍 Explore ▾** — World Atlas (`/atlas`), Greetings Hub (`/greetings`), Gap Radar (`/radar`).
- **⚡ AI Tools ▾** — AI Decoder (`/decoder`), Proxemics Lab (`/proxemics`), Roleplay Sim (`/roleplay`).
- **🎮 Practice ▾** — Match Customs (`/match`), Awareness Quiz (`/quiz`), Live Stats (`/stats`).
- **📚 Resources ▾** — Methodology (`/about`), API Docs (`/docs`), Verify Certificate (`/certificate/...`).
- **Командная палитра (`⌘K` / `Ctrl+K`)** — быстрый модальный поиск по всем модулям и странам с клавиатурной навигацией.
- **Contextual Breadcrumb Bar & Sibling Navigator** (`page_shell.html`) — отображение цепочки `Home / Category / Current Module` и быстрый переключатель смежных инструментов без вызова меню.
- **Пользовательский виджет** — динамический статус `👤 Name 🔥Xd` с выпадающим меню профиля/логаута в навбаре.
- **Mobile Drawer** (`#mobileDrawer`) — слайд-меню с группировкой, поиском и профилем для экранов смартфонов.

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
Одна IIFE. Инициализирует:
- `initNavigation`: мега-дропдауны, обработка кликов вне элементов, шорткаты `⌘K` / `Ctrl+K` и `Esc`, живой поиск по модулям и странам, мобильный drawer, логаут.
- `boot()` → `Promise.all(/api/bootstrap, /api/scenarios, загрузка шрифта флагов)` → заполняет глобали `COUNTRIES, CODES, DIMENSIONS, GREETINGS, MOODS, ROLEPLAYS` → вызывает модули:
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
- **Новая страна:** добавить объект в `countries` в research_data.json (+ шаблоны в `pragma_adapt.*` и `pragma_hearing` для её кода, иначе движок упадёт KeyError) → перезапуск (досеется сама) или `seed.py --reset`. Числовой ISO-код должен совпадать с id в world-110m. Для песочницы: `PERSONAS`/`INTERJECTIONS` в sandbox.py, `LOOKS` в sandbox3d.js, язык в `localize.LANGUAGE_NAMES`/`PHRASEBOOK`.
- **Новая ситуация песочницы:** запись в `SITUATIONS` и `LINES` (sandbox.py) + значение в `schemas.Situation`.
- **Новый кейс квиза / голос / этикет / сценарий:** через `/admin` (или в JSON + reset).
- **Сменить LLM:** только `.env` (`AI_PROVIDER`, `AI_MODEL`, ключ) и перезапуск.
- **Новый эндпоинт:** функция в api.py, схема в schemas.py, тест в tests/test_api.py.
