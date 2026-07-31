# TransOnce

SDLC platform with a Vite + React frontend and a Python + FastAPI backend.

## Structure

- `client/` — frontend (Vite + React + TypeScript + Tailwind)
- `server/` — backend (Python + FastAPI + Alembic), plus `server/asr_service/` (speech recognition)

## Run locally

### Prerequisites

- Node.js
- Python 3.12+

### Backend

    cd server
    python -m venv .venv
    .venv/bin/pip install -r requirements.txt
    cp .env.example .env        # set DATABASE_URL, AGENT_PROVIDER
    .venv/bin/uvicorn main:app --port 8000 --reload

### Frontend

    cd client
    npm install
    cp .env.example .env        # set GEMINI_API_KEY if using client-side AI
    npm run dev                 # http://localhost:3000

The Vite dev server proxies `/api` to http://localhost:8000 and `/asr` to http://localhost:8001, so start the backend first.
