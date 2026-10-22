-- HPCSA iRegister snapshot, refreshed by script/hpcsa-scrape.ts every 14 days.
-- Public register data (name, reg number, profession category, city, status) —
-- not personal clinical data, but still gated behind the server header so the
-- browser never talks to it directly.
create table if not exists hpcsa_register (
  id bigserial primary key,
  surname text not null,
  full_name text not null,
  registration_number text unique not null,
  hpcsa_number text not null default '',
  categories text not null default '',
  city text not null default '',
  postal_code text not null default '',
  status text not null default '',
  source text not null default 'iregister',
  scraped_at timestamptz not null default now()
);
create index if not exists hpcsa_surname_idx on hpcsa_register(surname);
create index if not exists hpcsa_number_idx on hpcsa_register(hpcsa_number);
-- Unregistered practitioners (no HPCSA number) get a synthetic NOREG_<name>
-- key in registration_number, so the same unique column covers both cases.
alter table hpcsa_register enable row level security;
do $$ begin
  create policy app_hpcsa on hpcsa_register for all to anon using (public.is_app_server()) with check (public.is_app_server());
exception when duplicate_object then null; end $$;
revoke all on hpcsa_register from authenticated;
