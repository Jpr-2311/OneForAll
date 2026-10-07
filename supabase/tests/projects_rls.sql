-- Phase 2D authorization, isolation, integrity and lifecycle checks.
-- One transaction, rolled back at the end.
--   docker exec -i supabase_db_OneForAll psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/projects_rls.sql

begin;

do $$
declare
  owner1 uuid := '00000000-0000-0000-0000-0000000000e1';  -- OWNER of org 1
  admin1 uuid := '00000000-0000-0000-0000-0000000000e2';  -- ADMIN of org 1 (in no team)
  ma     uuid := '00000000-0000-0000-0000-0000000000e3';  -- MEMBER, dept 1, team A
  mb     uuid := '00000000-0000-0000-0000-0000000000e4';  -- MEMBER, dept 1, team B   (same dept, wrong team)
  mdept  uuid := '00000000-0000-0000-0000-0000000000e5';  -- MEMBER, dept 1, NO team  (same dept, no team)
  mx     uuid := '00000000-0000-0000-0000-0000000000e6';  -- MEMBER of org 1, no dept, no team
  mo     uuid := '00000000-0000-0000-0000-0000000000e7';  -- MEMBER, dept 2, team C   (other department)
  owner2 uuid := '00000000-0000-0000-0000-0000000000f1';  -- OWNER of org 2 (other tenant)
  m2     uuid := '00000000-0000-0000-0000-0000000000f2';  -- MEMBER of org 2, team BB
  org1 uuid; org2 uuid; dept1 uuid; dept2 uuid; deptb uuid;
  team_a uuid; team_b uuid; team_c uuid; team_bb uuid; team_tmp uuid;
  p_a uuid; p_b uuid; p_bb uuid; p_x uuid; p_life uuid; p_life2 uuid; p_del1 uuid; p_del2 uuid; p_tmp uuid;
  r record; n int; caught boolean;
begin
  -- Fixtures (superuser) ----------------------------------------------------
  insert into auth.users (id, email) values
    (owner1,'o1@p.local'),(admin1,'a1@p.local'),(ma,'ma@p.local'),(mb,'mb@p.local'),(mdept,'md@p.local'),
    (mx,'mx@p.local'),(mo,'mo@p.local'),(owner2,'o2@p.local'),(m2,'m2@p.local');
  insert into public.organizations (name, slug, created_by) values ('Org One','org-one',owner1) returning id into org1;
  insert into public.organizations (name, slug, created_by) values ('Org Two','org-two',owner2) returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1,owner1,'OWNER'),(org1,admin1,'ADMIN'),(org1,ma,'MEMBER'),(org1,mb,'MEMBER'),(org1,mdept,'MEMBER'),
    (org1,mx,'MEMBER'),(org1,mo,'MEMBER'),(org2,owner2,'OWNER'),(org2,m2,'MEMBER');
  insert into public.departments (organization_id,name,slug,created_by) values (org1,'Engineering','engineering',owner1) returning id into dept1;
  insert into public.departments (organization_id,name,slug,created_by) values (org1,'HR','hr',owner1) returning id into dept2;
  insert into public.departments (organization_id,name,slug,created_by) values (org2,'Engineering','engineering',owner2) returning id into deptb;
  insert into public.department_members (department_id,user_id) values
    (dept1,ma),(dept1,mb),(dept1,mdept),(dept2,mo),(deptb,m2);
  insert into public.teams (department_id,name,slug,created_by) values (dept1,'Team A','team-a',owner1) returning id into team_a;
  insert into public.teams (department_id,name,slug,created_by) values (dept1,'Team B','team-b',owner1) returning id into team_b;
  insert into public.teams (department_id,name,slug,created_by) values (dept2,'Team C','team-c',owner1) returning id into team_c;
  insert into public.teams (department_id,name,slug,created_by) values (deptb,'Team BB','team-bb',owner2) returning id into team_bb;
  insert into public.team_members (team_id,user_id) values (team_a,ma),(team_b,mb),(team_c,mo),(team_bb,m2);

  ---------------------------------------------------------------- 1/2 anonymous denied
  set local role anon;
  caught := false;
  begin perform count(*) from public.projects; exception when insufficient_privilege then caught := true; end;
  assert caught, '1: anon must not read projects';
  caught := false;
  begin perform public.create_project(team_a, 'Anon Project'); exception when insufficient_privilege then caught := true; end;
  assert caught, '2: anon must not create projects (RPC)';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'Anon','anon','GREENFIELD',owner1);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '2: anon must not create projects (direct INSERT)';
  reset role;

  ---------------------------------------------------------------- 7/8/9 create by role
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',owner1,'role','authenticated')::text, true);
  select * into r from public.create_project(team_a, '  Payments  ', 'Payment service', 'GREENFIELD');
  p_a := r.id;
  assert r.name = 'Payments' and r.slug = 'payments' and r.team_id = team_a, '7: OWNER creates project (trimmed, slugged, in team)';
  assert r.status = 'DRAFT' and r.project_type = 'GREENFIELD', '7: new project is a GREENFIELD DRAFT';
  select count(*) into n from public.projects where id = p_a and created_by = owner1;
  assert n = 1, '7: created_by is the caller';

  perform set_config('request.jwt.claims', json_build_object('sub',admin1,'role','authenticated')::text, true);
  select * into r from public.create_project(team_b, 'Hiring Platform', null, 'BROWNFIELD');
  p_b := r.id;
  assert r.slug = 'hiring-platform' and r.project_type = 'BROWNFIELD' and r.description is null, '8: ADMIN creates project; empty description is NULL';

  perform set_config('request.jwt.claims', json_build_object('sub',ma,'role','authenticated')::text, true);
  caught := false;
  begin perform public.create_project(team_a, 'Member Project'); exception when insufficient_privilege then caught := true; end;
  assert caught, '9: team MEMBER must not create projects (RPC)';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'Member Project','member-project','GREENFIELD',ma);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '9: team MEMBER must not create projects (direct INSERT)';

  -- team B member / org-2 owner cannot create in team A (wrong team / other tenant, forged team_id)
  perform set_config('request.jwt.claims', json_build_object('sub',mb,'role','authenticated')::text, true);
  caught := false;
  begin perform public.create_project(team_a, 'Wrong Team'); exception when insufficient_privilege then caught := true; end;
  assert caught, 'wrong-team MEMBER must not create in team A';
  perform set_config('request.jwt.claims', json_build_object('sub',owner2,'role','authenticated')::text, true);
  caught := false;
  begin perform public.create_project(team_a, 'Forged Team'); exception when insufficient_privilege then caught := true; end;
  assert caught, '44: org 2 owner, forged team_id of org 1 (RPC) rejected';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'Forged','forged','GREENFIELD',owner2);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '44: org 2 owner, forged team_id of org 1 (direct INSERT) rejected';

  -- positive control + same name in another org/team is fine
  select * into r from public.create_project(team_bb, 'Payments', 'Org B payments', 'BROWNFIELD');
  p_bb := r.id;
  assert r.slug = 'payments', 'another organization may reuse a project name';

  ---------------------------------------------------------------- 3/4/16-21 visibility
  perform set_config('request.jwt.claims', json_build_object('sub',owner1,'role','authenticated')::text, true);
  select count(*) into n from public.projects; assert n = 2, 'OWNER sees every org 1 project (and no org 2), saw ' || n;
  perform set_config('request.jwt.claims', json_build_object('sub',admin1,'role','authenticated')::text, true);
  select count(*) into n from public.projects; assert n = 2, 'ADMIN sees every org 1 project even in no team, saw ' || n;

  perform set_config('request.jwt.claims', json_build_object('sub',ma,'role','authenticated')::text, true);
  select count(*) into n from public.projects where id = p_a; assert n = 1, '16/3: team A member reads team A project';
  select count(*) into n from public.projects where id = p_b; assert n = 0, '17: team B project hidden from team A member';
  select count(*) into n from public.projects; assert n = 1, '3: team A member sees only permitted projects, saw ' || n;
  select count(*) into n from public.projects where id = p_bb; assert n = 0, '4: org 1 member cannot see org 2 project';

  perform set_config('request.jwt.claims', json_build_object('sub',mb,'role','authenticated')::text, true);
  select count(*) into n from public.projects where id = p_a; assert n = 0, '17: team B member cannot read team A project (same department)';
  select count(*) into n from public.projects where id = p_b; assert n = 1, 'team B member reads team B project';

  perform set_config('request.jwt.claims', json_build_object('sub',mdept,'role','authenticated')::text, true);
  select count(*) into n from public.projects; assert n = 0, '19: same-department user with no team sees nothing';
  perform set_config('request.jwt.claims', json_build_object('sub',mx,'role','authenticated')::text, true);
  select count(*) into n from public.projects; assert n = 0, '18: same-org non-team member sees nothing';
  perform set_config('request.jwt.claims', json_build_object('sub',mo,'role','authenticated')::text, true);
  select count(*) into n from public.projects; assert n = 0, '20: user in another department sees nothing';
  perform set_config('request.jwt.claims', json_build_object('sub',owner2,'role','authenticated')::text, true);
  select count(*) into n from public.projects where id in (p_a, p_b); assert n = 0, '21: other organization cannot read org 1 projects';
  select count(*) into n from public.projects; assert n = 1, 'org 2 owner sees only org 2 projects, saw ' || n;
  perform set_config('request.jwt.claims', json_build_object('sub',m2,'role','authenticated')::text, true);
  select count(*) into n from public.projects where id = p_bb; assert n = 1, 'org 2 team member reads own project';
  select count(*) into n from public.projects where id in (p_a, p_b); assert n = 0, 'org 2 member cannot read org 1 projects';

  ---------------------------------------------------------------- 22-25 duplicate names, 23 duplicate slugs
  perform set_config('request.jwt.claims', json_build_object('sub',owner1,'role','authenticated')::text, true);
  caught := false;
  begin perform public.create_project(team_a, 'Payments'); exception when unique_violation then caught := true; end;
  assert caught, '22: duplicate project name rejected';
  caught := false;
  begin perform public.create_project(team_a, 'payments'); exception when unique_violation then caught := true; end;
  assert caught, '24: case-insensitive duplicate name rejected';
  caught := false;
  begin perform public.create_project(team_a, '   PAYMENTS  '); exception when unique_violation then caught := true; end;
  assert caught, '25: whitespace-normalized duplicate name rejected';
  select * into r from public.create_project(team_a, 'Pay-ments!'); -- different name, same slug base? ('pay-ments') no collision
  assert r.slug = 'pay-ments', 'slug derived from punctuation';
  select * into r from public.create_project(team_a, 'Payments!');   -- slug base 'payments' collides -> suffix
  assert r.slug like 'payments-%' and r.slug <> 'payments', 'slug collision gets random suffix, got ' || r.slug;
  p_x := r.id;
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'Other Name','payments','GREENFIELD',owner1);
  exception when unique_violation then caught := true; end;
  assert caught, '23: duplicate slug rejected within a team';
  select * into r from public.create_project(team_b, 'Payments');
  assert r.slug = 'payments', 'same project name allowed in a different team';

  ---------------------------------------------------------------- 26/27 invalid type/status, other validation
  caught := false;
  begin perform public.create_project(team_a, 'Typed', null, 'HYBRID'); exception when check_violation then caught := true; end;
  assert caught, '26: invalid project_type rejected (RPC)';
  reset role;
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'T','t','HYBRID',owner1);
  exception when check_violation then caught := true; end;
  assert caught, '26: invalid project_type rejected by CHECK';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,status,created_by) values (team_a,'S','s','GREENFIELD','DONE',owner1);
  exception when check_violation then caught := true; end;
  assert caught, '27: invalid status rejected by CHECK';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'Bad','Bad Slug','GREENFIELD',owner1);
  exception when check_violation then caught := true; end;
  assert caught, 'non kebab-case slug rejected';
  caught := false;
  begin insert into public.projects (team_id,name,slug,description,project_type,created_by) values (team_a,'Long','long',repeat('x',1001),'GREENFIELD',owner1);
  exception when check_violation then caught := true; end;
  assert caught, 'description over 1000 chars rejected';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,repeat('x',151),'toolong','GREENFIELD',owner1);
  exception when check_violation then caught := true; end;
  assert caught, 'name over 150 chars rejected';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'   ','blank','GREENFIELD',owner1);
  exception when check_violation then caught := true; end;
  assert caught, 'blank name rejected';

  ---------------------------------------------------------------- 28/29 invalid / deleted team
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values ('00000000-0000-0000-0000-00000000ffff','X','x','GREENFIELD',owner1);
  exception when foreign_key_violation then caught := true; end;
  assert caught, '28: nonexistent team_id rejected by FK';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',owner1,'role','authenticated')::text, true);
  caught := false;
  begin perform public.create_project('00000000-0000-0000-0000-00000000ffff', 'Ghost Team'); exception when insufficient_privilege then caught := true; end;
  assert caught, '28: nonexistent team_id rejected for clients (RLS)';
  reset role;
  insert into public.teams (department_id,name,slug,created_by) values (dept1,'Temp','temp',owner1) returning id into team_tmp;
  insert into public.projects (team_id,name,slug,project_type,created_by) values (team_tmp,'Tmp','tmp','GREENFIELD',owner1) returning id into p_tmp;
  delete from public.teams where id = team_tmp;
  select count(*) into n from public.projects where id = p_tmp; assert n = 0, 'deleting a team cascades to its projects';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_tmp,'Tmp2','tmp2','GREENFIELD',owner1);
  exception when foreign_key_violation then caught := true; end;
  assert caught, '29: project cannot reference a deleted team';

  ---------------------------------------------------------------- 10/11/12 update by role + 5/6 cross-tenant
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',owner1,'role','authenticated')::text, true);
  update public.projects set description = 'by owner' where id = p_a;
  get diagnostics n = row_count; assert n = 1, '10: OWNER updates project';
  perform set_config('request.jwt.claims', json_build_object('sub',admin1,'role','authenticated')::text, true);
  update public.projects set name = 'Hiring Platform v2' where id = p_b;
  get diagnostics n = row_count; assert n = 1, '11: ADMIN updates project in a team they are not in';
  perform set_config('request.jwt.claims', json_build_object('sub',ma,'role','authenticated')::text, true);
  update public.projects set description = 'by member' where id = p_a;
  get diagnostics n = row_count; assert n = 0, '12: team MEMBER (can read) must not update project';
  update public.projects set status = 'ACTIVE' where id = p_a;
  get diagnostics n = row_count; assert n = 0, '12: team MEMBER must not change status';
  perform set_config('request.jwt.claims', json_build_object('sub',mb,'role','authenticated')::text, true);
  update public.projects set description = 'wrong team' where id = p_a;
  get diagnostics n = row_count; assert n = 0, 'wrong-team MEMBER must not update project';
  perform set_config('request.jwt.claims', json_build_object('sub',m2,'role','authenticated')::text, true);
  update public.projects set description = 'org b member' where id = p_a;
  get diagnostics n = row_count; assert n = 0, '6: org 2 member must not modify org 1 project';
  perform set_config('request.jwt.claims', json_build_object('sub',admin1,'role','authenticated')::text, true);
  update public.projects set description = 'org a admin' where id = p_bb;
  get diagnostics n = row_count; assert n = 0, '5: org 1 admin must not modify org 2 project';
  delete from public.projects where id = p_bb;
  get diagnostics n = row_count; assert n = 0, '5: org 1 admin must not delete org 2 project';
  perform set_config('request.jwt.claims', json_build_object('sub',owner2,'role','authenticated')::text, true);
  update public.projects set description = 'org b owner' where id = p_a;
  get diagnostics n = row_count; assert n = 0, 'org 2 owner must not modify org 1 project';

  ---------------------------------------------------------------- 30/31/32 immutable fields, forged created_by
  perform set_config('request.jwt.claims', json_build_object('sub',owner1,'role','authenticated')::text, true);
  caught := false;
  begin update public.projects set team_id = team_b where id = p_a; exception when insufficient_privilege then caught := true; end;
  assert caught, '31: team_id (same department) not client-updatable';
  caught := false;
  begin update public.projects set team_id = team_bb where id = p_a; exception when insufficient_privilege then caught := true; end;
  assert caught, '31: team_id (other organization) not client-updatable';
  caught := false;
  begin update public.projects set slug = 'hijack' where id = p_a; exception when insufficient_privilege then caught := true; end;
  assert caught, '32: slug not client-updatable';
  caught := false;
  begin update public.projects set created_by = admin1 where id = p_a; exception when insufficient_privilege then caught := true; end;
  assert caught, '30: created_by not client-updatable';
  caught := false;
  begin update public.projects set project_type = 'BROWNFIELD' where id = p_a; exception when insufficient_privilege then caught := true; end;
  assert caught, 'project_type is immutable after creation';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,created_by) values (team_a,'Forged Author','forged-author','GREENFIELD',admin1);
  exception when insufficient_privilege then caught := true; end;
  assert caught, '30: created_by cannot be forged on INSERT';
  caught := false;
  begin insert into public.projects (team_id,name,slug,project_type,status,created_by) values (team_a,'Born Active','born-active','GREENFIELD','ACTIVE',owner1);
  exception when insufficient_privilege then caught := true; end;
  assert caught, 'projects can only be inserted as DRAFT';

  ---------------------------------------------------------------- 33-37 lifecycle
  select * into r from public.create_project(team_a, 'Lifecycle One'); p_life := r.id;
  select * into r from public.create_project(team_a, 'Lifecycle Two'); p_life2 := r.id;
  update public.projects set status = 'ACTIVE' where id = p_life;
  get diagnostics n = row_count; assert n = 1, '33: DRAFT -> ACTIVE';
  update public.projects set status = 'ARCHIVED' where id = p_life2;
  get diagnostics n = row_count; assert n = 1, '34: DRAFT -> ARCHIVED';
  update public.projects set status = 'ARCHIVED' where id = p_life;
  get diagnostics n = row_count; assert n = 1, '35: ACTIVE -> ARCHIVED';
  update public.projects set status = 'ACTIVE' where id = p_life;
  get diagnostics n = row_count; assert n = 1, '36: ARCHIVED -> ACTIVE';
  update public.projects set status = 'ACTIVE' where id = p_life;
  get diagnostics n = row_count; assert n = 1, 'same-status update is a no-op, not an error';
  update public.projects set status = 'ARCHIVED' where id = p_life;
  caught := false;
  begin update public.projects set status = 'DRAFT' where id = p_life; exception when check_violation then caught := true; end;
  assert caught, '37: ARCHIVED -> DRAFT rejected';
  update public.projects set status = 'ACTIVE' where id = p_life;
  caught := false;
  begin update public.projects set status = 'DRAFT' where id = p_life; exception when check_violation then caught := true; end;
  assert caught, 'ACTIVE -> DRAFT rejected';
  caught := false;
  begin update public.projects set status = 'DONE' where id = p_life; exception when check_violation then caught := true; end;
  assert caught, 'unknown status value rejected on update';
  select status into r from public.projects where id = p_life;
  assert r.status = 'ACTIVE', 'rejected transitions leave status unchanged';

  ---------------------------------------------------------------- 13/14/15 delete
  select * into r from public.create_project(team_a, 'Delete Me One'); p_del1 := r.id;
  select * into r from public.create_project(team_b, 'Delete Me Two'); p_del2 := r.id;
  perform set_config('request.jwt.claims', json_build_object('sub',ma,'role','authenticated')::text, true);
  delete from public.projects where id = p_del1;
  get diagnostics n = row_count; assert n = 0, '15: team MEMBER must not delete project';
  perform set_config('request.jwt.claims', json_build_object('sub',mb,'role','authenticated')::text, true);
  delete from public.projects where id = p_del1;
  get diagnostics n = row_count; assert n = 0, 'wrong-team MEMBER must not delete project';
  perform set_config('request.jwt.claims', json_build_object('sub',owner2,'role','authenticated')::text, true);
  delete from public.projects where id = p_del1;
  get diagnostics n = row_count; assert n = 0, 'other organization must not delete project';
  perform set_config('request.jwt.claims', json_build_object('sub',owner1,'role','authenticated')::text, true);
  delete from public.projects where id = p_del1;
  get diagnostics n = row_count; assert n = 1, '13: OWNER deletes project';
  perform set_config('request.jwt.claims', json_build_object('sub',admin1,'role','authenticated')::text, true);
  delete from public.projects where id = p_del2;
  get diagnostics n = row_count; assert n = 1, '14: ADMIN deletes project';

  ---------------------------------------------------------------- access follows team membership
  reset role;
  delete from public.team_members where team_id = team_a and user_id = ma;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',ma,'role','authenticated')::text, true);
  select count(*) into n from public.projects where team_id = team_a;
  assert n = 0, 'removing a user from the team removes their project access';
  reset role;
  insert into public.team_members (team_id,user_id) values (team_a, ma);

  ---------------------------------------------------------------- cascades: department -> teams -> projects; org -> all
  select count(*) into n from public.projects where team_id = team_a; assert n > 0, 'cascade setup (team A has projects)';
  delete from public.departments where id = dept1;
  select count(*) into n from public.projects where team_id in (team_a, team_b);
  assert n = 0, 'deleting a department cascades through teams to projects';
  select count(*) into n from public.projects where id = p_bb; assert n = 1, 'other organization untouched by cascade';
  delete from public.organizations where id = org2;
  select count(*) into n from public.projects where id = p_bb;
  assert n = 0, 'deleting an organization cascades through departments and teams to projects';

  raise notice 'ALL PROJECT CHECKS PASSED';
end;
$$;

rollback;
