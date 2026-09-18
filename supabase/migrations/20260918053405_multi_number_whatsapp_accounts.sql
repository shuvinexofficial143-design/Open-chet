-- Extend the existing WhatsApp account table for secure, multi-number routing.
alter table public.whatsapp_accounts
  add column label text not null default 'WhatsApp',
  add column display_phone_number text not null default '',
  add column verified_name text not null default '',
  add column access_token_ciphertext text,
  add column access_token_iv text,
  add column access_token_tag text,
  add column is_active boolean not null default false,
  add column is_default boolean not null default false,
  add column updated_at timestamptz not null default now(),
  add constraint whatsapp_accounts_label_check check (length(trim(label)) between 1 and 120),
  add constraint whatsapp_accounts_phone_number_id_check check (phone_number_id ~ '^[0-9]{5,30}$'),
  add constraint whatsapp_accounts_business_account_id_check check (business_account_id ~ '^[0-9]{5,30}$'),
  add constraint whatsapp_accounts_token_material_check check (
    (access_token_ciphertext is null and access_token_iv is null and access_token_tag is null)
    or
    (access_token_ciphertext is not null and access_token_iv is not null and access_token_tag is not null)
  ),
  add constraint whatsapp_accounts_organization_id_id_key unique (organization_id, id);

create unique index whatsapp_accounts_one_default_idx
  on public.whatsapp_accounts(organization_id)
  where is_default;
create index whatsapp_accounts_active_idx
  on public.whatsapp_accounts(organization_id, is_active, created_at);
create index whatsapp_accounts_business_account_idx
  on public.whatsapp_accounts(business_account_id);

-- Existing conversations remain valid with a null account until explicitly linked.
alter table public.conversations
  add column whatsapp_account_id uuid,
  drop constraint conversations_organization_id_contact_id_key,
  add constraint conversations_organization_id_whatsapp_account_id_fkey
    foreign key (organization_id, whatsapp_account_id)
    references public.whatsapp_accounts(organization_id, id);

create unique index conversations_account_contact_key
  on public.conversations(organization_id, whatsapp_account_id, contact_id)
  where whatsapp_account_id is not null;
create unique index conversations_legacy_contact_key
  on public.conversations(organization_id, contact_id)
  where whatsapp_account_id is null;
create index conversations_whatsapp_account_idx
  on public.conversations(whatsapp_account_id, updated_at desc)
  where whatsapp_account_id is not null;

-- Templates are scoped to the WABA connection that owns them. Legacy rows remain usable.
alter table public.templates
  add column whatsapp_account_id uuid,
  drop constraint templates_organization_id_name_language_key,
  add constraint templates_organization_id_whatsapp_account_id_fkey
    foreign key (organization_id, whatsapp_account_id)
    references public.whatsapp_accounts(organization_id, id);

create unique index templates_account_name_language_key
  on public.templates(organization_id, whatsapp_account_id, name, language)
  where whatsapp_account_id is not null;
create unique index templates_legacy_name_language_key
  on public.templates(organization_id, name, language)
  where whatsapp_account_id is null;

-- Authenticated clients may read only non-secret connection metadata.
revoke select on public.whatsapp_accounts from authenticated;
grant select (
  id, organization_id, phone_number_id, business_account_id, label,
  display_phone_number, verified_name, is_active, is_default, created_at, updated_at
) on public.whatsapp_accounts to authenticated;
