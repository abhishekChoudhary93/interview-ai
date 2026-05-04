# InterviewAI

A practice tool for software interviews. **One streaming LLM** plays a senior interviewer over **chat, audio, or audio + video** while a smaller model evaluates your answers in the background. Stack: **React (Vite)** SPA, **Express** API, **MongoDB**, **OpenRouter** for LLM calls. Local development runs in **Docker**.

> **No mock LLM in the new orchestrator path.** Set `OPENROUTER_API_KEY` and you get the real interviewer experience. The mock LLM is still used by older non-orchestrated code paths for offline development.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
- An [OpenRouter](https://openrouter.ai) API key (any account works)

## Run everything (recommended)

From the repository root:

```bash
npm start
```

This runs `docker compose --env-file .env.local -f docker-compose.yml up --build -d`. Use **`npm run start:attach`** for attached logs, **`npm run logs`** to follow logs, and **`npm stop`** to tear the stack down.

Then open **http://localhost:5173**.

- **API:** http://localhost:3001
- **MongoDB:** `mongodb://127.0.0.1:27017/interview_ai` is exposed for tools like Compass / `mongosh`.

## Test user (seeded demo account)

Use this account on **Sign in** after `npm start`. Auto-seeded when `SEED_ON_START=true` and `APP_ENV` is local/development. The account ships with three legacy-shape interviews **and** one new-shape orchestrated system-design session so you can compare the old and new report views.

| Detail | Value |
|--------|--------|
| **Email** | `demo@interview-ai.local` |
| **Password** | `demo123456` |
| **Display name** | `Demo User` |

To customize, edit [`.env.local`](.env.local) (`DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`, `DEMO_USER_NAME`).

## How an interview runs

1. **Setup** picks a template from [`backend/src/interview-templates/`](backend/src/interview-templates/) using the candidate's role/level/industry plus their recent template history (so you don't get the same problem twice in a row).
2. **`/session/start`** loads the template, snapshots it onto the interview row, and asks the **opening LLM** for the first line.
3. Each candidate turn calls **`/session/turn`** which **server-side streams** the interviewer's reply via Server-Sent Events. The frontend renders tokens as they arrive (token-by-token bubble; sentence-buffered TTS in voice modes).
4. After every turn, an **eval LLM** (smaller, JSON-mode) silently grades the exchange against the template rubric and updates `session_state.signals` + `live_evaluation`. The candidate doesn't see this happen.
5. When the LLM signals `interview_done` (or you press **End & report**), **`/session/complete`** runs the **debrief LLM** to produce the structured FAANG-style report you see at `/report?id=...`.

### Three interaction modes

| Mode | What changes |
|------|--------------|
| **Chat** | Plain text in/out. Same LLM, no audio peripherals. |
| **Audio** | Streaming TTS speaks the interviewer; Web Speech API captures your reply with an editable interim transcript. Always falls back to the keyboard. |
| **Video + Audio** | Adds a camera tile (your webcam) and an interviewer presence panel that pulses while the LLM is speaking. STT and TTS work the same as audio. |

The **interview LLM is identical across modes** — only the I/O changes.

### Model tiers (OpenRouter)

The backend uses different models for different jobs to balance quality and cost. All overrideable via env. Defaults:

| Tier | Default model | Used for |
|------|---------------|----------|
| `OPENROUTER_CONVERSATIONAL_MODEL` | `openai/gpt-4o` | The streaming interviewer voice (the one the candidate hears) |
| `OPENROUTER_OPENING_MODEL` | `openai/gpt-4o-mini` | One-shot opening line at session start |
| `OPENROUTER_EVAL_MODEL` | `openai/gpt-4o-mini` | Per-turn JSON grading against the rubric |
| `OPENROUTER_DEBRIEF_MODEL` | `openai/gpt-4o` | Final structured report |
| `OPENROUTER_EXTRACTION_MODEL` | (falls back to `OPENROUTER_MODEL`) | Cross-session history signals |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Fallback for any tier without an explicit override |

> Want a slightly more natural interviewer voice? Override `OPENROUTER_CONVERSATIONAL_MODEL=anthropic/claude-3.5-sonnet`. Requires Anthropic-model access on your OpenRouter account (usually means loaded credits).

### Estimated cost per interview (OpenRouter, USD, Apr 2026 list prices)

A typical 30-minute orchestrated session spends roughly:

| Tier | Calls | Tokens (est.) | Approx. cost |
|------|-------|---------------|--------------|
| Conversational (gpt-4o) | 1 streamed reply per turn × ~15 turns | 12k in + 6k out | **$0.090** |
| Eval (gpt-4o-mini) | 15 background JSON calls | 15k in + 3k out | **$0.005** |
| Opening (gpt-4o-mini) | 1 | 1k in + 0.2k out | <$0.001 |
| Debrief (gpt-4o) | 1 final report | 8k in + 2k out | **$0.045** |
| **Total per interview** | | | **~$0.14** |

Lower the bill by setting `OPENROUTER_CONVERSATIONAL_MODEL=openai/gpt-4o-mini` (drops to ~$0.03/interview at the cost of slightly less natural pacing). Raise the ceiling by switching to `anthropic/claude-3.5-sonnet` for the most human-feeling interviewer (~$0.18/interview, requires Anthropic access on OpenRouter). Numbers are rough and assume English-only sessions.

## Adding interview questions

The question bank is **just JSON files in [`backend/src/interview-templates/`](backend/src/interview-templates/)**. No code changes, no registry edits. Full docs in [that folder's README](backend/src/interview-templates/README.md). Quick path:

```bash
npm run new:template -- --type system_design --name "Design a Notification System"
# fills in the schema; edit the TODO_* fields and save
npm run validate:templates
# the backend also auto-validates on startup
```

## Project layout

| Path | Role |
|------|------|
| [frontend/](frontend/) | Vite + React UI (chat / audio / video) |
| [backend/](backend/) | Express REST API, JWT auth, Mongoose, OpenRouter client |
| [backend/src/services/interviewSystemPrompt.js](backend/src/services/interviewSystemPrompt.js) | The system prompt the conversational LLM runs under |
| [backend/src/services/interviewConverse.js](backend/src/services/interviewConverse.js) | Streaming interviewer reply |
| [backend/src/services/interviewEvalCapture.js](backend/src/services/interviewEvalCapture.js) | Background per-turn JSON eval |
| [backend/src/services/interviewSessionService.js](backend/src/services/interviewSessionService.js) | Session lifecycle (start/turn/end) |
| [backend/src/services/interviewConfig.js](backend/src/services/interviewConfig.js) | Single-problem v5 config loader |
| [backend/src/interview-config/url_shortener.json](backend/src/interview-config/url_shortener.json) | The v5 interview problem definition (single source of truth — sections, signals, leveling, scope, scale_facts, fault_scenarios, raise_stakes_prompts, **required_breadth_components**, **variant_scenarios**, deep_dive_topics) |
| [BRAIN.md](BRAIN.md) | Canonical map of the v5 interview engine — read before changing prompts, substrate state, or the debrief pipeline |
| [BACKLOG.md](BACKLOG.md) | Deferred discipline work (LLM-paste detection, planner-side scope-question priority, multi-problem) |
| [docker-compose.yml](docker-compose.yml) | **Local:** Mongo + backend + Vite (HMR bind mount) |
| [docker-compose.prod.yml](docker-compose.prod.yml) | **Production:** backend + nginx static frontend; external MongoDB |
| [`.env.local`](.env.local) / [`.env.production`](.env.production) | Per-environment env files |

## Monorepo scripts (host, optional)

If you have Node 20+ and want to run installs locally:

```bash
npm install
npm run dev -w frontend         # uses frontend/.env.development
npm run dev -w backend          # needs MONGODB_URI + OPENROUTER_API_KEY
npm run validate:templates      # CI-style template validation
npm run new:template -- --type system_design --name "Foo"
npm test -w backend             # backend unit tests
```

## Environments (local vs production)

Behavior is **config-driven** — see [backend/src/config.js](backend/src/config.js). Defaults are local-friendly; production expects you to set real secrets and `APP_ENV=production` (handled by [docker-compose.prod.yml](docker-compose.prod.yml)).

| | Local | Production |
|---|--------|------------|
| **Compose file** | [docker-compose.yml](docker-compose.yml) | [docker-compose.prod.yml](docker-compose.prod.yml) |
| **Env file** | [`.env.local`](.env.local) | [`.env.production`](.env.production) |
| **MongoDB** | Container in Compose | You supply `MONGODB_URI` (e.g. Atlas) |
| **`APP_ENV`** | `local` | `production` |
| **Demo seed** | On when `SEED_ON_START=true` | Off; API also blocks demo seed unless local-like |
| **Frontend** | Vite dev server, port 5173 | nginx static, port 8080 → container 80 |

**Production stack:**

1. Edit [`.env.production`](.env.production): `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_ORIGIN`, `OPENROUTER_API_KEY`, optionally `VITE_API_URL`, `FRONTEND_HTTP_PORT`, `BACKEND_PORT`.
2. Start: `npm run start:prod` (or `./scripts/start-prod.sh`). Stop: `npm run stop:prod`.

## Regional pricing & markets

The landing **Pricing** section loads `GET /api/public/market-context`. The backend picks a market (`US`, `EU`, `IN`, `ROW`) from the caller's country signal and returns Free + Pro plans. Catalog: [backend/src/config/markets.js](backend/src/config/markets.js).

**Production geo:** prefer an edge that sets a country header — `CF-IPCountry` (Cloudflare), `X-Vercel-IP-Country`, or a custom `X-App-Geo-Country`. Fallback is `DEFAULT_MARKET_ID` (default `ROW`).

**Behind a reverse proxy:** set `TRUST_PROXY` so Express trusts `X-Forwarded-*`.

**Local dev only** (`APP_ENV` is `local`/`development`):

- Header `X-Debug-Country: IN` or query `?debugCountry=FR` to override.

```bash
curl -s -H "X-Debug-Country: IN" http://localhost:3001/api/public/market-context | jq
```

## Environment variables

| Variable | Local default | Production |
|----------|--------------|------------|
| `APP_ENV` | `local` | `production` |
| `SEED_ON_START` | `true` | `false` |
| `MONGODB_URI` | Mongo container | **Required** (Atlas / managed) |
| `JWT_SECRET` | Dev placeholder allowed | **Required**, ≥ 24 chars, no dev placeholders |
| `JWT_REFRESH_SECRET` | Derived from `JWT_SECRET` | **Required**, ≥ 24 chars, ≠ `JWT_SECRET` |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Your real SPA origin(s), comma-separated |
| `VITE_API_URL` | `http://localhost:3001` | Your API host (baked into the SPA build) |
| `OPENROUTER_API_KEY` | Optional (mock LLM fallback for legacy paths) | **Required** for the orchestrated flow |
| `OPENROUTER_CONVERSATIONAL_MODEL` | `anthropic/claude-3.5-sonnet` | Override per cost / quality target |
| `OPENROUTER_EVAL_MODEL` | `openai/gpt-4o-mini` | — |
| `OPENROUTER_DEBRIEF_MODEL` | `openai/gpt-4o` | — |
| `OPENROUTER_OPENING_MODEL` | `openai/gpt-4o-mini` | — |
| `TRUST_PROXY` | unset | `true`, `1`, or hop count |
| `DEFAULT_MARKET_ID` | `ROW` | `US` / `EU` / `IN` / `ROW` |
