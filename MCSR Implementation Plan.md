# MCSR Implementation Plan

## Goal

Build a Minecraft 1.16.1 mod for both Fabric and Forge that lets two players race the same local world seed in a synchronized 1v1 match.

Each player runs their own singleplayer world. Our system only synchronizes the competitive layer:

- matchmaking
- FSG seed selection
- match readiness
- synchronized start
- milestone telemetry
- finish detection
- match result

This project is not a full multiplayer server replacement. We are not synchronizing chunks, entities, inventory, or player movement between clients.

## Current Project Constraints

- Minecraft version: `1.16.1`
- Java version: `8`
- Loaders: `Fabric` and `Forge`
- Shared logic location: `common`
- Loader entrypoints:
  - `fabric/src/main/java/com/codex/mcsroff/ExampleModFabric.java`
  - `forge/src/main/java/com/codex/mcsroff/ExampleModForge.java`
- Shared bootstrap:
  - `common/src/main/java/com/codex/mcsroff/ExampleMod.java`

This means the core implementation should live in `common` unless a hook is truly loader-specific.

## Product Definition

### What We Are Building

A 1v1 speedrun race flow:

1. Player opens the main menu.
2. Player starts matchmaking.
3. Player selects one or more allowed FSG seed types.
4. Matchmaking pairs two players.
5. One side requests exactly one FSG seed for the match.
6. Both clients receive the same seed and selected filter type.
7. Both clients create a local world automatically.
8. Both clients freeze on spawn until both are ready.
9. Both clients release on the same scheduled countdown.
10. The mod tracks milestones and finish state.
11. The match is recorded and closed.

### What We Are Not Building In The MVP

- full anti-cheat
- reconnect/resume after crash
- ranked integrity beyond basic validation
- website/dashboard
- Elo/ranking
- local filter installation and execution
- support for Minecraft versions other than `1.16.1`

## Seed Strategy

We will use the FSG online API as the seed provider.

### Why

- It already supports 1.16.1 FSG seed types.
- It returns real filtered seeds rather than generic random seeds.
- It can return verification tokens for non-practice seed generation.
- It matches the actual intended speedrunning format better than a custom random seed generator.

### How We Will Use It

Only one side of the match should call FSG.

The match host or backend coordinator requests the seed once, then stores:

- `seed`
- `filterId`
- `token` if using verifiable seed generation
- `issuedAt`

Both clients then consume that single shared result.

### FSG Modes

We should support two seed modes:

- `Practice`
  - uses used seeds
  - no verification token
  - best for casual play and testing
- `Match`
  - uses fresh filtered seeds
  - receives FSG token
  - better for organized races

### Confirmed Useful FSG Endpoints

- `GET /filters`
- `GET /getSeed/{filterId}`
- `GET /getSeedRandomFilter?filters=a&filters=b`
- `GET /getRandomUsedSeed/{filterId}`
- `GET /getRandomUsedSeeds/{filterId}/{count}`
- `GET /checkToken/{token}`

### Seed Rule

Both players must never request FSG independently for the same match.

The seed source for a match must be a single shared payload generated once.

## Overall Architecture

### Client Responsibilities

Each client will:

- show UI
- enter or join matchmaking
- receive match assignment
- create local world from agreed seed
- report readiness
- run paused spawn flow
- poll or receive match state updates
- show milestone/opponent progress
- detect local finish condition
- submit final result

### Backend Responsibilities

The backend will only coordinate match state. It should not host gameplay.

Minimum backend responsibilities:

- queue players
- create match record
- assign host and guest roles
- request one FSG seed per match or authorize host to do it once
- store ready state
- store countdown timestamp
- store telemetry
- store finish state

### Trust Model

For the MVP, this is a trust-based competitive system.

That means:

- clients are trusted to report milestones honestly
- clients are trusted to report finish honestly
- the backend coordinates but is not authoritative over gameplay

This is acceptable for a first playable version. It is not sufficient for serious ranked anti-cheat.

## Match State Machine

We should make the implementation follow a strict state machine.

### States

- `IDLE`
- `QUEUEING`
- `MATCH_FOUND`
- `SEED_ASSIGNED`
- `WORLD_CREATING`
- `SPAWN_WAIT`
- `COUNTDOWN`
- `RUNNING`
- `FINISHED`
- `ABORTED`

### State Rules

- No world creation before `SEED_ASSIGNED`.
- No countdown before both players are `ready`.
- No gameplay timer before countdown ends.
- No match result accepted after `FINISHED` or `ABORTED`.

This state machine should exist as shared code in `common`.

## MVP Technical Approach

## 1. Bootstrapping

Replace the current example mod bootstrap with a real core initialization path.

Planned shared bootstrap responsibilities:

- initialize config
- initialize networking services
- initialize client state manager
- register screens
- register menu hooks
- register telemetry tracking

Fabric and Forge entrypoints should stay thin and only call shared init.

## 2. Main Menu Integration

We need a main menu button for starting the MCSR flow.

Button actions:

- open MCSR matchmaking/config screen
- choose match mode
- choose FSG filter or filter set
- start queueing

This should be handled with shared client UI where possible, plus targeted mixins or screen hooks for 1.16.1.

## 3. Matchmaking Flow

The matchmaking layer should be simple and deterministic.

Required fields for a queue request:

- player session id
- display name
- loader type
- mod version
- desired seed mode
- allowed filters

Required fields for an assigned match:

- match id
- role: `host` or `guest`
- selected filter
- seed
- token if present
- world name
- countdown target timestamp

## 4. World Creation

After seed assignment, each client creates a local singleplayer world automatically.

World creation settings for MVP:

- survival mode
- fixed version target `1.16.1`
- structures enabled
- no bonus chest
- no user prompt once match creation is confirmed

We should encapsulate this behind a shared world-launch service with loader-appropriate hooks only where necessary.

## 5. Paused Spawn Synchronization

This is the core fairness feature.

When the player first enters the generated world:

- immediately open a custom wait screen
- pause local gameplay
- mark local player as ready
- wait for opponent ready state
- display countdown
- release control at the agreed start timestamp

This screen should be unclosable during the synchronization window.

## 6. Run Telemetry

Telemetry in the MVP should be minimal and useful.

Track only:

- Nether entered
- End entered
- Dragon dead
- Finish triggered

Optional later:

- Stronghold located
- blaze rods acquired
- pearl threshold reached

Telemetry should be best-effort and must never block the game thread.

## 7. Finish Detection

The first version should use a clear and practical finish rule.

Recommended finish rule for MVP:

- dragon is dead
- player enters the exit portal

This matches common Any% logic better than dragon death alone.

## 8. Result Handling

When a player finishes:

- record finish time locally
- submit finish payload
- mark match as finished
- show result screen
- freeze or end the opponent run once finish is confirmed

We should guard against duplicate submissions.

## Code Organization Plan

All new gameplay and match logic should be organized in `common`.

Suggested package structure:

- `com.codex.mcsroff`
  - shared bootstrap and constants
- `com.codex.mcsroff.config`
  - local config and persistence
- `com.codex.mcsroff.match`
  - match models, state machine, manager
- `com.codex.mcsroff.net`
  - HTTP client, backend API client, FSG API client
- `com.codex.mcsroff.seed`
  - seed mode, filter models, seed assignment
- `com.codex.mcsroff.world`
  - world creation and launch logic
- `com.codex.mcsroff.telemetry`
  - milestone tracking and event submission
- `com.codex.mcsroff.ui`
  - menu screen, wait screen, result screen
- `com.codex.mcsroff.mixin`
  - mixins only

### Loader Modules

`fabric` and `forge` should contain only:

- loader entrypoints
- loader-specific registration glue if required
- loader-specific compatibility shims if shared abstractions are not enough

## Network Approach

All HTTP must run off the main thread.

Because this project targets Java 8, we cannot rely on `java.net.http.HttpClient`.

So we should use one lightweight Java 8 compatible HTTP approach, then wrap it behind our own API interface.

Requirements:

- async request execution
- request timeout support
- retry policy for transient failures
- JSON encode/decode
- no game-thread blocking

The game thread should only receive final results or scheduled UI updates.

## Config Plan

Local config should store:

- player display name override if needed
- selected seed mode
- selected default filters
- backend base URL
- debug mode

Do not store active match state only in memory if the UI depends on it across screen transitions.

## Backend Contract

The backend API must be defined before implementation gets too deep.

Minimum routes or equivalent operations:

- `createQueueEntry`
- `pollQueueStatus`
- `cancelQueueEntry`
- `createMatch`
- `getMatch`
- `updateReadyState`
- `submitTelemetry`
- `submitFinish`
- `abortMatch`

Whether the backend is Firebase, Supabase, or a tiny custom service is secondary. The client should talk to a stable internal interface.

## MVP Delivery Order

### Phase 1: Project Cleanup

- remove example print logic
- create real bootstrap classes
- establish package structure
- add config and logging

### Phase 2: FSG Integration

- implement FSG filter fetch
- implement seed fetch for practice and match modes
- implement seed models
- add filter selection UI

### Phase 3: Matchmaking Skeleton

- implement queue create/join flow
- implement match polling
- implement shared match state machine

### Phase 4: World Launch

- auto-create world from assigned seed
- lock world settings for race mode

### Phase 5: Paused Spawn

- detect first spawn
- open wait screen
- synchronize release

### Phase 6: Telemetry And Finish

- add milestone tracking
- add finish detection
- add result screen

### Phase 7: Stabilization

- failure handling
- duplicate submission protection
- timeout handling
- polish UI and match cancellation flow

## Important Risks

### 1. Loader Parity

Fabric and Forge 1.16.1 do not expose every client hook the same way.

Mitigation:

- keep core logic shared
- isolate hook-specific code
- use mixins only where event hooks are insufficient

### 2. Java 8 Constraint

The older runtime reduces library choices and rules out newer standard HTTP APIs.

Mitigation:

- choose one small Java 8-compatible HTTP layer
- wrap it so we can swap later if needed

### 3. Start Sync Jitter

Countdown-based release can still have timing jitter.

Mitigation:

- use ready-state barrier
- use server-scheduled start timestamp
- keep release logic simple and deterministic

### 4. Client Trust

Players can lie or tamper in a trust-based system.

Mitigation:

- accept this for MVP
- store FSG token and match metadata
- keep future ranked mode separate from the first playable release

## Decisions Already Made

- We are not blindly following the original research markdown.
- The mod target is `1.16.1` only.
- The mod will support both `Fabric` and `Forge`.
- The template project in this repo is the implementation base.
- FSG is the seed source.
- Shared logic belongs in `common`.
- The first release is an MVP race flow, not a full anti-cheat platform.

## Immediate Next Steps

1. Replace the example bootstrap with real mod initialization.
2. Create the shared package structure in `common`.
3. Implement the FSG client and filter models.
4. Build the first MCSR menu screen.
5. Define the backend contract in code.
6. Implement queue and match polling.
7. Implement seeded world creation.
8. Implement paused spawn synchronization.

## Success Criteria For MVP

The MVP is successful when:

- two players can enter the queue
- both receive one identical FSG seed
- both auto-load the same local world
- both remain frozen until both are ready
- both start from the same countdown release
- both can finish a race and see a result

That is the first real target. Everything else is secondary.
