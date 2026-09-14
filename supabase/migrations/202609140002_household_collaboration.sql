alter table public.household_members
  add column if not exists display_name text not null default 'Člen'
  check (length(trim(display_name)) between 2 and 50);

update public.household_members as member
set display_name = case
  when length(split_part(account.email, '@', 1)) between 2 and 50 then split_part(account.email, '@', 1)
  else 'Člen'
end
from auth.users as account
where account.id = member.user_id and member.display_name = 'Člen';

alter table public.shopping_items
  add column if not exists purchased_by uuid references auth.users(id) on delete set null;

create policy "members update own profile" on public.household_members
for update using (user_id = auth.uid())
with check (user_id = auth.uid() and public.is_household_member(household_id));

create or replace function public.create_household(household_name text, member_name text)
returns public.households language plpgsql security definer set search_path = public
as $$
declare result public.households;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je povinné'; end if;
  if length(trim(member_name)) not between 2 and 50 then raise exception 'Meno musí mať 2 až 50 znakov'; end if;
  insert into households(name, created_by) values (coalesce(nullif(trim(household_name), ''), 'Náš nákup'), auth.uid()) returning * into result;
  insert into household_members(household_id, user_id, display_name) values (result.id, auth.uid(), trim(member_name));
  return result;
end $$;

create or replace function public.join_household(code text, member_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je povinné'; end if;
  if length(trim(member_name)) not between 2 and 50 then raise exception 'Meno musí mať 2 až 50 znakov'; end if;
  select id into target_id from households where invite_code = upper(trim(code));
  if target_id is null then raise exception 'Neplatný pozývací kód'; end if;
  insert into household_members(household_id, user_id, display_name)
  values (target_id, auth.uid(), trim(member_name))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return target_id;
end $$;

alter publication supabase_realtime add table public.household_members;
