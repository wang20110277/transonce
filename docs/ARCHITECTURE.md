# Transones — Architecture

> A one-stop, AI-orchestrated software-delivery platform: **会议纪要 → 需求 → 研发 → 测试 → 运维 (DevOps)**,
> with humans and agents collaborating as teammates. **Web first.**

This doc locks the design for the build-out. It is the single source of truth for
structure, data model, and sequencing. Reference projects (`meetily/`, `multica/`, `xone/`
in the repo, git-ignored & excluded from codegraph) are a source of **patterns**, not code.

---

## 1. What we are building

A platform where the whole software lifecycle is a single agent-orchestrated pipeline,
and every handoff is a human-in-the-loop collaboration point:

```
Meeting ──extract──▶ Requirement ──breakdown──▶ DevTask ──code──▶ Artifact
                                                                   │
                              Deployment ◀──deploy── TestRun ◀──test──┘
```

- **meetily** = the *Meeting* entry: capture/transcribe/summarize → structured input.
- **multica** = the *collaboration backbone*: agents as first-class teammates, squads,
  task lifecycle (`queued → assigned → running → reviewing → done | failed`),
  real-time progress streaming, autopilots.
- **xone** = the *operations end*: CI/CD pipelines, multi-tenant, gateway, project board,
  environments & deployments.

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite + React 19 + Tailwind 4 + shadcn (base-nova) + Base UI** | pipeline UI; calls backend via `/api` (Vite proxy → :8000) |
| Client state | observable store (`src/lib/store.ts`, `useSyncExternalStore`) | hydrates from `/api/state`; mutators persist to backend |
| Backend | **Python 3 + FastAPI + uvicorn** (`server/`) | REST + agent runtime; `uvicorn main:app --app-dir server --port 8000` |
| Persistence | **PostgreSQL via `psycopg2`** (shared `callbot-postgres` container, separate `transones` DB) | connection `postgresql://postgres:postgres@localhost:5432/transones` |
| Migrations | **Alembic** (`server/migrations/`) | `cd server && ../.venv/bin/alembic upgrade head` |
| AI / agents | **claude (Claude Code `--print`) / opencode (`run`)** as subprocesses | `AGENT_PROVIDER=claude`; multica model — real coding agents as teammates |
| ASR (meetings) | **Web Speech API** (Chrome, client-side) for live meeting transcription | server-side whisper.cpp/faster-whisper needs ffmpeg (absent on this Python 3.14 box) |
| IDs | Postgres `gen_random_uuid()` | |

### Running it

```bash
# backend (Python)
.venv/bin/pip install -r server/requirements.txt
cd server && ../.venv/bin/alembic upgrade head && cd ..
.venv/bin/uvicorn main:app --app-dir server --port 8000 --reload

# frontend (separate terminal)
npm run dev      # http://localhost:3000  (proxies /api → :8000)
```

The current app is a **mock UI shell** (monolithic `App.tsx`, all data inline, no backend).
We make it real incrementally, keeping `npm run lint` (`tsc --noEmit`) green at every step.

## 3. Domain model (extends `src/types.ts`)

Existing: `User, Role, Member, Agent, Tenant, Project, System, Codebase, Requirement,
Artifact, Deployment`.

**Add:**

- `Meeting` — `{ id, projectId, title, rawNotes, transcript?, participants[], source, createdAt }`
  (meetily-shaped; raw text is enough for MVP, audio/transcript later).
- `Requirement` *(extend)* — add `sourceMeetingId?`, `acceptanceCriteria[]`, `priority`.
- `DevTask` — `{ id, requirementId, title, description, assigneeKind: 'human'|'agent',
  assigneeId?, status: TaskStatus, agentRunId? }`.
- `AgentRun` — `{ id, agentId, taskType, status, input, output, events[], startedAt, endedAt }`
  — the unit of agent work; streamed over WS.
- `TestRun`, `Pipeline` — testing & DevOps records (xone-shaped).
- `Squad` — group of agents/humans under a leader (multica pattern), for routing.
- `ActivityEvent` — `{ id, projectId, actorKind, actorId, type, payload, at }` — the shared
  collaboration timeline.

## 4. Agent model (multica-inspired)

An **Agent** is a named AI worker: `{ id, name, role, model, systemPrompt, tools }`.
Roster for the pipeline:

| Agent | Role | Produces |
|---|---|---|
| 需求架构师 (Extractor) | Meeting → structured requirements | `Requirement[]` |
| 拆解师 (Breakdown) | Requirement → dev tasks | `DevTask[]` |
| 编码助手 (Coder) | DevTask → code artifact | code diff / files |
| 测试专家 (Tester) | Artifact → tests + run | `TestRun` |
| 部署专家 (Deployer) | Artifact → deployment | `Deployment` |

Execution is a **state machine** with a human review gate between phases
(collaboration). For MVP, agent "execution" = structured Gemini calls; real
code/test/deploy execution is behind pluggable adapters (mock now, real later).

## 5. Sequencing (how we get there, turn by turn)

1. **[DONE]** Research refs + audit transones; lock this design.
2. **Foundation + Meeting→Requirement slice (frontend-first):** extend types, add an
   `src/agents/` module (Gemini-backed, backend-portable), a `MeetingIngest` view, wire
   into nav. Real AI extraction + human review = first collaboration loop.
3. **Backend:** `server/` (Express + in-memory store + REST + WS hub); move agent logic
   server-side; frontend talks to API; add real-time run streaming.
4. **Requirement → DevTask → Code** slice (Coder agent + task board).
5. **Testing** slice (Tester agent + TestRun UI).
6. **DevOps** slice (Pipelines/Deployments + environments, xone patterns).
7. **Collaboration layer:** approvals, activity timeline, squads, assign-to-agent
   everywhere; harden realtime.

Frontend-first slices are intentional: fastest visible value, reusable agent/types modules,
de-risked backend migration. Each step ships build-green.

## 6. Repo layout (target)

```
src/
  agents/            # Gemini agent roster + run helpers (portable to server/)
  components/        # views (gradually extracted from App.tsx)
  lib/store.ts       # client state + event bus
  services/api.ts    # backend client (added with server)
  types.ts           # domain model
server/              # added in step 3
docs/ARCHITECTURE.md # this file
```
