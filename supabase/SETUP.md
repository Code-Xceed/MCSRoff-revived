# Supabase Runtime Setup

This project now uses the website/backend as the auth and match authority. Supabase is the Postgres runtime store behind that backend.

## Required Project Values

- `Project URL`: `https://YOUR_PROJECT_REF.supabase.co`
- `service_role` key: used only by the website/backend in `website/.env`
- `publishable` key: optional for future client integrations, not required for the current website-auth flow

Do not hardcode project-specific values into the mod source. Configure runtime values through:

- `website/.env` for the backend
- the mod config file or `MCSROFF_*` environment variables for the mod

## Dashboard Steps

1. Open Supabase `Project Settings -> API`.
2. Copy the `Project URL`.
3. Copy the legacy `service_role` key for backend use.
4. Open `SQL Editor`.
5. Run [schema.sql](schema.sql) if you need the original research schema.
6. Run [runtime-postgres-schema.sql](../website/sql/runtime-postgres-schema.sql) for the current website/backend runtime.
7. Reload PostgREST schema if needed:

```sql
NOTIFY pgrst, 'reload schema';
```

## Current Runtime Architecture

The live app uses:

- website/backend auth sessions
- backend-owned matchmaking and match lifecycle
- Supabase/Postgres tables for users, sessions, queue state, matches, events, ratings, and audit logs

The mod does not directly own matchmaking state in Supabase.

## Validation

After setting `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `website/.env`, validate with:

```powershell
npm --prefix website run validate-postgres-runtime
npm --prefix website run test-auth
npm --prefix website run test-admin
npm --prefix website run test-matchmaking
```

Then start the backend and confirm:

- `/health` reports `storage_backend=postgres`
- live two-client matchmaking writes rows into `matches`, `match_players`, `match_events`, `rating_history`, and `audit_logs`
