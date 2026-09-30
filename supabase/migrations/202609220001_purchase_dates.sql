alter table public.shopping_items
  add column if not exists purchased_at timestamptz;

-- Existing checked items have no exact purchase timestamp. Their last update is
-- the closest reliable value and keeps them grouped sensibly after deployment.
update public.shopping_items
set purchased_at = updated_at
where checked and purchased_at is null;

-- Keep the timestamp correct for every write path, including the reliable-sync
-- RPC introduced in the previous migration and older queued operations.
create or replace function public.set_shopping_item_purchase_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.checked then
    if new.purchased_at is null then
      new.purchased_at := now();
    end if;
  else
    new.purchased_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists shopping_items_purchase_date on public.shopping_items;
create trigger shopping_items_purchase_date
before insert or update of checked, purchased_at on public.shopping_items
for each row execute function public.set_shopping_item_purchase_date();

create index if not exists shopping_items_household_purchase_idx
  on public.shopping_items (household_id, purchased_at desc)
  where checked;
