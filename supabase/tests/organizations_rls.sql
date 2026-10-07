-- Phase 2A isolation and constraint checks. Everything runs in one transaction that is rolled back.
-- Run against the local DB:
--   docker exec -i supabase_db_OneForAll psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/organizations_rls.sql

begin;

do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000000a';  -- owner of org A
  ub uuid := '00000000-0000-0000-0000-00000000000b';  -- unrelated user, org B
  uc uuid := '00000000-0000-0000-0000-00000000000c';  -- MEMBER of org A
  org_a uuid;
  org_b uuid;
  n int;
  r record;
  caught boolean;
begin
  insert into auth.users (id, email) values
    (ua, 'a@test.local'), (ub, 'b@test.local'), (uc, 'c@test.local');

  ---------------------------------------------------------------- creation
  -- anon cannot call the RPC
  set local role anon;
  caught := false;
  begin
    perform public.create_organization('Anon Org');
  exception when insufficient_privilege then caught := true;
  end;
  assert caught, 'anon must not execute create_organization';

  -- authenticated without a user id is rejected
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  caught := false;
  begin
    perform public.create_organization('Ghost Org');
  exception when sqlstate '28000' then caught := true;
  end;
  assert caught, 'create_organization must reject a missing auth.uid()';

  -- user A creates org A -> OWNER
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  select * into r from public.create_organization('  Acme Corp  ');
  org_a := r.id;
  assert r.role = 'OWNER', 'creator role must be OWNER';
  assert r.name = 'Acme Corp', 'name must be trimmed';
  assert r.slug = 'acme-corp', 'slug must be derived from name, got ' || r.slug;

  -- membership row exists with OWNER and the right user
  select count(*) into n from public.organization_members
    where organization_id = org_a and user_id = ua and role = 'OWNER';
  assert n = 1, 'creator must have exactly one OWNER membership';

  -- invalid names rejected
  caught := false;
  begin perform public.create_organization('   ');
  exception when sqlstate '22023' then caught := true; end;
  assert caught, 'blank name must be rejected';

  -- same name twice -> distinct slugs, no failure
  select * into r from public.create_organization('Acme Corp');
  assert r.slug <> 'acme-corp' and r.slug like 'acme-corp-%', 'duplicate name must get a suffixed slug';

  -- clients cannot insert directly
  caught := false;
  begin insert into public.organizations (name, slug, created_by) values ('x', 'x', ua);
  exception when insufficient_privilege then caught := true; end;
  assert caught, 'direct INSERT into organizations must be denied';

  caught := false;
  begin insert into public.organization_members (organization_id, user_id, role) values (org_a, ua, 'OWNER');
  exception when insufficient_privilege then caught := true; end;
  assert caught, 'direct INSERT into organization_members must be denied';

  ---------------------------------------------------------------- isolation
  -- user B creates org B
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select * into r from public.create_organization('Bravo Inc');
  org_b := r.id;

  select count(*) into n from public.organizations;
  assert n = 1, 'B must see only their own organization, saw ' || n;
  select count(*) into n from public.organizations where id = org_a;
  assert n = 0, 'B must not see org A';
  select count(*) into n from public.organization_members where organization_id = org_a;
  assert n = 0, 'B must not see org A memberships';

  update public.organizations set name = 'Hacked' where id = org_a;
  get diagnostics n = row_count;
  assert n = 0, 'B must not update org A';
  delete from public.organizations where id = org_a;
  get diagnostics n = row_count;
  assert n = 0, 'B must not delete org A';

  -- A still sees only A's data (2 orgs: both created by A)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  select count(*) into n from public.organizations;
  assert n = 2, 'A must see exactly their 2 organizations, saw ' || n;
  select count(*) into n from public.organizations where id = org_b;
  assert n = 0, 'A must not see org B';

  ---------------------------------------------------------------- roles (as superuser)
  reset role;

  -- invalid role rejected
  caught := false;
  begin insert into public.organization_members (organization_id, user_id, role) values (org_a, uc, 'GOD');
  exception when check_violation then caught := true; end;
  assert caught, 'invalid role must be rejected';

  -- duplicate membership rejected
  caught := false;
  begin insert into public.organization_members (organization_id, user_id, role) values (org_a, ua, 'MEMBER');
  exception when unique_violation then caught := true; end;
  assert caught, 'duplicate membership must be rejected';

  -- add C as MEMBER of org A
  insert into public.organization_members (organization_id, user_id, role) values (org_a, uc, 'MEMBER');

  -- MEMBER can read but not modify
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  select count(*) into n from public.organizations where id = org_a;
  assert n = 1, 'MEMBER must see their organization';
  select count(*) into n from public.organization_members where organization_id = org_a;
  assert n = 2, 'MEMBER must see co-members of their organization';
  update public.organizations set name = 'Nope' where id = org_a;
  get diagnostics n = row_count;
  assert n = 0, 'MEMBER must not update the organization';
  delete from public.organizations where id = org_a;
  get diagnostics n = row_count;
  assert n = 0, 'MEMBER must not delete the organization';

  -- OWNER can rename; slug is not client-editable
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  update public.organizations set name = 'Acme Renamed' where id = org_a;
  get diagnostics n = row_count;
  assert n = 1, 'OWNER must be able to rename';
  caught := false;
  begin update public.organizations set slug = 'stolen' where id = org_a;
  exception when insufficient_privilege then caught := true; end;
  assert caught, 'slug must not be client-updatable';

  raise notice 'ALL ORGANIZATION CHECKS PASSED';
end;
$$;

rollback;
