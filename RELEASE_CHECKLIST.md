# MCSR Offline Production Release Checklist

This checklist is for the current stable build only. It is intentionally limited to the existing feature set.

## Backend

- `website/.env` points to the intended production backend values.
- `STORAGE_BACKEND=postgres`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present and valid.
- `ADMIN_USERNAMES` is set for intended operator accounts.
- `npm --prefix website run test-auth` passes.
- `npm --prefix website run test-admin` passes.
- `npm --prefix website run test-matchmaking` passes.
- `npm start` boots cleanly and `/health` reports `storage_backend=postgres`.

## Database

- Latest runtime schema from [runtime-postgres-schema.sql](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/sql/runtime-postgres-schema.sql) has been applied.
- `npm --prefix website run validate-postgres-runtime` passes.
- Match rows, match player rows, rating history, and audit logs are being written during smoke tests.
- A backup/export plan for Supabase runtime data is in place before release.

## Mod Build

- `.\gradlew.bat :common:compileJava :fabric:compileJava --no-daemon` passes.
- `.\gradlew.bat :fabric:build --no-daemon` passes.
- Release jar is [mcsroff-fabric-1.0.0-1.16.1.jar](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/fabric/build/libs/mcsroff-fabric-1.0.0-1.16.1.jar).
- Website/backend has been restarted after the latest backend commit.

## Live Match Flow

- Two separate clients authenticate with different accounts.
- Queue and match found state appear on both clients.
- Both clients receive the same match id and shared seed.
- World generation status propagates correctly between clients.
- Countdown starts from one shared backend target.
- Both players are released together.
- Opponent status and advancement chat updates appear during the run.
- Finish resolves correctly and Elo updates are written.
- Pre-start cancel/abort is reflected on both clients.
- Late pre-race updates do not regress a running match.
- Late post-finish activity does not mutate the finished match.

## Release Signoff

- Backend logs are clean during a real 2-client run.
- No auth/session loop occurs during repeated queue and requeue.
- No stale prior opponent or stale claimed queue entry can be reproduced.
- The final tested backend commit and the released Fabric jar are from the same revision.
