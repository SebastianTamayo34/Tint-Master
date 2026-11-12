-- =========================================================
-- Tint Master Inc: Supabase database setup
--
-- Run this once in Supabase: Dashboard → SQL Editor → New query →
-- paste this whole file → Run. It is safe to run again.
--
-- What it sets up:
--   • appointments: every booking request from the website
--   • owners: which login accounts count as an owner
--   • Security rules (Row Level Security):
--       - the public website can only ADD a new appointment request
--       - nobody can READ appointments except a signed-in owner
-- =========================================================


-- ---------- Appointments ----------
create table if not exists public.appointments (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),

  -- customer
  name           text not null check (char_length(trim(name)) between 1 and 100),
  phone          text not null check (char_length(trim(phone)) between 1 and 40),
  email          text not null check (char_length(email) between 3 and 200 and email like '%@%'),

  -- where
  location       text not null default 'shop' check (location in ('shop', 'mobile')),
  mobile_address text check (mobile_address is null or char_length(mobile_address) <= 300),

  -- what
  service        text check (service is null or char_length(service) <= 100),
  film           text check (film is null or char_length(film) <= 100),
  shade          text check (shade is null or char_length(shade) <= 20),
  addons         text[] not null default '{}' check (cardinality(addons) <= 5),
  details        text check (details is null or char_length(details) <= 500),
  message        text check (message is null or char_length(message) <= 2000),

  -- when
  appt_date      date not null,
  start_hour     smallint not null check (start_hour in (9, 11, 13, 15)),
  time_slot      text not null check (char_length(time_slot) <= 40),

  -- owner workflow
  status         text not null default 'new'
                 check (status in ('new', 'confirmed', 'completed', 'cancelled')),

  -- business rules (these match the website form)
  constraint closed_sundays   check (extract(dow from appt_date) <> 0),
  constraint saturday_til_3pm check (extract(dow from appt_date) <> 6 or start_hour < 15),
  constraint mobile_needs_address
    check (location = 'shop' or char_length(trim(coalesce(mobile_address, ''))) > 0),
  constraint service_or_addon
    check (service is not null or cardinality(addons) > 0)
);

-- Rules added after the table was first created. "create table if not exists"
-- skips existing tables, so these are dropped and re-added to stay re-runnable.
-- "not valid" skips checking old rows; every new or edited row is still checked.
alter table public.appointments
  drop constraint if exists commercial_is_mobile;
alter table public.appointments
  add constraint commercial_is_mobile
  check (service is distinct from 'Commercial building tint' or location = 'mobile')
  not valid;

create index if not exists appointments_date_idx
  on public.appointments (appt_date, start_hour);


-- ---------- Owners ----------
-- A row here = that login account is an owner.
-- Add one after creating the owner's login (see SETUP.md, step 3).
create table if not exists public.owners (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- True when the person making the request is signed in AND listed in owners.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.owners where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to anon, authenticated;


-- ---------- Security rules ----------
alter table public.appointments enable row level security;
alter table public.owners       enable row level security;  -- no policies = no access from the website

-- Start clean so re-running this file doesn't stack duplicate rules.
drop policy if exists "public can request appointments" on public.appointments;
drop policy if exists "owners can view appointments"    on public.appointments;
drop policy if exists "owners can update appointments"  on public.appointments;
drop policy if exists "owners can delete appointments"  on public.appointments;

-- Anyone (the public booking form) may ADD a request, but only as status 'new',
-- and only for a date from today onward.
create policy "public can request appointments"
  on public.appointments for insert
  to anon, authenticated
  with check (status = 'new' and appt_date >= current_date);

-- Only owners may see, change, or delete appointments.
create policy "owners can view appointments"
  on public.appointments for select
  to authenticated
  using ((select public.is_owner()));

create policy "owners can update appointments"
  on public.appointments for update
  to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

create policy "owners can delete appointments"
  on public.appointments for delete
  to authenticated
  using ((select public.is_owner()));

-- Table permissions (Row Level Security above still applies on top of these).
revoke all on public.appointments from anon, authenticated;
grant insert on public.appointments to anon, authenticated;
grant select, update, delete on public.appointments to authenticated;
revoke all on public.owners from anon, authenticated;
