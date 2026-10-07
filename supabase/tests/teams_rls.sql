-- Phase 2C authorization, isolation, hierarchy and integrity checks.
-- One transaction, rolled back at the end.
--   docker exec -i supabase_db_OneForAll psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/teams_rls.sql

begin;

do $$
declare
  o1  uuid := '00000000-0000-0000-0000-0000000000c1';  -- OWNER  of org 1
  a1  uuid := '00000000-0000-0000-0000-0000000000c2';  -- ADMIN  of org 1, in dept 1
  m1  uuid := '00000000-0000-0000-0000-0000000000c3';  -- MEMBER of org 1, in dept 1
  mx  uuid := '00000000-0000-0000-0000-0000000000c4';  -- MEMBER of org 1, in NO department
  w1  uuid := '00000000-0000-0000-0000-0000000000c5';  -- MEMBER of org 1, only in dept 1b (wrong department)
  gh  uuid := '00000000-0000-0000-0000-0000000000c6';  -- in dept 1 but NOT in org 1 (forced fixture)
  o2  uuid := '00000000-0000-0000-0000-0000000000d1';  -- OWNER  of org 2 (other tenant)
  u2  uuid := '00000000-0000-0000-0000-0000000000d2';  -- MEMBER of org 2, in dept 2
  org1 uuid; org2 uuid; dept1 uuid; dept1b uuid; dept2 uuid;
  t_o uuid; t_a uuid; t_b uuid; t_2 uuid; t_x uuid;
  r record; n int; caught boolean;
begin
  -- Fixtures (superuser) ----------------------------------------------------
  insert into auth.users (id, email) values
    (o1, 'o1@t.local'), (a1, 'a1@t.local'), (m1, 'm1@t.local'), (mx, 'mx@t.local'),
    (w1, 'w1@t.local'), (gh, 'gh@t.local'), (o2, 'o2@t.local'), (u2, 'u2@t.local');
  insert into public.organizations (name, slug, created_by) values ('Org One', 'org-one', o1) returning id into org1;
  insert into public.organizations (name, slug, created_by) values ('Org Two', 'org-two', o2) returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, o1, 'OWNER'), (org1, a1, 'ADMIN'), (org1, m1, 'MEMBER'), (org1, mx, 'MEMBER'), (org1, w1, 'MEMBER'),
    (org2, o2, 'OWNER'), (org2, u2, 'MEMBER');
  insert into public.departments (organization_id, name, slug, created_by) values (org1, 'Engineering', 'engineering', o1) returning id into dept1;
  insert into public.departments (organization_id, name, slug, created_by) values (org1, 'Operations', 'operations', o1) returning id into dept1b;
  insert into public.departments (organization_id, name, slug, created_by) values (org2, 'Engineering', 'engineering', o2) returning id into dept2;
  insert into public.department_members (department_id, user_id) values
    (dept1, a1), (dept1, m1), (dept1, gh), (dept1b, w1), (dept2, u2);

  ---------------------------------------------------------------- anonymous denied
  set local role anon;
  caught := false;
  begin perform count(*) from public.teams; exception when insufficient_privilege then caught := true; end;
  assert caught, 'anon must not read teams';
  caught := false;
  begin perform count(*) from public.team_members; exception when insufficient_privilege then caught := true; end;
  assert caught, 'anon must not read team_members';
  caught := false;
  begin perform public.create_team(dept1, 'Anon Team'); exception when insufficient_privilege then caught := true; end;
  assert caught, 'anon must not execute create_team';
  reset role;

  ---------------------------------------------------------------- B 3/4/5/6 creation
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  select * into r from public.create_team(dept1, '  Backend  ', 'Services');
  t_o := r.id;
  assert r.name = 'Backend' and r.slug = 'backend' and r.department_id = dept1, '3: OWNER creates team (trimmed, slugged, in dept)';
  select count(*) into n from public.teams where id = t_o and created_by = o1;
  assert n = 1, '3: created_by is the caller';

  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  select * into r from public.create_team(dept1, 'Research & Development');
  t_a := r.id;
  assert r.slug = 'research-development', '4: ADMIN creates team; slug from name, got ' || r.slug;

  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  caught := false;
  begin perform public.create_team(dept1, 'Member Team'); exception when insufficient_privilege then caught := true; end;
  assert caught, '5: MEMBER must not create teams (RPC)';
  caught := false;
  begin insert into public.teams (department_id, name, slug, created_by) values (dept1, 'Member Team', 'member-team', m1);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '5: MEMBER must not create teams (direct INSERT)';

  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  caught := false;
  begin perform public.create_team(dept1, 'Outsider Team'); exception when insufficient_privilege then caught := true; end;
  assert caught, '6: outsider must not create teams in another org (RPC, forged department_id)';
  caught := false;
  begin insert into public.teams (department_id, name, slug, created_by) values (dept1, 'Outsider', 'outsider', o2);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '6: outsider must not create teams in another org (direct INSERT, forged department_id)';

  -- positive control: org 2 owner may create in their own department; same name as org 1 is fine
  select * into r from public.create_team(dept2, 'Backend');
  t_2 := r.id;
  assert r.slug = 'backend', '6: other org may reuse a team name';

  ---------------------------------------------------------------- A 1/2 isolation
  select count(*) into n from public.teams;
  assert n = 1, '2: org 2 owner sees only org 2 teams, saw ' || n;
  select count(*) into n from public.teams where id in (t_o, t_a);
  assert n = 0, '2: org 2 must not see org 1 teams';

  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.teams where department_id = dept1;
  assert n = 2, '1: org 1 MEMBER sees org 1 teams, saw ' || n;
  select count(*) into n from public.teams where id = t_2;
  assert n = 0, '2: org 1 member must not see org 2 team';

  ---------------------------------------------------------------- H 27/28 duplicates and scoping
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  caught := false;
  begin perform public.create_team(dept1, 'backend'); exception when unique_violation then caught := true; end;
  assert caught, '27: duplicate name (case-insensitive) rejected within a department';
  caught := false;
  begin perform public.create_team(dept1, '  BACKEND '); exception when unique_violation then caught := true; end;
  assert caught, '27: duplicate name with whitespace/case rejected';

  select * into r from public.create_team(dept1b, 'Backend');
  t_b := r.id;
  assert r.slug = 'backend', '27: same team name allowed in a different department';

  select * into r from public.create_team(dept1, 'Research Development');
  assert r.slug like 'research-development-%' and r.slug <> 'research-development', 'slug collision gets suffix, got ' || r.slug;
  t_x := r.id;

  caught := false;
  begin insert into public.teams (department_id, name, slug, created_by) values (dept1, 'Other Name', 'backend', o1);
  exception when unique_violation then caught := true; end;
  assert caught, '28: duplicate slug rejected within a department';

  caught := false;
  begin perform public.create_team(dept1, '   '); exception when sqlstate '22023' then caught := true; end;
  assert caught, 'blank name rejected';
  caught := false;
  begin insert into public.teams (department_id, name, slug, created_by) values (dept1, 'Bad', 'Bad Slug', o1);
  exception when check_violation then caught := true; end;
  assert caught, 'non kebab-case slug rejected';
  caught := false;
  begin insert into public.teams (department_id, name, slug, description, created_by) values (dept1, 'Long', 'long', repeat('x', 501), o1);
  exception when check_violation then caught := true; end;
  assert caught, 'description over 500 chars rejected';

  ---------------------------------------------------------------- C 7/8/9/10 update
  update public.teams set description = 'by owner' where id = t_o;
  get diagnostics n = row_count; assert n = 1, '7: OWNER updates team';
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  update public.teams set name = 'R and D' where id = t_a;
  get diagnostics n = row_count; assert n = 1, '8: ADMIN updates team';
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  update public.teams set description = 'by member' where id = t_o;
  get diagnostics n = row_count; assert n = 0, '9: MEMBER must not update team';
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  update public.teams set description = 'other tenant' where id = t_o;
  get diagnostics n = row_count; assert n = 0, '10: outsider must not update team';

  ---------------------------------------------------------------- H 30 immutable fields
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  caught := false;
  begin update public.teams set department_id = dept1b where id = t_o; exception when insufficient_privilege then caught := true; end;
  assert caught, '30: department_id (same org, other department) not client-updatable';
  caught := false;
  begin update public.teams set department_id = dept2 where id = t_o; exception when insufficient_privilege then caught := true; end;
  assert caught, '30: department_id (other org) not client-updatable';
  caught := false;
  begin update public.teams set created_by = a1 where id = t_o; exception when insufficient_privilege then caught := true; end;
  assert caught, '30: created_by not client-updatable';
  caught := false;
  begin update public.teams set slug = 'hijack' where id = t_o; exception when insufficient_privilege then caught := true; end;
  assert caught, '30: slug not client-updatable';
  caught := false;
  begin insert into public.teams (department_id, name, slug, created_by) values (dept1, 'Forged Author', 'forged-author', a1);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '30: created_by cannot be forged on INSERT';

  ---------------------------------------------------------------- E 15/16/17/18 add members
  insert into public.team_members (team_id, user_id) values (t_o, m1);                      -- OWNER adds
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  insert into public.team_members (team_id, user_id) values (t_a, m1);                      -- ADMIN adds
  insert into public.team_members (team_id, user_id) values (t_o, a1);                      -- ADMIN adds a department member
  select count(*) into n from public.team_members where team_id in (t_o, t_a);
  assert n = 3, '15/16: OWNER and ADMIN can add members, saw ' || n;

  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, m1); exception when insufficient_privilege then caught := true; end;
  assert caught, '17: MEMBER must not add team members';

  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, m1); exception when insufficient_privilege then caught := true; end;
  assert caught, '18: outsider must not add team members (forged team_id)';
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, o2); exception when insufficient_privilege then caught := true; end;
  assert caught, '18: outsider must not add themselves to an org 1 team';

  ---------------------------------------------------------------- F 19/20/21/22 hierarchy
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, gh); exception when insufficient_privilege then caught := true; end;
  assert caught, '19: target in the department but NOT in the organization is rejected';
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, mx); exception when insufficient_privilege then caught := true; end;
  assert caught, '20: org member who is not in the department is rejected';
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, u2); exception when insufficient_privilege then caught := true; end;
  assert caught, '21: cross-organization user is rejected';
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, w1); exception when insufficient_privilege then caught := true; end;
  assert caught, '22: same-org user from a different department is rejected';
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_x, '00000000-0000-0000-0000-00000000ffff'); exception when insufficient_privilege then caught := true; end;
  assert caught, 'forged unknown user id is rejected';

  -- org 2 owner cannot pull an org 1 user into an org 2 team (reverse direction, forged user_id)
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_2, m1); exception when insufficient_privilege then caught := true; end;
  assert caught, 'org 1 user cannot be added to an org 2 team';
  -- positive control: org 2 owner adds an org 2 department member to an org 2 team
  insert into public.team_members (team_id, user_id) values (t_2, u2);

  ---------------------------------------------------------------- H 29 duplicate membership, immutable membership
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  caught := false;
  begin insert into public.team_members (team_id, user_id) values (t_o, m1); exception when unique_violation then caught := true; end;
  assert caught, '29: duplicate team membership rejected';
  caught := false;
  begin update public.team_members set user_id = o1 where team_id = t_o; exception when insufficient_privilege then caught := true; end;
  assert caught, '30: team_members.user_id not client-updatable';
  caught := false;
  begin update public.team_members set team_id = t_a where user_id = m1; exception when insufficient_privilege then caught := true; end;
  assert caught, '30: team_members.team_id not client-updatable';

  ---------------------------------------------------------------- member reads; G 25/26 member/outsider remove
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.team_members where team_id = t_o;
  assert n = 2, 'MEMBER can read team membership in own org';
  delete from public.team_members where team_id = t_o;
  get diagnostics n = row_count; assert n = 0, '25: MEMBER must not remove team members';

  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.team_members where team_id in (t_o, t_a);
  assert n = 0, 'outsider sees no org 1 team memberships';
  delete from public.team_members where team_id = t_o;
  get diagnostics n = row_count; assert n = 0, '26: outsider must not remove team members';

  ---------------------------------------------------------------- G 23/24 owner/admin remove
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  delete from public.team_members where team_id = t_o and user_id = a1;
  get diagnostics n = row_count; assert n = 1, '24: ADMIN removes member';
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  delete from public.team_members where team_id = t_a and user_id = m1;
  get diagnostics n = row_count; assert n = 1, '23: OWNER removes member';

  ---------------------------------------------------------------- hierarchy upkeep: leaving a department
  -- m1 is still in t_o (and in dept1). Removing m1 from dept1 must drop m1 from dept1's teams only.
  insert into public.team_members (team_id, user_id) values (t_a, m1);
  delete from public.department_members where department_id = dept1 and user_id = m1;
  get diagnostics n = row_count; assert n = 1, 'OWNER removes m1 from department';
  select count(*) into n from public.team_members where user_id = m1;
  assert n = 0, 'leaving a department removes the user from its teams, left ' || n;

  ---------------------------------------------------------------- D 11/12/13/14 delete
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  delete from public.teams where id = t_x;
  get diagnostics n = row_count; assert n = 0, '13: MEMBER must not delete team';
  perform set_config('request.jwt.claims', json_build_object('sub', o2, 'role', 'authenticated')::text, true);
  delete from public.teams where id = t_x;
  get diagnostics n = row_count; assert n = 0, '14: outsider must not delete team';

  -- cascade setup: put a member in t_x, then delete it
  perform set_config('request.jwt.claims', json_build_object('sub', o1, 'role', 'authenticated')::text, true);
  insert into public.team_members (team_id, user_id) values (t_x, a1);
  delete from public.teams where id = t_x;
  get diagnostics n = row_count; assert n = 1, '11: OWNER deletes team';
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  delete from public.teams where id = t_a;
  get diagnostics n = row_count; assert n = 1, '12: ADMIN deletes team';
  reset role;
  select count(*) into n from public.team_members where team_id = t_x;
  assert n = 0, 'deleting a team cascades to its memberships';

  ---------------------------------------------------------------- cascades: department -> teams -> members; org -> all
  insert into public.team_members (team_id, user_id) values (t_o, a1);
  delete from public.departments where id = dept1;
  select count(*) into n from public.teams where department_id = dept1;
  assert n = 0, 'deleting a department cascades to its teams';
  select count(*) into n from public.team_members where team_id = t_o;
  assert n = 0, '...and to team memberships';
  select count(*) into n from public.teams where id = t_b;
  assert n = 1, 'teams of other departments untouched';

  delete from public.organizations where id = org1;
  select count(*) into n from public.teams where id = t_b;
  assert n = 0, 'deleting an organization cascades to teams in all its departments';
  select count(*) into n from public.teams where id = t_2;
  assert n = 1, 'other organization untouched by cascade';

  raise notice 'ALL TEAM CHECKS PASSED';
end;
$$;

rollback;
