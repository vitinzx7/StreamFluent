-- Personal study data only. Uninstall/logout never deletes this row.
create table public.study_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  document jsonb not null check (
    jsonb_typeof(document) = 'object'
    and document -> 'schemaVersion' = '1'::jsonb
    and jsonb_typeof(document -> 'phrases') = 'array'
    and jsonb_typeof(document -> 'vocabulary') = 'object'
    and jsonb_typeof(document -> 'settings') = 'object'
    and document ?& array['schemaVersion','phrases','vocabulary','settings']
    and pg_column_size(document) <= 4194304
  ),
  updated_at timestamptz not null default now()
);
alter table public.study_accounts enable row level security;
alter table public.study_accounts force row level security;
revoke all on public.study_accounts from public, anon, authenticated;
grant select, insert, update on public.study_accounts to authenticated;
create policy study_select_own on public.study_accounts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy study_insert_own on public.study_accounts for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy study_update_own on public.study_accounts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.study_account_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then new.revision := 1;
  else new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.study_account_revision() from public, anon, authenticated;
create trigger study_account_revision before insert or update on public.study_accounts
  for each row execute function public.study_account_revision();

-- No caller-supplied owner, no SECURITY DEFINER, no delete endpoint.
create function public.save_study_account(expected_revision bigint, new_document jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid := auth.uid(); result bigint;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision < 0 or expected_revision is null then raise exception 'Invalid revision'; end if;
  if expected_revision = 0 then
    insert into public.study_accounts(user_id, document) values (owner_id, new_document)
    on conflict (user_id) do nothing returning revision into result;
  else
    update public.study_accounts set document = new_document
    where user_id = owner_id and revision = expected_revision returning revision into result;
  end if;
  return result; -- null means a conflict: caller must read and merge again.
end;
$$;
revoke all on function public.save_study_account(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_study_account(bigint, jsonb) to authenticated;
