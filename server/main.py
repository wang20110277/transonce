"""TransOnce backend — multi-tenant, agent-orchestrated SDLC platform.

Run:  .venv/bin/uvicorn main:app --app-dir server --port 8000 --reload
Schema: alembic upgrade head (server/migrations).
"""
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # must run before db/agents read env vars

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import agents
from config import CORS_ORIGINS, SEED_DEMO
from routers import agentchat, auth, devops, pipeline, projects, tenants

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("transonce")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if SEED_DEMO:
        try:
            import seed
            seed.seed()
        except Exception as e:  # keep the API bootable; surface the reason
            log.warning("seed skipped/failed: %s", e)
    yield


app = FastAPI(title="transonce", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(tenants.router)
app.include_router(projects.router)
app.include_router(pipeline.router)
app.include_router(devops.router)
app.include_router(agentchat.router)


@app.get("/")
def root():
    return {"app": "transonce", "ok": True, "version": "1.0.0"}


@app.get("/api/health")
def health():
    return {"ok": True, "provider": agents.get_provider()}
