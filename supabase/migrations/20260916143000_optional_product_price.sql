-- Prices are optional. Existing positive prices remain unchanged; historical zero placeholders become null.
alter table public.products alter column price drop not null;
alter table public.products alter column price drop default;
update public.products set price = null where price = 0;

-- Keep catalogue page reads fast as catalogues grow beyond the inbox bootstrap size.
create index if not exists products_catalogue_browse_idx
  on public.products(organization_id, category, name, id);
