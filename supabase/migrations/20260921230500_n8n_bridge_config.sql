-- Store server-only n8n bridge configuration without exposing secrets to browser clients.
create table if not exists public.integration_bridges (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  n8n_inbound_webhook_url text not null,
  n8n_bridge_secret text not null,
  whatsapp_verify_token text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_bridges_https_check check (n8n_inbound_webhook_url ~ '^https://'),
  constraint integration_bridges_secret_length_check check (length(n8n_bridge_secret) >= 32),
  constraint integration_bridges_verify_token_length_check check (length(whatsapp_verify_token) >= 16)
);

alter table public.integration_bridges enable row level security;
revoke all on public.integration_bridges from anon, authenticated;
create index if not exists integration_bridges_enabled_idx
  on public.integration_bridges(enabled, updated_at desc);
