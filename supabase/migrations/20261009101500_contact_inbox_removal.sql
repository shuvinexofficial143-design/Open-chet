-- Removing a customer from the Open Chet address book and inbox must not
-- destroy WhatsApp message history, campaign receipts, or audit references.
alter table public.contacts add column if not exists removed_at timestamptz;
create index if not exists contacts_visible_by_org
  on public.contacts(organization_id, name, id) where removed_at is null;

-- If the customer sends a *new inbound* WhatsApp message, let their contact
-- and historical thread reappear automatically for business support.
create or replace function public.restore_removed_contact_on_inbound()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.direction = 'in' then
    update public.contacts ct
       set removed_at = null, updated_at = now()
      from public.conversations cv
     where cv.id = new.conversation_id
       and cv.organization_id = new.organization_id
       and ct.id = cv.contact_id
       and ct.organization_id = cv.organization_id
       and ct.removed_at is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists restore_removed_contact_on_inbound on public.messages;
create trigger restore_removed_contact_on_inbound
after insert on public.messages
for each row execute function public.restore_removed_contact_on_inbound();
