-- TransferDesk schema (POPIA-oriented). Access only via the server; RLS on.
create table if not exists users (
  id bigserial primary key, username text unique not null, name text not null,
  role text not null default 'clinician' check (role in ('admin','clinician')),
  pass_hash text not null, active boolean not null default true, must_change boolean not null default true,
  failed int not null default 0, locked_until timestamptz, created_at timestamptz not null default now(), last_login timestamptz);
create table if not exists sessions (
  id text primary key, user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(), last_seen timestamptz not null default now(), expires_at timestamptz not null);
create table if not exists referrals (
  id bigserial primary key, ref text unique not null, created_at timestamptz not null default now(),
  doctor_name text, hospital text, department text, phone text, email text,
  specialty text, current_location text, bed_needed text, lat text, lon text,
  patient_initials text, age text, sex text, folder_no text, diagnosis text,
  history text, exam text, investigations text, reason text,
  suggested_priority text, priority text, status text not null default 'pending',
  decision_note text default '', decided_by text default '', decided_at timestamptz,
  bed_status text default 'Not assigned', bed_ward text default '', remind_at timestamptz,
  ack_by text default '', ack_at timestamptz, consent boolean not null default false, purged_at timestamptz);
create index if not exists referrals_created_idx on referrals(created_at desc);
create table if not exists audit_log (
  id bigserial primary key, at timestamptz not null default now(), user_id bigint, user_name text,
  action text not null, referral_id bigint, detail text default '', ip text default '');
create index if not exists audit_at_idx on audit_log(at desc);
create table if not exists settings (k text primary key, v jsonb not null);
alter table users enable row level security; alter table sessions enable row level security;
alter table referrals enable row level security; alter table audit_log enable row level security; alter table settings enable row level security;
-- No policies are created here: with RLS on, every table denies the API roles
-- until migration_lockdown.sql adds the x-app-secret policies.
