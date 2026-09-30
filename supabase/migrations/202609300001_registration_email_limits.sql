-- Only Lístoček's custom email sender uses these objects. No Auth settings change.
create table public.listocek_registration_email_limits (
  key text primary key,
  window_started_at timestamptz not null,
  last_sent_at timestamptz not null,
  attempts integer not null
);
alter table public.listocek_registration_email_limits enable row level security;
revoke all on public.listocek_registration_email_limits from public, anon, authenticated;

create or replace function public.listocek_reserve_registration_email(email_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  stamp timestamptz := clock_timestamp();
  email_key text := 'email:' || email_hash;
  bucket public.listocek_registration_email_limits;
begin
  if email_hash is null or email_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid email hash';
  end if;
  -- Serialize all reservations, including concurrent first requests for the same email.
  perform pg_advisory_xact_lock(609300001);
  delete from public.listocek_registration_email_limits where last_sent_at < stamp - interval '2 hours';
  select * into bucket from public.listocek_registration_email_limits where key = email_key;
  if found and (bucket.last_sent_at > stamp - interval '60 seconds'
    or (bucket.window_started_at > stamp - interval '1 hour' and bucket.attempts >= 5)) then
    return false;
  end if;
  select * into bucket from public.listocek_registration_email_limits where key = 'global';
  if found and bucket.window_started_at > stamp - interval '1 hour' and bucket.attempts >= 100 then
    return false;
  end if;
  insert into public.listocek_registration_email_limits as limits (key, window_started_at, last_sent_at, attempts)
  values (email_key, stamp, stamp, 1), ('global', stamp, stamp, 1)
  on conflict (key) do update set
    attempts = case when limits.window_started_at <= stamp - interval '1 hour' then 1 else limits.attempts + 1 end,
    window_started_at = case when limits.window_started_at <= stamp - interval '1 hour' then stamp else limits.window_started_at end,
    last_sent_at = stamp;
  return true;
end;
$$;
revoke all on function public.listocek_reserve_registration_email(text) from public, anon, authenticated;
grant execute on function public.listocek_reserve_registration_email(text) to service_role;
