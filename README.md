# InterviewAI

Full-stack mock interview practice app: **React (Vite)** frontend, **Express** API, **MongoDB**, deterministic **mock LLM** responses (no external AI). Local development runs in **Docker**.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2

## Run everything (recommended)

From the repository root:

```bash
npm start
```

This runs `docker compose --env-file .env.local -f docker-compose.yml up --build -d` (stack in the background). Use **`npm run start:attach`** if you want logs attached in that terminal, **`npm run logs`** to follow logs, and **`npm stop`** to tear the stack down.

You can also run **`./scripts/start.sh`** (same as `npm start`) and **`./scripts/stop.sh`** to stop the local stack.

Then open **http://localhost:5173** in your browser.

- **API:** http://localhost:3001 (used by the SPA; configure `VITE_API_URL` in Compose if needed)
- **MongoDB:** internal to Compose by default (no host port). To debug from the host, temporarily add `ports: ["27017:27017"]` under `mongo` in [docker-compose.yml](docker-compose.yml) if nothing else is using `27017`.

## Test user (seeded demo account)

Use this account on **Sign in** after `npm start`. The backend creates it when `SEED_ON_START=true` **and** `APP_ENV` is `local` or `development` (the Compose file sets both for the default stack). Production should use `APP_ENV=production`; demo seed is **not** run there, even if `SEED_ON_START` were set. This account comes with **three completed mock interviews** so you can try the dashboard, history, and full reports (including one video-style session with eye contact / body language scores).

| Detail | Value |
|--------|--------|
| **Email** | `demo@interview-ai.local` |
| **Password** | `demo123456` |
| **Display name** | `Demo User` (e.g. “Welcome back, Demo” on the dashboard) |

To seed a different demo user, edit [`.env.local`](.env.local) (or override the same variable names in your shell).

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEMO_USER_EMAIL` | `demo@interview-ai.local` | Login email for the seeded user |
| `DEMO_USER_PASSWORD` | `demo123456` | Login password |
| `DEMO_USER_NAME` | `Demo User` | Full name shown in the UI |

### Register your own user

Use **Register** on the landing page. New accounts start with an empty history until you complete interviews.

## Project layout

| Path | Role |
|------|------|
| [frontend/](frontend/) | Vite + React UI |
| [backend/](backend/) | Express REST API, JWT auth, Mongoose, mock LLM |
| [docker-compose.yml](docker-compose.yml) | **Local:** Mongo + backend + Vite (HMR bind mount) |
| [docker-compose.prod.yml](docker-compose.prod.yml) | **Production:** backend + nginx static frontend; external MongoDB |
| [backend/src/config.js](backend/src/config.js) | Backend env (single module) |
| [`.env.local`](.env.local) | Local Docker env (JWT, demo user overrides) |
| [`.env.production`](.env.production) | Production Docker env (MongoDB URI, CORS, `VITE_API_URL`, ports) |
| [frontend/.env.development](frontend/.env.development) | Vite dev (`VITE_API_URL` when running the SPA on the host) |
| [frontend/.env.production](frontend/.env.production) | Vite production build (`npm run build`) |

## Monorepo scripts (host, optional)

If you have Node 20+ and run installs locally (not required for Docker-first dev):

```bash
npm install
npm run dev -w frontend   # Vite uses frontend/.env.development
```

Backend locally: `npm run dev -w backend` with `MONGODB_URI` pointing at Mongo.

## Environments (local vs production)

Behavior is **config-driven**: the backend loads environment variables once via [backend/src/config.js](backend/src/config.js). Defaults suit local development; production expects you to set real secrets and `APP_ENV=production` (handled in [docker-compose.prod.yml](docker-compose.prod.yml)).

| | Local | Production |
|---|--------|------------|
| **Compose file** | [docker-compose.yml](docker-compose.yml) | [docker-compose.prod.yml](docker-compose.prod.yml) |
| **Env file** | [`.env.local`](.env.local) | [`.env.production`](.env.production) |
| **MongoDB** | Container in Compose | You supply `MONGODB_URI` (e.g. Atlas) |
| **`APP_ENV`** | `local` (in Compose) | `production` (in prod Compose) |
| **Demo seed** | On when `SEED_ON_START=true` and `APP_ENV` is local/development | Off (`SEED_ON_START=false` in prod compose; API also blocks demo seed unless local-like) |
| **Frontend** | Vite dev server on port 5173 | Static assets via nginx ([frontend/Dockerfile](frontend/Dockerfile)), port **8080** → container 80 by default |

**Production stack**

1. Edit [`.env.production`](.env.production) with your real `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_ORIGIN`, and optionally `VITE_API_URL`, `FRONTEND_HTTP_PORT`, `BACKEND_PORT`.
2. Start: **`npm run start:prod`** or **`./scripts/start-prod.sh`**. Stop: **`npm run stop:prod`** or **`./scripts/stop-prod.sh`**.

The production Compose file passes variables into the build/run; there is no bundled MongoDB service.

## Production-style frontend image (manual build)

If you are not using [docker-compose.prod.yml](docker-compose.prod.yml), you can build the static SPA and nginx image directly (bake `VITE_API_URL` for where the browser will call the API):

```bash
docker build -f frontend/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t interview-ai-web .
```

## Environment variables

Committed env files: [`.env.local`](.env.local) (local Docker), [`.env.production`](.env.production) (production Docker), [frontend/.env.development](frontend/.env.development) and [frontend/.env.production](frontend/.env.production) (Vite on the host).

| Variable | Local (default Compose) | Production |
|----------|-------------------------|------------|
| `APP_ENV` | `local` in [docker-compose.yml](docker-compose.yml) | `production` in [docker-compose.prod.yml](docker-compose.prod.yml) |
| `SEED_ON_START` | `true` with demo user + interviews | `false`; seeding requires `APP_ENV` local/development anyway |
| `MONGODB_URI` | Set in local Compose to `mongo` service | Required in `.env.production` |
| `JWT_SECRET` | Dev default allowed | Must be a strong secret; dev placeholders are rejected at startup |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Your real SPA origin(s), comma-separated |
| `VITE_API_URL` | `http://localhost:3001` in local Compose | Set when the browser must call a different API host than the SPA |

Non-Docker backend: set `APP_ENV=local` and point `MONGODB_URI` at your DB; use `npm run seed -w backend` only for local-like `APP_ENV`.
