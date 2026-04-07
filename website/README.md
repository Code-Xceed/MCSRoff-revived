# MCSR Auth Website

This folder contains a simple local website and auth backend for the mod.

It provides:

- website account creation with unique `username`
- unique `display_name`
- password-based sign-in
- device-code linking for the Minecraft mod
- revocable access and refresh tokens for the mod
- backend-authoritative queue, match sync, countdown, activity, heartbeat, and finish reporting
- request IDs, structured request logs, and route rate limiting for operational hardening
- optional Postgres/Supabase runtime storage path for production migration

## Run

```powershell
cd website
npm start
```

The server automatically loads `website/.env` if present.

Smoke-test the full local auth flow:

```powershell
cd website
npm run test-auth
```

Smoke-test admin moderation and forced session revocation:

```powershell
cd website
npm run test-admin
```

Smoke-test the full match lifecycle with a deterministic local FSG seed:

```powershell
cd website
$env:FSG_STATIC_SEED="123456789"
$env:FSG_STATIC_FILTER="zsg"
$env:FSG_STATIC_TOKEN="test-token"
npm run test-matchmaking
```

The service starts on:

- website: `http://localhost:8080`
- mod auth API: `http://localhost:8080/mod-auth`

## Operational Hardening

The backend now adds:

- `X-Request-Id` on every response
- structured JSON request logs to stdout
- basic security headers
- in-memory rate limiting on auth pages, mod auth routes, and match API routes

Rate-limit knobs can be overridden in `website/.env`:

- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `MATCH_RATE_LIMIT_WINDOW_MS`
- `MATCH_RATE_LIMIT_MAX`
- `PAGE_RATE_LIMIT_WINDOW_MS`
- `PAGE_RATE_LIMIT_MAX`
- `ADMIN_USERNAMES`

## Mod Defaults

The mod is configured to use:

- `webAppBaseUrl = http://localhost:8080`
- `webAuthApiBaseUrl = http://localhost:8080/mod-auth`

So once this server is running, the in-game auth flow should point to the correct local website automatically.

## Routes

Website pages:

- `/`
- `/register`
- `/login`
- `/dashboard`
- `/link`
- `/admin`

Mod auth API:

- `POST /mod-auth/device/start`
- `POST /mod-auth/device/poll`
- `POST /mod-auth/refresh`
- `GET /mod-auth/me`

Match API:

- `POST /matchmaker`
  - `join_queue`
  - `poll_match`
  - `cancel_queue`
  - `mark_world_generated`
  - `mark_ready`
  - `heartbeat`
  - `report_activity`
  - `report_finish`

## Storage

Data is stored locally in JSON files under `website/data`.

This is good for local development and integration testing. Before public deployment, move these records to a real database and a properly managed backend runtime.

For the production migration path, set `STORAGE_BACKEND=postgres` and provide either:

- `DATABASE_URL`
- or `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`

Activation guide:

- [POSTGRES_ACTIVATION.md](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/POSTGRES_ACTIVATION.md)
