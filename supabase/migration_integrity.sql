-- Schema the application already depends on, plus retention and identity
-- guards. Safe to re-run. Apply after migration_referrers.sql.

-- Referral location provenance (read by the queue projection and the purge).
alter table referrals add column if not exists loc_source text;

-- Purged referrals must not accept new follow-ups or images, whichever caller
-- reaches the database.
create or replace function public.append_followup(p_referral bigint,p_author text,p_user bigint,p_kind text,p_body text,p_images jsonb)
returns bigint language plpgsql security invoker as $$
declare fid bigint; im jsonb;
begin
 perform 1 from referrals where id=p_referral and purged_at is null for update;
 if not found then raise exception 'Referral unavailable'; end if;
 insert into referral_followups(referral_id,author,user_id,kind,body)
 values(p_referral,p_author,p_user,p_kind,p_body) returning id into fid;
 for im in select * from jsonb_array_elements(p_images) loop
  insert into referral_images(referral_id,followup_id,name,mime,cipher,iv,tag)
  values(p_referral,fid,im->>'name',im->>'mime',im->>'cipher',im->>'iv',im->>'tag');
 end loop;
 if p_kind='update' then update referrals set latest_followup_at=now() where id=p_referral; end if;
 return fid;
end $$;
revoke all on function public.append_followup(bigint,text,bigint,text,text,jsonb) from public,authenticated;
grant execute on function public.append_followup(bigint,text,bigint,text,text,jsonb) to anon;

-- Register numbers are matched exactly after removing whitespace and
-- upper-casing; older imports stored them as published ("MP 0123456").
update hpcsa_register set hpcsa_number=upper(regexp_replace(hpcsa_number,'\s+','','g'))
 where hpcsa_number<>upper(regexp_replace(hpcsa_number,'\s+','','g'));

-- One account per email address. Stops here, before creating the index, if
-- existing accounts share an address so they can be resolved first.
do $$
declare dupes text;
begin
 select string_agg(email, ', ') into dupes from (
  select lower(email) as email from users where email<>'' group by lower(email) having count(*)>1) d;
 if dupes is not null then
  raise exception 'Resolve accounts sharing these email addresses before re-running: %', dupes;
 end if;
end $$;
update users set email=lower(trim(email)) where email<>lower(trim(email));
create unique index if not exists users_email_unique on users(lower(email)) where email<>'';
