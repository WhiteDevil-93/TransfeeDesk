-- Referrer (referring clinician) accounts + HPCSA verification state.
-- Referrers use the same users table; the new role gives them the referral
-- PWA: they create consults, see the full on-call roster, and never see
-- patient data of other referrers. Verification: hpcsa_number match against
-- the scraped register = auto-approved; otherwise staff-card photo + owner.
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check(role in ('admin','unit_admin','clinician','referrer'));
-- Referrer profile (autofilled into the consult form) + verification state.
alter table users add column if not exists email text not null default '';
create index if not exists users_email_idx on users(email);
alter table users add column if not exists specialty text not null default '';
alter table users add column if not exists profession text check(profession in ('doctor','nurse','other'));
alter table users add column if not exists hpcsa_number text not null default '';
alter table users add column if not exists card_cipher text;  -- AES-256-GCM, same key as referral images
alter table users add column if not exists card_iv text;
alter table users add column if not exists card_tag text;
alter table users add column if not exists verify_status text not null default 'none' check(verify_status in ('none','hpcsa','card_pending','verified'));
alter table users add column if not exists verified_at timestamptz;
create index if not exists users_referrer_idx on users(role) where role = 'referrer';
-- Referrals created by a referrer's PWA session (instead of the public form).
alter table referrals add column if not exists referrer_id bigint references users(id) on delete set null;
create index if not exists referrals_referrer_idx on referrals(referrer_id);
