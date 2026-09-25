-- Model B: an organization/contact is the logical thread. Account conversations
-- remain immutable subthreads: no history, FK, AI state or routing is discarded.
-- Existing unique(org,phone) + strict international phone CHECK already prevent
-- ambiguous contact merging. Names and country-code guesses are never identities.
alter table public.conversations add column if not exists cleared_at timestamptz;
alter table public.ai_sessions add column if not exists updated_at timestamptz not null default now();
alter table public.messages add column if not exists whatsapp_account_id uuid;
alter table public.messages add column if not exists phone_number_id text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='messages_route_account_fkey') then
    alter table public.messages add constraint messages_route_account_fkey
      foreign key(organization_id,whatsapp_account_id) references public.whatsapp_accounts(organization_id,id);
  end if;
end $$;

-- Backfill only provable routes. Unknown legacy routes stay explicitly NULL.
update public.messages m set whatsapp_account_id=c.whatsapp_account_id,phone_number_id=a.phone_number_id
from public.conversations c join public.whatsapp_accounts a
  on a.organization_id=c.organization_id and a.id=c.whatsapp_account_id
where m.organization_id=c.organization_id and m.conversation_id=c.id
  and m.whatsapp_account_id is null and m.phone_number_id is null;

create or replace function public.capture_message_route() returns trigger
language plpgsql set search_path='' as $$
declare route uuid; phone text;
begin
  select c.whatsapp_account_id,a.phone_number_id into route,phone
  from public.conversations c left join public.whatsapp_accounts a
    on a.id=c.whatsapp_account_id and a.organization_id=c.organization_id
  where c.id=new.conversation_id and c.organization_id=new.organization_id;
  if new.whatsapp_account_id is not null and new.whatsapp_account_id is distinct from route
     or new.phone_number_id is not null and new.phone_number_id is distinct from phone then
    raise exception 'Message route does not match its account subthread';
  end if;
  new.whatsapp_account_id:=route; new.phone_number_id:=phone;
  return new;
end $$;
drop trigger if exists capture_message_route on public.messages;
create trigger capture_message_route before insert on public.messages
for each row execute function public.capture_message_route();
revoke all on function public.capture_message_route() from public;

create or replace function public.guard_customer_identity() returns trigger
language plpgsql set search_path='' as $$ begin
  if new.phone is distinct from old.phone and exists(select 1 from public.conversations
    where organization_id=old.organization_id and contact_id=old.id) then
    raise exception 'A customer with conversation history cannot change phone identity; create a separate contact';
  end if;
  return new;
end $$;
drop trigger if exists guard_customer_identity on public.contacts;
create trigger guard_customer_identity before update of phone on public.contacts
for each row execute function public.guard_customer_identity();
revoke all on function public.guard_customer_identity() from public;

create or replace function public.guard_conversation_route() returns trigger
language plpgsql set search_path='' as $$ begin
  if (new.organization_id,new.contact_id,new.whatsapp_account_id) is distinct from
    (old.organization_id,old.contact_id,old.whatsapp_account_id) and exists(
      select 1 from public.messages where organization_id=old.organization_id and conversation_id=old.id) then
    raise exception 'A conversation with messages cannot change customer or account route';
  end if;
  return new;
end $$;
drop trigger if exists guard_conversation_route on public.conversations;
create trigger guard_conversation_route before update of organization_id,contact_id,whatsapp_account_id on public.conversations
for each row execute function public.guard_conversation_route();
revoke all on function public.guard_conversation_route() from public;

-- Both refresh and realtime hydration use this database projection. Stable id is
-- contact_id, never the latest route id. NULL legacy history joins the same thread.
-- A disabled latest inbound route is deliberately NOT replaced with a default.
create or replace view public.customer_threads with (security_invoker=true) as
select ct.id,ct.organization_id,ct.id contact_id,
  route.id route_conversation_id,route.whatsapp_account_id,route.mode,route.assigned_to,
  route.version,route.last_inbound_at,
  totals.unread,totals.welcome_sent,totals.created_at,totals.subthread_ids,
  coalesce(latest.created_at,totals.created_at) updated_at,
  coalesce(nullif(latest.body,''),'['||latest.kind||']','') preview,
  totals.routes
from public.contacts ct
join lateral (
  select c.* from public.conversations c
  where c.organization_id=ct.organization_id and c.contact_id=ct.id
  order by c.last_inbound_at desc nulls last,
    (c.whatsapp_account_id is not null) desc,c.created_at,c.id limit 1
) route on true
join lateral (
  select sum(c.unread)::integer unread,bool_or(c.welcome_sent) welcome_sent,
    min(c.created_at) created_at,array_agg(c.id order by c.created_at,c.id) subthread_ids,
    jsonb_agg(jsonb_build_object('id',c.id,'whatsapp_account_id',c.whatsapp_account_id,
      'last_inbound_at',c.last_inbound_at,'mode',c.mode,'assigned_to',c.assigned_to,
      'version',c.version,'welcome_sent',c.welcome_sent) order by c.created_at,c.id) routes
  from public.conversations c where c.organization_id=ct.organization_id and c.contact_id=ct.id
) totals on true
left join lateral (
  select m.body,m.kind,m.created_at from public.messages m
  join public.conversations c on c.organization_id=m.organization_id and c.id=m.conversation_id
  where c.organization_id=ct.organization_id and c.contact_id=ct.id
    and (c.cleared_at is null or m.created_at>c.cleared_at)
  order by m.created_at desc,m.id desc limit 1
) latest on true;
revoke all on public.customer_threads from anon;
grant select on public.customer_threads to authenticated;
create index if not exists conversations_customer_routes_idx
  on public.conversations(organization_id,contact_id,last_inbound_at desc);

-- One transactional ingestion implementation for Meta AND n8n. Unique meta ID is
-- the final guard; locks serialize welcome/new-contact/unread and event races.
create or replace function public.ingest_whatsapp_message(
  p_org uuid,p_account uuid,p_phone text,p_name text,p_meta text,p_kind text,
  p_body text,p_media text,p_timestamp timestamptz,p_mode text,p_payload jsonb default '{}'
) returns jsonb language plpgsql set search_path='' as $$
declare ct public.contacts; cv public.conversations; msg public.messages;
  existed boolean; welcome boolean; existing_route uuid;
begin
  if p_meta is null or length(trim(p_meta))=0 then raise exception 'Meta message ID required'; end if;
  p_phone:=regexp_replace(trim(p_phone),'[[:space:]()-]','','g');
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid international phone'; end if;
  if not exists(select 1 from public.whatsapp_accounts where id=p_account and organization_id=p_org and is_active) then
    raise exception 'Unknown or disabled WhatsApp route';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_meta));
  select * into msg from public.messages where meta_message_id=p_meta;
  if found then
    if msg.organization_id<>p_org or msg.direction<>'in' or msg.whatsapp_account_id is distinct from p_account
      or not exists(select 1 from public.conversations c join public.contacts t
        on t.id=c.contact_id and t.organization_id=c.organization_id
        where c.id=msg.conversation_id and c.organization_id=p_org and t.phone=p_phone) then
      raise exception 'Meta message identity conflicts with existing route';
    end if;
    return jsonb_build_object('duplicate',true,'message',to_jsonb(msg));
  end if;
  perform pg_advisory_xact_lock(hashtext(p_org::text||':'||p_phone));
  select exists(select 1 from public.contacts where organization_id=p_org and phone=p_phone) into existed;
  insert into public.contacts(organization_id,name,phone,source)
  values(p_org,coalesce(nullif(trim(p_name),''),p_phone),p_phone,'whatsapp')
  on conflict(organization_id,phone) do update set
    name=case when excluded.name<>excluded.phone and (contacts.source='whatsapp' or contacts.name=contacts.phone)
      then excluded.name else contacts.name end,updated_at=now()
  returning * into ct;
  -- Lock order: contact, account-subthread advisory, then row. Shared by UI/worker.
  select id into existing_route from public.conversations
    where organization_id=p_org and contact_id=ct.id and whatsapp_account_id=p_account;
  if existing_route is not null then perform pg_advisory_xact_lock(hashtext(existing_route::text)); end if;
  welcome:=not exists(select 1 from public.conversations
    where organization_id=p_org and contact_id=ct.id and welcome_sent);
  insert into public.conversations(organization_id,contact_id,whatsapp_account_id,mode,welcome_sent,cleared_at)
  values(p_org,ct.id,p_account,case when exists(select 1 from public.conversations
    where organization_id=p_org and contact_id=ct.id and mode='human') then 'human' else p_mode end,not welcome,
    (select max(cleared_at) from public.conversations where organization_id=p_org and contact_id=ct.id))
  on conflict(organization_id,whatsapp_account_id,contact_id) where whatsapp_account_id is not null
    do update set contact_id=excluded.contact_id
  returning * into cv;
  insert into public.messages(organization_id,conversation_id,direction,kind,body,status,
    sender_name,meta_message_id,media_id,created_at,payload)
  values(p_org,cv.id,'in',p_kind,p_body,'received',ct.name,p_meta,p_media,p_timestamp,p_payload)
  returning * into msg;
  update public.conversations set
    unread=unread+case when cleared_at is null or p_timestamp>cleared_at then 1 else 0 end,
    last_inbound_at=greatest(last_inbound_at,p_timestamp),
    preview=case when (cleared_at is null or p_timestamp>cleared_at) and not exists(
      select 1 from public.messages where organization_id=p_org and conversation_id=cv.id
        and (created_at,id)>(msg.created_at,msg.id)) then p_body else preview end,
    updated_at=greatest(updated_at,p_timestamp),version=version+1,welcome_sent=true
  where id=cv.id and organization_id=p_org returning * into cv;
  update public.ai_sessions set status='cancelled' where organization_id=p_org
    and conversation_id=cv.id and status in('queued','generating');
  update public.messages set status='cancelled' where organization_id=p_org
    and conversation_id=cv.id and sender_name='Open Chet AI' and status='queued';
  insert into public.notifications(organization_id,conversation_id,body)
    values(p_org,cv.id,'New message from '||ct.name);
  return jsonb_build_object('duplicate',false,'contact',to_jsonb(ct),
    'conversation',to_jsonb(cv),'message',to_jsonb(msg),'new_contact',not existed,'should_send_welcome',welcome);
end $$;

-- Durable bridge intent: never acknowledge an inbound event and silently lose
-- its n8n handoff. Unknown delivery outcomes are visible and never blindly resent.
create table if not exists public.n8n_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null,
  meta_message_id text not null unique references public.messages(meta_message_id),
  payload jsonb not null,
  status text not null default 'pending' check(status in('pending','sending','delivered','unknown','cancelled')),
  error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(organization_id,conversation_id) references public.conversations(organization_id,id)
);
alter table public.n8n_deliveries enable row level security;
revoke all on public.n8n_deliveries from public,anon,authenticated;
create index if not exists n8n_deliveries_pending_idx on public.n8n_deliveries(status,created_at);
revoke all on function public.ingest_whatsapp_message(uuid,uuid,text,text,text,text,text,text,timestamptz,text,jsonb)
  from public,anon,authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.ingest_whatsapp_message(uuid,uuid,text,text,text,text,text,text,timestamptz,text,jsonb) to service_role;
    grant select on public.customer_threads to service_role;
    grant select,insert,update,delete on public.n8n_deliveries to service_role;
  end if;
end $$;

-- Contact-name changes must invalidate the same hydration as message events.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='contacts') then
    alter publication supabase_realtime add table public.contacts;
  end if;
end $$;
