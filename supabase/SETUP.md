# Supabase Setup

Apply [schema.sql](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/supabase/schema.sql) in the Supabase SQL Editor.

## Use These Project Values

- `Project URL`: `https://uoqolyihlfnscikszxwc.supabase.co`
- `Edge Function URL`: `https://uoqolyihlfnscikszxwc.supabase.co/functions/v1/matchmaker`
- `Publishable key`: use in the mod config
- `Anon JWT key`: optional for debugging; the mod should prefer the publishable key

## Dashboard Steps

1. Open `Authentication -> Providers`.
2. Enable `Anonymous` sign-ins.
3. Open `SQL Editor`.
4. Run [schema.sql](/C:/Users/Aditya/Desktop/MCSR%20OFFLINE/supabase/schema.sql).
5. Open `Edge Functions -> matchmaker`.
6. Use one function to own all sensitive match writes.

## Recommended Matchmaker Actions

Use JSON `action` values:

- `join_queue`
- `cancel_queue`
- `poll_match`
- `mark_world_generated`
- `mark_ready`
- `heartbeat`
- `report_finish`
- `abort_match`

## Match Flow

1. Client anonymously signs in to Supabase Auth.
2. Client ensures a `profiles` row exists.
3. Client calls `matchmaker` with `join_queue`.
4. Function either keeps player queued or creates a `matches` row and two `match_players` rows.
5. Clients poll `poll_match` until state becomes `matched`.
6. One function call assigns the FSG seed and shared match metadata.
7. After local world creation, each client calls `mark_world_generated`.
8. After both clients are generated and locked, each client calls `mark_ready`.
9. Function writes one shared `countdown_target`.
10. Both clients count down to the same timestamp.
11. Finish and abort updates always go through the function.

## What The Mod Should Read Directly

Direct read access is fine for:

- own `profiles` row
- own `queue_entries` row
- `matches` row if the player is in that match
- `match_players` rows for that match
- `match_events` rows for that match

## What Must Stay In Edge Functions

Keep these server-side:

- queue matching / queue claim
- match creation
- FSG seed assignment
- writing `countdown_target`
- winner selection
- disconnect / abort resolution

## Current Next Implementation Step

Wire the mod to:

- sign in anonymously
- create/update `profiles`
- call `matchmaker`
- replace all dummy opponent / ready logic with real `matches` and `match_players` state
