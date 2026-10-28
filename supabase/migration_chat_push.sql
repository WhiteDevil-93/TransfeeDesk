-- Referral chat (questions from the receiving team, replies from the referrer)
-- and push notifications. Safe to re-run. Apply after migration_integrity.sql.

-- Chat messages live in the same append-only timeline as follow-ups, so they are
-- exported, audited and purged together with the rest of the referral.
alter table referral_followups drop constraint if exists referral_followups_kind_check;
alter table referral_followups add constraint referral_followups_kind_check
 check(kind in ('update','advice','decision','question','reply'));

-- Set while the receiving team is waiting for the referrer to supply information.
alter table referrals add column if not exists awaiting_info_at timestamptz;

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
 if p_kind in ('update','reply') then
  update referrals set latest_followup_at=now(),awaiting_info_at=null where id=p_referral;
 elsif p_kind='question' then
  update referrals set awaiting_info_at=now() where id=p_referral;
 end if;
 return fid;
end $$;
revoke all on function public.append_followup(bigint,text,bigint,text,text,jsonb) from public,authenticated;
grant execute on function public.append_followup(bigint,text,bigint,text,text,jsonb) to anon;

-- A decline or advice-only answer closes the consult, so an open question is no
-- longer waiting on the referrer.
create or replace function public.record_response(p_referral bigint,p_status text,p_body text,p_author text,p_user bigint,p_remind timestamptz)
returns void language plpgsql security invoker as $$
begin
 if p_status not in ('pending','accepted','declined','waiting','advised') then raise exception 'Invalid status'; end if;
 if p_status='advised' and length(trim(p_body))<1 then raise exception 'Advice is required'; end if;
 update referrals set status=p_status,decision_note=p_body,decided_by=p_author,decided_at=now(),
  remind_at=case when p_status='waiting' then p_remind else null end,
  awaiting_info_at=case when p_status in ('declined','advised') then null else awaiting_info_at end,
  ack_at=coalesce(ack_at,now()),ack_by=case when ack_at is null then p_author else ack_by end
 where id=p_referral and purged_at is null;
 if not found then raise exception 'Referral unavailable'; end if;
 insert into referral_followups(referral_id,author,user_id,kind,body)
 values(p_referral,p_author,p_user,case when p_status='advised' then 'advice' else 'decision' end,
  case when trim(p_body)='' then 'Referral '||p_status else p_body end);
end $$;
revoke all on function public.record_response(bigint,text,text,text,bigint,timestamptz) from public,authenticated;
grant execute on function public.record_response(bigint,text,text,text,bigint,timestamptz) to anon;

-- Browser push subscriptions: a signed-in account (staff or referrer) or one
-- referral reached through the follow-up portal, never both.
create table if not exists push_subscriptions (
 id bigserial primary key,
 endpoint text not null unique,
 p256dh text not null, auth text not null,
 user_id bigint references users(id) on delete cascade,
 referral_id bigint references referrals(id) on delete cascade,
 created_at timestamptz not null default now(),
 check((user_id is null) <> (referral_id is null))
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
create index if not exists push_subscriptions_referral_idx on push_subscriptions(referral_id);

-- One row per notification already sent, so a restart or a second server never
-- sends the same alert twice.
create table if not exists push_sent (
 key text primary key,
 sent_at timestamptz not null default now()
);
create index if not exists push_sent_at_idx on push_sent(sent_at);

alter table push_subscriptions enable row level security;
alter table push_sent enable row level security;
drop policy if exists app_push_subscriptions on push_subscriptions;
drop policy if exists app_push_sent on push_sent;
create policy app_push_subscriptions on push_subscriptions for all to anon using(public.is_app_server()) with check(public.is_app_server());
create policy app_push_sent on push_sent for all to anon using(public.is_app_server()) with check(public.is_app_server());
revoke all on push_subscriptions, push_sent from authenticated;

-- Purged referrals lose their portal push subscriptions along with the portal code.
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
  portal_hash=null,awaiting_info_at=null,purged_at=now() where id=any(ids);
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.purge_clinical_data(int) from public,authenticated;
grant execute on function public.purge_clinical_data(int) to anon;
