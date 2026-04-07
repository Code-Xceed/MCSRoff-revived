# MCSR Production Execution Roadmap

## Goal

Turn the current MVP into a production-ready platform for:

- trusted player identity
- durable matchmaking
- synchronized 1v1 races
- persistent match history
- server-owned ratings
- operational stability

This roadmap is specific to the current repository and code layout.

## Current Reality

### Working today

- trusted website-linked mod auth exists
- Fabric/Forge mod flow works
- match UI and countdown flow work
- FSG integration works
- local backend-backed queue and match flow work
- live opponent status and mirrored advancement chat work

### Not production-ready yet

- website storage is still JSON-file backed
- auth is still a custom local stack
- mod auth is device-code-first
- match state is single-process local backend state
- no real database-backed repositories
- no true push transport
- no server-owned finish/result pipeline
- no production operations layer

## Final Target

### Identity

- website account is canonical identity
- mod uses browser-based native-app login with PKCE
- device-code auth remains fallback only
- all matchmaking and rating use website `user_id`

### Backend

- API service owns all game state transitions
- Postgres stores durable data
- websocket/broadcast layer pushes live updates
- polling remains fallback

### Match system

- server creates match
- server assigns seed
- server owns countdown target
- server resolves finish and rating updates
- server handles disconnects and aborts

## Repo-Level Architecture Changes

## Website

### Current

- [server.js](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/server.js)
- [website/data](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/data)

### Target

Split the website/backend into clear layers:

- `website/src/http`
- `website/src/auth`
- `website/src/matchmaking`
- `website/src/repositories`
- `website/src/services`
- `website/src/realtime`
- `website/src/jobs`

### Replace

- JSON file persistence with repository interfaces backed by Postgres
- one large server file with modules for auth, queue, match lifecycle, ratings, and moderation

## Mod

### Current key areas

- [WebAuthApi.java](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/common/src/main/java/com/codex/mcsroff/net/WebAuthApi.java)
- [BackendApi.java](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/common/src/main/java/com/codex/mcsroff/net/BackendApi.java)
- [AccountManager.java](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/common/src/main/java/com/codex/mcsroff/auth/AccountManager.java)
- [MatchmakingScreen.java](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/common/src/main/java/com/codex/mcsroff/ui/MatchmakingScreen.java)
- [PreRaceController.java](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/common/src/main/java/com/codex/mcsroff/race/PreRaceController.java)
- [TelemetryManager.java](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/common/src/main/java/com/codex/mcsroff/telemetry/TelemetryManager.java)

### Target additions

- auth transport for PKCE browser login
- session manager with refresh rotation handling
- realtime match client
- heartbeat service
- finish/result reporting service
- reconnect-aware match resume handler

## Database

### Current

- [supabase/schema.sql](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/supabase/schema.sql) exists but is not the active runtime backing

### Target

Use Postgres as the live source of truth for:

- users
- profiles
- mod sessions
- queue entries
- matches
- match players
- match events
- rating history
- bans
- audit logs

## Execution Phases

## Phase 1: Backend Decomposition

### Goal

Refactor the current website backend before changing infrastructure.

### Work

1. Split [server.js](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/server.js) into modules.
2. Introduce repository interfaces even if the first implementation still wraps JSON temporarily.
3. Separate these service boundaries:
   - auth service
   - queue service
   - match service
   - telemetry service
   - rating service
4. Define shared DTOs for API responses.

### Definition of done

- no business logic concentrated in one file
- all match lifecycle transitions live in one service
- tests run against service/repository boundaries

## Phase 2: Database Migration

### Goal

Move all durable state from JSON into Postgres.

### Work

1. Create migration files for:
   - users
   - profiles
   - mod_sessions
   - queue_entries
   - matches
   - match_players
   - match_events
   - rating_history
   - bans
   - audit_logs
2. Implement Postgres repository adapters.
3. Remove all writes to [website/data](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/data) for runtime state.
4. Keep a one-time import script for existing local JSON data if needed.
5. Add transactional match creation and queue claiming.

### Key rule

Queue matching must happen inside a transaction with row locking.

### Definition of done

- JSON files are no longer used for runtime state
- match creation is transactional
- state survives backend restarts without local file assumptions

## Phase 3: Auth Hardening

### Goal

Replace the current custom-first auth approach with a production-grade model.

### Work

1. Keep the website as the identity authority.
2. Move to managed auth backing or a hardened auth service.
3. Add:
   - email verification
   - password reset
   - refresh rotation
   - revoke-all-sessions capability
   - ban checks on every protected path
4. Add browser-based native-app login with PKCE for the mod.
5. Keep device code flow as fallback only.

### Mod changes

- replace device-link-first UI with:
  - `Sign in in browser`
  - fallback `Use device code`

### Definition of done

- mod login is browser-based by default
- every queue attempt first validates a live session
- session revocation immediately blocks matchmaking access

## Phase 4: Authoritative Match Lifecycle

### Goal

Move every critical match transition to backend authority.

### Work

1. Add explicit server-owned state machine:
   - `searching`
   - `matched`
   - `seed_assigned`
   - `world_generating`
   - `world_generated`
   - `ready`
   - `countdown`
   - `running`
   - `finished`
   - `aborted`
2. Add explicit per-player state:
   - `connected`
   - `world_generated`
   - `ready`
   - `finished`
   - `forfeit`
   - `disconnected`
3. Move seed assignment fully server-side.
4. Add `finish_match` endpoint.
5. Add result finalization service.

### Definition of done

- no client decides countdown start
- no client can revive an old match
- result and winner live in backend-owned records

## Phase 5: Heartbeats and Disconnect Rules

### Goal

Make live sessions trustworthy enough for public use.

### Work

1. Add heartbeat endpoint.
2. Send heartbeat from mod every `3-5s` while:
   - queueing
   - in pre-start flow
   - in active match
3. Add stale-player handling rules by phase.
4. Add server-generated abort reasons:
   - `queue_timeout`
   - `opponent_disconnected`
   - `prestart_stale`
   - `countdown_stale`
   - `running_disconnect`

### Definition of done

- stale players are detected without relying on incidental polling
- disconnect results are consistent and visible to both clients

## Phase 6: Realtime Transport

### Goal

Make live updates fast and reliable.

### Work

1. Add match-scoped realtime channel.
2. Push:
   - opponent status updates
   - readiness changes
   - countdown target
   - aborts
   - finish/result
   - chat-mirrored events
3. Keep polling fallback for resilience.

### Mod changes

- add realtime client
- reconnect automatically
- fall back to polling when realtime drops

### Definition of done

- lobby and in-run updates do not depend on rapid polling alone
- websocket or broadcast failures degrade gracefully

## Phase 7: Ratings, Rooms, and Policy Separation

### Goal

Separate product modes cleanly.

### Queues

- `Practice`
- `Private Room`
- `Ranked`

### Work

1. Add server-side rating update engine.
2. Add `rating_history`.
3. Snapshot rating and rank into each match.
4. Keep private rooms unrated.
5. Keep practice unrated.
6. Add room join codes for private matches.

### Definition of done

- ranked and non-ranked flows are fully separated
- every rating change is auditable

## Phase 8: Moderation and Review

### Goal

Support real public operations.

### Work

1. Add staff-only moderation tools.
2. Add ban and suspension system.
3. Add suspicious match review workflow.
4. Add admin visibility into:
   - match history
   - disconnect trends
   - rating anomalies
   - repeated unusual telemetry

### Definition of done

- staff can intervene without database surgery
- abuse actions are durable and auditable

## Phase 9: Operations and Production Readiness

### Goal

Make the system deployable and maintainable.

### Work

1. Create separate `local`, `staging`, `production` environments.
2. Add migration pipeline.
3. Add structured logs and request IDs.
4. Add metrics and alerts:
   - auth failures
   - queue wait time
   - match creation failure rate
   - stale disconnect rate
   - countdown aborts
5. Add backup and restore procedures.
6. Load test staging.

### Definition of done

- staging is realistic
- production can be monitored and restored
- backend behavior under load is known before launch

## Recommended Order For Implementation In This Repo

### Next 4 concrete milestones

1. Backend decomposition
   - break [server.js](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/website/server.js) into modules
   - preserve existing API behavior

2. Postgres repository layer
   - move queue, matches, sessions, events off JSON
   - keep tests green

3. Heartbeats + finish pipeline
   - add explicit presence and result finalization

4. PKCE auth migration
   - improve mod login model after durable backend exists

### Why this order

- the backend must be structurally clean before data migration
- durable state matters more urgently than auth UX polish
- result integrity and disconnect handling matter before public release
- PKCE is the right final auth flow, but it should sit on top of the real backend, not the MVP file-backed one

## API Surface To Stabilize

The mod should converge on these backend endpoints:

- `POST /auth/native/start`
- `POST /auth/native/token`
- `POST /auth/refresh`
- `GET /auth/me`
- `POST /matchmaking/join`
- `POST /matchmaking/cancel`
- `GET /matches/:id`
- `POST /matches/:id/heartbeat`
- `POST /matches/:id/world-generated`
- `POST /matches/:id/ready`
- `POST /matches/:id/activity`
- `POST /matches/:id/finish`
- `POST /matches/:id/forfeit`

Realtime channel:

- `match:{matchId}`

## Risks To Manage

### 1. Local-world trust ceiling

Even productionizing the backend does not make the local game fully authoritative.

### 2. Overbuilding too early

Do not add heavy moderation/admin systems before durable state and heartbeats exist.

### 3. Direct database exposure

Do not shift core match lifecycle logic into client-side direct DB writes.

### 4. Auth complexity too early

PKCE is correct, but not before backend state is no longer file-backed.

## Immediate Recommendation

Start now with:

1. refactor the website backend into services and repositories
2. migrate runtime data to Postgres
3. add heartbeat and finish/result endpoints

That is the most important production step for this repo.
