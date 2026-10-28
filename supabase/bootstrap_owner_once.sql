-- ONE-TIME, DESTRUCTIVE: run once when moving an existing database to unit
-- workflows. Signs out and demotes every global admin except the owner.
-- Do not include in routine migration runs.
--   psql -v owner=thendricks -f supabase/bootstrap_owner_once.sql
\if :{?owner}
\else
  \echo 'Set the owner username: psql -v owner=<username> -f supabase/bootstrap_owner_once.sql'
  \quit
\endif
begin;
delete from sessions where user_id in (select id from users where role='admin' and username<>:'owner');
update users set role='unit_admin' where role='admin' and username<>:'owner';
commit;
