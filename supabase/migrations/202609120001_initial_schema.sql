create extension if not exists pgcrypto;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Náš nákup',
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  quantity text check (quantity is null or length(quantity) <= 40),
  shop text check (shop is null or length(shop) <= 60),
  checked boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_history (
  household_id uuid not null references public.households(id) on delete cascade,
  normalized_name text not null,
  display_name text not null,
  use_count integer not null default 1 check (use_count > 0),
  preferred_shop text,
  last_used_at timestamptz not null default now(),
  primary key (household_id, normalized_name)
);

create index shopping_items_household_checked_idx on public.shopping_items (household_id, checked, created_at desc);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.shopping_items enable row level security;
alter table public.product_history enable row level security;

create function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from household_members where household_id = target_household and user_id = auth.uid()) $$;

create policy "members read households" on public.households for select using (public.is_household_member(id));
create policy "users create households" on public.households for insert with check (created_by = auth.uid());
create policy "members read membership" on public.household_members for select using (public.is_household_member(household_id));
create policy "members read items" on public.shopping_items for select using (public.is_household_member(household_id));
create policy "members add items" on public.shopping_items for insert with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy "members edit items" on public.shopping_items for update using (public.is_household_member(household_id));
create policy "members delete items" on public.shopping_items for delete using (public.is_household_member(household_id));
create policy "members read history" on public.product_history for select using (public.is_household_member(household_id));
create policy "members add history" on public.product_history for insert with check (public.is_household_member(household_id));
create policy "members edit history" on public.product_history for update using (public.is_household_member(household_id));

create or replace function public.create_household(household_name text default 'Náš nákup')
returns public.households language plpgsql security definer set search_path = public
as $$
declare result public.households;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je povinné'; end if;
  insert into households(name, created_by) values (coalesce(nullif(trim(household_name), ''), 'Náš nákup'), auth.uid()) returning * into result;
  insert into household_members(household_id, user_id) values (result.id, auth.uid());
  return result;
end $$;

create or replace function public.join_household(code text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je povinné'; end if;
  select id into target_id from households where invite_code = upper(trim(code));
  if target_id is null then raise exception 'Neplatný pozývací kód'; end if;
  insert into household_members(household_id, user_id) values (target_id, auth.uid()) on conflict do nothing;
  return target_id;
end $$;

create or replace function public.record_product_use(target_household uuid, product_name text, product_shop text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare normalized text := lower(trim(product_name));
begin
  if not public.is_household_member(target_household) then raise exception 'Prístup zamietnutý'; end if;
  insert into product_history(household_id, normalized_name, display_name, preferred_shop)
  values (target_household, normalized, trim(product_name), product_shop)
  on conflict (household_id, normalized_name) do update set
    use_count = product_history.use_count + 1,
    display_name = excluded.display_name,
    preferred_shop = coalesce(excluded.preferred_shop, product_history.preferred_shop),
    last_used_at = now();
end $$;

alter publication supabase_realtime add table public.shopping_items;
