-- Apply each offline operation and its history update exactly once, even if
-- the connection drops after COMMIT and the phone retries the same operation.
create table public.shopping_operation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  household_id uuid not null references public.households(id) on delete cascade,
  applied_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.shopping_operation_receipts enable row level security;
revoke all on public.shopping_operation_receipts from anon, authenticated;

create function public.apply_shopping_operation(operation jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target uuid := (operation->>'householdId')::uuid;
  operation_id uuid := (operation->>'id')::uuid;
  kind text := operation->>'type';
  item_id uuid;
  item_data jsonb := operation->'item';
  creator uuid := auth.uid();
  saved public.shopping_items;
  affected integer;
begin
  if auth.uid() is null or not public.is_household_member(target) then raise exception 'Prístup zamietnutý'; end if;
  if kind is null or kind not in ('save', 'edit', 'toggle', 'remove') then raise exception 'Neplatná zmena'; end if;
  insert into shopping_operation_receipts(user_id, operation_id, household_id)
    values (auth.uid(), operation_id, target) on conflict do nothing;
  get diagnostics affected = row_count;
  if affected = 0 then return; end if;

  if kind = 'save' then
    item_id := (item_data->>'id')::uuid;
    if exists (select 1 from shopping_items where id = item_id and household_id <> target) then raise exception 'Prístup zamietnutý'; end if;
    if exists (select 1 from household_members where household_id = target and user_id = (item_data->>'createdBy')::uuid) then
      creator := (item_data->>'createdBy')::uuid;
    end if;
    insert into shopping_items(id, household_id, name, quantity, shop, checked, created_at, created_by, purchased_by)
      values (item_id, target, trim(item_data->>'name'), nullif(trim(item_data->>'quantity'), ''), item_data->>'shop',
        coalesce((item_data->>'checked')::boolean, false), coalesce((item_data->>'createdAt')::timestamptz, now()), creator,
        case when (item_data->>'checked')::boolean then coalesce(
          (select user_id from household_members where household_id = target and user_id = (item_data->>'purchasedBy')::uuid),
          auth.uid()) else null end)
      on conflict (id) do update set name = excluded.name, quantity = excluded.quantity, shop = excluded.shop, updated_at = now()
      where shopping_items.household_id = target
      returning * into saved;
  else
    item_id := (operation->>'itemId')::uuid;
    if item_id is null then raise exception 'Chýba položka'; end if;
    if kind = 'edit' then
      -- Editing details must not uncheck an item just purchased by another member.
      update shopping_items set name = trim(operation->>'name'), quantity = nullif(trim(operation->>'quantity'), ''),
        shop = operation->>'shop', updated_at = now()
        where id = item_id and household_id = target returning * into saved;
    elsif kind = 'toggle' then
      update shopping_items set checked = (operation->>'checked')::boolean,
        purchased_by = case when (operation->>'checked')::boolean then auth.uid() else null end, updated_at = now()
        where id = item_id and household_id = target;
    else
      delete from shopping_items where id = item_id and household_id = target;
    end if;
  end if;
  -- A concurrently deleted item stays deleted; an edit never recreates it.
  if coalesce((operation->>'recordHistory')::boolean, false) and saved.id is not null then
    perform public.record_product_use(target, saved.name, saved.shop, saved.quantity);
  end if;
end $$;
revoke all on function public.apply_shopping_operation(jsonb) from public;
grant execute on function public.apply_shopping_operation(jsonb) to authenticated;

create or replace function public.create_household(household_name text, member_name text)
returns public.households language plpgsql security definer set search_path = public
as $$
declare result public.households;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je povinné'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists (select 1 from household_members where user_id = auth.uid()) then raise exception 'Najprv opustite svoju aktuálnu domácnosť.'; end if;
  if member_name is null or length(trim(member_name)) not between 2 and 50 then raise exception 'Meno musí mať 2 až 50 znakov'; end if;
  if household_name is null or length(trim(household_name)) not between 1 and 60 then raise exception 'Názov domácnosti musí mať 1 až 60 znakov'; end if;
  insert into households(name, created_by) values (trim(household_name), auth.uid()) returning * into result;
  insert into household_members(household_id, user_id, display_name) values (result.id, auth.uid(), trim(member_name));
  return result;
end $$;

create or replace function public.join_household(code text, member_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je povinné'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if member_name is null or length(trim(member_name)) not between 2 and 50 then raise exception 'Meno musí mať 2 až 50 znakov'; end if;
  select id into target_id from households where invite_code = upper(trim(code));
  if target_id is null then raise exception 'Pozývací kód nie je platný.'; end if;
  if exists (select 1 from household_members where user_id = auth.uid() and household_id <> target_id) then raise exception 'Najprv opustite svoju aktuálnu domácnosť.'; end if;
  insert into household_members(household_id, user_id, display_name) values (target_id, auth.uid(), trim(member_name))
    on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return target_id;
end $$;

-- Keep old clients compatible without bypassing the single-household checks.
create or replace function public.create_household(household_name text default 'Náš nákup')
returns public.households language sql security definer set search_path = public
as $$ select public.create_household(household_name, 'Člen') $$;
create or replace function public.join_household(code text)
returns uuid language sql security definer set search_path = public
as $$ select public.join_household(code, 'Člen') $$;

create function public.leave_household(target_household uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Prihlásenie je povinné'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  delete from household_members where household_id = target_household and user_id = auth.uid();
  -- The household and its list remain available to the other members.
end $$;
revoke all on function public.leave_household(uuid) from public;
grant execute on function public.leave_household(uuid) to authenticated;

create function public.rename_household(target_household uuid, household_name text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household) then raise exception 'Prístup zamietnutý'; end if;
  if household_name is null or length(trim(household_name)) not between 1 and 60 then raise exception 'Názov domácnosti musí mať 1 až 60 znakov'; end if;
  update households set name = trim(household_name) where id = target_household;
end $$;
revoke all on function public.rename_household(uuid, text) from public;
grant execute on function public.rename_household(uuid, text) to authenticated;

alter publication supabase_realtime add table public.households;
