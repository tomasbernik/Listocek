-- Neon Data API does not add Supabase's implicit table grants. RLS policies
-- still decide which rows an authenticated user can see or update.
grant usage on schema public to authenticated;

grant select on table
  public.households,
  public.household_members,
  public.shopping_items,
  public.product_history
to authenticated;

grant update (display_name) on table public.household_members to authenticated;

-- Household and shopping-list writes are intentionally exposed only through
-- security-definer RPCs that validate auth.user_id() and membership.
revoke execute on function public.create_household(text) from public;
revoke execute on function public.create_household(text, text) from public;
revoke execute on function public.join_household(text) from public;
revoke execute on function public.join_household(text, text) from public;
revoke execute on function public.leave_household(uuid) from public;
revoke execute on function public.rename_household(uuid, text) from public;
revoke execute on function public.apply_shopping_operation(jsonb) from public;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.rename_household(uuid, text) to authenticated;
grant execute on function public.apply_shopping_operation(jsonb) to authenticated;
