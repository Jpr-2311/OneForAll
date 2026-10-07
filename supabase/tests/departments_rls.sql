-- Phase 2B authorization, isolation and constraint checks. One transaction, rolled back at the end.
--   docker exec -i supabase_db_OneForAll psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/departments_rls.sql

begin;

do $$
declare
  owner1 uuid := '00000000-0000-0000-0000-0000000000a1';  -- OWNER of org 1
  admin1 uuid := '00000000-0000-0000-0000-0000000000a2';  -- ADMIN of org 1
  mem1   uuid := '00000000-0000-0000-0000-0000000000a3';  -- MEMBER of org 1
  owner2 uuid := '00000000-0000-0000-0000-0000000000b1';  -- OWNER of org 2 (other tenant)
  org1 uuid; org2 uuid;
  d_owner uuid; d_admin uuid; d_org2 uuid; d_x uuid;
  r record; n int; caught boolean; s text;
begin
  -- Fixtures (superuser) ----------------------------------------------------
  insert into auth.users (id, email) values
    (owner1, 'o1@test.local'), (admin1, 'a1@test.local'), (mem1, 'm1@test.local'), (owner2, 'o2@test.local');
  insert into public.organizations (name, slug, created_by) values ('Org One', 'org-one', owner1) returning id into org1;
  insert into public.organizations (name, slug, created_by) values ('Org Two', 'org-two', owner2) returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, owner1, 'OWNER'), (org1, admin1, 'ADMIN'), (org1, mem1, 'MEMBER'), (org2, owner2, 'OWNER');

  ---------------------------------------------------------------- 18 anonymous denied
  set local role anon;
  caught := false;
  begin perform count(*) from public.departments; exception when insufficient_privilege then caught := true; end;
  assert caught, '18: anon must not read departments';
  caught := false;
  begin perform count(*) from public.department_members; exception when insufficient_privilege then caught := true; end;
  assert caught, '18: anon must not read department_members';
  caught := false;
  begin perform public.create_department(org1, 'Anon Dept'); exception when insufficient_privilege then caught := true; end;
  assert caught, '18: anon must not create departments';
  reset role;

  ---------------------------------------------------------------- 1 / 2 / 3 create
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  select * into r from public.create_department(org1, '  Engineering  ', 'Builds things');
  d_owner := r.id;
  assert r.name = 'Engineering' and r.slug = 'engineering', '1: OWNER creates department (trimmed, slugged)';
  assert r.organization_id = org1, '1: department belongs to org1';
  select count(*) into n from public.departments where id = d_owner and created_by = owner1;
  assert n = 1, '1: created_by is the caller';

  perform set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  select * into r from public.create_department(org1, 'Research & Development');
  d_admin := r.id;
  assert r.slug = 'research-development', '2: ADMIN creates department; slug from name, got ' || r.slug;

  perform set_config('request.jwt.claims', json_build_object('sub', mem1, 'role', 'authenticated')::text, true);
  caught := false;
  begin perform public.create_department(org1, 'Member Dept'); exception when insufficient_privilege then caught := true; end;
  assert caught, '3: MEMBER must not create departments (RPC)';
  caught := false;
  begin
    insert into public.departments (organization_id, name, slug, created_by) values (org1, 'Member Dept', 'member-dept', mem1);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '3: MEMBER must not create departments (direct INSERT)';

  ---------------------------------------------------------------- 4 / 5 visibility
  select count(*) into n from public.departments where organization_id = org1;
  assert n = 2, '4: MEMBER sees org departments, saw ' || n;

  perform set_config('request.jwt.claims', json_build_object('sub', owner2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.departments where organization_id = org1 or id in (d_owner, d_admin);
  assert n = 0, '5: other-tenant user must not see org1 departments';
  select count(*) into n from public.departments;
  assert n = 0, '5: org2 has no departments yet';

  ---------------------------------------------------------------- 22 same name in another org + 21 slug scoping
  select * into r from public.create_department(org2, 'Engineering');
  d_org2 := r.id;
  assert r.slug = 'engineering', '22: org2 may also have Engineering with slug engineering';

  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  caught := false;
  begin perform public.create_department(org1, 'engineering'); exception when unique_violation then caught := true; end;
  assert caught, '21: duplicate name (case-insensitive) rejected within one org';
  caught := false;
  begin perform public.create_department(org1, '  ENGINEERING '); exception when unique_violation then caught := true; end;
  assert caught, '21: duplicate name with whitespace/case rejected within one org';

  -- different name, same derived slug -> suffix strategy
  select * into r from public.create_department(org1, 'Research Development');
  assert r.slug like 'research-development-%' and r.slug <> 'research-development', '21: slug collision gets suffix, got ' || r.slug;
  d_x := r.id;

  caught := false;
  begin
    insert into public.departments (organization_id, name, slug, created_by) values (org1, 'Other', 'engineering', owner1);
  exception when unique_violation then caught := true; end;
  assert caught, '21: duplicate slug rejected within one org (direct insert)';

  -- invalid inputs
  caught := false;
  begin perform public.create_department(org1, '   '); exception when sqlstate '22023' then caught := true; end;
  assert caught, 'blank name rejected';
  caught := false;
  begin
    insert into public.departments (organization_id, name, slug, created_by) values (org1, 'Bad', 'Bad Slug', owner1);
  exception when check_violation then caught := true; end;
  assert caught, 'non kebab-case slug rejected';

  ---------------------------------------------------------------- 19 forged organization id
  perform set_config('request.jwt.claims', json_build_object('sub', owner2, 'role', 'authenticated')::text, true);
  caught := false;
  begin perform public.create_department(org1, 'Forged'); exception when insufficient_privilege then caught := true; end;
  assert caught, '19: forged org id via RPC rejected';
  caught := false;
  begin
    insert into public.departments (organization_id, name, slug, created_by) values (org1, 'Forged', 'forged', owner2);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '19: forged org id via direct INSERT rejected';
  caught := false;
  begin insert into public.department_members (department_id, user_id) values (d_owner, owner2);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '19/20: other-tenant user cannot add anyone (incl. self) to org1 department';

  ---------------------------------------------------------------- 6 / 7 / 8 update
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  update public.departments set description = 'by owner' where id = d_owner;
  get diagnostics n = row_count; assert n = 1, '6: OWNER updates department';
  perform set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  update public.departments set name = 'R and D' where id = d_admin;
  get diagnostics n = row_count; assert n = 1, '7: ADMIN updates department';
  perform set_config('request.jwt.claims', json_build_object('sub', mem1, 'role', 'authenticated')::text, true);
  update public.departments set description = 'by member' where id = d_owner;
  get diagnostics n = row_count; assert n = 0, '8: MEMBER must not update department';
  perform set_config('request.jwt.claims', json_build_object('sub', owner2, 'role', 'authenticated')::text, true);
  update public.departments set description = 'other tenant' where id = d_owner;
  get diagnostics n = row_count; assert n = 0, '8: other tenant must not update department';

  ---------------------------------------------------------------- 24 sensitive fields immutable
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  caught := false;
  begin update public.departments set organization_id = org2 where id = d_owner; exception when insufficient_privilege then caught := true; end;
  assert caught, '24: organization_id not client-updatable';
  caught := false;
  begin update public.departments set created_by = admin1 where id = d_owner; exception when insufficient_privilege then caught := true; end;
  assert caught, '24: created_by not client-updatable';
  caught := false;
  begin update public.departments set slug = 'hijack' where id = d_owner; exception when insufficient_privilege then caught := true; end;
  assert caught, '24: slug not client-updatable';
  caught := false;
  begin
    insert into public.departments (organization_id, name, slug, created_by) values (org1, 'Forged Author', 'forged-author', admin1);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '24: created_by cannot be forged on INSERT';

  ---------------------------------------------------------------- 12 / 13 / 14 / 20 add members
  insert into public.department_members (department_id, user_id) values (d_owner, mem1);       -- OWNER adds
  perform set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  insert into public.department_members (department_id, user_id) values (d_owner, admin1);     -- ADMIN adds
  select count(*) into n from public.department_members where department_id = d_owner;
  assert n = 2, '12: OWNER and ADMIN can add members';

  caught := false;
  begin insert into public.department_members (department_id, user_id) values (d_owner, mem1); exception when unique_violation then caught := true; end;
  assert caught, '13: duplicate department membership rejected';

  caught := false;
  begin insert into public.department_members (department_id, user_id) values (d_owner, owner2); exception when insufficient_privilege then caught := true; end;
  assert caught, '14/20: cross-organization target user rejected (forged user id)';

  -- reverse direction: org2 admin cannot pull an org1 user into an org2 department
  perform set_config('request.jwt.claims', json_build_object('sub', owner2, 'role', 'authenticated')::text, true);
  caught := false;
  begin insert into public.department_members (department_id, user_id) values (d_org2, mem1); exception when insufficient_privilege then caught := true; end;
  assert caught, '20: org1 user cannot be added to an org2 department';

  -- membership rows cannot be edited
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  caught := false;
  begin update public.department_members set user_id = owner1 where department_id = d_owner; exception when insufficient_privilege then caught := true; end;
  assert caught, '24: department_members has no client UPDATE';

  ---------------------------------------------------------------- 15 / 16 member cannot add/remove; reads allowed
  perform set_config('request.jwt.claims', json_build_object('sub', mem1, 'role', 'authenticated')::text, true);
  caught := false;
  begin insert into public.department_members (department_id, user_id) values (d_admin, mem1); exception when insufficient_privilege then caught := true; end;
  assert caught, '15: MEMBER must not add department members';
  select count(*) into n from public.department_members where department_id = d_owner;
  assert n = 2, 'MEMBER can read department membership in own org';
  delete from public.department_members where department_id = d_owner;
  get diagnostics n = row_count; assert n = 0, '16: MEMBER must not remove department members';

  perform set_config('request.jwt.claims', json_build_object('sub', owner2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.department_members;
  assert n = 0, 'other tenant sees no org1 department memberships';
  delete from public.department_members where department_id = d_owner;
  get diagnostics n = row_count; assert n = 0, 'other tenant must not remove memberships';

  ---------------------------------------------------------------- 17 remove
  perform set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  delete from public.department_members where department_id = d_owner and user_id = mem1;
  get diagnostics n = row_count; assert n = 1, '17: ADMIN removes member';
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  delete from public.department_members where department_id = d_owner and user_id = admin1;
  get diagnostics n = row_count; assert n = 1, '17: OWNER removes member';

  ---------------------------------------------------------------- 23 cascade: department -> members
  insert into public.department_members (department_id, user_id) values (d_x, mem1);
  reset role;
  select count(*) into n from public.department_members where department_id = d_x;
  assert n = 1, 'cascade setup';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);

  ---------------------------------------------------------------- 11 / 9 / 10 delete
  perform set_config('request.jwt.claims', json_build_object('sub', mem1, 'role', 'authenticated')::text, true);
  delete from public.departments where id = d_x;
  get diagnostics n = row_count; assert n = 0, '11: MEMBER must not delete department';
  perform set_config('request.jwt.claims', json_build_object('sub', owner2, 'role', 'authenticated')::text, true);
  delete from public.departments where id = d_x;
  get diagnostics n = row_count; assert n = 0, '11: other tenant must not delete department';

  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  delete from public.departments where id = d_x;
  get diagnostics n = row_count; assert n = 1, '9: OWNER deletes department';
  perform set_config('request.jwt.claims', json_build_object('sub', admin1, 'role', 'authenticated')::text, true);
  delete from public.departments where id = d_admin;
  get diagnostics n = row_count; assert n = 1, '10: ADMIN deletes department';

  reset role;
  select count(*) into n from public.department_members where department_id = d_x;
  assert n = 0, '23: deleting a department cascades to its memberships';

  ---------------------------------------------------------------- 23 cascade: organization -> departments -> members
  insert into public.department_members (department_id, user_id) values (d_owner, mem1);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner1, 'role', 'authenticated')::text, true);
  delete from public.organizations where id = org1;
  get diagnostics n = row_count; assert n = 1, 'OWNER deletes organization';
  reset role;
  select count(*) into n from public.departments where organization_id = org1;
  assert n = 0, '23: deleting an organization cascades to departments';
  select count(*) into n from public.department_members where department_id = d_owner;
  assert n = 0, '23: ...and to department memberships';
  select count(*) into n from public.departments where organization_id = org2;
  assert n = 1, '23: other organization untouched by cascade';

  raise notice 'ALL DEPARTMENT CHECKS PASSED';
end;
$$;

rollback;
