# Frontend/Backend Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the frontend (Vite + React + TS) from the repository root into a `client/` directory so it is cleanly separated from the Python/FastAPI backend in `server/`, with no change to source logic or backend behavior.

**Architecture:** A pure file-move restructure. All frontend files (`src/`, `components/`, `hooks/`, `lib/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, `components.json`) are relocated into `client/`. Because the frontend configs use relative paths and the `@/` alias resolves relative to the config file, no path edits are needed. The only edits are: pruning four unused backend npm deps, splitting the root `.env` into per-app files, and updating the README. The backend (`server/`) is untouched.

**Tech Stack:** Vite 6, React 19, TypeScript 5.8, Tailwind 4, shadcn (frontend); Python + FastAPI + uvicorn + Alembic (backend).

**Reference spec:** `docs/superpowers/specs/2026-06-15-frontend-backend-separation-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `client/src/` | React application | Move from `/src/` |
| `client/components/` | shadcn UI components | Move from `/components/` |
| `client/hooks/`, `client/lib/` | Frontend hooks/utils | Move from `/hooks/`, `/lib/` |
| `client/index.html` | Vite entry HTML | Move from `/index.html` |
| `client/vite.config.ts` | Vite config (alias, proxy) | Move; **no edits** (relative paths) |
| `client/tsconfig.json` | TS config (`@/*` alias) | Move; **no edits** |
| `client/package.json` | Frontend deps + scripts | Move, then prune 4 deps |
| `client/package-lock.json` | Lockfile | Move, then regenerate via `npm uninstall` |
| `client/components.json` | shadcn config | Move; **no edits** |
| `client/.env`, `client/.env.example` | Frontend env (`GEMINI_API_KEY`) | Create new |
| `server/.env`, `server/.env.example` | Backend env (existing vars) | Create new (from root `.env`) |
| `/README.md` | Run instructions for both apps | Rewrite |
| `server/` | Backend code | **Unchanged** |

---

### Task 1: Create a safety checkpoint branch

The working tree currently contains uncommitted work (modified files, new `server/`, new `src/agents/`, etc.). Before restructuring, create a rollback point so the move can be undone cleanly.

**Files:** none (git only)

- [ ] **Step 1: Create a safety branch and commit the current state**

```bash
git checkout -b chore/frontend-backend-separation
git add -A
git commit -m "chore: checkpoint before frontend/backend separation"
```

Expected: a new commit capturing all current work on branch `chore/frontend-backend-separation`. If `git commit` reports "nothing to commit," the tree was already clean — that is fine, proceed.

- [ ] **Step 2: Confirm the tree is clean**

Run: `git status --short`
Expected: empty output (clean working tree).

---

### Task 2: Move frontend files into `client/`

Relocate every frontend file/directory from the repository root into a new `client/` directory. Using plain `mv` (rather than `git mv`) so that the untracked files mixed inside `src/` (e.g. `src/agents/`, `src/lib/`) move along with the tracked ones; `git add -A` then stages the result and git's rename detection preserves history for tracked files.

**Files:**
- Move: `/src/` → `client/src/`
- Move: `/components/` → `client/components/`
- Move: `/hooks/` → `client/hooks/`
- Move: `/lib/` → `client/lib/`
- Move: `/index.html` → `client/index.html`
- Move: `/vite.config.ts` → `client/vite.config.ts`
- Move: `/tsconfig.json` → `client/tsconfig.json`
- Move: `/package.json` → `client/package.json`
- Move: `/package-lock.json` → `client/package-lock.json`
- Move: `/components.json` → `client/components.json`

- [ ] **Step 1: Create the client directory**

Run: `mkdir client`
Expected: `client/` exists.

- [ ] **Step 2: Move all frontend files into `client/`**

```bash
mv src components hooks lib index.html vite.config.ts tsconfig.json package.json package-lock.json components.json client/
```

Expected: the ten listed entries no longer exist at the repo root; all now appear under `client/`.

- [ ] **Step 3: Stage the move**

Run: `git add -A`

- [ ] **Step 4: Confirm git detected renames (history preserved)**

Run: `git status --short | head -40`
Expected: lines like `R  src/App.tsx -> client/src/App.tsx` (rename entries `R`), plus `A` entries for the previously-untracked files (e.g. `client/src/agents/index.ts`). Tracked files should show as `R` (renamed), confirming history is preserved.

- [ ] **Step 5: Commit the move**

```bash
git commit -m "refactor: move frontend into client/"
```

Expected: commit created with all moves staged.

---

### Task 3: Prune unused backend dependencies from the frontend

Remove the four npm packages that no `src` file imports: `express`, `pg`, `@types/pg`, `@types/express`. Using `npm uninstall` so both `package.json` and `package-lock.json` are updated correctly. Keep `@google/genai` (used by `src/services/gemini.ts`).

**Files:**
- Modify: `client/package.json` (remove 4 deps)
- Modify: `client/package-lock.json` (regenerated)

- [ ] **Step 1: Install dependencies in the new location**

Run:
```bash
cd client
npm install
```
Expected: `client/node_modules/` is created; install completes. (Run in background if slow.)

- [ ] **Step 2: Uninstall the four unused backend packages**

Run (still inside `client/`):
```bash
npm uninstall express pg @types/pg @types/express
```
Expected: npm removes the four packages and updates both `package.json` and `package-lock.json`.

- [ ] **Step 3: Verify the packages are gone from package.json**

Run: `grep -E '"(express|pg)"' client/package.json`
Expected: empty output (no matches for `express` or `pg`).

- [ ] **Step 4: Verify `@google/genai` is still present**

Run: `grep '"@google/genai"' client/package.json`
Expected: a match (the dependency is retained).

- [ ] **Step 5: Commit**

```bash
cd ..
git add client/package.json client/package-lock.json
git commit -m "chore(client): remove unused backend deps (express, pg)"
```

Expected: commit created.

---

### Task 4: Verify the frontend still type-checks after the move

The migration must not introduce TypeScript errors. This is the regression gate for Tasks 2–3.

**Files:** none (verification only)

- [ ] **Step 1: Run the TypeScript checker from `client/`**

Run:
```bash
cd client
npm run lint
```
(`npm run lint` is `tsc --noEmit` per `package.json`.)
Expected: exits 0 with no error output. If errors appear, they indicate a path/alias problem — double-check that `client/vite.config.ts` and `client/tsconfig.json` were moved intact (they require no edits).

```bash
cd ..
```

---

### Task 5: Split environment files per app

The root `.env` (gitignored, actual secrets) contains only backend variables: `DATABASE_URL`, `AGENT_PROVIDER`, `AGENT_TIMEOUT_MS`, `PORT`. Move it to `server/.env`. Give the frontend its own `client/.env` with `GEMINI_API_KEY`. Replace the root `.env.example` with per-app examples.

**Files:**
- Create: `server/.env` (move from root `.env`)
- Create: `server/.env.example`
- Create: `client/.env`
- Create: `client/.env.example`
- Delete: `/.env.example` (root)

- [ ] **Step 1: Move the actual root `.env` into `server/`**

Run: `mv .env server/.env`
Expected: root `.env` is gone; `server/.env` now holds `DATABASE_URL`, `AGENT_PROVIDER`, `AGENT_TIMEOUT_MS`, `PORT`.

- [ ] **Step 2: Create `server/.env.example`**

Write `server/.env.example` with this content:

```env
# Backend (Python/FastAPI) — copy to .env and adjust.
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/transonce
# Agent runtime provider: claude (Claude Code --print) or opencode (opencode run)
AGENT_PROVIDER=claude
AGENT_TIMEOUT_MS=180000
PORT=8000
```

- [ ] **Step 3: Create `client/.env`**

Write `client/.env` with this content (client-side Gemini is optional; leave commented unless needed):

```env
# Frontend (Vite) — client-side Gemini, used by src/services/gemini.ts.
# Uncomment and set if you use client-side AI features.
# GEMINI_API_KEY=
```

- [ ] **Step 4: Create `client/.env.example`**

Write `client/.env.example` with this content:

```env
# Frontend (Vite) — copy to .env and set if you use client-side AI features.
# GEMINI_API_KEY=
```

- [ ] **Step 5: Remove the now-redundant root `.env.example`**

Run: `git rm .env.example`
Expected: root `.env.example` is staged for deletion.

- [ ] **Step 6: Stage and commit the example files**

```bash
git add server/.env.example client/.env.example
git commit -m "chore: split env files per app (server/.env, client/.env)"
```
Note: only the `.env.example` files and the `git rm` of the root `.env.example` (from Step 5) are committed. The actual `server/.env` and `client/.env` are gitignored (the `.env*` pattern) and are deliberately left out — they hold local secrets. Do NOT `git add` them (git would reject the ignored `client/.env` with a non-zero exit). Expected: commit created.

---

### Task 6: Update README and clean up orphaned root artifacts

Rewrite the root README to document the two-app setup, and remove the now-orphaned `node_modules/` and `dist/` at the repo root (they belong to the old root frontend and would otherwise be stale duplicates of what `client/` now manages).

**Files:**
- Modify: `/README.md`
- Delete: `/node_modules/` (regenerable)
- Delete: `/dist/` (regenerable)

- [ ] **Step 1: Rewrite `README.md`**

Replace the entire contents of `README.md` with:

```markdown
# TransOne

SDLC platform with a Vite + React frontend and a Python + FastAPI backend.

## Structure

- `client/` — frontend (Vite + React + TypeScript + Tailwind)
- `server/` — backend (Python + FastAPI + Alembic), plus `server/asr_service/` (speech recognition)

## Run locally

### Prerequisites

- Node.js
- Python 3.12+

### Backend

```bash
cd server
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # set DATABASE_URL, AGENT_PROVIDER
.venv/bin/uvicorn main:app --port 8000 --reload
```

### Frontend

```bash
cd client
npm install
cp .env.example .env        # set GEMINI_API_KEY if using client-side AI
npm run dev                 # http://localhost:3000
```

The Vite dev server proxies `/api` → `http://localhost:8000` and `/asr` → `http://localhost:8001`, so start the backend first.
```

- [ ] **Step 2: Remove orphaned root build artifacts**

Run:
```bash
rm -rf node_modules dist
```
Expected: `/node_modules/` and `/dist/` no longer exist at the repo root. These are gitignored, so this is a local cleanup only (no git change).

- [ ] **Step 3: Confirm `.gitignore` needs no changes**

Run: `cat .gitignore`
Confirm it contains (without leading slashes, so they match at any depth): `node_modules/`, `dist/`, `.env*` with `!.env.example`, and the reference-repo exclusions (`meetily/`, `multica/`, `xone/`). These already cover `client/node_modules/`, `client/dist/`, `client/.env`, `server/.env`, etc. No edit required.

- [ ] **Step 4: Commit the README change**

```bash
git add README.md
git commit -m "docs: update README for client/ + server/ layout"
```
Expected: commit created.

---

### Task 7: End-to-end verification

Confirm both apps build and run from their new locations.

**Files:** none (verification only)

- [ ] **Step 1: Frontend production build**

Run:
```bash
cd client
npm run build
cd ..
```
Expected: `vite build` succeeds and emits `client/dist/`. No errors.

- [ ] **Step 2: Confirm backend still imports cleanly**

Run:
```bash
cd server
.venv/bin/python -c "import main; print('backend imports OK')"
cd ..
```
Expected: prints `backend imports OK`. (If the venv is not set up, this can be skipped — the backend was not modified; the goal here is only to confirm nothing in `server/` was disturbed.)

- [ ] **Step 3: (Manual) Smoke-test the dev servers**

Start the backend in one terminal:
```bash
cd server && .venv/bin/uvicorn main:app --port 8000 --reload
```
Start the frontend in another:
```bash
cd client && npm run dev
```
Open `http://localhost:3000`. Confirm the app loads and that a `/api/...` request in the browser network tab is proxied to the backend (HTTP 200, not a proxy error).

- [ ] **Step 4: Final review of the diff**

Run: `git log --oneline chore/frontend-backend-separation ^main`
Expected: a short list of the restructure commits. Review `git diff main...HEAD --stat` to confirm: only frontend files moved into `client/`, `server/` code unchanged, four deps removed, env split, README updated.

---

## Rollback

If anything goes wrong, the restructure is fully reversible from the Task 1 checkpoint:

```bash
git checkout main
git branch -D chore/frontend-backend-separation   # discards the restructure commits
```

Or to keep the branch but discard uncommitted moves: `git reset --hard chore/frontend-backend-separation` (back to the Task 1 checkpoint).
