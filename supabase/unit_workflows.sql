-- Replace REPLACE_WITH_OWNER_USERNAME with the owner's username before applying
-- (script/setup-local-db.sh does this). Every other global admin is demoted below,
-- so the file refuses to run with the placeholder still in place.
do $$ begin
  if 'REPLACE_WITH_OWNER_USERNAME' like 'REPLACE\_WITH\_%' then
    raise exception 'Set the owner username in unit_workflows.sql before applying it';
  end if;
end $$;
alter table users drop constraint if exists users_role_check;
-- 'referrer' is included so re-running this file after migration_referrers.sql keeps existing referrer rows valid.
alter table users add constraint users_role_check check(role in ('admin','unit_admin','clinician','referrer'));
alter table users add column if not exists team text check(team in ('MEU','TEU','SEU'));
alter table users add column if not exists phone text not null default '';
-- The owner is the sole global administrator. Existing other admins become
-- unit consultants and must be assigned a unit by the owner.
delete from sessions where user_id in (select id from users where role='admin' and username<>'REPLACE_WITH_OWNER_USERNAME');
update users set role='unit_admin' where role='admin' and username<>'REPLACE_WITH_OWNER_USERNAME';
-- Existing cases deliberately remain unassigned; only the global admin can see them.
alter table referrals add column if not exists team text check(team in ('MEU','TEU','SEU'));
alter table referrals add column if not exists consult_type text not null default 'transfer' check(consult_type in ('transfer','advice'));
alter table referrals add column if not exists portal_hash text;
alter table referrals add column if not exists opened_at timestamptz;
alter table referrals add column if not exists opened_by text;
alter table referrals add column if not exists latest_followup_at timestamptz;
alter table referrals add column if not exists followup_seen_at timestamptz;
create index if not exists referrals_team_idx on referrals(team,created_at desc);
create table if not exists referral_followups (
 id bigserial primary key, referral_id bigint not null references referrals(id) on delete cascade,
 created_at timestamptz not null default now(), author text not null, user_id bigint,
 kind text not null check(kind in ('update','advice','decision')), body text not null
);
create table if not exists referral_images (
 id bigserial primary key, referral_id bigint not null references referrals(id) on delete cascade,
 followup_id bigint references referral_followups(id) on delete cascade,
 created_at timestamptz not null default now(), name text not null, mime text not null,
 cipher text not null, iv text not null, tag text not null
);
create table if not exists unit_rosters (
 team text not null check(team in ('MEU','TEU','SEU')), day date not null,
 entries jsonb not null default '[]', updated_by text not null, updated_at timestamptz not null default now(),
 primary key(team,day)
);
alter table referral_followups enable row level security;
alter table referral_images enable row level security;
alter table unit_rosters enable row level security;
drop policy if exists app_followups on referral_followups;
drop policy if exists app_images on referral_images;
drop policy if exists app_unit_rosters on unit_rosters;
create policy app_followups on referral_followups for all to anon using(public.is_app_server()) with check(public.is_app_server());
create policy app_images on referral_images for all to anon using(public.is_app_server()) with check(public.is_app_server());
create policy app_unit_rosters on unit_rosters for all to anon using(public.is_app_server()) with check(public.is_app_server());
-- Atomic follow-up + attachment write. Keeps original referral history immutable.
create or replace function public.append_followup(p_referral bigint,p_author text,p_user bigint,p_kind text,p_body text,p_images jsonb)
returns bigint language plpgsql security invoker as $$
declare fid bigint; im jsonb;
begin
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
  portal_hash=null,purged_at=now() where id=any(ids);
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.purge_clinical_data(int) from public,authenticated;
grant execute on function public.purge_clinical_data(int) to anon;
create or replace function public.record_response(p_referral bigint,p_status text,p_body text,p_author text,p_user bigint,p_remind timestamptz)
returns void language plpgsql security invoker as $$
begin
 if p_status not in ('pending','accepted','declined','waiting','advised') then raise exception 'Invalid status'; end if;
 if p_status='advised' and length(trim(p_body))<1 then raise exception 'Advice is required'; end if;
 update referrals set status=p_status,decision_note=p_body,decided_by=p_author,decided_at=now(),
  remind_at=case when p_status='waiting' then p_remind else null end,
  ack_at=coalesce(ack_at,now()),ack_by=case when ack_at is null then p_author else ack_by end
 where id=p_referral and purged_at is null;
 if not found then raise exception 'Referral unavailable'; end if;
 insert into referral_followups(referral_id,author,user_id,kind,body)
 values(p_referral,p_author,p_user,case when p_status='advised' then 'advice' else 'decision' end,
  case when trim(p_body)='' then 'Referral '||p_status else p_body end);
end $$;
revoke all on function public.record_response(bigint,text,text,text,bigint,timestamptz) from public,authenticated;
grant execute on function public.record_response(bigint,text,text,text,bigint,timestamptz) to anon;
