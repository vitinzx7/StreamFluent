-- Controlled SQL test: synthetic identities, real roles/policies; no emails/sessions.
-- Every fixture is rolled back. Run on the target project after the migration.
begin;
insert into auth.users(id) values ('5f000000-0000-4000-8000-000000000001'), ('5f000000-0000-4000-8000-000000000002');
create temp table rls_results(check_name text, passed boolean);
grant select, insert on rls_results to authenticated, anon;
set local role authenticated;
select set_config('request.jwt.claim.sub', '5f000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"5f000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare d jsonb := '{"schemaVersion":1,"phrases":[],"vocabulary":{"schemaVersion":2,"languages":{}},"settings":{}}'; n bigint;
begin
  n := public.save_study_account(0, d);
  if n <> 1 then raise exception 'first write failed'; end if;
  n := public.save_study_account(1, d);
  if n <> 2 then raise exception 'revision increment failed'; end if;
  if public.save_study_account(1, d) is not null then raise exception 'stale overwrite accepted'; end if;
  insert into rls_results values ('owner write, read and CAS stale rejection', true);
  begin
    insert into public.study_accounts(user_id,document) values ('5f000000-0000-4000-8000-000000000002',d);
    raise exception 'cross-account INSERT accepted';
  exception when insufficient_privilege then insert into rls_results values ('cross-account insert rejected',true); end;
  begin
    update public.study_accounts set user_id = '5f000000-0000-4000-8000-000000000002';
    raise exception 'owner reassignment accepted';
  exception when insufficient_privilege then insert into rls_results values ('owner reassignment rejected',true); end;
end;
$$;
select set_config('request.jwt.claim.sub', '5f000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"5f000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare n integer; d jsonb := '{"schemaVersion":1,"phrases":[],"vocabulary":{"schemaVersion":2,"languages":{}},"settings":{}}';
begin
  if exists(select 1 from public.study_accounts) then raise exception 'B can SELECT A'; end if;
  update public.study_accounts set document = d where user_id = '5f000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B can UPDATE A'; end if;
  if public.save_study_account(2,d) is not null then raise exception 'B can RPC-update A'; end if;
  insert into rls_results values ('B cannot select, update or RPC-update A',true);
  if public.save_study_account(0,d) <> 1 then raise exception 'B own insert failed'; end if;
  if (select count(*) from public.study_accounts) <> 1 then raise exception 'B isolation failed'; end if;
  insert into rls_results values ('B own account remains isolated',true);
  begin
    delete from public.study_accounts;
    raise exception 'direct delete unexpectedly accepted';
  exception when insufficient_privilege then insert into rls_results values ('DELETE has no grant',true); end;
end;
$$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
begin
  begin
    perform * from public.study_accounts;
    raise exception 'anon SELECT accepted';
  exception when insufficient_privilege then insert into rls_results values ('anonymous table access rejected',true); end;
  begin
    perform public.save_study_account(0,'{}');
    raise exception 'anon RPC accepted';
  exception when insufficient_privilege then insert into rls_results values ('anonymous RPC rejected',true); end;
end;
$$;
reset role;
select check_name, passed from rls_results;
rollback;
