# CultureBridge AI — Intercultural Intelligence Platform

Веб-платформа для преодоления культурного барьера и социокультурной адаптации за рубежом.
Основана на опросе выпускников НИШ, обучающихся за рубежом, и моделях Hall, Hofstede, Meyer, Brown & Levinson.

**Стек:** Flask 3 · SQLAlchemy 2 (SQLite → PostgreSQL через `DATABASE_URL`) · Pydantic 2 · Gunicorn ·
серверный AI (`google-genai` / `openai`) с кэшем в БД · Jinja2 · Fetch API · Chart.js · D3 (SVG-карта) ·
Web Audio / Web Speech API · админ-панель на Tailwind + Alpine.js. Все JS-библиотеки и шрифт флагов лежат
в `app/static/vendor/`, поэтому интерфейс работает без интернета.

## Быстрый старт (локально)

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows;  на macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env          # затем впишите SECRET_KEY, ADMIN_PASSWORD, GEMINI_API_KEY
python seed.py                  # создаёт culturebridge.db и заполняет все научные данные
python wsgi.py                  # http://localhost:5000
```

`python seed.py --reset` — пересоздать базу с нуля. Пустая база также заполняется автоматически при первом запуске (`AUTO_SEED=true`).
Тесты: `pytest -q`.

## Деплой

| Платформа | Как |
|---|---|
| **Docker / VPS** | `docker build -t culturebridge .` → `docker run -p 8000:8000 --env-file .env -v cb-data:/app/data culturebridge` |
| **Render** | New → Blueprint → репозиторий (используется `render.yaml`). Впишите `GEMINI_API_KEY` и `ADMIN_PASSWORD` в панели. |
| **Railway / Heroku-подобные** | Подхватят `Procfile` (`python seed.py && gunicorn wsgi:app`). Для сохранности данных подключите PostgreSQL и задайте `DATABASE_URL`. |

## AI-декодер: как он не падает на конкурсе

`POST /api/decode` отвечает по цепочке:

1. **AI-кэш в БД** — если эта фраза уже разбиралась живой моделью для этой страны, ответ мгновенно отдаётся из базы;
2. **Живой LLM** (Gemini или OpenAI, ключ только на сервере) — ответ сохраняется в кэш;
3. **Экспертный кэш** — все 6 демонстрационных фраз × 10 стран предрассчитаны при сидировании;
4. **Rule-based прагматический движок** (`app/pragma.py`) — работает всегда, без сети.

Перед выступлением прогоните нужные фразы с интернетом — дальше они будут работать и офлайн.
В интерфейсе бейдж показывает источник: ⚡ Live AI / 💾 AI cache / 📚 Expert cache / 🧠 Expert engine.

## Админ-панель — `/admin`

Вход по `ADMIN_PASSWORD` (если не задан — панель выключена). Возможности: статистика прохождений,
добавление/скрытие/удаление кейсов квиза, ответов выпускников, правил этикета, ролевых сценариев (JSON с валидацией),
просмотр и очистка AI-кэша.

## Страницы платформы

Платформа имеет полноценную многостраничную архитектуру с общим shell-шаблоном, SEO-тегами, OpenGraph, Canonical URLs, sitemap.xml и robots.txt:

| URL | Раздел | Описание |
|---|---|---|
| `/` | **Главная** | Bento-сетка, 3D-глобус с маршрутами из Астаны, интерактивный Three.js фон, CQ Passport, витрина модулей |
| `/atlas` | **Атлас мира** | SVG-карта Natural Earth, карточки менталитета, этикет и реальные голоса выпускников НИШ; форма отправки своей истории |
| `/greetings` | **Приветствия** | 20 культур, бегущие строки, 3D-переворот карточек, жесты и озвучка через Web Speech API |
| `/radar` | **6D Gap Radar** | Сравнение культур по 6 шкалам, расчёт CDI, U-кривая адаптации Оберга, чек-лист шок-факторов |
| `/decoder` | **AI Decoder** | Прагматический переводчик подтекста (Hall, Brown & Levinson), conflict-risk спидометр, варианты на английском и местном языке |
| `/proxemics` | **Проксемика и голос** | 3D/SVG симулятор личного пространства по Э. Холлу, гистограмма комфортных дистанций, калибратор громкости речи (Web Audio) |
| `/roleplay` | **3D AI Cultural Sandbox + ролевой симулятор** | Матрица «11 наций × 8 ситуаций»: процедурный 3D-персонаж (Three.js) под управлением ИИ говорит голосом с акцентом, меняет мимику и позу, реагирует на жесты и дистанцию (проксемика Холла); вкладка классических сценариев с Cultural Trust Meter |
| `/match` | **Матчинг обычаев** | Интерактивный drag & drop и tap-тренажёр культурных традиций с серверной верификацией |
| `/quiz` | **Квиз осведомленности** | 12 реальных ситуаций, научные пояснения к каждому ответу, бейджи и генерация персонального сертификата |
| `/certificate/<token>` | **Сертификат** | Страница персонального сертификата с уникальным ID, печатью (Print-friendly CSS) и подтверждением уровня |
| `/stats` | **Live-статистика** | Динамическая аналитика из БД: распределение уровней, график активности (Chart.js), самые сложные вопросы |
| `/about` | **Методология** | Научные основы (NIS survey, Hofstede, Hall, Meyer, Brown & Levinson), этика, архитектура |
| `/docs` | **API Reference** | Полная документация REST API с примерами curl и форматами ответов |

## CLI команды

- `flask seed` — создать схему и залить исследовательские данные (идемпотентно).
- `flask upgrade-db` — автоматическая миграция схемы для существующих баз данных (добавляет недостающие колонки).
- `flask import-alumni <path>` — импорт сырых результатов опроса выпускников из JSON.

## REST API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | состояние БД и AI (readiness probe) |
| GET | `/healthz` | liveness probe (без обращения к БД) |
| GET | `/api/bootstrap` | страны, измерения, приветствия, пресеты, статистика |
| GET | `/api/countries`, `/api/countries/<code>` | профили стран |
| GET | `/api/radar?from=KZ&to=DE` | индекс культурной дистанции + топ-разрывы + чек-лист |
| POST | `/api/decode` | `{text, country, fresh?}` — культурный декодер |
| GET | `/api/quiz` | 12 кейсов (без правильных ответов) |
| POST | `/api/quiz/<id>/answer` | проверка ответа с научным объяснением |
| POST | `/api/quiz/finish` | финализация квиза, выдача бейджа и ссылки на сертификат |
| GET/POST | `/api/match`, `/api/match/check` | тренажёр сопоставления |
| GET/POST | `/api/scenarios`, `/api/scenarios/<slug>/result` | ролевые сценарии |
| GET | `/api/stats` | агрегированная статистика сообщества |
| * | `/api/admin/...` | CRUD для админ-панели (сессия) |

## Структура

```
app/            Flask-приложение: models, api, admin, web, ai, pragma, localize, migrate, services, seeding, templates, static
seed_data/      research_data.json — все данные исследования (страны, опрос, квиз, сценарии, лексикон движка)
seed.py         создание схемы + сидирование
wsgi.py         точка входа (gunicorn wsgi:app)
tests/          pytest (включая тесты всех страниц, SEO и API)
```

Данные измерений — масштабированные экспертные оценки групповых тенденций, а не характеристики каждого человека.

