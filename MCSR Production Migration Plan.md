# MCSR Production Migration Plan

## Purpose

This document replaces the current MVP assumptions with a production-oriented plan for:

- authentication
- backend architecture
- durable match state
- realtime updates
- rating and history
- operations and observability

It is written for the current project constraints:

- Minecraft `1.16.1`
- Java `8`
- Fabric + Forge client mod
- website-controlled identity

## Executive Summary

The current stack is good for local and closed-alpha testing, but it is not yet production-grade:

- website auth is custom and file-backed
- queue and match state are stored in local JSON files
- live state is coordinated by a single local Node process
- the mod still relies on some placeholder-era assumptions in the match lifecycle

The production target should be:

1. Website identity remains the source of truth.
2. Authentication moves to browser-based native-app login using external browser + PKCE.
3. All durable data moves to Postgres.
4. The mod talks only to a backend API, never directly to the database.
5. Matchmaking and countdown are server-authoritative.
6. Presence and live match updates use realtime messaging, with polling as fallback.
7. Ratings, history, bans, and audit logs are written durably.
8. Production operations include migrations, backups, observability, rate limiting, and staging.

## Non-Negotiable Product Constraints

### 1. Identity must be singular and revocable

Every competitive account must map to one canonical website user ID.

The mod must never self-assert:

- username
- display name
- elo
- rank
- ban state

### 2. Match state must be durable

Queue, match, and session state must live in a database, not process memory or JSON files.

### 3. Match lifecycle must be authoritative

Clients may render the flow, but the backend must decide:

- who is matched
- what seed is assigned
- when both players are ready
- when countdown starts
- whether a match is aborted
- who won
- how Elo changes

### 4. Competitive integrity has a hard ceiling in fully local worlds

This is an engineering inference from the architecture, not a vendor claim:

If both players run fully local singleplayer worlds, the backend cannot truly verify every gameplay event. That means:

- casual and standard ladder play can be productionized
- fully trusted ranked play still needs stronger anti-tamper and review controls
- truly authoritative tournament-grade play would require a server-authoritative mode or additional verification workflow

## Recommended Production Architecture

## Identity and Authentication

### Recommended target

Use website-controlled auth backed by a real identity provider and browser-based native-app login.

Recommended implementation:

- website frontend: your site
- auth backend: Supabase Auth or another managed IdP
- mod auth flow: Authorization Code + PKCE in the external browser
- mod callback: localhost loopback redirect
- fallback only: device code flow for environments where browser callback fails

### Why

RFC 8252 defines external-browser native-app auth as best current practice and explicitly recommends browser-based flows for native apps, with loopback redirects for desktop apps.

### Result

The canonical account becomes:

- `user.id` from website auth

The mod stores only:

- short-lived access token
- rotating refresh token
- public profile snapshot for display

### Session rules

- short access token lifetime: `10-30 minutes`
- rotating refresh tokens
- refresh token revocation on logout, ban, password reset, or suspicious activity
- single active mod session per account if strict competitive policy is desired
- revalidate session whenever the player opens matchmaking

### Credential rules

If username/password remains supported:

- use Argon2id
- unique username
- unique display name
- email verification
- password reset flow
- optional MFA for staff/admin accounts

Do not keep custom PBKDF2 auth as the long-term primary solution unless you have a very strong reason.

## Backend Topology

### Recommended target

Use a real application backend in front of the database.

Recommended shape:

- website frontend
- API/backend service
- Postgres database
- optional Redis for presence, rate limiting, and ephemeral coordination
- realtime delivery layer

### Recommended stack for this project

Practical choice:

- website + API: Node.js/TypeScript
- database: Postgres
- managed platform: Supabase Postgres is acceptable
- auth backing: Supabase Auth is acceptable
- realtime:
  - preferred: backend WebSocket or Supabase Broadcast/Presence
  - fallback: short-interval polling

### What the mod should talk to

The mod should call only:

- your auth endpoints
- your gameplay API endpoints
- your realtime channel

The mod should not:

- write directly to public queue tables
- mint identity locally
- decide countdown targets locally

## Database Design

### Durable core tables

The production schema should include at minimum:

- `users`
- `profiles`
- `mod_sessions`
- `linked_game_accounts`
- `queue_entries`
- `matches`
- `match_players`
- `match_events`
- `rating_history`
- `bans`
- `audit_log`

### Recommended semantics

- `users`: canonical identity from auth system
- `profiles`: display profile, public stats, competitive state
- `mod_sessions`: active client sessions, device info, revocation state
- `queue_entries`: current search requests
- `matches`: durable match record and authoritative lifecycle state
- `match_players`: per-player state within one match
- `match_events`: immutable event stream for telemetry and review
- `rating_history`: every rating change with reason and previous/new values
- `bans`: enforcement state
- `audit_log`: staff/security-sensitive actions

### Queue matching rule

Queue claiming must be transactional.

Use database transactions and row locking for match creation. PostgreSQL `FOR UPDATE SKIP LOCKED` is appropriate for queue-like consumers when implemented carefully in a server-side transaction.

Clients must never race each other to claim opponents.

## Match Lifecycle

## Authoritative states

Recommended authoritative match states:

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

### Per-player states

Each player row should independently track:

- `connection_state`
- `world_state`
- `ready_state`
- `last_heartbeat_at`
- `finish_state`
- `result`

### Server-owned fields

The backend alone should write:

- `seed`
- `fsg_filter_id`
- `fsg_token`
- `countdown_target_at`
- `match_state`
- `winner_user_id`
- `abort_reason`
- rating update records

### Client-owned reports

Clients may report:

- world generated
- ready
- telemetry milestones
- finish submission
- advancement events
- heartbeat

But these are reports, not truth by themselves. The backend interprets them.

## Seed Assignment

### Production rule

Seed assignment must happen server-side.

Recommended flow:

1. Two players are matched in a transaction.
2. Backend requests one FSG seed.
3. Backend stores `seed`, `filter`, `token`, and timestamps in the match row.
4. Both clients receive that same assignment.

### Do not

- let both clients call FSG independently
- let the host decide the seed unilaterally
- expose unnecessary seed verification fields in the lobby UI

## Realtime Strategy

## Preferred model

Use push for live match updates and polling as fallback.

Recommended realtime data:

- opponent status changes
- countdown target creation
- match aborts
- match events
- in-run activity updates

### Best fit

If staying close to Supabase:

- use Broadcast for low-latency messages
- use Presence for online/active tracking
- avoid using raw Postgres Changes as the main gameplay event bus

If using your own backend websocket layer:

- keep Postgres as the source of truth
- publish events from backend workers/API after commit

### Polling fallback

Keep a polling fallback in the mod:

- `500-1000 ms` for active pre-start match state
- `2-5 s` for lower-priority screens

This prevents the entire UX from failing if a websocket path drops.

## Presence, Heartbeats, and Disconnect Handling

Production rules:

- mod sends heartbeat every `3-5 seconds` while queued or in a match
- backend marks player stale if no heartbeat within threshold
- threshold should differ by phase:
  - queue: short
  - pre-start: strict
  - running: slightly more tolerant

Recommended behavior:

- stale before countdown: abort or return opponent to queue according to product rules
- stale during countdown: abort match
- stale during run: forfeit or disconnect result according to ranked rules

Do not rely only on polling side effects for presence.

## Ratings and Competitive Integrity

## Rating system

Use backend-owned Elo or Glicko-style updates.

Production minimum:

- rating update runs server-side only
- write every change into `rating_history`
- snapshot both players' rating and rank into the match record

### Separate queues

Recommended product split:

- `Practice`
- `Private Room`
- `Ranked`

Do not mix these queues.

### Integrity warning

Because gameplay is local, ranked integrity must be treated as limited unless you add stronger controls.

Recommended layered controls:

- signed mod builds
- mod version enforcement
- token-bound session checks
- suspicious telemetry detection
- server-side validation of impossible state transitions
- post-match audit tools
- optional moderator review for top ladder or tournaments

For the highest-trust competitive mode, plan a future authoritative mode or verified-run workflow.

## Security Controls

Production minimum:

- all traffic over HTTPS only
- secure cookies for website sessions
- refresh token rotation
- rate limiting on auth and matchmaking endpoints
- RLS enabled if clients ever access Supabase directly for restricted paths
- service-role keys never shipped in the mod
- backend secrets only on server
- structured audit logs for auth, moderation, and rating changes

### Anti-abuse

- IP/device/session anomaly tracking
- queue spam limits
- duplicate session controls
- ban and suspension enforcement
- username/display name reservation rules

## Operations and Reliability

## Environments

Maintain separate:

- local
- staging
- production

### Deployments

- database migrations versioned in repo
- blue/green or rolling deployment for API/backend
- staging smoke tests before production promotion

### Observability

Production minimum:

- structured logs
- request IDs
- match IDs in logs
- metrics for queue size, match creation latency, countdown failures, disconnect rate
- error tracking
- uptime checks

### Backup and recovery

- automated Postgres backups
- tested restore procedure
- retention policy for match history and audit logs

## Recommended Migration Path

## Phase 0: Freeze MVP assumptions

Current state to retire:

- JSON-file storage
- custom password auth as long-term primary auth
- device-code-only mod login
- match presence inferred only from polling

## Phase 1: Identity hardening

1. Move website auth onto a real auth provider.
2. Implement browser-based native-app login with PKCE.
3. Add refresh rotation, logout, ban revocation, and session introspection.
4. Keep device code as fallback only.

## Phase 2: Durable data migration

1. Move users, sessions, queue, matches, and events into Postgres.
2. Add migration tooling.
3. Add indexes and unique constraints.
4. Add transactional match creation.

## Phase 3: Authoritative match lifecycle

1. Add heartbeat endpoint and stale-player handling.
2. Make countdown backend-owned only.
3. Add explicit abort reasons and requeue rules.
4. Add match finish submission and server-owned result finalization.

## Phase 4: Realtime delivery

1. Add websocket or Supabase Broadcast/Presence channels.
2. Push match-state updates instead of depending on rapid polling alone.
3. Keep polling fallback in the mod.

## Phase 5: Rating and moderation

1. Add server-side rating updates.
2. Add match history views.
3. Add bans, suspensions, and audit log tools.
4. Add suspicious-run review capability.

## Phase 6: Operational readiness

1. Staging environment.
2. Metrics, alerts, and dashboards.
3. Backup/restore drills.
4. Load testing with realistic concurrency.

## Recommended Immediate Next Changes In This Repo

### Backend

- replace `website/data/*.json` with Postgres-backed repositories
- keep API shapes stable where possible
- add explicit heartbeat endpoint
- add `finish_match` and rating update pipeline

### Website

- stop growing the custom password stack as the final auth model
- move toward managed auth + proper account management
- add verified email, reset flow, and admin moderation paths

### Mod

- replace device-code-first flow with browser PKCE flow
- keep device code as fallback
- add websocket or broadcast client for live match updates
- keep polling fallback for resilience

### Match system

- make countdown start only from backend event
- add disconnect/forfeit handling
- add immutable match event persistence
- add result finalization and rating changes

## Recommended Final Position

The best production path for this project is:

- website-owned identity
- external-browser native-app auth with PKCE
- Postgres-backed durable state
- backend-authoritative matchmaking and countdown
- realtime push plus polling fallback
- operational discipline around migrations, monitoring, and recovery

The current MVP should be treated as a functional prototype, not the final architecture.

## Sources

- Supabase Production Checklist: https://supabase.com/docs/guides/deployment/going-into-prod
- Supabase Realtime overview: https://supabase.com/docs/guides/realtime
- Supabase Broadcast docs: https://supabase.com/docs/guides/realtime/broadcast
- Supabase Auth overview: https://supabase.com/docs/guides/auth
- Supabase Auth sessions: https://supabase.com/docs/guides/auth/sessions
- Supabase Database Webhooks: https://supabase.com/docs/guides/database/webhooks
- PostgreSQL row locking and `SKIP LOCKED`: https://www.postgresql.org/docs/15/sql-select.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OAuth 2.0 for Native Apps, RFC 8252: https://www.rfc-editor.org/rfc/rfc8252
- OAuth 2.0 Device Authorization Grant, RFC 8628: https://www.rfc-editor.org/rfc/rfc8628
