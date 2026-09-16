-- Additive change: preserve existing products and historical messages.
alter table public.products
 add column brand text not null default '',
 add column composition text not null default '',
 add column strength text not null default '',
 add column form_type text not null default '',
 add column pack_size text not null default '',
 add column notes text not null default '',
 add column featured boolean not null default false,
 add column availability text not null default 'in_stock'
 check (availability in ('in_stock','out_of_stock','on_request'));
alter table public.messages add column product_snapshot jsonb;
create index products_category_idx on public.products(organization_id,category);
create index products_brand_idx on public.products(organization_id,brand);
