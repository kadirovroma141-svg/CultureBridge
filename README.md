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

## REST API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | состояние БД и AI |
| GET | `/api/bootstrap` | страны, измерения, приветствия, пресеты, статистика |
| GET | `/api/countries`, `/api/countries/<code>` | профили стран |
| GET | `/api/radar?from=KZ&to=DE` | индекс культурной дистанции + топ-разрывы + чек-лист |
| POST | `/api/decode` | `{text, country, fresh?}` — культурный декодер |
| GET | `/api/quiz` | 12 кейсов (без правильных ответов) |
| POST | `/api/quiz/<id>/answer`, `/api/quiz/finish` | проверка на сервере, бейдж |
| GET/POST | `/api/match`, `/api/match/check` | тренажёр сопоставления |
| GET/POST | `/api/scenarios`, `/api/scenarios/<slug>/result` | ролевые сценарии |
| * | `/api/admin/...` | CRUD для админ-панели (сессия) |

## Структура

```
app/            Flask-приложение: models, api, admin, ai, pragma, services, seeding, templates, static
seed_data/      research_data.json — все данные исследования (страны, опрос, квиз, сценарии, лексикон движка)
seed.py         создание схемы + сидирование
wsgi.py         точка входа (gunicorn wsgi:app)
tests/          pytest
```

Данные измерений — масштабированные экспертные оценки групповых тенденций, а не характеристики каждого человека.
