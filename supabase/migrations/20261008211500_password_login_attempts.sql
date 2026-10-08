-- A private, durable throttling table for the single-password Open Chet sign-in.
-- No browser or Supabase API role receives access. Server uses DATABASE_URL.
create table if not exists public.open_chet_login_attempts (
  attempt_key text primary key,
  failures integer not null default 0 check (failures >= 0),
  window_start timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists open_chet_login_attempts_updated_idx on public.open_chet_login_attempts(updated_at);
alter table public.open_chet_login_attempts enable row level security;
revoke all on table public.open_chet_login_attempts from anon, authenticated;
