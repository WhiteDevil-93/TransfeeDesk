-- Schema and retention fixes. Safe to re-run. Apply after migration_referrers.sql.

-- The server reads and writes referrals.loc_source (queue projection, purge, location edits),
-- but no earlier migration created it.
alter table referrals add column if not exists loc_source text;

-- Referrer profile fields that the sign-up and profile forms already collect.
alter table users add column if not exists hospital text not null default '';
alter table users add column if not exists department text not null default '';

-- One account per email. Skipped (with a notice) if existing rows already collide,
-- so the duplicates can be resolved by hand first.
do $$ begin
  if exists (select 1 from users where email <> '' group by email having count(*) > 1) then
    raise notice 'users_email_unique not created: resolve duplicate emails, then re-run this migration';
  else
    create unique index if not exists users_email_unique on users(email) where email <> '';
  end if;
end $$;

-- Retention purge also clears free-text fields that can describe the patient's
-- location or bed, not only the clinical narrative.
create or replace function public.purge_clinical_data(p_days int) returns bigint
language plpgsql security invoker as $$
declare ids bigint[]; n bigint;
begin
 select array_agg(id) into ids from referrals where created_at < now()-make_interval(days=>p_days) and purged_at is null;
 if ids is null then return 0; end if;
 delete from referral_images where referral_id=any(ids);
 delete from referral_followups where referral_id=any(ids);
 update referrals set patient_initials='[purged]',folder_no='',age='',sex='',history='[purged]',exam='[purged]',
  investigations='[purged]',reason='[purged]',decision_note='',diagnosis='[purged]',lat='',lon='',loc_source='',
  current_location='',bed_needed='',bed_ward='',
  portal_hash=null,purged_at=now() where id=any(ids);
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.purge_clinical_data(int) from public,authenticated;
grant execute on function public.purge_clinical_data(int) to anon;
