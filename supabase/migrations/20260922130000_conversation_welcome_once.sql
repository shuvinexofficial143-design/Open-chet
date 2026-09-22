alter table public.conversations
  add column if not exists welcome_sent boolean not null default false;
