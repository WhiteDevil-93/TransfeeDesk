-- Replace broad anon policies: every request must carry the server-only x-app-secret header.
create extension if not exists pgcrypto with schema extensions;
create or replace function public.is_app_server() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(encode(extensions.digest(coalesce(current_setting('request.headers', true)::json->>'x-app-secret',''), 'sha256'), 'hex') = 'REPLACE_WITH_SHA256_OF_APP_DB_SECRET', false)
$$;
revoke all on function public.is_app_server() from public;
grant execute on function public.is_app_server() to anon;
drop policy if exists srv_users on users; drop policy if exists srv_sessions on sessions; drop policy if exists srv_referrals on referrals;
drop policy if exists srv_settings on settings; drop policy if exists srv_audit_ins on audit_log; drop policy if exists srv_audit_sel on audit_log;
drop policy if exists app_users on users; drop policy if exists app_sessions on sessions; drop policy if exists app_referrals on referrals;
drop policy if exists app_settings on settings; drop policy if exists app_audit_ins on audit_log; drop policy if exists app_audit_sel on audit_log;
create policy app_users on users for all to anon using (public.is_app_server()) with check (public.is_app_server());
create policy app_sessions on sessions for all to anon using (public.is_app_server()) with check (public.is_app_server());
create policy app_referrals on referrals for all to anon using (public.is_app_server()) with check (public.is_app_server());
create policy app_settings on settings for all to anon using (public.is_app_server()) with check (public.is_app_server());
create policy app_audit_ins on audit_log for insert to anon with check (public.is_app_server());
create policy app_audit_sel on audit_log for select to anon using (public.is_app_server());
-- audit log: no update/delete for API roles at all
revoke update, delete, truncate on audit_log from anon, authenticated;
revoke all on users, sessions, referrals, settings, audit_log from authenticated;
