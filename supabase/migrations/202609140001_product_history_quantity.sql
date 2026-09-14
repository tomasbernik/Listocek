alter table public.product_history
  add column if not exists preferred_quantity text
  check (preferred_quantity is null or length(preferred_quantity) <= 40);

create or replace function public.record_product_use(
  target_household uuid,
  product_name text,
  product_shop text default null,
  product_quantity text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare normalized text := lower(trim(product_name));
begin
  if not public.is_household_member(target_household) then raise exception 'Prístup zamietnutý'; end if;
  insert into product_history(household_id, normalized_name, display_name, preferred_shop, preferred_quantity)
  values (target_household, normalized, trim(product_name), product_shop, nullif(trim(product_quantity), ''))
  on conflict (household_id, normalized_name) do update set
    use_count = product_history.use_count + 1,
    display_name = excluded.display_name,
    preferred_shop = coalesce(excluded.preferred_shop, product_history.preferred_shop),
    preferred_quantity = coalesce(excluded.preferred_quantity, product_history.preferred_quantity),
    last_used_at = now();
end $$;
