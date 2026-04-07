# Postgres Activation

This is the exact cutover path from the current JSON runtime to the Supabase/Postgres runtime.

## Required Inputs

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not use the publishable key for the website backend runtime.

## 1. Configure `website/.env`

Create `website/.env` with:

```env
PORT=8080
HOST=127.0.0.1
BASE_URL=http://localhost:8080
STORAGE_BACKEND=postgres
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Optional for deterministic local matchmaking smoke:

```env
FSG_STATIC_SEED=123456789
FSG_STATIC_FILTER=zsg
FSG_STATIC_TOKEN=test-token
```

## 2. Apply Runtime Schema

Run the SQL in:

- [runtime-postgres-schema.sql](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/sql/runtime-postgres-schema.sql)

This must be applied before starting the website in `postgres` mode.

## 3. Optional: Import Current JSON Runtime

If you want to migrate existing local test data:

```powershell
cd website
npm run export-runtime-sql > runtime-export.sql
```

Apply the generated `runtime-export.sql` after the runtime schema.

## 4. Validate the Runtime

Run:

```powershell
cd website
npm run validate-postgres-runtime
```

This checks:

- required runtime tables
- `mcsroff_claim_queue_opponent`
- `mcsroff_release_queue_claim`

## 5. Start the Website Backend

```powershell
cd website
npm start
```

Expected health response:

```json
{"ok":true,"service":"mcsroff-auth-site","storage_backend":"postgres"}
```

## 6. Validate End-to-End Flows

Auth smoke:

```powershell
cd website
npm run test-auth
```

Matchmaking smoke:

```powershell
cd website
$env:FSG_STATIC_SEED="123456789"
$env:FSG_STATIC_FILTER="zsg"
$env:FSG_STATIC_TOKEN="test-token"
npm run test-matchmaking
```

## Cutover Definition Of Done

- `npm run validate-postgres-runtime` passes
- `/health` reports `storage_backend=postgres`
- `npm run test-auth` passes
- `npm run test-matchmaking` passes
- new match completion writes:
  - `matches`
  - `match_players`
  - `match_events`
  - `rating_history`
  - `audit_logs`
