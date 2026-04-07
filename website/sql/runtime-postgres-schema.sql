-- MCSR website/backend runtime schema for the current production migration path.
-- This schema mirrors the current JSON-backed auth + matchmaking runtime so the
-- backend can move to Postgres before the auth model is fully replaced.

create extension if not exists pgcrypto;

create or replace function public.mcsroff_runtime_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  username_lower text not null unique,
  display_name text not null unique,
  display_name_lower text not null unique,
  password_hash text not null,
  password_salt text not null,
  elo integer not null default 1200 check (elo >= 0),
  rank_tier text not null default 'Bronze I',
  status text not null default 'active' check (status in ('active', 'banned', 'disabled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.web_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create table if not exists public.device_links (
  id uuid primary key default gen_random_uuid(),
  device_code text not null unique,
  user_code text not null unique,
  minecraft_name text not null,
  loader text not null,
  scope text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  approved_user_id uuid references public.app_users(id) on delete set null,
  mod_session_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create table if not exists public.mod_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  scope text not null,
  access_token text not null unique,
  refresh_token text not null unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  state text not null check (
    state in (
      'matched',
      'world_generating',
      'world_generated',
      'countdown',
      'running',
      'finished',
      'aborted'
    )
  ),
  seed_mode text not null check (seed_mode in ('MATCH', 'PRACTICE')),
  seed_type_label text not null,
  filter_ids jsonb not null default '[]'::jsonb,
  seed text,
  fsg_filter_id text,
  fsg_token text,
  countdown_target_epoch_millis bigint not null default 0,
  abort_reason text not null default '',
  winner_player_id uuid references public.app_users(id) on delete set null,
  next_event_seq integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.app_users(id) on delete cascade,
  username text not null,
  display_name text not null,
  elo_snapshot integer not null default 1200 check (elo_snapshot >= 0),
  rank_snapshot text not null,
  slot text not null check (slot in ('host', 'opponent')),
  connected boolean not null default true,
  world_status text not null default 'queued' check (
    world_status in ('queued', 'generating', 'generated', 'ready', 'running', 'finished', 'disconnected')
  ),
  activity_status text not null default 'Started Match',
  last_seen_at timestamptz not null default timezone('utc', now()),
  ready_at timestamptz,
  finished_at timestamptz,
  finish_time_ms bigint not null default 0,
  result text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_players_unique_match_player unique (match_id, player_id),
  constraint match_players_unique_match_slot unique (match_id, slot)
);

create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null unique references public.app_users(id) on delete cascade,
  username text not null,
  display_name text not null,
  elo integer not null default 1200,
  rank_tier text not null,
  seed_mode text not null check (seed_mode in ('MATCH', 'PRACTICE')),
  seed_type_label text not null,
  filter_ids jsonb not null default '[]'::jsonb,
  status text not null default 'searching' check (status in ('searching', 'matched', 'cancelled')),
  claimed_match_id uuid,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create table if not exists public.match_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  seq integer not null,
  player_id uuid references public.app_users(id) on delete set null,
  type text not null,
  activity_key text not null default '',
  status_text text not null default '',
  chat_message text not null default '',
  advancement_id text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  constraint match_events_unique_seq unique (match_id, seq)
);

create table if not exists public.rating_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  previous_elo integer not null default 0 check (previous_elo >= 0),
  new_elo integer not null default 0 check (new_elo >= 0),
  delta integer not null default 0,
  reason text not null default 'match_result',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete set null,
  category text not null,
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  match_id uuid references public.matches(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.mcsroff_claim_queue_opponent(
  requesting_player_id uuid,
  requested_seed_mode text,
  requested_filter_ids text[],
  claim_match_id uuid,
  claim_now timestamptz,
  stale_cutoff timestamptz
)
returns table (
  id uuid,
  player_id uuid,
  username text,
  display_name text,
  elo integer,
  rank_tier text,
  seed_mode text,
  seed_type_label text,
  filter_ids jsonb,
  status text,
  claimed_match_id uuid,
  last_seen_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  expires_at timestamptz
)
language plpgsql
as $$
declare
  candidate public.queue_entries%rowtype;
  touched_count integer;
begin
  perform 1
  from public.queue_entries q_self
  where q_self.player_id = requesting_player_id
  for update;

  select q.*
  into candidate
  from public.queue_entries q
  where q.player_id <> requesting_player_id
    and q.status = 'searching'
    and q.seed_mode = requested_seed_mode
    and q.expires_at > claim_now
    and (q.last_seen_at is null or q.last_seen_at >= stale_cutoff)
    and q.filter_ids ?| requested_filter_ids
  order by q.created_at asc
  for update skip locked
  limit 1;

  if candidate.id is null then
    return;
  end if;

  update public.queue_entries q_claim
  set status = 'matched',
      claimed_match_id = claim_match_id,
      updated_at = claim_now
  where q_claim.player_id in (requesting_player_id, candidate.player_id)
    and q_claim.status = 'searching';

  get diagnostics touched_count = row_count;
  if touched_count <> 2 then
    update public.queue_entries q_reset
    set status = 'searching',
        claimed_match_id = null,
        updated_at = claim_now
    where q_reset.claimed_match_id = claim_match_id;
    return;
  end if;

  return query
  select
    candidate.id,
    candidate.player_id,
    candidate.username,
    candidate.display_name,
    candidate.elo,
    candidate.rank_tier,
    candidate.seed_mode,
    candidate.seed_type_label,
    candidate.filter_ids,
    candidate.status,
    candidate.claimed_match_id,
    candidate.last_seen_at,
    candidate.created_at,
    candidate.updated_at,
    candidate.expires_at;
end;
$$;

create or replace function public.mcsroff_release_queue_claim(
  claim_match_id uuid,
  release_player_ids uuid[],
  release_now timestamptz
)
returns void
language plpgsql
as $$
begin
  update public.queue_entries q_release
  set status = 'searching',
      claimed_match_id = null,
      updated_at = release_now,
      last_seen_at = release_now
  where q_release.claimed_match_id = mcsroff_release_queue_claim.claim_match_id
    and q_release.player_id = any(release_player_ids);
end;
$$;

create index if not exists idx_app_users_username_lower on public.app_users(username_lower);
create index if not exists idx_app_users_display_name_lower on public.app_users(display_name_lower);
create index if not exists idx_web_sessions_token on public.web_sessions(token);
create index if not exists idx_web_sessions_user_id on public.web_sessions(user_id);
create index if not exists idx_device_links_user_code on public.device_links(user_code);
create index if not exists idx_device_links_device_code on public.device_links(device_code);
create index if not exists idx_mod_sessions_access_token on public.mod_sessions(access_token);
create index if not exists idx_mod_sessions_refresh_token on public.mod_sessions(refresh_token);
create index if not exists idx_mod_sessions_user_id on public.mod_sessions(user_id);
create index if not exists idx_matches_state_updated_at on public.matches(state, updated_at desc);
create index if not exists idx_match_players_match_id on public.match_players(match_id);
create index if not exists idx_match_players_player_id on public.match_players(player_id);
create index if not exists idx_queue_entries_status_created_at on public.queue_entries(status, created_at);
create index if not exists idx_queue_entries_expires_at on public.queue_entries(expires_at);
create index if not exists idx_match_events_match_id_created_at on public.match_events(match_id, created_at desc);
create index if not exists idx_rating_history_user_id_created_at on public.rating_history(user_id, created_at desc);
create index if not exists idx_rating_history_match_id on public.rating_history(match_id);
create index if not exists idx_audit_logs_user_id_created_at on public.audit_logs(user_id, created_at desc);
create index if not exists idx_audit_logs_match_id_created_at on public.audit_logs(match_id, created_at desc);
create index if not exists idx_audit_logs_category_action_created_at on public.audit_logs(category, action, created_at desc);

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.mcsroff_runtime_set_updated_at();

drop trigger if exists trg_device_links_updated_at on public.device_links;
create trigger trg_device_links_updated_at
before update on public.device_links
for each row execute function public.mcsroff_runtime_set_updated_at();

drop trigger if exists trg_mod_sessions_updated_at on public.mod_sessions;
create trigger trg_mod_sessions_updated_at
before update on public.mod_sessions
for each row execute function public.mcsroff_runtime_set_updated_at();

drop trigger if exists trg_matches_updated_at on public.matches;
create trigger trg_matches_updated_at
before update on public.matches
for each row execute function public.mcsroff_runtime_set_updated_at();

drop trigger if exists trg_match_players_updated_at on public.match_players;
create trigger trg_match_players_updated_at
before update on public.match_players
for each row execute function public.mcsroff_runtime_set_updated_at();

drop trigger if exists trg_queue_entries_updated_at on public.queue_entries;
create trigger trg_queue_entries_updated_at
before update on public.queue_entries
for each row execute function public.mcsroff_runtime_set_updated_at();
