-- Referrer profile columns and a wider retention purge. Safe to re-run.
-- Apply after migration_chat_push.sql.

-- The sign-up and profile forms collect these; earlier migrations never created them.
alter table users add column if not exists hospital text not null default '';
alter table users add column if not exists department text not null default '';

-- The purge also clears free-text fields that can describe where the patient
-- is or which bed they were given, not only the clinical narrative.
create or replace function public.purge_clinical_data(p_days int) returns bigint
language plpgsql security invoker as $$
declare ids bigint[]; n bigint;
begin
 select array_agg(id) into ids from referrals where created_at < now()-make_interval(days=>p_days) and purged_at is null;
 if ids is null then return 0; end if;
 delete from referral_images where referral_id=any(ids);
 delete from referral_followups where referral_id=any(ids);
 delete from push_subscriptions where referral_id=any(ids);
 update referrals set patient_initials='[purged]',folder_no='',age='',sex='',history='[purged]',exam='[purged]',
  investigations='[purged]',reason='[purged]',decision_note='',diagnosis='[purged]',lat='',lon='',loc_source='',
  current_location='',bed_needed='',bed_ward='',
  portal_hash=null,awaiting_info_at=null,purged_at=now() where id=any(ids);
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.purge_clinical_data(int) from public,authenticated;
grant execute on function public.purge_clinical_data(int) to anon;
